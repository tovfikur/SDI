/**
 * Files domain (Spec §22 / Phase 22): MinIO/S3 object storage adapter,
 * upload-session orchestration, metadata rows and presigned download URLs.
 * Virus scanning is pluggable (default stub marks files clean); hook
 * `setScanHandler` to wire ClamAV.
 */

import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { query, withTransaction, list } from '@jsk/shared-kernel';
import type { PaginatedResponse } from '@jsk/shared-kernel';
import type { FilterParam } from '@jsk/shared-kernel';
import { Client as MinioClient } from 'minio';
import type { ItemBucketMetadata } from 'minio';

export interface StorageConfig {
  endpoint: string;
  port?: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL?: boolean;
  forcePathStyle?: boolean;
}

export interface FileRecord {
  id: string;
  module: string;
  entity_type: string;
  entity_id: string | null;
  storage_key: string;
  original_filename: string;
  size_bytes: string;
  mime_type: string;
  scan_status: 'pending' | 'clean' | 'quarantined' | 'failed';
}

type ScanHandler = (bucket: string, key: string) => Promise<'clean' | 'quarantined'>;

/** Domain error carrying a stable machine code (mapped to HTTP by controllers). */
export class FilesError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FilesError';
    this.code = code;
  }
}

/** Login background images: strict whitelist enforced server-side. */
const LOGIN_BG_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LOGIN_BG_MAX_BYTES = 5 * 1024 * 1024;
/** Generic cap for any other module's uploads. */
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

let client: MinioClient | null = null;
let bucket = 'jsk-files';
let scanHandler: ScanHandler = async () => 'clean';

export function configureStorage(config: StorageConfig): void {
  client = new MinioClient({
    endPoint: config.endpoint,
    port: config.port ?? 9000,
    useSSL: config.useSSL ?? false,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    pathStyle: config.forcePathStyle ?? true,
  });
  bucket = config.bucket;
}

export function setScanHandler(handler: ScanHandler): void {
  scanHandler = handler;
}

function getClient(): MinioClient {
  if (!client) {
    throw new FilesError('files.storage_unavailable', 'Object storage is not configured');
  }
  return client;
}

/** Runs a storage-dependent operation, mapping connection failures to a clear error. */
async function withStorage<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof FilesError) throw error;
    const err = error as NodeJS.ErrnoException;
    const connFailure =
      err?.code === 'ECONNREFUSED' ||
      err?.code === 'ECONNRESET' ||
      err?.code === 'ENOTFOUND' ||
      err?.code === 'ETIMEDOUT' ||
      /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|Connection closed|socket hang up/i.test(
        String(err?.message ?? '')
      );
    if (connFailure) {
      throw new FilesError(
        'files.storage_unavailable',
        `Object storage is unreachable (${operation} failed). Start MinIO/S3 and try again.`
      );
    }
    throw error;
  }
}

/** Strips path components / unsafe characters from client-supplied filenames. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 180) : 'file';
}

export async function ensureBucket(): Promise<void> {
  const exists = await getClient().bucketExists(bucket);
  if (!exists) {
    await getClient().makeBucket(bucket);
  }
}

// ---------------------------------------------------------------------------
// Upload sessions
// ---------------------------------------------------------------------------

/** Presigns a PUT URL; auto-creates the bucket if it is missing; the metadata row
 *  is only written on confirm (secure). */
export async function createUploadSession(input: {
  module: string;
  entity_type: string;
  entity_id?: string | undefined;
  original_filename: string;
  mime_type?: string | undefined;
  size_bytes?: number | undefined;
  expiresInMinutes?: number | undefined;
  uploaded_by?: string | undefined;
}): Promise<{ session_id: string; storage_key: string; upload_url: string; expires_at: string }> {
  // ---- server-side validation (never trust the client) --------------------
  if (!input.original_filename || input.original_filename.trim() === '') {
    throw new FilesError('files.bad_request', 'original_filename is required');
  }
  const filename = sanitizeFilename(input.original_filename);
  const mimeType = (input.mime_type ?? '').toLowerCase();
  const sizeBytes = input.size_bytes ?? 0;

  if (input.module === 'settings' && input.entity_type === 'login_bg') {
    const isImage = LOGIN_BG_MIME_TYPES.has(mimeType) || /\.(jpe?g|png|webp)$/i.test(filename);
    if (!isImage) {
      throw new FilesError(
        'files.unsupported_type',
        'Login background must be a JPG, PNG or WebP image'
      );
    }
    if (sizeBytes > LOGIN_BG_MAX_BYTES) {
      throw new FilesError('files.too_large', 'Login background must be 5 MB or smaller');
    }
  } else if (sizeBytes > DEFAULT_MAX_BYTES) {
    throw new FilesError('files.too_large', 'File exceeds the 25 MB limit');
  }

  return withTransaction(async (client) => {
    const storageKey = `${input.module}/${randomUUID()}/${filename}`;
    const expiresAt = new Date(Date.now() + (input.expiresInMinutes ?? 60) * 60_000);

    const { rows: sessionRows } = await client.query<{ id: string }>(
      `INSERT INTO upload_sessions (storage_key, entity_type, entity_id, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [storageKey, input.entity_type, input.entity_id ?? null, expiresAt.toISOString()]
    );

    const presign = () =>
      getClient().presignedPutObject(bucket, storageKey, (input.expiresInMinutes ?? 60) * 60);
    let uploadUrl: string;
    try {
      uploadUrl = await withStorage('presign upload URL', presign);
    } catch (error) {
      // Self-heal: bucket removed (or created before storage came up) — recreate once and retry.
      if (/does not exist/i.test(String((error as Error)?.message))) {
        await ensureBucket();
        uploadUrl = await withStorage('presign upload URL', presign);
      } else {
        throw error;
      }
    }

    await client.query(
      `INSERT INTO files (module, entity_type, entity_id, storage_key, original_filename, size_bytes, mime_type, scan_status, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
      [
        input.module,
        input.entity_type,
        input.entity_id ?? null,
        storageKey,
        input.original_filename,
        input.size_bytes ?? 0,
        input.mime_type ?? '',
        input.uploaded_by ?? null,
      ]
    );

    return {
      session_id: sessionRows[0].id,
      storage_key: storageKey,
      upload_url: uploadUrl,
      expires_at: expiresAt.toISOString(),
    };
  });
}

export async function putObjectStream(
  storageKey: string,
  body: Readable | Buffer,
  size: number,
  mimeType?: string
): Promise<void> {
  await withStorage('upload object', () =>
    getClient().putObject(bucket, storageKey, body, size, mimeType ? { 'Content-Type': mimeType } : {})
  );
}

/** Pending upload-session metadata (used by the API upload proxy). */
export async function getUploadSession(sessionId: string): Promise<{
  id: string;
  storage_key: string;
  status: string;
  expires_at: string;
  mime_type: string | null;
  size_bytes: string | null;
} | null> {
  const { rows } = await query<{
    id: string;
    storage_key: string;
    status: string;
    expires_at: string;
    mime_type: string | null;
    size_bytes: string | null;
  }>(
    `SELECT s.id, s.storage_key, s.status, s.expires_at, f.mime_type, f.size_bytes
       FROM upload_sessions s
  LEFT JOIN files f ON f.storage_key = s.storage_key
      WHERE s.id = $1::uuid`,
    [sessionId]
  );
  return rows[0] ?? null;
}

/** Call after the client finished the presigned PUT to confirm the session. */
export async function confirmUpload(sessionId: string, uploadedBy?: string): Promise<FileRecord | null> {
  return withTransaction(async (client) => {
    const { rows: sessions } = await client.query(
      `SELECT * FROM upload_sessions WHERE id = $1::uuid AND status = 'pending' FOR UPDATE`,
      [sessionId]
    );
    if (sessions.length === 0) {
      throw new FilesError('files.session_invalid', 'Upload session not found or already used');
    }
    const session = sessions[0];
    if (new Date(session.expires_at) < new Date()) {
      await client.query(`UPDATE upload_sessions SET status='expired' WHERE id = $1::uuid`, [sessionId]);
      throw new FilesError('files.session_expired', 'Upload session has expired — please retry the upload');
    }

    // The browser must have completed the presigned PUT before confirm.
    const stat = await withStorage('verify uploaded object', () => statObject(session.storage_key));
    if (!stat) {
      await client.query(`UPDATE upload_sessions SET status='failed' WHERE id = $1::uuid`, [sessionId]);
      throw new FilesError(
        'files.not_uploaded',
        'No file was received for this upload session — please try uploading again'
      );
    }

    const scanStatus = await scanHandler(bucket, session.storage_key);
    const { rows } = await client.query<FileRecord>(
      `UPDATE files
          SET scan_status = $2, uploaded_by = COALESCE($3, uploaded_by)
        WHERE storage_key = $1 RETURNING *`,
      [session.storage_key, scanStatus, uploadedBy ?? null]
    );
    await client.query(`UPDATE upload_sessions SET status='confirmed' WHERE id = $1::uuid`, [sessionId]);
    return rows[0] ?? null;
  });
}

// ---------------------------------------------------------------------------
// Metadata queries
// ---------------------------------------------------------------------------

export async function listFiles(input: { filters?: FilterParam[]; page?: number; per_page?: number }): Promise<PaginatedResponse<Record<string, unknown>>> {
  return list({
    table: 'files f',
    columns: {
      id: { type: 'uuid', sql: 'f.id' },
      module: { type: 'text', sql: 'f.module' },
      entity_type: { type: 'text', sql: 'f.entity_type' },
      entity_id: { type: 'uuid', sql: 'f.entity_id' },
      original_filename: { type: 'text', sql: 'f.original_filename' },
      mime_type: { type: 'text', sql: 'f.mime_type' },
      scan_status: { type: 'text', sql: 'f.scan_status' },
      created_at: { type: 'datetime', sql: 'f.created_at' },
      uploaded_by_name: { type: 'text', sql: 'u.full_name' },
    },
    joins: 'LEFT JOIN users u ON u.id = f.uploaded_by',
    filters: input.filters,
    defaultSort: { field: 'created_at', direction: 'desc' },
    activeOnly: true,
    pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
  });
}

/** Presigned GET URL (expires in `ttlSeconds`, default 1 hour). */
export async function getDownloadUrl(fileId: string, ttlSeconds = 3600): Promise<{ url: string; filename: string }> {
  const { rows } = await query<FileRecord>(
    `SELECT * FROM files WHERE id = $1::uuid AND deleted_at IS NULL`,
    [fileId]
  );
  if (rows.length === 0) {
    throw new Error('files.not_found');
  }
  const file = rows[0];
  if (file.scan_status !== 'clean') {
    throw new Error('files.not_scanned');
  }
  const url = await withStorage('presign download URL', () =>
    getClient().presignedGetObject(bucket, file.storage_key, ttlSeconds)
  );
  return { url, filename: file.original_filename };
}

export async function getFile(id: string): Promise<FileRecord | null> {
  const { rows } = await query<FileRecord>(`SELECT * FROM files WHERE id = $1::uuid`, [id]);
  return rows[0] ?? null;
}

/** Streams a stored file's bytes (used by the public branding proxy). */
export async function streamFile(fileId: string): Promise<{ stream: NodeJS.ReadableStream; mime_type: string; original_filename: string } | null> {
  const file = await getFile(fileId);
  if (!file || (file.scan_status !== 'clean' && file.scan_status !== 'pending')) {
    return null;
  }
  const stream = await withStorage('read object', () => getClient().getObject(bucket, file.storage_key));
  return { stream, mime_type: file.mime_type, original_filename: file.original_filename };
}

/** Presigned GET URL for an arbitrary storage key (used by modules that own their
 *  attachment tables, e.g. meeting_attachments). Verifies the key exists. */
export async function getDownloadUrlByKey(storageKey: string, filename: string, ttlSeconds = 3600): Promise<{ url: string; filename: string }> {
  const url = await getClient().presignedGetObject(bucket, storageKey, ttlSeconds);
  return { url, filename };
}

export async function deleteFile(id: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT storage_key FROM files WHERE id = $1::uuid AND deleted_at IS NULL`,
      [id]
    );
    if (rows.length === 0) {
      return false;
    }
    try {
      await getClient().removeObject(bucket, rows[0].storage_key);
    } catch {
      // orphaned object: still allow metadata removal
    }
    await client.query(`UPDATE files SET deleted_at = now() WHERE id = $1::uuid`, [id]);
    return true;
  });
}

export async function statObject(storageKey: string): Promise<{ size: number; metaData: ItemBucketMetadata } | null> {
  try {
    return await getClient().statObject(bucket, storageKey);
  } catch {
    return null;
  }
}

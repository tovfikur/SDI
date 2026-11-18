import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { files } from '../api';
import { Icon, Icons } from './Icon';

export interface PhotoFile {
  file_id: string;
  preview: string;
}

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ACCEPTED_EXT = /\.(jpe?g|png|webp)$/i;
const MAX_BYTES = 5 * 1024 * 1024;

function typeError(name: string): string {
  return `${name} is not a supported photo type. Only JPG, JPEG, PNG or WebP are allowed.`;
}

function sizeError(): string {
  return 'Photo exceeds the 5MB limit.';
}

/** Resolves a confirmed file id to a presigned image URL (used for previews). */
export async function photoUrlFor(fileId: string): Promise<string> {
  const res = await files.fileDownload(fileId);
  return res.data.url;
}

/**
 * Circular avatar that renders a confirmed file photo (presigned URL fetched
 * on demand), a legacy photo_url, or initials when no photo exists.
 */
export function EmployeeAvatar({
  fileId,
  url,
  name,
  size = 40,
}: {
  fileId?: string | null;
  url?: string | null;
  name: string;
  size?: number;
}): ReactElement {
  const [src, setSrc] = useState<string | null>(url ?? null);
  const [failed, setFailed] = useState(false);
  const requested = useRef<string | null>(null);

  useEffect(() => {
    setFailed(false);
    if (url) {
      setSrc(url);
      return;
    }
    if (fileId) {
      if (requested.current !== fileId) {
        requested.current = fileId;
        photoUrlFor(fileId)
          .then((u) => setSrc((prev) => (failed ? prev : u)))
          .catch(() => setFailed(true));
      }
      return;
    }
    setSrc(null);
  }, [fileId, url, failed]);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      className="employee-avatar"
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      title={name}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: size, height: size }}
        />
      ) : (
        <span className="employee-avatar-initials">{initials || <Icon icon={Icons.UserTie} size="sm" />}</span>
      )}
    </span>
  );
}

/**
 * Premium circular photo uploader backed by the file-session infrastructure.
 * Validates JPG/JPEG/PNG/WebP up to 5MB, previews instantly, then persists
 * the confirmed file id via onChange.
 */
export function EmployeePhotoUpload({
  value,
  legacyUrl,
  onChange,
  error,
  disabled = false,
}: {
  value: PhotoFile | null;
  legacyUrl?: string | null;
  onChange: (v: PhotoFile | null) => void;
  error?: string;
  disabled?: boolean;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrl = useRef<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [resolvedPreview, setResolvedPreview] = useState<string | null>(null);

  useEffect(() => {
    if (value?.file_id && !value.preview) {
      let cancelled = false;
      photoUrlFor(value.file_id)
        .then((u) => {
          if (!cancelled) setResolvedPreview(u);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    setResolvedPreview(null);
    return undefined;
  }, [value]);

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const pick = () => {
    if (disabled || progress !== null) return;
    setUploadError('');
    inputRef.current?.click();
  };

  const uploadPhoto = (file: File): Promise<PhotoFile> =>
    new Promise((resolve, reject) => {
      (async () => {
        try {
          const sess = await files.createUploadSession({
            module: 'hr',
            entity_type: 'employee_photo',
            original_filename: file.name,
            mime_type: file.type || 'application/octet-stream',
            size_bytes: file.size,
          });

          await new Promise<void>((res, rej) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', sess.upload_url);
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
            };
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? res() : rej(new Error(`Upload failed (${xhr.status})`)));
            xhr.onerror = () => rej(new Error('Upload failed — check your connection and try again.'));
            xhr.send(file);
          });

          const confirmed = await files.confirmUpload(sess.session_id);
          const preview = await photoUrlFor(confirmed.data.id);
          resolve({ file_id: confirmed.data.id, preview });
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Upload failed'));
        }
      })();
    });

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ACCEPTED_EXT.test(file.name)) {
      setUploadError(typeError(file.name));
      return;
    }
    if (file.type && !ACCEPTED_TYPES.has(file.type)) {
      setUploadError(typeError(file.name));
      return;
    }
    if (file.size > MAX_BYTES) {
      setUploadError(sizeError());
      return;
    }

    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setProgress(0);
    setUploadError('');
    try {
      const result = await uploadPhoto(file);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
      onChange(result);
      setProgress(null);
    } catch (err) {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
      setProgress(null);
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    }
  };

  const shownError = error || uploadError;
  const previewSrc = value?.preview || resolvedPreview || legacyUrl || null;

  return (
    <div className={`photo-uploader${shownError ? ' photo-uploader-invalid' : ''}`}>
      <input
        ref={inputRef}
        type="file"
        className="file-uploader-input"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        onChange={(e) => void handleChange(e)}
        disabled={disabled}
      />

      <button type="button" className="photo-uploader-frame" onClick={pick} disabled={disabled || progress !== null} title="Upload / replace photo">
        {progress !== null ? (
          <span className="photo-uploader-progress">
            <span className="photo-uploader-progress-track">
              <span className="photo-uploader-progress-fill" style={{ width: `${progress}%` }} />
            </span>
            <span className="photo-uploader-progress-label">{progress}%</span>
          </span>
        ) : previewSrc ? (
          <img src={previewSrc} alt="Employee photo" />
        ) : (
          <span className="photo-uploader-placeholder">
            <Icon icon={Icons.UserTie} size="2xl" />
          </span>
        )}
        <span className="photo-uploader-overlay">
          <Icon icon={Icons.Camera} />
          <small>Change</small>
        </span>
      </button>

      <div className="photo-uploader-actions">
        <button type="button" className="btn-clay btn-clay-sm btn-clay-secondary" onClick={pick} disabled={disabled || progress !== null}>
          <Icon icon={Icons.Upload} size="xs" /> {previewSrc ? 'Replace' : 'Upload Photo'}
        </button>
        {previewSrc && (
          <button
            type="button"
            className="btn-clay btn-clay-sm btn-clay-danger"
            onClick={() => {
              setUploadError('');
              if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
              objectUrl.current = null;
              onChange(null);
            }}
            disabled={disabled || progress !== null}
          >
            <Icon icon={Icons.Trash} size="xs" /> Remove
          </button>
        )}
      </div>
      <p className="photo-uploader-hint">JPG, JPEG, PNG or WebP · max 5MB</p>

      {shownError && <div className="form-error-text">{shownError}</div>}
    </div>
  );
}
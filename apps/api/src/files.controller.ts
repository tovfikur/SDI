import { Body, Controller, Delete, Get, HttpException, Param, Post, Put, Query, Req, Res, UseGuards, BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createUploadSession, confirmUpload, listFiles, getDownloadUrl, deleteFile, getUploadSession, putObjectStream, streamFile, FilesError } from '@jsk/domain-files';
import { parseFilters } from '@jsk/shared-kernel';
import type { FilterParam } from '@jsk/shared-kernel';
import { Permissions } from './auth/guards';
import { contentDisposition, proxyUploadUrl, requestOrigin } from './file-urls';

/** HTTP status per stable domain error code. */
const FILES_ERROR_STATUS: Record<string, 400 | 404 | 410 | 503> = {
  'files.bad_request': 400,
  'files.unsupported_type': 400,
  'files.too_large': 400,
  'files.not_uploaded': 400,
  'files.not_scanned': 400,
  'files.session_invalid': 400,
  'files.session_expired': 410,
  'files.not_found': 404,
  'files.storage_unavailable': 503,
};

function toHttpError(error: unknown): never {
  if (error instanceof FilesError) {
    const status = FILES_ERROR_STATUS[error.code] ?? 500;
    if (status === 503) throw new ServiceUnavailableException(error.message);
    if (status === 404) throw new NotFoundException(error.message);
    if (status === 410) throw new HttpException(error.message, 410);
    throw new BadRequestException(error.message);
  }
  throw error;
}

@Controller('api/files')
export class FilesController {
  @Post('sessions')
  @UseGuards(Permissions('hr.files.upload', 'pm.daily_task.manage', 'pm.daily_task.approve'))
  async createSession(
    @Body() body: {
      module?: string; entity_type?: string; entity_id?: string; original_filename?: string;
      mime_type?: string; size_bytes?: number; uploaded_by?: string;
    },
    @Req() req: Request
  ) {
    if (!body.module || !body.entity_type || !body.original_filename) {
      throw new BadRequestException('module, entity_type and original_filename are required');
    }
    try {
      const result = await createUploadSession({
        module: body.module,
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        original_filename: body.original_filename,
        mime_type: body.mime_type,
        size_bytes: body.size_bytes,
        uploaded_by: body.uploaded_by,
      });
      // Storage is internal-only; the browser uploads through this API instead
      // of a presigned MinIO URL it cannot reach.
      return { success: true, ...result, upload_url: proxyUploadUrl(req, result.session_id) };
    } catch (error) {
      toHttpError(error);
    }
  }

  /**
   * Upload proxy: accepts the raw bytes for a pending session and streams them
   * into MinIO/S3. The session id is an unguessable capability; the route is
   * public (no cookies) so cross-origin dev uploads work too.
   */
  @Put('sessions/:id/upload')
  async upload(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    let session: Awaited<ReturnType<typeof getUploadSession>>;
    try {
      session = await getUploadSession(id);
    } catch {
      throw new BadRequestException('Invalid upload session');
    }
    if (!session || session.status !== 'pending') {
      throw new BadRequestException('Upload session is invalid or already used');
    }
    if (new Date(session.expires_at) < new Date()) {
      throw new HttpException('Upload session has expired — please retry the upload', 410);
    }
    const headerLength = Number(req.headers['content-length']);
    const size =
      Number.isFinite(headerLength) && headerLength > 0 ? headerLength : Number(session.size_bytes ?? 0);
    if (!Number.isFinite(size) || size <= 0) {
      throw new BadRequestException('File size is required');
    }
    try {
      await putObjectStream(session.storage_key, req, size, session.mime_type || undefined);
    } catch (error) {
      toHttpError(error);
    }
    res.status(200).json({ success: true });
  }

  @Post('confirm')
  @UseGuards(Permissions('hr.files.upload', 'pm.daily_task.manage', 'pm.daily_task.approve'))
  async confirm(@Body() body: { sessionId?: string; uploadedBy?: string }) {
    if (!body.sessionId) throw new BadRequestException('sessionId is required');
    try {
      return { success: true, data: await confirmUpload(body.sessionId, body.uploadedBy) };
    } catch (error) {
      toHttpError(error);
    }
  }

  @Get()
  @UseGuards(Permissions('hr.files.upload', 'hr.employee.view', 'hr.masters.view', 'pm.daily_task.manage', 'pm.daily_task.approve'))
  async list(@Query() q: Record<string, string>) {
    const filters: FilterParam[] = parseFilters(q);
    const page = q['page'] ? parseInt(q['page'], 10) : 1;
    const perPage = q['perPage'] ? parseInt(q['perPage'], 10) : 10;
    return { data: await listFiles({ filters, page, per_page: perPage }) };
  }

  @Get(':id/download')
  @UseGuards(Permissions('hr.files.upload', 'hr.employee.view', 'hr.masters.view', 'pm.daily_task.manage', 'pm.daily_task.approve'))
  async download(@Param('id') id: string, @Req() req: Request) {
    try {
      const { filename } = await getDownloadUrl(id);
      return { data: { url: `${requestOrigin(req)}/api/files/${id}/content`, filename } };
    } catch (error) {
      toHttpError(error);
    }
  }

  /** Public stream for employee avatars and photos (works for mobile/web <img> tags). */
  @Get(':id/avatar')
  async avatar(@Param('id') id: string, @Res() res: Response): Promise<void> {
    let file: Awaited<ReturnType<typeof streamFile>>;
    try {
      file = await streamFile(id);
    } catch (error) {
      toHttpError(error);
    }
    if (!file) throw new NotFoundException('File not found');
    res.setHeader('Content-Type', file.mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    file.stream.pipe(res);
  }

  /** Streams the file bytes through the API (works for <img>, downloads, etc.). */
  @Get(':id/content')
  @UseGuards(Permissions('hr.files.upload', 'hr.employee.view', 'hr.masters.view', 'pm.daily_task.manage', 'pm.daily_task.approve'))
  async content(@Param('id') id: string, @Res() res: Response): Promise<void> {
    let file: Awaited<ReturnType<typeof streamFile>>;
    try {
      file = await streamFile(id);
    } catch (error) {
      toHttpError(error);
    }
    if (!file) throw new NotFoundException('File not found');
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(file.mime_type || '', file.original_filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    file.stream.pipe(res);
  }

  @Delete(':id')
  @UseGuards(Permissions('hr.files.delete'))
  async remove(@Param('id') id: string) {
    return { success: await deleteFile(id) };
  }
}

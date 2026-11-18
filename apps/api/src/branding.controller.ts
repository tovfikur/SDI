import { BadRequestException, Controller, Get, NotFoundException, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { getSettings } from '@jsk/domain-hr';
import { streamFile, FilesError } from '@jsk/domain-files';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public read-only branding endpoint — accessible before authentication. */
@Controller('api/branding')
export class BrandingController {
  @Get()
  async branding(@Res() res: Response): Promise<Response> {
    const s = await getSettings();
    const bgUrl = typeof s?.login_bg_url === 'string' && s.login_bg_url.trim() !== '' ? s.login_bg_url.trim() : null;
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(200).json({
      data: {
        company_title: s?.company_title ?? null,
        footer_text: s?.footer_text ?? null,
        login_bg_url: bgUrl,
      },
    });
  }

  @Get('background')
  async background(@Query('file') file: string | undefined, @Res() res: Response): Promise<void> {
    if (!file || !UUID_RE.test(file)) {
      throw new BadRequestException('Invalid background file');
    }
    let result;
    try {
      result = await streamFile(file);
    } catch (error) {
      if (error instanceof FilesError && error.code === 'files.storage_unavailable') {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
    if (!result) {
      throw new NotFoundException('Background image not found');
    }
    res.setHeader('Content-Type', result.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    result.stream.pipe(res);
  }
}
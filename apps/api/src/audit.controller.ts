import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { listActivities, getActivity, listMetaAudits, writeActivity, writeMetaAudit, deleteActivities } from '@jsk/domain-audit';
import { parseFilters, parseSort } from '@jsk/shared-kernel';
import type { FilterParam, SortParam } from '@jsk/shared-kernel';
import { Permissions } from './auth/guards';

@Controller('api/audit')
export class AuditController {
  @Get('logs')
  async logs(@Query() q: Record<string, string>) {
    const filters: FilterParam[] = parseFilters(q);
    const sort: SortParam | null = parseSort(q['sort'], q['direction']);
    const page = q['page'] ? parseInt(q['page'], 10) : 1;
    const perPage = q['perPage'] ? parseInt(q['perPage'], 10) : 10;
    const result = await listActivities({
      filters,
      sort,
      page,
      per_page: perPage,
      search: q['search'],
      dateFrom: q['dateFrom'],
      dateTo: q['dateTo'],
      all: q['all'] === 'true',
    });
    return { data: result };
  }

  @Get('logs/:id')
  async log(@Param('id') id: string) {
    return { data: await getActivity(id) };
  }

  @Post('logs')
  async createLog(@Body() body: { user_id?: string; action: string; entity_type: string; entity_id?: string; old_value?: Record<string, unknown>; new_value?: Record<string, unknown>; ip_address?: string }) {
    return { success: true, data: await writeActivity(body as never) };
  }

  @Delete('logs')
  @UseGuards(Permissions('audit.delete'))
  @HttpCode(HttpStatus.OK)
  async deleteLogs(@Body() body: { ids?: string[] }) {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : [];
    if (ids.length === 0) {
      return { success: true, deleted: 0 };
    }
    const deleted = await deleteActivities(ids);
    return { success: true, deleted };
  }

  @Get('meta')
  async meta(@Query() q: Record<string, string>) {
    const page = q['page'] ? parseInt(q['page'], 10) : 1;
    const perPage = q['perPage'] ? parseInt(q['perPage'], 10) : 10;
    const result = await listMetaAudits({ filters: parseFilters(q), page, per_page: perPage });
    return { data: result };
  }

  @Post('meta')
  async createMeta(@Body() body: { entity_type: string; entity_id: string; action: string; performed_by?: string; details?: Record<string, unknown> }) {
    return { success: true, data: await writeMetaAudit(body as never) };
  }
}

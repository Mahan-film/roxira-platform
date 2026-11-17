import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { requireTenantId } from '../../tenants/tenant-context';
import { AccessRequest, requireAccess } from '../../access/access-context';
import { AnyMember } from '../../access/decorators';
import { SearchQueryDto, SearchResponseDto } from '../dto/search.dto';
import { SearchService } from '../services/search.service';

/**
 * Universal entity search controller (Task T147).
 * Exposes a single `/search` (and `/enterprise-hub/search`) endpoint across:
 * - Customers & Suppliers (erp_parties)
 * - Products & Stock Items (erp_stock_items)
 * - Invoices & Purchase Bills (invoices)
 * - Cheques (fin_cheques)
 * - Accounts (fin_chart_of_accounts)
 * - Navigation pages
 *
 * Runs under RLS via TenantScope, backed by Postgres full-text & pg_trgm indexes.
 * Accessible to any active member (@AnyMember); the service only searches the
 * entity types whose module the caller may read (entitlement + read permission).
 */
@ApiTags('Search - جستجوی سراسری')
@ApiBearerAuth()
@Controller(['search', 'enterprise-hub/search'])
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @AnyMember()
  @ApiOperation({
    summary: 'جستجوی سراسری در تمام موجودیت‌های سازمانی و صفحات سامانه (T147)',
    description:
      'جستجوی هم‌زمان روی طرف‌حساب‌ها، کالاها، فاکتورها، چک‌ها، حساب‌ها و صفحات برنامه با ترایگرام و RLS.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'نتایج جستجو همراه با امتیاز تطابق و لینک هدایت مستقیم',
    type: SearchResponseDto,
  })
  async search(
    @Query() dto: SearchQueryDto,
    @Req() req: AccessRequest,
  ): Promise<SearchResponseDto> {
    const tenantId = requireTenantId(req);
    return this.searchService.search(tenantId, dto.q, dto.limit, dto.types, requireAccess(req));
  }
}

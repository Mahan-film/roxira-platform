import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AccessModule, AccessAction } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CreateReturnDto, ReturnResponseDto } from '../dto/sales-return.dto';
import { SalesReturnService } from '../services/sales-return.service';

/**
 * Returns for sales delivery invoices (#536 T1): create RETURN invoices that reverse
 * revenue, VAT, issue stock and post COGS reversal at the original cost.
 */
@ApiTags('Sales - برگشت کالا از تحویل')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/sales/invoices')
export class SalesReturnController {
  constructor(private readonly returns: SalesReturnService) {}

  /**
   * POST /enterprise-hub/sales/invoices/:invoiceId/returns
   * 
   * Creates a RETURN invoice for a sales delivery invoice with proper transaction isolation,
   * validating quantity constraints and posting stock/ledger reversals at original cost.
   * 
   * Request body: { lines: [{ deliveryLineId, quantity }], returnDate, idempotencyKey? }
   */
  @RequireAction(AccessAction.CREATE)
  @Post(':invoiceId/returns')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'ثبت برگشت کالا از حواله تحویل',
    description:
      'یک صورتحباب برگشتی (subject: RETURN) ایجاد می‌کند که برگشت را در همان ارز و نرخ مالیاتی
      صورتحباب مرجع ثبت می‌کند، کالا را با بهای تمام‌شده FIFO اصلی استock می‌کند و
      سند حسابداری ابطال بهای تمام‌شده (COGS reversal) را با شناسه منبع یکتا ثبت می‌کند.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: ReturnResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر (خط برگشتی به صورتحباب مرجع تعلق ندارد)' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'مقدار برگشتی مجاز نیست (از فروخته‌شده بیشتر است)' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'صورتحباب مرجع یا حواله تحویل یافت نشد' })
  async createReturn(
    @Req() request: AuthenticatedRequest,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: CreateReturnDto,
  ): Promise<ReturnResponseDto> {
    const tenantId = requireTenantId(request);
    const userId = String(request.user?.sub ?? 'unknown').slice(0, 64);
    
    return this.returns.createReturn(tenantId, invoiceId, dto, userId);
  }
}
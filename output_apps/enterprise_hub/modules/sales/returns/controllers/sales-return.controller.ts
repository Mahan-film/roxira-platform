import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../../access/decorators';
import { AuthenticatedRequest } from '../../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../../tenants/tenant-context';
import { CreateReturnDto, ReturnResponseDto } from '../dto/sales-return.dto';
import { SalesReturnService } from '../services/sales-return.service';

/**
 * Partial returns of delivery invoices (#565 T1 slice 5). The RETURN invoice is created through
 * the invoicing service; stock and COGS come back through the delivery lines.
 */
@ApiTags('Sales - برگشت کالا از تحویل')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/sales/invoices')
export class SalesReturnController {
  constructor(private readonly returns: SalesReturnService) {}

  /**
   * POST /enterprise-hub/sales/invoices/:invoiceId/returns
   * Body: { lines: [{ deliveryLineId, quantity }], returnDate, idempotencyKey? }
   */
  @RequireAction(AccessAction.CREATE)
  @Post(':invoiceId/returns')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'ثبت برگشت کالا از حواله تحویل',
    description:
      'یک صورتحساب برگشتی (subject: RETURN) ایجاد می‌کند که برگشت را با نرخ مالیاتی صورتحساب مرجع ' +
      'ثبت می‌کند، کالا را با بهای تمام‌شده خط حواله برمی‌گرداند و ابطال بهای تمام‌شده (COGS) را ' +
      'با شناسه منبع یکتا ثبت می‌کند.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: ReturnResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر یا خط خارج از صورتحساب' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'مقدار برگشتی بیش از باقی‌مانده قابل برگشت است' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'صورتحساب مرجع یافت نشد' })
  async createReturn(
    @Req() request: AuthenticatedRequest,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: CreateReturnDto,
  ): Promise<ReturnResponseDto> {
    const userId = String(request.user?.sub ?? 'unknown').slice(0, 64);
    return this.returns.createReturn(requireTenantId(request), invoiceId, dto, userId);
  }
}

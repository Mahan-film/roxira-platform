import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../../access/catalogue';
import { AlsoAllowModule, ModuleAccess, RequireAction } from '../../../access/decorators';
import { AuthenticatedRequest } from '../../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../../tenants/tenant-context';
import {
  ConvertQuotationToInvoiceDto,
  ConvertQuotationToInvoiceResponseDto,
} from '../dto/quotation-to-invoice.dto';
import { QuotationToInvoiceService } from '../services/quotation-to-invoice.service';

/**
 * تبدیل پیش‌فاکتور به صورتحساب فروش (Quotation to Sales Invoice - T104).
 * دارای کنترل تکرارناپذیری (Idempotency)، کنترل تاریخ انقضا (Expiry Date)،
 * و اعمال مالیات بر ارزش افزوده قانونی.
 */
@ApiTags('Sales - پیش‌فاکتور و فروش')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/sales/quotations')
export class QuotationToInvoiceController {
  constructor(private readonly quotationToInvoiceService: QuotationToInvoiceService) {}

  private userIdOf(request: AuthenticatedRequest): string {
    return String(request.user?.sub ?? 'unknown').slice(0, 64);
  }

  @RequireAction(AccessAction.CREATE)
  @Post(':id/convert-to-invoice')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'تبدیل ۱-کلیکی پیش‌فاکتور به صورتحساب فروش',
    description:
      'پیش‌فاکتور را به صورت ایدمپوتنت و با قفل بدبینانه به یک صورتحساب فروش تبدیل می‌کند. در صورت گذشتن تاریخ انقضا، خطا بازگردانده شده و وضعیت به EXPIRED تغییر می‌کند.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: ConvertQuotationToInvoiceResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'پیش‌فاکتور منقضی شده، رد شده یا فاقد سطر است' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'پیش‌فاکتور قبلاً به صورتحساب تبدیل شده است' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'پیش‌فاکتور یا طرف‌حساب یافت نشد' })
  convertQuotationToInvoice(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto?: ConvertQuotationToInvoiceDto,
  ): Promise<ConvertQuotationToInvoiceResponseDto> {
    return this.quotationToInvoiceService.convertQuotationToInvoice(
      requireTenantId(request),
      id,
      dto,
      this.userIdOf(request),
    );
  }
}

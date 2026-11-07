import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { tehranIsoDate } from '../../hr/services/jalali-period';
import {
  CreateRecurringVoucherDto,
  RecurringVoucherResponseDto,
  RunRecurringVouchersDto,
  RunRecurringVouchersResultDto,
  UpdateRecurringVoucherDto,
} from '../dto/recurring-voucher.dto';
import { RecurringVoucherService } from '../services/recurring-voucher.service';

/**
 * کنترلر اسناد دوره‌ای و تعهدات خودکار (E-04).
 * فقط مسیریابی و اعتبارسنجی HTTP؛ منطق کسب‌وکار در سرویس است (Rule #3 — AGENTS.md).
 * شناسه مستأجر تنها از claim تأییدشده JWT خوانده می‌شود.
 */
@ApiTags('Accounting - اسناد دوره‌ای')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/accounting/recurring-vouchers')
export class RecurringVoucherController {
  constructor(private readonly service: RecurringVoucherService) {}

  private tenantIdOf(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }

  private actorOf(request: AuthenticatedRequest): string {
    return String(request.user?.sub ?? 'unknown').slice(0, 64);
  }

  @Get()
  @ApiOperation({ summary: 'فهرست الگوهای سند دوره‌ای' })
  @ApiResponse({ status: HttpStatus.OK, type: [RecurringVoucherResponseDto] })
  async list(@Req() request: AuthenticatedRequest): Promise<RecurringVoucherResponseDto[]> {
    return this.service.list(this.tenantIdOf(request));
  }

  @Get(':id')
  @ApiOperation({ summary: 'دریافت یک الگوی سند دوره‌ای' })
  @ApiResponse({ status: HttpStatus.OK, type: RecurringVoucherResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'الگو یافت نشد' })
  async findOne(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<RecurringVoucherResponseDto> {
    return this.service.findOne(this.tenantIdOf(request), id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'ایجاد الگوی سند دوره‌ای',
    description: 'سطرهای سند باید دقیقاً تراز باشند؛ در غیر این صورت رد می‌شود.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: RecurringVoucherResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'سند ناتراز یا ورودی نامعتبر' })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateRecurringVoucherDto,
  ): Promise<RecurringVoucherResponseDto> {
    return this.service.create(this.tenantIdOf(request), this.actorOf(request), dto);
  }

  @RequireAction(AccessAction.CREATE)
  @Put(':id')
  @ApiOperation({ summary: 'ویرایش الگوی سند دوره‌ای' })
  @ApiResponse({ status: HttpStatus.OK, type: RecurringVoucherResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'الگو یافت نشد' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'سند ناتراز' })
  async update(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRecurringVoucherDto,
  ): Promise<RecurringVoucherResponseDto> {
    return this.service.update(this.tenantIdOf(request), id, dto);
  }

  @RequireAction(AccessAction.CREATE)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف الگوی سند دوره‌ای' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'الگو یافت نشد' })
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.service.remove(this.tenantIdOf(request), id);
  }

  @RequireAction(AccessAction.POST)
  @Post('run-due')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'اجرای موارد سررسیده',
    description:
      'برای هر الگوی سررسیده یک سند می‌سازد (دوره‌های جامانده را به ترتیب جبران می‌کند) و تعهدهای سررسیده‌شده را برمی‌گرداند. دورهٔ قفل‌شده در skipped گزارش می‌شود.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: RunRecurringVouchersResultDto })
  async runDue(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RunRecurringVouchersDto,
  ): Promise<RunRecurringVouchersResultDto> {
    const today = dto?.date ?? tehranIsoDate(new Date());
    return this.service.runDue(this.tenantIdOf(request), today);
  }
}

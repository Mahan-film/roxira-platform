import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import {
  requireTenantAdmin,
  requireTenantId,
} from '../../tenants/tenant-context';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { InvoiceResponseDto } from '../dto/invoice-response.dto';
import { QueryInvoiceDto } from '../dto/query-invoice.dto';
import { InvoicingService } from '../services/invoicing.service';

/**
 * کنترلر ماژول صورتحساب مالیاتی هوشمند.
 * فقط مسیریابی و اعتبارسنجی HTTP انجام می‌دهد؛ هیچ منطق کسب‌وکار یا
 * دسترسی مستقیم به پایگاه‌داده در این لایه وجود ندارد (Rule #3 - AGENTS.md).
 *
 * شناسه مستأجر «تنها» از claim تأییدشده JWT خوانده می‌شود (`requireTenantId`)
 * و دسترسی مدیریتی با `requireTenantAdmin` بررسی می‌شود؛ هرگز از بدنه/کوئری/هدر
 * درخواست (Rule #4 - AGENTS.md). احراز هویت از طریق گارد سراسری JwtAuthGuard
 * اعمال می‌شود.
 */
@ApiTags('Invoicing - فاکتور هوشمند')
@ApiBearerAuth()
@Controller('enterprise-hub/invoicing')
export class InvoicingController {
  constructor(private readonly invoicingService: InvoicingService) {}

  /** استخراج شناسه مستأجر و بررسی دسترسی مدیریتی از کاربر تأییدشده. */
  private tenantIdOf(request: AuthenticatedRequest): string {
    requireTenantAdmin(request);
    return requireTenantId(request);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'صدور صورتحساب مالیاتی جدید',
    description:
      'ایجاد صورتحساب همراه با محاسبه آنی مالیات بر ارزش افزوده ۹٪، جمع‌بندی خودکار مبالغ و کنترل یکتایی شماره صورتحساب.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: InvoiceResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'شماره صورتحساب تکراری' })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    return this.invoicingService.create(this.tenantIdOf(request), dto);
  }

  @Get()
  @ApiOperation({ summary: 'فهرست صورتحساب‌ها به همراه صفحه‌بندی و فیلتر' })
  @ApiResponse({ status: HttpStatus.OK })
  async findAll(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryInvoiceDto,
  ) {
    return this.invoicingService.findAll(this.tenantIdOf(request), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'دریافت یک صورتحساب بر اساس شناسه' })
  @ApiResponse({ status: HttpStatus.OK, type: InvoiceResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'صورتحساب یافت نشد' })
  async findOne(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceResponseDto> {
    return this.invoicingService.findOne(this.tenantIdOf(request), id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'ابطال صورتحساب' })
  @ApiResponse({ status: HttpStatus.OK, type: InvoiceResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'صورتحساب یافت نشد' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'صورتحساب قبلاً ابطال شده است' })
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceResponseDto> {
    return this.invoicingService.cancel(this.tenantIdOf(request), id);
  }
}

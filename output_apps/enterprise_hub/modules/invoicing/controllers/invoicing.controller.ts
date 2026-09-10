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
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { InvoiceResponseDto } from '../dto/invoice-response.dto';
import { QueryInvoiceDto } from '../dto/query-invoice.dto';
import { InvoicingService } from '../services/invoicing.service';

/**
 * کنترلر ماژول صورتحساب مالیاتی هوشمند.
 * فقط مسیریابی و اعتبارسنجی HTTP انجام می‌دهد؛ هیچ منطق کسب‌وکار یا
 * دسترسی مستقیم به پایگاه‌داده در این لایه وجود ندارد (Rule #3 - AGENTS.md).
 */
@ApiTags('Invoicing - فاکتور هوشمند')
@Controller('enterprise-hub/invoicing')
export class InvoicingController {
  constructor(private readonly invoicingService: InvoicingService) {}

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
  async create(@Body() dto: CreateInvoiceDto): Promise<InvoiceResponseDto> {
    return this.invoicingService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'فهرست صورتحساب‌ها به همراه صفحه‌بندی و فیلتر' })
  @ApiResponse({ status: HttpStatus.OK })
  async findAll(@Query() query: QueryInvoiceDto) {
    return this.invoicingService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'دریافت یک صورتحساب بر اساس شناسه' })
  @ApiResponse({ status: HttpStatus.OK, type: InvoiceResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'صورتحساب یافت نشد' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceResponseDto> {
    return this.invoicingService.findOne(id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'ابطال صورتحساب' })
  @ApiResponse({ status: HttpStatus.OK, type: InvoiceResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'صورتحساب یافت نشد' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'صورتحساب قبلاً ابطال شده است' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceResponseDto> {
    return this.invoicingService.cancel(id);
  }
}

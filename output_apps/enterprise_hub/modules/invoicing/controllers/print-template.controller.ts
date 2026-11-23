import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
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
import { requireTenantId } from '../../tenants/tenant-context';
import {
  CreatePrintTemplateDto,
  GetDefaultTemplateQueryDto,
  PrintTemplateResponseDto,
  QueryPrintTemplateDto,
  RenderBarcodeSheetDto,
  UpdatePrintTemplateDto,
} from '../dto/print-template.dto';
import { PrintDocType, PrintPaperSize } from '../enums/print-template.enum';
import { PrintTemplateService } from '../services/print-template.service';

/**
 * کنترلر مدیریت قالب‌های چاپ اسناد و فاکتورها (T81 / Print Form Builder).
 *
 * امکان ایجاد، ویرایش، انتخاب پیش‌فرض و تولید شیت بارکد ۴ یا ۵ ستونه
 * را برای سازمان فراهم می‌کند.
 */
@ApiTags('Invoicing - Print Templates / قالب‌های چاپ')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/invoicing/print-templates')
export class PrintTemplateController {
  constructor(private readonly service: PrintTemplateService) {}

  private tenantIdOf(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }

  @RequireAction(AccessAction.CREATE)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد قالب چاپ جدید' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PrintTemplateResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'عنوان قالب تکراری است' })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreatePrintTemplateDto,
  ): Promise<PrintTemplateResponseDto> {
    return this.service.create(this.tenantIdOf(request), dto);
  }

  @RequireAction(AccessAction.READ)
  @Get()
  @ApiOperation({ summary: 'فهرست قالب‌های چاپ سازمان' })
  @ApiResponse({ status: HttpStatus.OK, type: [PrintTemplateResponseDto] })
  async list(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryPrintTemplateDto,
  ): Promise<PrintTemplateResponseDto[]> {
    return this.service.list(this.tenantIdOf(request), query);
  }

  @RequireAction(AccessAction.READ)
  @Get('default')
  @ApiOperation({ summary: 'دریافت قالب پیش‌فرض برای یک نوع سند و سایز کاغذ' })
  @ApiResponse({ status: HttpStatus.OK, type: PrintTemplateResponseDto })
  async getDefault(
    @Req() request: AuthenticatedRequest,
    @Query() query: GetDefaultTemplateQueryDto,
  ): Promise<PrintTemplateResponseDto> {
    const saved = await this.service.findDefault(
      this.tenantIdOf(request),
      query.docType,
      query.paperSize,
    );
    if (!saved) {
      throw new NotFoundException('برای این سند و قطع کاغذ قالب پیش‌فرضی ذخیره نشده است.');
    }
    return saved;
  }

  @RequireAction(AccessAction.READ)
  @Get('preset')
  @ApiOperation({ summary: 'مقادیر اولیه فرم قالب‌ساز (فقط برای ویرایشگر، نه برای چاپ)' })
  @ApiResponse({ status: HttpStatus.OK, type: PrintTemplateResponseDto })
  getPreset(@Query() query: GetDefaultTemplateQueryDto): PrintTemplateResponseDto {
    return this.service.getPreset(query.docType, query.paperSize);
  }

  @RequireAction(AccessAction.READ)
  @Post('barcode-sheet')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تولید پیش‌نمایش و خروجی HTML شیت بارکد ۴ یا ۵ ستونه A4' })
  @ApiResponse({ status: HttpStatus.OK, description: 'HTML آماده چاپ شیت بارکد' })
  async renderBarcodeSheet(
    @Req() _request: AuthenticatedRequest,
    @Body() dto: RenderBarcodeSheetDto,
  ): Promise<{ html: string }> {
    const html = this.service.renderBarcodeLabelSheetHtml(dto);
    return { html };
  }

  @RequireAction(AccessAction.READ)
  @Get(':id')
  @ApiOperation({ summary: 'مشاهده مشخصات یک قالب چاپ' })
  @ApiResponse({ status: HttpStatus.OK, type: PrintTemplateResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'قالب یافت نشد' })
  async getOne(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PrintTemplateResponseDto> {
    return this.service.findOne(this.tenantIdOf(request), id);
  }

  @RequireAction(AccessAction.CREATE)
  @Patch(':id')
  @ApiOperation({ summary: 'ویرایش مشخصات یا ستون‌های قالب چاپ' })
  @ApiResponse({ status: HttpStatus.OK, type: PrintTemplateResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'قالب یافت نشد' })
  async update(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePrintTemplateDto,
  ): Promise<PrintTemplateResponseDto> {
    return this.service.update(this.tenantIdOf(request), id, dto);
  }

  @RequireAction(AccessAction.CREATE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'حذف یک قالب چاپ' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'قالب یافت نشد' })
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: boolean; id: number }> {
    return this.service.remove(this.tenantIdOf(request), id);
  }
}

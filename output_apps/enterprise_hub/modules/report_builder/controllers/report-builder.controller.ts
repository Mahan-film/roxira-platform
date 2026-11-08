import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AccessRequest, requireAccess } from '../../access/access-context';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import {
  ExecuteReportQueryDto,
  ExportReportDto,
  ReportQueryResultView,
  ReportTemplateView,
  SaveReportTemplateDto,
} from '../dto/report-builder.dto';
import { ReportBuilderService } from '../services/report-builder.service';

@ApiTags('Report Builder - سازنده گزارش و گزارش‌های تلفیقی')
@ApiBearerAuth()
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('report-builder')
export class ReportBuilderController {
  constructor(private readonly service: ReportBuilderService) {}

  @RequireAction(AccessAction.READ)
  @Get('datasets')
  @ApiOperation({ summary: 'فهرست مجموعه‌های داده و ستون‌های مجاز برای گزارش‌ساز' })
  @ApiResponse({ status: HttpStatus.OK })
  getDatasets() {
    return this.service.getAvailableDatasets();
  }

  @RequireAction(AccessAction.READ)
  @Post('query')
  @ApiOperation({ summary: 'اجرای کوئری گزارش سفارشی با تراکنش فقط‌خواندنی و محدودیت ۵ ثانیه‌ای' })
  @ApiResponse({ status: HttpStatus.OK })
  executeQuery(
    @Req() request: AccessRequest,
    @Body() dto: ExecuteReportQueryDto,
  ): Promise<ReportQueryResultView> {
    const ctx = requireAccess(request);
    return this.service.executeQuery(ctx.tenantId, dto);
  }

  @RequireAction(AccessAction.EXPORT)
  @Post('export')
  @ApiOperation({ summary: 'خروجی اکسل یا پی‌دی‌اف از گزارش سفارشی' })
  @ApiResponse({ status: HttpStatus.OK })
  async exportReport(
    @Req() request: AccessRequest,
    @Body() dto: ExportReportDto,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = requireAccess(request);
    const exported = await this.service.exportReport(ctx.tenantId, dto);
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(exported.filename)}"`);
    res.send(exported.body);
  }

  @RequireAction(AccessAction.READ)
  @Get('templates')
  @ApiOperation({ summary: 'فهرست الگوهای ذخیره‌شدهٔ گزارش' })
  @ApiResponse({ status: HttpStatus.OK })
  listTemplates(
    @Req() request: AccessRequest,
    @Query('dataset') dataset?: string,
  ): Promise<ReportTemplateView[]> {
    const ctx = requireAccess(request);
    return this.service.listTemplates(ctx.tenantId, dataset);
  }

  @RequireAction(AccessAction.CREATE)
  @Post('templates')
  @ApiOperation({ summary: 'ذخیرهٔ یک الگوی جدید گزارش' })
  @ApiResponse({ status: HttpStatus.CREATED })
  saveTemplate(
    @Req() request: AccessRequest,
    @Body() dto: SaveReportTemplateDto,
  ): Promise<ReportTemplateView> {
    const ctx = requireAccess(request);
    return this.service.saveTemplate(ctx.tenantId, ctx.userId, dto);
  }

  @RequireAction(AccessAction.READ)
  @Get('templates/:id')
  @ApiOperation({ summary: 'دریافت مشخصات یک الگوی گزارش' })
  @ApiResponse({ status: HttpStatus.OK })
  getTemplate(
    @Req() request: AccessRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReportTemplateView> {
    const ctx = requireAccess(request);
    return this.service.getTemplate(ctx.tenantId, id);
  }

  @RequireAction(AccessAction.CREATE)
  @Delete('templates/:id')
  @ApiOperation({ summary: 'حذف یک الگوی گزارش ذخیره‌شده' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  async deleteTemplate(
    @Req() request: AccessRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = requireAccess(request);
    await this.service.deleteTemplate(ctx.tenantId, ctx.userId, id);
    res.status(HttpStatus.NO_CONTENT).send();
  }
}

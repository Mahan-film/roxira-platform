import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { BusinessTaxPreviewDto } from '../dto/business-tax-preview.dto';
import { BusinessTaxPreview, BusinessTaxService } from '../services/business-tax.service';

/** مالیات صاحبان مشاغل و مشارکت مدنی (ماده ۱۰۱): فقط پیش‌نمایش؛ هیچ سندی ثبت نمی‌شود. */
@ApiTags('Tax Compliance - مالیات صاحبان مشاغل و مشارکت مدنی')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/business-tax')
export class BusinessTaxController {
  constructor(private readonly service: BusinessTaxService) {}

  /** A POST that only computes: it needs the export (view-and-download) action. */
  @RequireAction(AccessAction.EXPORT)
  @Post('preview')
  @ApiOperation({ summary: 'پیش‌نمایش مالیات صاحب شغل یا مشارکت مدنی (بدون ثبت سند)' })
  preview(@Req() request: AuthenticatedRequest, @Body() dto: BusinessTaxPreviewDto): Promise<BusinessTaxPreview> {
    return this.service.preview(requireTenantId(request), dto);
  }
}

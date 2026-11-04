import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { RentalTaxPreviewDto } from '../dto/rental-tax-preview.dto';
import { RentalTaxPreview, RentalTaxService } from '../services/rental-tax.service';

/** مالیات درآمد اجاره (ماده ۵۳) و معافیت ماده ۵۷: فقط پیش‌نمایش؛ هیچ سندی ثبت نمی‌شود. */
@ApiTags('Tax Compliance - مالیات اجاره')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/rental-tax')
export class RentalTaxController {
  constructor(private readonly service: RentalTaxService) {}

  /** A POST that only computes: it needs the export (view-and-download) action. */
  @RequireAction(AccessAction.EXPORT)
  @Post('preview')
  @ApiOperation({ summary: 'پیش‌نمایش مالیات اجاره با معافیت ماده ۵۷ (بدون ثبت سند)' })
  preview(@Req() request: AuthenticatedRequest, @Body() dto: RentalTaxPreviewDto): Promise<RentalTaxPreview> {
    return this.service.preview(requireTenantId(request), dto);
  }
}

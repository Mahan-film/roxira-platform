import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CorporateTaxPreviewDto } from '../dto/corporate-tax-preview.dto';
import { CorporateTaxPreview, CorporateTaxService } from '../services/corporate-tax.service';

/** میز کار مالیات بر درآمد شرکت‌ها: فقط پیش‌نمایش؛ هیچ سندی ثبت نمی‌شود. */
@ApiTags('Tax Compliance - مالیات بر درآمد شرکت‌ها')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/corporate-tax')
export class CorporateTaxController {
  constructor(private readonly service: CorporateTaxService) {}

  /** A POST that reads and computes only, so it needs the export (view-and-download) action. */
  @RequireAction(AccessAction.EXPORT)
  @Post('preview')
  @ApiOperation({ summary: 'پیش‌نمایش ذخیرهٔ مالیات بر درآمد (بدون ثبت سند)' })
  preview(@Req() request: AuthenticatedRequest, @Body() dto: CorporateTaxPreviewDto): Promise<CorporateTaxPreview> {
    return this.service.preview(requireTenantId(request), dto);
  }
}

import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { DoctorWithholdingPreviewDto } from '../dto/doctor-withholding-preview.dto';
import { DoctorWithholdingPreview, DoctorWithholdingService } from '../services/doctor-withholding.service';

/** کسر علی‌الحساب مالیات از حق‌الزحمهٔ پزشکان: فقط پیش‌نمایش؛ هیچ سندی ثبت و چیزی ارسال نمی‌شود. */
@ApiTags('Tax Compliance - مالیات تکلیفی پزشکان')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/doctor-withholding')
export class DoctorWithholdingController {
  constructor(private readonly service: DoctorWithholdingService) {}

  /** A POST that only computes: it needs the export (view-and-download) action. */
  @RequireAction(AccessAction.EXPORT)
  @Post('preview')
  @ApiOperation({ summary: 'پیش‌نمایش کسر مالیات علی‌الحساب از حق‌الزحمه پزشکان (بدون ثبت سند)' })
  preview(@Req() request: AuthenticatedRequest, @Body() dto: DoctorWithholdingPreviewDto): Promise<DoctorWithholdingPreview> {
    return this.service.preview(requireTenantId(request), dto);
  }
}

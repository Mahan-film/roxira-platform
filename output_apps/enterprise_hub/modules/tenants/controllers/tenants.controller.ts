import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpStatus,
  Patch,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { AnyMember, ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { TenantMeResponseDto } from '../dto/tenant-me-response.dto';
import { UpdateTenantSettingsDto } from '../dto/update-tenant-settings.dto';
import { TenantRole } from '../enums/tenant-role.enum';
import { TenantsService } from '../services/tenants.service';
import { requireTenantId } from '../tenant-context';

/** تبدیل claim متنی توکن به نقش سازمانی شناخته‌شده (یا null). */
function toTenantRole(value: string | null | undefined): TenantRole | null {
  if (value === TenantRole.OWNER) {
    return TenantRole.OWNER;
  }
  if (value === TenantRole.MEMBER) {
    return TenantRole.MEMBER;
  }
  return null;
}

/**
 * کنترلر سازمان و مدیریت اعضا.
 *
 * فقط مسیریابی و اعتبارسنجی DTO؛ تمام منطق در TenantsService است
 * (Rule #2 و Rule #3 - AGENTS.md).
 *
 * شناسه مستأجر «تنها» از claim تأییدشده JWT خوانده می‌شود (`requireTenantId`)
 * و دسترسی را AccessGuard از روی نقش تعیین می‌کند. مدیریت اعضا در `/org/members`
 * (ماژول access) است؛ هرگز از بدنه/کوئری/هدر درخواست (Rule #4 - AGENTS.md).
 */
@ApiTags('Tenants - سازمان و اعضا')
@ApiBearerAuth()
@ModuleAccess(AccessModule.MEMBERS)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @AnyMember()
  @Get('me')
  @ApiOperation({ summary: 'دریافت سازمان جاری کاربر' })
  @ApiResponse({ status: HttpStatus.OK, type: TenantMeResponseDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'کاربر عضو هیچ سازمانی نیست' })
  async me(@Req() request: AuthenticatedRequest): Promise<TenantMeResponseDto> {
    const tenantId = requireTenantId(request);
    const tenant = await this.tenantsService.findMyTenant(tenantId);
    if (!tenant) {
      throw new ForbiddenException('سازمانی برای حساب شما یافت نشد.');
    }
    return TenantMeResponseDto.fromEntity(
      tenant,
      toTenantRole(request.user?.tenantRole),
    );
  }

  @RequireAction(AccessAction.ADMIN)
  @Patch('me/settings')
  @ApiOperation({ summary: 'به‌روزرسانی تنظیمات سازمان (نرخ پیش‌فرض VAT)' })
  @ApiResponse({ status: HttpStatus.OK, type: TenantMeResponseDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی مدیریتی لازم است' })
  async updateSettings(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateTenantSettingsDto,
  ): Promise<TenantMeResponseDto> {
    const tenantId = requireTenantId(request);
    const tenant = await this.tenantsService.updateSettings(tenantId, dto);
    return TenantMeResponseDto.fromEntity(
      tenant,
      toTenantRole(request.user?.tenantRole),
    );
  }
}

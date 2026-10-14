import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../auth/guards/jwt-auth.guard';
import { AddTenantMemberDto } from '../dto/add-tenant-member.dto';
import { TenantMeResponseDto } from '../dto/tenant-me-response.dto';
import { TenantMemberResponseDto } from '../dto/tenant-member-response.dto';
import { TenantRole } from '../enums/tenant-role.enum';
import { TenantsService } from '../services/tenants.service';
import { requireTenantId, requireTenantOwner } from '../tenant-context';

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
 * و عملیات مدیریت اعضا فقط برای مالک سازمان (`requireTenantOwner`) مجاز است —
 * هرگز از بدنه/کوئری/هدر درخواست (Rule #4 - AGENTS.md).
 */
@ApiTags('Tenants - سازمان و اعضا')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

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

  @Get('members')
  @ApiOperation({ summary: 'فهرست اعضای سازمان (فقط مالک)' })
  @ApiResponse({ status: HttpStatus.OK, type: [TenantMemberResponseDto] })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'فقط مالک سازمان مجاز است' })
  async listMembers(
    @Req() request: AuthenticatedRequest,
  ): Promise<TenantMemberResponseDto[]> {
    const tenantId = requireTenantId(request);
    requireTenantOwner(request);
    const members = await this.tenantsService.listMembers(tenantId);
    return members.map(TenantMemberResponseDto.fromEntity);
  }

  @Post('members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'افزودن عضو به سازمان (فقط مالک)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: TenantMemberResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'شماره عضو سازمان دیگری است' })
  async addMember(
    @Req() request: AuthenticatedRequest,
    @Body() dto: AddTenantMemberDto,
  ): Promise<TenantMemberResponseDto> {
    const tenantId = requireTenantId(request);
    requireTenantOwner(request);
    const member = await this.tenantsService.addMember(tenantId, dto);
    return TenantMemberResponseDto.fromEntity(member);
  }

  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف عضو از سازمان (فقط مالک)' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'عضو حذف شد' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'فقط مالک سازمان مجاز است' })
  async removeMember(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ): Promise<void> {
    const tenantId = requireTenantId(request);
    requireTenantOwner(request);
    await this.tenantsService.removeMember(
      tenantId,
      userId,
      request.user?.sub ?? '',
    );
  }
}

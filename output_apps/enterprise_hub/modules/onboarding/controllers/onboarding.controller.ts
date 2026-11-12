import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { AnyMember, ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  OnboardingStateDto,
  OnboardingStepParamDto,
  SaveOnboardingProfileDto,
  SetOnboardingStepDto,
  UpdateOnboardingDto,
} from '../dto/onboarding.dto';
import { OnboardingService } from '../services/onboarding.service';

/**
 * Setup wizard of a new company. Routing and validation only; the tenant id comes from the verified
 * JWT claim (`requireTenantId`), never from the body, query or header.
 */
@ApiTags('Onboarding - راه‌اندازی شرکت جدید')
@ApiBearerAuth()
@ModuleAccess(AccessModule.MEMBERS)
@Controller('tenants/me/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @AnyMember()
  @Get()
  @ApiOperation({ summary: 'وضعیت مراحل راه‌اندازی شرکت' })
  @ApiResponse({ status: HttpStatus.OK, type: OnboardingStateDto })
  get(@Req() request: AuthenticatedRequest): Promise<OnboardingStateDto> {
    return this.onboarding.get(requireTenantId(request));
  }

  @RequireAction(AccessAction.ADMIN)
  @Put('profile')
  @ApiOperation({ summary: 'مرحله ۱: نام شرکت، شماره اقتصادی و شناسه ملی' })
  @ApiResponse({ status: HttpStatus.OK, type: OnboardingStateDto })
  saveProfile(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SaveOnboardingProfileDto,
  ): Promise<OnboardingStateDto> {
    return this.onboarding.saveProfile(requireTenantId(request), dto);
  }

  @RequireAction(AccessAction.ADMIN)
  @Put('steps/:step')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ثبت انجام‌شده، ردشده یا بازگشایی یک مرحله' })
  @ApiResponse({ status: HttpStatus.OK, type: OnboardingStateDto })
  setStep(
    @Req() request: AuthenticatedRequest,
    @Param() params: OnboardingStepParamDto,
    @Body() dto: SetOnboardingStepDto,
  ): Promise<OnboardingStateDto> {
    return this.onboarding.setStep(requireTenantId(request), params.step, dto.status);
  }

  @RequireAction(AccessAction.ADMIN)
  @Patch()
  @ApiOperation({ summary: 'پنهان‌کردن بنر راه‌اندازی یا ثبت انجام هدایت ورود نخست' })
  @ApiResponse({ status: HttpStatus.OK, type: OnboardingStateDto })
  update(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateOnboardingDto,
  ): Promise<OnboardingStateDto> {
    return this.onboarding.update(requireTenantId(request), dto);
  }
}

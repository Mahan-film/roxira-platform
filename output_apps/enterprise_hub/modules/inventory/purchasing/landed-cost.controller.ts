import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CreateLandedCostDto, LandedCostResponseDto } from './landed-cost.dto';
import { LandedCostService } from './landed-cost.service';

/** Landed costs attached to a goods receipt: freight, customs, insurance and other surcharges. */
@ApiTags('Inventory - هزینه سربار خرید')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVENTORY)
@Controller('enterprise-hub/inventory/purchasing')
export class LandedCostController {
  constructor(private readonly landedCosts: LandedCostService) {}

  private userIdOf(request: AuthenticatedRequest): string {
    return String(request.user?.sub ?? 'unknown').slice(0, 64);
  }

  @RequireAction(AccessAction.POST)
  @Post('receipts/:id/landed-costs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'تخصیص هزینه سربار خرید به سطرهای یک رسید کالا',
    description:
      'هزینه حمل، گمرک، بیمه یا سایر به نسبت ارزش، مقدار یا وزن بین سطرهای رسید تقسیم می‌شود؛ ' +
      'سهم موجودی بهای لایه FIFO را بالا می‌برد و سهم کالای فروش‌رفته به بهای تمام‌شده می‌رود. ' +
      'کلید تکرار همان سند را برمی‌گرداند.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: LandedCostResponseDto })
  createLandedCost(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLandedCostDto,
  ): Promise<LandedCostResponseDto> {
    return this.landedCosts.createLandedCost(
      requireTenantId(request),
      this.userIdOf(request),
      id,
      dto,
    );
  }
}

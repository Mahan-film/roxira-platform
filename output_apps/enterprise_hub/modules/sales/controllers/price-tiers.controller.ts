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
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  CalculateCommissionDto,
  CreatePriceTierDto,
  ListPriceTiersQueryDto,
  ResolvePriceDto,
  SetCommissionPolicyDto,
} from '../dto/price-tier.dto';
import { PriceTierService } from '../services/price-tier.service';
import { SalesCommissionService } from '../services/sales-commission.service';

/**
 * Controller for price tiers per customer group and sales representative commissions (#230 / T74).
 * Gated by INVOICING module access with strict tenant isolation.
 * Management of price tiers and commission policies requires ADMIN privileges to protect financial controls.
 */
@ApiTags('Sales - Price Tiers & Commission (سطوح قیمت و پورسانت)')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/sales')
export class PriceTiersController {
  constructor(
    private readonly priceTierService: PriceTierService,
    private readonly commissionService: SalesCommissionService,
  ) {}

  @Get('price-tiers')
  @ApiOperation({ summary: 'فهرست سطوح قیمت کالاها' })
  async listPriceTiers(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListPriceTiersQueryDto,
  ) {
    const tenantId = requireTenantId(req);
    return this.priceTierService.listTiers(tenantId, query.sku, query.customerGroup);
  }

  @Post('price-tiers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'تعریف یا به‌روزرسانی سطح قیمت' })
  @RequireAction(AccessAction.ADMIN)
  async createPriceTier(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreatePriceTierDto,
  ) {
    const tenantId = requireTenantId(req);
    return this.priceTierService.createTier(tenantId, dto);
  }

  @Post('price-tiers/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'محاسبه قیمت واحد بر اساس گروه مشتری' })
  async resolvePrice(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ResolvePriceDto,
  ) {
    const tenantId = requireTenantId(req);
    const res = await this.priceTierService.resolveForTenant(
      tenantId,
      dto.sku,
      dto.customerGroup,
      BigInt(dto.basePriceMinor),
      dto.referenceDate,
    );
    return {
      ...res,
      unitPriceMinor: res.unitPriceMinor.toString(),
      discountAmountMinor: res.discountAmountMinor.toString(),
      effectiveUnitPriceMinor: res.effectiveUnitPriceMinor.toString(),
    };
  }

  @Delete('price-tiers/:id')
  @ApiOperation({ summary: 'حذف سطح قیمت' })
  @RequireAction(AccessAction.ADMIN)
  async deletePriceTier(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const tenantId = requireTenantId(req);
    const deleted = await this.priceTierService.deleteTier(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Price tier with id ${id} not found`);
    }
    return { deleted: true };
  }

  @Get('commission-policies')
  @ApiOperation({ summary: 'فهرست سیاست‌های پورسانت فروش' })
  async listCommissionPolicies(@Req() req: AuthenticatedRequest) {
    const tenantId = requireTenantId(req);
    return this.commissionService.listPolicies(tenantId);
  }

  @Post('commission-policies')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تنظیم درصد پورسانت دسته‌بندی' })
  @RequireAction(AccessAction.ADMIN)
  async setCommissionPolicy(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SetCommissionPolicyDto,
  ) {
    const tenantId = requireTenantId(req);
    return this.commissionService.setPolicy(tenantId, dto);
  }

  @Post('commission/calculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'محاسبه گزارش ماهانه پورسانت کارشناسان فروش' })
  @RequireAction(AccessAction.ADMIN)
  async calculateCommission(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CalculateCommissionDto,
  ) {
    const tenantId = requireTenantId(req);
    const lines = dto.lines.map((l) => ({
      salesRepId: l.salesRepId,
      salesRepName: l.salesRepName,
      category: l.category,
      saleAmountMinor: BigInt(l.saleAmountMinor),
      invoiceNumber: l.invoiceNumber,
    }));
    const report = await this.commissionService.calculateForTenant(tenantId, dto.month, lines);
    return {
      month: report.month,
      grandTotalSalesMinor: report.grandTotalSalesMinor.toString(),
      grandTotalCommissionMinor: report.grandTotalCommissionMinor.toString(),
      reps: report.reps.map((r) => ({
        salesRepId: r.salesRepId,
        salesRepName: r.salesRepName,
        itemsCount: r.itemsCount,
        totalSalesMinor: r.totalSalesMinor.toString(),
        totalCommissionMinor: r.totalCommissionMinor.toString(),
      })),
    };
  }
}

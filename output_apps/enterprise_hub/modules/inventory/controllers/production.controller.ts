import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  CompleteProductionOrderDto,
  CreateBomDto,
  CreateProductionOrderDto,
  ExplodeBomDto,
} from '../dto/bom.dto';
import { ProductionOrderStatus } from '../entities/production-order.entity';
import { BomService } from '../services/bom.service';
import { ProductionOrderService } from '../services/production-order.service';

/**
 * Controller for multi-level BOMs and production orders with FIFO costing (#764 / T83).
 * Gated by INVENTORY module access with strict tenant isolation.
 */
@ApiTags('Inventory - Production & BOM (تولید و فرمول ساخت)')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVENTORY)
@Controller('enterprise-hub/inventory/production')
export class ProductionController {
  constructor(
    private readonly bomService: BomService,
    private readonly productionService: ProductionOrderService,
  ) {}

  @Post('boms')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد فرمول ساخت جدید (BOM)' })
  @RequireAction(AccessAction.CREATE)
  async createBom(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateBomDto,
  ) {
    const tenantId = requireTenantId(req);
    return this.bomService.createBom(tenantId, dto);
  }

  @Get('boms')
  @ApiOperation({ summary: 'فهرست فرمول‌های ساخت' })
  @RequireAction(AccessAction.READ)
  async listBoms(
    @Req() req: AuthenticatedRequest,
    @Query('finishedItemSku') finishedItemSku?: string,
  ) {
    const tenantId = requireTenantId(req);
    return this.bomService.listBoms(tenantId, finishedItemSku);
  }

  @Get('boms/:id')
  @ApiOperation({ summary: 'دریافت جزئیات یک فرمول ساخت' })
  @RequireAction(AccessAction.READ)
  async getBom(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const tenantId = requireTenantId(req);
    return this.bomService.getBom(tenantId, id);
  }

  @Post('boms/:id/explode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ریزش مواد و قطعات چندسطحی با درصد ضایعات' })
  @RequireAction(AccessAction.READ)
  async explodeBom(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ExplodeBomDto,
  ) {
    const tenantId = requireTenantId(req);
    return this.bomService.explodeBom(tenantId, id, dto.quantity);
  }

  @Delete('boms/:id')
  @ApiOperation({ summary: 'حذف فرمول ساخت' })
  @RequireAction(AccessAction.ADMIN)
  async deleteBom(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const tenantId = requireTenantId(req);
    return { deleted: await this.bomService.deleteBom(tenantId, id) };
  }

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد سفارش تولید جدید' })
  @RequireAction(AccessAction.CREATE)
  async createOrder(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateProductionOrderDto,
  ) {
    const tenantId = requireTenantId(req);
    return this.productionService.createOrder(tenantId, dto);
  }

  @Get('orders')
  @ApiOperation({ summary: 'فهرست سفارشات تولید' })
  @RequireAction(AccessAction.READ)
  async listOrders(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: ProductionOrderStatus,
  ) {
    const tenantId = requireTenantId(req);
    return this.productionService.listOrders(tenantId, status);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'دریافت جزئیات سفارش تولید' })
  @RequireAction(AccessAction.READ)
  async getOrder(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const tenantId = requireTenantId(req);
    return this.productionService.getOrder(tenantId, id);
  }

  @Post('orders/:id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'شروع عملیات تولید' })
  @RequireAction(AccessAction.CREATE)
  async startOrder(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const tenantId = requireTenantId(req);
    return this.productionService.startOrder(tenantId, id);
  }

  @Post('orders/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تکمیل تولید، مصرف FIFO مواد، ثبت کالای نهایی و صدور سند' })
  @RequireAction(AccessAction.POST)
  async completeOrder(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteProductionOrderDto,
  ) {
    const tenantId = requireTenantId(req);
    const order = await this.productionService.completeOrder(tenantId, id, dto);
    return {
      ...order,
      totalCostMinor: order.totalCostMinor.toString(),
      unitCostMinor: order.unitCostMinor.toString(),
    };
  }

  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'لغو سفارش تولید' })
  @RequireAction(AccessAction.CREATE)
  async cancelOrder(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const tenantId = requireTenantId(req);
    return this.productionService.cancelOrder(tenantId, id);
  }
}

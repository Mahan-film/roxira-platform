import {
  Body,
  Controller,
  Get,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../../access/decorators';
import { AuthenticatedRequest } from '../../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../../tenants/tenant-context';
import {
  UpdateWooCommerceConfigDto,
  WooCommerceConfigResponseDto,
} from '../dto/woocommerce-config.dto';
import { WooCommerceSyncLogQueryDto } from '../dto/woocommerce-sync-log.dto';
import { WooCommerceSyncService } from '../services/woocommerce-sync.service';

@ApiTags('Integrations - WooCommerce')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVOICING)
@Controller('api/integrations/woocommerce')
export class WooCommerceConfigController {
  constructor(private readonly syncService: WooCommerceSyncService) {}

  @Get('config')
  @RequireAction(AccessAction.READ)
  @ApiOperation({ summary: 'دریافت تنظیمات اتصال به ووکامرس برای سازمان جاری' })
  @ApiResponse({ status: 200, type: WooCommerceConfigResponseDto })
  async getConfig(@Req() req: AuthenticatedRequest): Promise<WooCommerceConfigResponseDto> {
    const tenantId = requireTenantId(req);
    return this.syncService.getConfig(tenantId);
  }

  @Put('config')
  @RequireAction(AccessAction.CREATE)
  @ApiOperation({ summary: 'ذخیره تنظیمات اتصال به ووکامرس' })
  @ApiResponse({ status: 200, type: WooCommerceConfigResponseDto })
  async updateConfig(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateWooCommerceConfigDto,
  ): Promise<WooCommerceConfigResponseDto> {
    const tenantId = requireTenantId(req);
    return this.syncService.saveConfig(tenantId, dto);
  }

  @Get('logs')
  @RequireAction(AccessAction.READ)
  @ApiOperation({ summary: 'مشاهده لاگ‌های همگام‌سازی ووکامرس' })
  async getLogs(
    @Req() req: AuthenticatedRequest,
    @Query() query: WooCommerceSyncLogQueryDto,
  ) {
    const tenantId = requireTenantId(req);
    return this.syncService.listSyncLogs(tenantId, query);
  }
}

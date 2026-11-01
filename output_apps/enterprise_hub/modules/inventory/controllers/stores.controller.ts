import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CreateStoreDto, StoreResponseDto, UpdateStoreDto } from '../dto/store.dto';
import { StoresService } from '../services/stores.service';

/** Stores (shops/branches) that own warehouses. Tenant comes only from the verified token. */
@ApiTags('Inventory - فروشگاه‌ها')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVENTORY)
@Controller('enterprise-hub/inventory/stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  @ApiOperation({ summary: 'فهرست فروشگاه‌ها' })
  @ApiResponse({ status: HttpStatus.OK, type: [StoreResponseDto] })
  list(@Req() request: AuthenticatedRequest): Promise<StoreResponseDto[]> {
    return this.stores.list(requireTenantId(request));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد فروشگاه' })
  @ApiResponse({ status: HttpStatus.CREATED, type: StoreResponseDto })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateStoreDto): Promise<StoreResponseDto> {
    return this.stores.create(requireTenantId(request), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'ویرایش یا غیرفعال‌سازی فروشگاه' })
  @ApiResponse({ status: HttpStatus.OK, type: StoreResponseDto })
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStoreDto,
  ): Promise<StoreResponseDto> {
    return this.stores.update(requireTenantId(request), id, dto);
  }
}

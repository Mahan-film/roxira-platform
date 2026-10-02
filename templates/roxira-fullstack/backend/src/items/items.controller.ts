import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CreateItemDto } from './create-item.dto';
import { Item } from './items.repository';
import { ItemsService } from './items.service';

@Controller('tenants/:tenantId/items')
export class ItemsController {
  constructor(private readonly service: ItemsService) {}

  @Get()
  list(@Param('tenantId') tenantId: string): Promise<Item[]> {
    return this.service.list(tenantId);
  }

  @Get(':id')
  get(@Param('tenantId') tenantId: string, @Param('id') id: string): Promise<Item> {
    return this.service.get(tenantId, id);
  }

  @Post()
  create(@Param('tenantId') tenantId: string, @Body() dto: CreateItemDto): Promise<Item> {
    return this.service.create(tenantId, dto);
  }

  @Delete(':id')
  remove(@Param('tenantId') tenantId: string, @Param('id') id: string): Promise<void> {
    return this.service.remove(tenantId, id);
  }
}

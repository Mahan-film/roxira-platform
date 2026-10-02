import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateItemDto } from './create-item.dto';
import { Item, ItemsRepository } from './items.repository';

@Injectable()
export class ItemsService {
  constructor(private readonly repository: ItemsRepository) {}

  list(tenantId: string): Promise<Item[]> {
    return this.repository.findAll(tenantId);
  }

  async get(tenantId: string, id: string): Promise<Item> {
    const item = await this.repository.findById(tenantId, id);
    if (!item) {
      throw new NotFoundException('item not found');
    }
    return item;
  }

  create(tenantId: string, dto: CreateItemDto): Promise<Item> {
    return this.repository.create(tenantId, randomUUID(), dto.name, dto.description ?? null);
  }

  remove(tenantId: string, id: string): Promise<void> {
    return this.repository.remove(tenantId, id);
  }
}

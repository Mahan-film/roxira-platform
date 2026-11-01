import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateStoreDto, StoreResponseDto, UpdateStoreDto } from '../dto/store.dto';
import { StoreEntity } from '../entities/store.entity';
import { StockDocumentsRepository } from '../repositories/stock-documents.repository';

/** Stores (shops/branches) that group warehouses. */
@Injectable()
export class StoresService {
  constructor(private readonly repository: StockDocumentsRepository) {}

  private toResponse(entity: StoreEntity, warehouseCount: number): StoreResponseDto {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      address: entity.address ?? null,
      isActive: entity.isActive,
      warehouseCount,
      createdAt: entity.createdAt,
    };
  }

  async list(tenantId: string): Promise<StoreResponseDto[]> {
    const [stores, counts] = await Promise.all([
      this.repository.listStores(tenantId),
      this.repository.warehouseCounts(tenantId),
    ]);
    return stores.map((store) => this.toResponse(store, counts.get(store.id) ?? 0));
  }

  async create(tenantId: string, dto: CreateStoreDto): Promise<StoreResponseDto> {
    await this.assertUnique(tenantId, dto.code, dto.name);
    const created = await this.repository.createStore(tenantId, {
      code: dto.code,
      name: dto.name,
      address: dto.address ?? null,
    });
    return this.toResponse(created, 0);
  }

  async update(tenantId: string, id: number, dto: UpdateStoreDto): Promise<StoreResponseDto> {
    const store = await this.repository.findStoreById(tenantId, id);
    if (!store) {
      throw new NotFoundException(`فروشگاه با شناسه ${id} یافت نشد.`);
    }
    await this.assertUnique(
      tenantId,
      dto.code ?? store.code,
      dto.name ?? store.name,
      id,
    );
    await this.repository.updateStore(tenantId, id, {
      ...(dto.code !== undefined ? { code: dto.code } : {}),
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.address !== undefined ? { address: dto.address } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });
    const updated = (await this.repository.findStoreById(tenantId, id)) as StoreEntity;
    const counts = await this.repository.warehouseCounts(tenantId);
    return this.toResponse(updated, counts.get(id) ?? 0);
  }

  private async assertUnique(tenantId: string, code: string, name: string, selfId?: number): Promise<void> {
    const clashes = await this.repository.findStoreByCodeOrName(tenantId, code, name);
    const other = clashes.find((store) => store.id !== selfId);
    if (other) {
      throw new ConflictException(
        other.code === code
          ? `فروشگاهی با کد ${code} قبلاً ثبت شده است.`
          : `فروشگاهی با نام ${name} قبلاً ثبت شده است.`,
      );
    }
  }
}

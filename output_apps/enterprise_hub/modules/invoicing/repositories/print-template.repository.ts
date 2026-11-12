import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EntityManager,
  FindOptionsWhere,
  Repository,
} from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { PrintTemplateEntity } from '../entities/print-template.entity';
import { PrintDocType, PrintPaperSize } from '../enums/print-template.enum';

@Injectable()
export class PrintTemplateRepository {
  constructor(
    private readonly scope: TenantScope,
  ) {}

  private withRepo<T>(
    tenantId: string,
    manager: EntityManager | undefined,
    work: (repo: Repository<PrintTemplateEntity>, m?: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.scope.within(tenantId, manager, (m) => work(m.getRepository(PrintTemplateEntity), m));
  }

  async saveWithDefault(
    tenantId: string,
    data: Partial<PrintTemplateEntity>,
    isDefault: boolean,
    existingId?: number,
  ): Promise<PrintTemplateEntity> {
    return this.scope.within(tenantId, undefined, async (manager) => {
      const repo = manager.getRepository(PrintTemplateEntity);
      if (isDefault) {
        const qb = repo
          .createQueryBuilder()
          .update(PrintTemplateEntity)
          .set({ isDefault: false, updatedAt: new Date() })
          .where('tenant_id = :tenantId AND doc_type = :docType AND paper_size = :paperSize', {
            tenantId,
            docType: data.docType,
            paperSize: data.paperSize,
          });
        if (existingId) {
          qb.andWhere('id != :existingId', { existingId });
        }
        await qb.execute();
      }
      if (existingId) {
        const existing = await repo.findOne({ where: { id: existingId, tenantId } });
        if (!existing) {
          throw new NotFoundException(`قالب چاپی با شناسه ${existingId} یافت نشد.`);
        }
        Object.assign(existing, data, { isDefault, updatedAt: new Date() });
        return repo.save(existing);
      }
      const created = repo.create({ ...data, tenantId, isDefault });
      return repo.save(created);
    });
  }

  async createTemplate(
    tenantId: string,
    data: Partial<PrintTemplateEntity>,
    manager?: EntityManager,
  ): Promise<PrintTemplateEntity> {
    return this.withRepo(tenantId, manager, async (repo) => {
      const entity = repo.create({ ...data, tenantId });
      return repo.save(entity);
    });
  }

  async updateTemplate(
    tenantId: string,
    id: number,
    data: Partial<PrintTemplateEntity>,
    manager?: EntityManager,
  ): Promise<PrintTemplateEntity | null> {
    return this.withRepo(tenantId, manager, async (repo) => {
      const existing = await repo.findOne({ where: { id, tenantId } });
      if (!existing) return null;
      Object.assign(existing, data, { updatedAt: new Date() });
      return repo.save(existing);
    });
  }

  async findById(
    tenantId: string,
    id: number,
    manager?: EntityManager,
  ): Promise<PrintTemplateEntity | null> {
    return this.withRepo(tenantId, manager, async (repo) => {
      return repo.findOne({ where: { id, tenantId } });
    });
  }

  async findByTitle(
    tenantId: string,
    title: string,
    manager?: EntityManager,
  ): Promise<PrintTemplateEntity | null> {
    return this.withRepo(tenantId, manager, async (repo) => {
      return repo.findOne({ where: { tenantId, title } });
    });
  }

  async findDefault(
    tenantId: string,
    docType: PrintDocType,
    paperSize?: PrintPaperSize,
    manager?: EntityManager,
  ): Promise<PrintTemplateEntity | null> {
    return this.withRepo(tenantId, manager, async (repo) => {
      if (paperSize) {
        return repo.findOne({
          where: { tenantId, docType, isDefault: true, paperSize },
          order: { id: 'DESC' },
        });
      }
      const anyDefault = await repo.findOne({
        where: { tenantId, docType, isDefault: true },
        order: { id: 'DESC' },
      });
      if (anyDefault) return anyDefault;

      const targetSize =
        docType === PrintDocType.RECEIPT_PAYMENT_VOUCHER ? PrintPaperSize.A5 : PrintPaperSize.A4;
      return repo.findOne({
        where: { tenantId, docType, paperSize: targetSize, isDefault: true },
        order: { id: 'DESC' },
      });
    });
  }

  async list(
    tenantId: string,
    filter?: { docType?: PrintDocType; paperSize?: PrintPaperSize },
    manager?: EntityManager,
  ): Promise<PrintTemplateEntity[]> {
    return this.withRepo(tenantId, manager, async (repo) => {
      const where: FindOptionsWhere<PrintTemplateEntity> = { tenantId };
      if (filter?.docType) where.docType = filter.docType;
      if (filter?.paperSize) where.paperSize = filter.paperSize;
      return repo.find({ where, order: { docType: 'ASC', isDefault: 'DESC', id: 'ASC' } });
    });
  }

  async clearDefault(
    tenantId: string,
    docType: PrintDocType,
    paperSize: PrintPaperSize,
    excludeId?: number,
    manager?: EntityManager,
  ): Promise<void> {
    return this.withRepo(tenantId, manager, async (repo) => {
      const qb = repo
        .createQueryBuilder()
        .update(PrintTemplateEntity)
        .set({ isDefault: false, updatedAt: new Date() })
        .where('tenant_id = :tenantId AND doc_type = :docType AND paper_size = :paperSize', {
          tenantId,
          docType,
          paperSize,
        });
      if (excludeId) {
        qb.andWhere('id != :excludeId', { excludeId });
      }
      await qb.execute();
    });
  }

  async delete(
    tenantId: string,
    id: number,
    manager?: EntityManager,
  ): Promise<boolean> {
    return this.withRepo(tenantId, manager, async (repo) => {
      const res = await repo.delete({ id, tenantId });
      return (res.affected ?? 0) > 0;
    });
  }
}

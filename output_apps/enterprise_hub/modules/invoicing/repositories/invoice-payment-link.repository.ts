import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { InvoicePaymentGatewayConfigEntity } from '../entities/invoice-payment-gateway-config.entity';
import { InvoicePaymentLinkEntity } from '../entities/invoice-payment-link.entity';

@Injectable()
export class InvoicePaymentLinkRepository {
  constructor(
    @InjectRepository(InvoicePaymentGatewayConfigEntity)
    private readonly configRepo: Repository<InvoicePaymentGatewayConfigEntity>,
    @InjectRepository(InvoicePaymentLinkEntity)
    private readonly linkRepo: Repository<InvoicePaymentLinkEntity>,
    private readonly dataSource: DataSource,
    private readonly tenantScope: TenantScope,
  ) {}

  async findConfig(
    tenantId: string,
    gateway = 'zibal',
  ): Promise<InvoicePaymentGatewayConfigEntity | null> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager ? manager.getRepository(InvoicePaymentGatewayConfigEntity) : this.configRepo;
      return repo.findOne({
        where: { tenantId, gateway },
      });
    });
  }

  async saveConfig(
    tenantId: string,
    data: { gateway: string; encryptedMerchantId: string; isActive?: boolean },
  ): Promise<InvoicePaymentGatewayConfigEntity> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager ? manager.getRepository(InvoicePaymentGatewayConfigEntity) : this.configRepo;
      let existing = await repo.findOne({
        where: { tenantId, gateway: data.gateway },
      });
      if (existing) {
        existing.encryptedMerchantId = data.encryptedMerchantId;
        if (data.isActive !== undefined) {
          existing.isActive = data.isActive;
        }
        return repo.save(existing);
      }
      const created = repo.create({
        tenantId,
        gateway: data.gateway,
        encryptedMerchantId: data.encryptedMerchantId,
        isActive: data.isActive ?? true,
      });
      return repo.save(created);
    });
  }

  async createPaymentLink(
    tenantId: string,
    data: Partial<InvoicePaymentLinkEntity>,
  ): Promise<InvoicePaymentLinkEntity> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager ? manager.getRepository(InvoicePaymentLinkEntity) : this.linkRepo;
      const entity = repo.create({ ...data, tenantId });
      return repo.save(entity);
    });
  }

  async updatePaymentLink(
    tenantId: string,
    entity: InvoicePaymentLinkEntity,
  ): Promise<InvoicePaymentLinkEntity> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager ? manager.getRepository(InvoicePaymentLinkEntity) : this.linkRepo;
      return repo.save(entity);
    });
  }

  async findPaymentLinkByTrackId(
    tenantId: string,
    trackId: string,
  ): Promise<InvoicePaymentLinkEntity | null> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager ? manager.getRepository(InvoicePaymentLinkEntity) : this.linkRepo;
      return repo.findOne({
        where: { tenantId, trackId },
      });
    });
  }

  async findPaymentLinkByGatewayRef(
    tenantId: string,
    gatewayRef: string,
  ): Promise<InvoicePaymentLinkEntity | null> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager ? manager.getRepository(InvoicePaymentLinkEntity) : this.linkRepo;
      return repo.findOne({
        where: { tenantId, gatewayRef },
      });
    });
  }

  async findPaymentLinksByInvoiceId(
    tenantId: string,
    invoiceId: string,
  ): Promise<InvoicePaymentLinkEntity[]> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager ? manager.getRepository(InvoicePaymentLinkEntity) : this.linkRepo;
      return repo.find({
        where: { tenantId, invoiceId },
        order: { createdAt: 'DESC' },
      });
    });
  }

  /**
   * Pre-tenant lookup helper (SECURITY DEFINER, Lesson 26) resolving tenantId and invoiceId
   * from gateway callback trackId when caller has no authenticated tenant context.
   */
  async lookupTenantByTrackId(
    trackId: string,
  ): Promise<{ tenantId: string; invoiceId: string; status: string } | null> {
    try {
      const rows = await this.dataSource.query(
        `SELECT tenant_id AS "tenantId", invoice_id AS "invoiceId", status FROM public.lookup_invoice_payment_tenant_by_track_id($1)`,
        [trackId],
      );
      if (rows && rows.length > 0) {
        return rows[0];
      }
    } catch {
      // Fallback query if function is not available or direct query runner
    }
    return null;
  }
}

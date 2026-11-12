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

  /**
   * Atomically claims a payment link for server-side gateway verification so
   * concurrent GET/POST callbacks cannot both verify and settle the same link.
   */
  async claimPaymentLinkForVerification(
    tenantId: string,
    trackId: string,
  ): Promise<InvoicePaymentLinkEntity | null> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager ? manager.getRepository(InvoicePaymentLinkEntity) : this.linkRepo;
      const res = await repo
        .createQueryBuilder()
        .update(InvoicePaymentLinkEntity)
        .set({ status: 'VERIFYING' })
        .where('tenant_id = :tenantId AND track_id = :trackId AND status IN (:...allowed)', {
          tenantId,
          trackId,
          allowed: ['PENDING', 'UNVERIFIED', 'FAILED'],
        })
        .returning([
          'id',
          'tenant_id',
          'invoice_id',
          'track_id',
          'payment_url',
          'amount',
          'status',
          'gateway',
          'gateway_ref',
          'card_number',
          'paid_at',
          'created_at',
          'updated_at',
        ])
        .execute();

      const row = res.raw?.[0];
      if (!row) {
        return null;
      }
      const entity = new InvoicePaymentLinkEntity();
      entity.id = row.id;
      entity.tenantId = row.tenant_id;
      entity.invoiceId = row.invoice_id;
      entity.trackId = row.track_id;
      entity.paymentUrl = row.payment_url;
      entity.amount = BigInt(row.amount);
      entity.status = row.status;
      entity.gateway = row.gateway;
      entity.gatewayRef = row.gateway_ref ?? null;
      entity.cardNumber = row.card_number ?? null;
      entity.paidAt = row.paid_at ? new Date(row.paid_at) : null;
      entity.createdAt = new Date(row.created_at);
      entity.updatedAt = new Date(row.updated_at);
      return entity;
    });
  }

  async markPaymentLinkPaid(
    tenantId: string,
    id: string,
    data: { gatewayRef: string; cardNumber: string | null; paidAt: Date },
  ): Promise<boolean> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager ? manager.getRepository(InvoicePaymentLinkEntity) : this.linkRepo;
      const res = await repo
        .createQueryBuilder()
        .update(InvoicePaymentLinkEntity)
        .set({
          status: 'PAID',
          gatewayRef: data.gatewayRef,
          cardNumber: data.cardNumber,
          paidAt: data.paidAt,
        })
        .where('id = :id AND tenant_id = :tenantId AND status = :verifying', {
          id,
          tenantId,
          verifying: 'VERIFYING',
        })
        .execute();
      return (res.affected ?? 0) === 1;
    });
  }

  async markPaymentLinkStatus(
    tenantId: string,
    id: string,
    status: 'FAILED' | 'UNVERIFIED',
  ): Promise<void> {
    await this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager ? manager.getRepository(InvoicePaymentLinkEntity) : this.linkRepo;
      await repo
        .createQueryBuilder()
        .update(InvoicePaymentLinkEntity)
        .set({ status })
        .where('id = :id AND tenant_id = :tenantId AND status = :verifying', {
          id,
          tenantId,
          verifying: 'VERIFYING',
        })
        .execute();
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
   * Pre-tenant lookup helper (SECURITY DEFINER) resolving tenantId and invoiceId
   * from gateway callback trackId when caller has no authenticated tenant context.
   */
  async lookupTenantByTrackId(
    trackId: string,
  ): Promise<{ tenantId: string; invoiceId: string; status: string } | null> {
    const rows = await this.dataSource.query(
      `SELECT tenant_id AS "tenantId", invoice_id AS "invoiceId", status FROM public.lookup_invoice_payment_tenant_by_track_id($1)`,
      [trackId],
    );
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }
}

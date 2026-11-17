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
   * Reclaims rows stuck in VERIFYING longer than `staleTimeoutMs` (process crash / hung call).
   */
  async claimPaymentLinkForVerification(
    tenantId: string,
    trackId: string,
    staleTimeoutMs = 2 * 60 * 1000,
  ): Promise<InvoicePaymentLinkEntity | null> {
    const staleCutoff = new Date(Date.now() - staleTimeoutMs);
    return this.tenantScope.run(tenantId, async (manager) => {
      const mgr = manager ?? this.linkRepo.manager;
      const rows = await mgr.query(
        `UPDATE invoice_payment_links
         SET status = 'VERIFYING', updated_at = NOW()
         WHERE tenant_id = $1
           AND track_id = $2
           AND (
             status IN ('PENDING', 'UNVERIFIED', 'FAILED')
             OR (status = 'VERIFYING' AND updated_at <= $3)
           )
         RETURNING id, tenant_id, invoice_id, track_id, payment_url, amount, status, gateway, gateway_ref, card_number, paid_at, created_at, updated_at`,
        [tenantId, trackId, staleCutoff],
      );

      const first = Array.isArray(rows?.[0]) ? rows[0][0] : rows?.[0];
      return this.hydrateReturnedLink(first);
    });
  }

  /**
   * Atomically claims a verified-but-unsettled (`PAID_UNSETTLED`, or stale `SETTLING`)
   * payment link so a retry callback can complete invoice settlement without re-verifying at Zibal.
   */
  async claimUnsettledPaymentLink(
    tenantId: string,
    trackId: string,
    staleTimeoutMs = 2 * 60 * 1000,
  ): Promise<InvoicePaymentLinkEntity | null> {
    const staleCutoff = new Date(Date.now() - staleTimeoutMs);
    return this.tenantScope.run(tenantId, async (manager) => {
      const mgr = manager ?? this.linkRepo.manager;
      const rows = await mgr.query(
        `UPDATE invoice_payment_links
         SET status = 'SETTLING', updated_at = NOW()
         WHERE tenant_id = $1
           AND track_id = $2
           AND (
             status = 'PAID_UNSETTLED'
             OR (status = 'SETTLING' AND updated_at <= $3)
           )
         RETURNING id, tenant_id, invoice_id, track_id, payment_url, amount, status, gateway, gateway_ref, card_number, paid_at, created_at, updated_at`,
        [tenantId, trackId, staleCutoff],
      );

      const first = Array.isArray(rows?.[0]) ? rows[0][0] : rows?.[0];
      return this.hydrateReturnedLink(first);
    });
  }

  private hydrateReturnedLink(row: Record<string, any> | undefined): InvoicePaymentLinkEntity | null {
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
  }

  async markPaymentLinkPaidUnsettled(
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
          status: 'PAID_UNSETTLED',
          gatewayRef: data.gatewayRef,
          cardNumber: data.cardNumber,
          paidAt: data.paidAt,
        })
        .where('id = :id AND tenant_id = :tenantId AND status IN (:...fromStatuses)', {
          id,
          tenantId,
          fromStatuses: ['VERIFYING', 'SETTLING'],
        })
        .execute();
      return (res.affected ?? 0) === 1;
    });
  }

  async markPaymentLinkReconciliationRequired(
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
          status: 'RECONCILIATION_REQUIRED',
          gatewayRef: data.gatewayRef,
          cardNumber: data.cardNumber,
          paidAt: data.paidAt,
        })
        .where('id = :id AND tenant_id = :tenantId AND status IN (:...fromStatuses)', {
          id,
          tenantId,
          fromStatuses: ['VERIFYING', 'PAID_UNSETTLED', 'SETTLING'],
        })
        .execute();
      return (res.affected ?? 0) === 1;
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
        .where('id = :id AND tenant_id = :tenantId AND status IN (:...fromStatuses)', {
          id,
          tenantId,
          fromStatuses: ['VERIFYING', 'PAID_UNSETTLED', 'SETTLING'],
        })
        .execute();
      return (res.affected ?? 0) === 1;
    });
  }

  async markPaymentLinkStatus(
    tenantId: string,
    id: string,
    status: 'FAILED' | 'UNVERIFIED' | 'PAID_UNSETTLED',
  ): Promise<void> {
    await this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager ? manager.getRepository(InvoicePaymentLinkEntity) : this.linkRepo;
      await repo
        .createQueryBuilder()
        .update(InvoicePaymentLinkEntity)
        .set({ status })
        .where('id = :id AND tenant_id = :tenantId AND status IN (:...fromStatuses)', {
          id,
          tenantId,
          fromStatuses: ['VERIFYING', 'SETTLING', 'PAID_UNSETTLED'],
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

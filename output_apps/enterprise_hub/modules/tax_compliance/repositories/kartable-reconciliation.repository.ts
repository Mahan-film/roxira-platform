import { BadRequestException, Injectable } from '@nestjs/common';
import { Brackets, In } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { InvoiceJurisdiction } from '../../invoicing/enums/invoice-jurisdiction.enum';
import { InvoiceDirection } from '../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import { MoadianSubmissionEntity } from '../entities/moadian-submission.entity';
import { TaxInvoiceSignatureEntity } from '../entities/tax-invoice-signature.entity';
import { invoiceRialAmounts } from '../reports/invoice-rial-amounts';
import { tehranDay } from '../reports/jalali-format.util';

export interface QuarterDbInvoiceRecord {
  id: string;
  direction: InvoiceDirection;
  subject?: number;
  taxInvoiceNumber: string;
  taxId: string | null;
  issueDate: string;
  counterpartyName: string | null;
  salesMinor: bigint;
  vatMinor: bigint;
  receivableMinor: bigint;
}

@Injectable()
export class KartableReconciliationRepository {
  constructor(private readonly scope: TenantScope) {}

  async loadQuarterInvoices(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<QuarterDbInvoiceRecord[]> {
    return this.scope.run(tenantId, async (manager) => {
      const invoices = await manager
        .getRepository(InvoiceEntity)
        .createQueryBuilder('invoice')
        .where('invoice.tenantId = :tenantId', { tenantId })
        .andWhere('invoice.status IN (:...statuses)', {
          statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PAID],
        })
        .andWhere('invoice.subject = :subject', { subject: 1 })
        .andWhere('invoice.jurisdiction = :jurisdiction', {
          jurisdiction: InvoiceJurisdiction.IR,
        })
        .andWhere(
          new Brackets((qb) => {
            qb.where('invoice.issuedAt >= :from AND invoice.issuedAt < :to', {
              from,
              to,
            }).orWhere(
              'invoice.issuedAt IS NULL AND invoice.createdAt >= :from AND invoice.createdAt < :to',
              { from, to },
            );
          }),
        )
        .orderBy('invoice.issuedAt', 'ASC')
        .addOrderBy('invoice.createdAt', 'ASC')
        .addOrderBy('invoice.taxInvoiceNumber', 'ASC')
        .take(5001)
        .getMany();

      if (invoices.length > 5000) {
        throw new BadRequestException(
          'تعداد فاکتورهای ثبت‌شده در این فصل بیش از ۵۰۰۰ مورد است؛ لطفاً دوره را محدودتر کنید.',
        );
      }

      if (invoices.length === 0) {
        return [];
      }

      const invoiceIds = invoices.map((inv) => inv.id);

      const [submissions, signatures] = await Promise.all([
        manager.getRepository(MoadianSubmissionEntity).find({
          where: { tenantId, invoiceId: In(invoiceIds) },
          order: { createdAt: 'DESC' },
        }),
        manager.getRepository(TaxInvoiceSignatureEntity).find({
          where: { tenantId, invoiceId: In(invoiceIds) },
          order: { createdAt: 'DESC' },
        }),
      ]);

      const taxIdByInvoiceId = new Map<string, string>();
      for (const sig of signatures) {
        if (sig.taxId && !taxIdByInvoiceId.has(sig.invoiceId)) {
          taxIdByInvoiceId.set(sig.invoiceId, sig.taxId);
        }
      }
      // Prefer the live Moadian submission TaxID if present
      for (const sub of submissions) {
        if (sub.taxId) {
          taxIdByInvoiceId.set(sub.invoiceId, sub.taxId);
        }
      }

      return invoices.map((invoice) => {
        const amounts = invoiceRialAmounts(invoice);
        const instant = invoice.issuedAt ?? invoice.createdAt;
        const counterpartyName =
          invoice.direction === InvoiceDirection.PURCHASE
            ? invoice.sellerInfo?.name ?? null
            : invoice.buyerInfo?.name ?? null;

        return {
          id: invoice.id,
          direction: invoice.direction,
          subject: invoice.subject,
          taxInvoiceNumber: invoice.taxInvoiceNumber,
          taxId: taxIdByInvoiceId.get(invoice.id) ?? null,
          issueDate: tehranDay(instant),
          counterpartyName,
          salesMinor: amounts.salesMinor,
          vatMinor: amounts.vatMinor,
          receivableMinor: amounts.receivableMinor,
        };
      });
    });
  }
}

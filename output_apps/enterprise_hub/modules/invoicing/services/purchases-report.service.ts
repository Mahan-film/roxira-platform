import { BadRequestException, Injectable } from '@nestjs/common';
import { ReportTable } from '../../accounting/reports/report-table';
import { jalali } from '../../accounting/reports/report-tables';
import { moneyJson } from '../../accounting/services/financial-reports.service';
import { PurchasesReportQueryDto } from '../dto/purchases-report.dto';
import { InvoiceDirection } from '../enums/invoice-kind.enum';
import { InvoicingRepository } from '../repositories/invoicing.repository';
import { quantityText } from '../reports/invoice-docs';
import { purchasesReport, purchasesReportTable } from '../reports/purchases-report';

/** Purchases by item or supplier (#243) over the tenant's issued and paid purchase invoices, by issue date. */
@Injectable()
export class PurchasesReportService {
  constructor(private readonly invoices: InvoicingRepository) {}

  async build(tenantId: string, query: PurchasesReportQueryDto): Promise<{ json: unknown; table: ReportTable }> {
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('تاریخ شروع باید پیش از تاریخ پایان باشد.');
    }
    const docs = await this.invoices.findDocsBetween(tenantId, InvoiceDirection.PURCHASE, query.from, query.to);
    const groups = purchasesReport(docs, query.groupBy);
    const subtitle = `${query.from ? `از ${jalali(query.from)} ` : ''}${query.to ? `تا ${jalali(query.to)} ` : ''}(مبالغ به ریال)`;
    return {
      table: purchasesReportTable(groups, query.groupBy, subtitle),
      json: moneyJson({
        groupBy: query.groupBy,
        from: query.from ?? null,
        to: query.to ?? null,
        groups: groups.map((group) => ({
          key: group.key,
          quantity: quantityText(group.quantityMilli),
          net: group.netMinor,
          vat: group.vatMinor,
          foreign: [...group.foreign.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([currency, net]) => ({ currency, net })),
        })),
      }),
    };
  }
}
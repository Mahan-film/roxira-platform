import { BadRequestException, Injectable } from '@nestjs/common';
import { ReportTable } from '../../accounting/reports/report-table';
import { jalali } from '../../accounting/reports/report-tables';
import { moneyJson } from '../../accounting/services/financial-reports.service';
import { SalesReportQueryDto } from '../dto/sales-report.dto';
import { InvoicingRepository } from '../repositories/invoicing.repository';
import { quantityText } from '../reports/invoice-docs';
import { salesReport, salesReportTable } from '../reports/sales-report';

/** Sales by item or customer (#243) over the tenant's issued and paid sale invoices, by issue date. */
@Injectable()
export class SalesReportService {
  constructor(private readonly invoices: InvoicingRepository) {}

  async build(tenantId: string, query: SalesReportQueryDto): Promise<{ json: unknown; table: ReportTable }> {
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('تاریخ شروع باید پیش از تاریخ پایان باشد.');
    }
    const docs = await this.invoices.findSalesBetween(tenantId, query.from, query.to);
    const groups = salesReport(docs, query.groupBy);
    const subtitle = `${query.from ? `از ${jalali(query.from)} ` : ''}${query.to ? `تا ${jalali(query.to)} ` : ''}(مبالغ به ریال)`;
    return {
      table: salesReportTable(groups, query.groupBy, subtitle),
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

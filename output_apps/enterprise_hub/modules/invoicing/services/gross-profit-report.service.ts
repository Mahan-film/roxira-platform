import { BadRequestException, Injectable } from '@nestjs/common';
import { ReportTable } from '../../accounting/reports/report-table';
import { jalali } from '../../accounting/reports/report-tables';
import { moneyJson } from '../../accounting/services/financial-reports.service';
import { GrossProfitReportQueryDto } from '../dto/gross-profit-report.dto';
import { InvoiceDirection } from '../enums/invoice-kind.enum';
import { InvoicingRepository } from '../repositories/invoicing.repository';
import { grossProfitReport, grossProfitTable, marginText } from '../reports/gross-profit-report';

/** Gross profit of the SALE documents (#243), by invoice chain, item or customer, over the tenant's issued and paid sale invoices, by issue date. */
@Injectable()
export class GrossProfitReportService {
  constructor(private readonly invoices: InvoicingRepository) {}

  async build(
    tenantId: string,
    query: GrossProfitReportQueryDto,
  ): Promise<{ json: unknown; table: ReportTable }> {
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('تاریخ شروع باید پیش از تاریخ پایان باشد.');
    }
    // A from/to range is applied to the issue date, so it may cut a corrective chain; that is accepted.
    const docs = await this.invoices.findDocsBetween(tenantId, InvoiceDirection.SALE, query.from, query.to);
    const groups = grossProfitReport(docs, query.groupBy);
    const subtitle = `${query.from ? `از ${jalali(query.from)} ` : ''}${query.to ? `تا ${jalali(query.to)} ` : ''}(مبالغ به ریال)`;
    return {
      table: grossProfitTable(groups, query.groupBy, subtitle),
      json: moneyJson({
        groupBy: query.groupBy,
        from: query.from ?? null,
        to: query.to ?? null,
        groups: groups.map((group) => ({
          key: group.key,
          revenue: group.revenueMinor,
          cogs: group.cogsMinor,
          profit: group.profitMinor,
          marginBp: group.marginBp === null ? null : group.marginBp.toString(),
          margin: marginText(group.marginBp),
        })),
      }),
    };
  }
}
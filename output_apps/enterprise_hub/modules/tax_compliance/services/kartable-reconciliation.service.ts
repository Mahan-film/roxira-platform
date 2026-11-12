import { BadRequestException, Injectable } from '@nestjs/common';
import { fromMinor } from '../../accounting/money';
import { InvoiceDirection } from '../../invoicing/enums/invoice-kind.enum';
import {
  KartableQuarterlyVatTotalsDto,
  KartableReconciliationResponseDto,
  KartableReconciliationRowDto,
  KartableSectionKind,
  KartableSectionSummaryDto,
} from '../dto/kartable-reconciliation.dto';
import {
  KartableReconciliationRepository,
  QuarterDbInvoiceRecord,
} from '../repositories/kartable-reconciliation.repository';
import {
  normalizeInvoiceNumber,
  normalizeTaxId,
  parseKartableExportFile,
  ParsedKartableRow,
} from '../utils/kartable-export.parser';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';

export interface UploadedKartableFile {
  buffer: Buffer;
  originalname: string;
}

export interface ReconcileSectionInput {
  file?: UploadedKartableFile;
}

interface SectionReconcileInternal {
  summary: KartableSectionSummaryDto;
  rows: KartableReconciliationRowDto[];
  ourBaseMinor: bigint;
  ourVatMinor: bigint;
  ourGrossMinor: bigint;
  kartableBaseMinor: bigint;
  kartableVatMinor: bigint;
  kartableGrossMinor: bigint;
}

function sumOurTotals(invoices: QuarterDbInvoiceRecord[]): {
  baseMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
} {
  let baseMinor = 0n;
  let vatMinor = 0n;
  let grossMinor = 0n;
  for (const inv of invoices) {
    baseMinor += inv.salesMinor;
    vatMinor += inv.vatMinor;
    grossMinor += inv.receivableMinor;
  }
  return { baseMinor, vatMinor, grossMinor };
}

@Injectable()
export class KartableReconciliationService {
  constructor(private readonly repository: KartableReconciliationRepository) {}

  async reconcile(
    tenantId: string,
    year: number,
    quarter: number,
    files: {
      salesFile?: UploadedKartableFile;
      purchasesFile?: UploadedKartableFile;
    },
  ): Promise<KartableReconciliationResponseDto> {
    if (!files.salesFile && !files.purchasesFile) {
      throw new BadRequestException(
        'حداقل یکی از فایل‌های کارپوشه فروش یا خرید باید بارگذاری شود.',
      );
    }

    const period = jalaliQuarterRange(year, quarter);
    const dbInvoices = await this.repository.loadQuarterInvoices(
      tenantId,
      period.from,
      period.to,
    );

    const dbSales = dbInvoices.filter((i) => i.direction === InvoiceDirection.SALE);
    const dbPurchases = dbInvoices.filter((i) => i.direction === InvoiceDirection.PURCHASE);

    const salesResult = await this.reconcileSection(
      'SALE',
      year,
      quarter,
      dbSales,
      files.salesFile,
    );
    const purchasesResult = await this.reconcileSection(
      'PURCHASE',
      year,
      quarter,
      dbPurchases,
      files.purchasesFile,
    );

    const ourNetVat = salesResult.ourVatMinor - purchasesResult.ourVatMinor;
    const kartableNetVat =
      salesResult.kartableVatMinor - purchasesResult.kartableVatMinor;

    const quarterlyVat: KartableQuarterlyVatTotalsDto = {
      our: {
        salesBase: fromMinor(salesResult.ourBaseMinor),
        salesVat: fromMinor(salesResult.ourVatMinor),
        purchasesBase: fromMinor(purchasesResult.ourBaseMinor),
        purchasesVat: fromMinor(purchasesResult.ourVatMinor),
        netVatPayable: fromMinor(ourNetVat),
      },
      kartable: {
        salesBase: fromMinor(salesResult.kartableBaseMinor),
        salesVat: fromMinor(salesResult.kartableVatMinor),
        purchasesBase: fromMinor(purchasesResult.kartableBaseMinor),
        purchasesVat: fromMinor(purchasesResult.kartableVatMinor),
        netVatPayable: fromMinor(kartableNetVat),
      },
      diff: {
        salesVat: fromMinor(salesResult.kartableVatMinor - salesResult.ourVatMinor),
        purchasesVat: fromMinor(
          purchasesResult.kartableVatMinor - purchasesResult.ourVatMinor,
        ),
        netVatPayable: fromMinor(kartableNetVat - ourNetVat),
      },
    };

    return {
      period: {
        year: period.year,
        quarter: period.quarter,
        label: period.label,
        from: period.from.toISOString(),
        to: period.to.toISOString(),
      },
      currency: 'IRR',
      sales: salesResult.summary,
      purchases: purchasesResult.summary,
      quarterlyVat,
      rows: [...salesResult.rows, ...purchasesResult.rows],
    };
  }

  private async reconcileSection(
    section: KartableSectionKind,
    year: number,
    quarter: number,
    dbInvoices: QuarterDbInvoiceRecord[],
    file?: UploadedKartableFile,
  ): Promise<SectionReconcileInternal> {
    const ourTotals = sumOurTotals(dbInvoices);

    if (!file) {
      return {
        summary: {
          uploaded: false,
          fileName: null,
          formatId: null,
          kartableRowCount: 0,
          outOfPeriodSkippedCount: 0,
          ourInvoiceCount: dbInvoices.length,
          matchedCount: 0,
          amountDifferenceCount: 0,
          missingInOurSystemCount: 0,
          missingInKartableCount: 0,
          ourTaxableBase: fromMinor(ourTotals.baseMinor),
          ourVatTotal: fromMinor(ourTotals.vatMinor),
          ourGrossTotal: fromMinor(ourTotals.grossMinor),
          kartableTaxableBase: 0,
          kartableVatTotal: 0,
          kartableGrossTotal: 0,
        },
        rows: [],
        ourBaseMinor: ourTotals.baseMinor,
        ourVatMinor: ourTotals.vatMinor,
        ourGrossMinor: ourTotals.grossMinor,
        kartableBaseMinor: 0n,
        kartableVatMinor: 0n,
        kartableGrossMinor: 0n,
      };
    }

    const parsed = await parseKartableExportFile(file.buffer, file.originalname);
    const inPeriodRows: ParsedKartableRow[] = [];
    let outOfPeriodSkippedCount = 0;

    for (const row of parsed.rows) {
      if (
        row.jalaliPeriod &&
        (row.jalaliPeriod.year !== year || row.jalaliPeriod.quarter !== quarter)
      ) {
        outOfPeriodSkippedCount += 1;
        continue;
      }
      inPeriodRows.push(row);
    }

    let kartableBaseMinor = 0n;
    let kartableVatMinor = 0n;
    let kartableGrossMinor = 0n;
    for (const row of inPeriodRows) {
      kartableBaseMinor += row.netMinor;
      kartableVatMinor += row.vatMinor;
      kartableGrossMinor += row.totalMinor;
    }

    const matchedDb = new Set<string>();
    const matchedKRow = new Set<number>();
    const pairs: Array<{
      db: QuarterDbInvoiceRecord;
      k: ParsedKartableRow;
      matchBy: 'taxId' | 'invoiceNumber' | 'amount';
    }> = [];

    // Pass 1: exact normalized TaxID match (only unique normalized TaxID pairs)
    const dbByTaxId = new Map<string, QuarterDbInvoiceRecord[]>();
    for (const inv of dbInvoices) {
      const key = normalizeTaxId(inv.taxId);
      if (!key) continue;
      const list = dbByTaxId.get(key) ?? [];
      list.push(inv);
      dbByTaxId.set(key, list);
    }
    for (const row of inPeriodRows) {
      const key = normalizeTaxId(row.taxId);
      if (!key) continue;
      const candidates = (dbByTaxId.get(key) ?? []).filter((d) => !matchedDb.has(d.id));
      if (candidates.length === 1) {
        const dbInv = candidates[0];
        matchedDb.add(dbInv.id);
        matchedKRow.add(row.rowIndex);
        pairs.push({ db: dbInv, k: row, matchBy: 'taxId' });
      }
    }

    // Pass 2: normalized invoice number match
    const dbByInvNo = new Map<string, QuarterDbInvoiceRecord[]>();
    for (const inv of dbInvoices) {
      if (matchedDb.has(inv.id)) continue;
      const key = normalizeInvoiceNumber(inv.taxInvoiceNumber);
      if (!key) continue;
      const list = dbByInvNo.get(key) ?? [];
      list.push(inv);
      dbByInvNo.set(key, list);
    }
    for (const row of inPeriodRows) {
      if (matchedKRow.has(row.rowIndex)) continue;
      const key = normalizeInvoiceNumber(row.invoiceNumber);
      if (!key) continue;
      const candidates = (dbByInvNo.get(key) ?? []).filter((d) => !matchedDb.has(d.id));
      if (candidates.length === 1) {
        const dbInv = candidates[0];
        matchedDb.add(dbInv.id);
        matchedKRow.add(row.rowIndex);
        pairs.push({ db: dbInv, k: row, matchBy: 'invoiceNumber' });
      }
    }

    // Pass 3: unique exact gross amount match on remaining unmatched items
    const remDbByTotal = new Map<bigint, QuarterDbInvoiceRecord[]>();
    for (const inv of dbInvoices) {
      if (matchedDb.has(inv.id)) continue;
      const list = remDbByTotal.get(inv.receivableMinor) ?? [];
      list.push(inv);
      remDbByTotal.set(inv.receivableMinor, list);
    }
    const remKByTotal = new Map<bigint, ParsedKartableRow[]>();
    for (const row of inPeriodRows) {
      if (matchedKRow.has(row.rowIndex)) continue;
      const list = remKByTotal.get(row.totalMinor) ?? [];
      list.push(row);
      remKByTotal.set(row.totalMinor, list);
    }
    for (const [totalMinor, kList] of remKByTotal.entries()) {
      const dbList = remDbByTotal.get(totalMinor) ?? [];
      if (kList.length === 1 && dbList.length === 1) {
        const dbInv = dbList[0];
        const kRow = kList[0];
        // Avoid false amount matches when both sides provide conflicting non-empty TaxIDs
        const dbTaxId = normalizeTaxId(dbInv.taxId);
        const kTaxId = normalizeTaxId(kRow.taxId);
        if (dbTaxId && kTaxId && dbTaxId !== kTaxId) {
          continue;
        }
        matchedDb.add(dbInv.id);
        matchedKRow.add(kRow.rowIndex);
        pairs.push({ db: dbInv, k: kRow, matchBy: 'amount' });
      }
    }

    const rows: KartableReconciliationRowDto[] = [];
    let matchedCount = 0;
    let amountDifferenceCount = 0;
    let missingInOurSystemCount = 0;
    let missingInKartableCount = 0;

    for (const { db, k, matchBy } of pairs) {
      const vatDiffMinor = k.vatMinor - db.vatMinor;
      const totalDiffMinor = k.totalMinor - db.receivableMinor;
      const hasDiff = vatDiffMinor !== 0n || totalDiffMinor !== 0n;
      const bucket = hasDiff ? 'amount_difference' : 'matched';
      if (bucket === 'matched') matchedCount += 1;
      else amountDifferenceCount += 1;

      const noteParts: string[] = [];
      if (totalDiffMinor !== 0n) noteParts.push('اختلاف مبلغ کل');
      if (vatDiffMinor !== 0n) noteParts.push('اختلاف مالیات ارزش افزوده');
      if (db.taxId && k.taxId && normalizeTaxId(db.taxId) !== normalizeTaxId(k.taxId)) {
        noteParts.push('مغایرت شناسه مالیاتی');
      }

      rows.push({
        id: `${section}:${db.id}:${k.rowIndex}`,
        section,
        bucket,
        matchBy,
        taxId: k.taxId ?? db.taxId,
        invoiceNumber: db.taxInvoiceNumber || k.invoiceNumber,
        issueDate: k.issueDate ?? db.issueDate,
        counterpartyName: k.counterpartyName ?? db.counterpartyName,
        ourInvoiceId: db.id,
        ourNetAmount: fromMinor(db.salesMinor),
        ourVatAmount: fromMinor(db.vatMinor),
        ourTotalAmount: fromMinor(db.receivableMinor),
        kartableRowIndex: k.rowIndex,
        kartableNetAmount: fromMinor(k.netMinor),
        kartableVatAmount: fromMinor(k.vatMinor),
        kartableTotalAmount: fromMinor(k.totalMinor),
        vatDiff: fromMinor(vatDiffMinor),
        totalDiff: fromMinor(totalDiffMinor),
        note: noteParts.length > 0 ? noteParts.join('؛ ') : null,
      });
    }

    for (const db of dbInvoices) {
      if (matchedDb.has(db.id)) continue;
      missingInKartableCount += 1;
      rows.push({
        id: `${section}:our:${db.id}`,
        section,
        bucket: 'missing_in_kartable',
        matchBy: 'none',
        taxId: db.taxId,
        invoiceNumber: db.taxInvoiceNumber,
        issueDate: db.issueDate,
        counterpartyName: db.counterpartyName,
        ourInvoiceId: db.id,
        ourNetAmount: fromMinor(db.salesMinor),
        ourVatAmount: fromMinor(db.vatMinor),
        ourTotalAmount: fromMinor(db.receivableMinor),
        kartableRowIndex: null,
        kartableNetAmount: null,
        kartableVatAmount: null,
        kartableTotalAmount: null,
        vatDiff: fromMinor(-db.vatMinor),
        totalDiff: fromMinor(-db.receivableMinor),
        note: 'در سیستم ثبت شده ولی در کارپوشه یافت نشد',
      });
    }

    for (const k of inPeriodRows) {
      if (matchedKRow.has(k.rowIndex)) continue;
      missingInOurSystemCount += 1;
      rows.push({
        id: `${section}:kartable:${k.rowIndex}`,
        section,
        bucket: 'missing_in_our_system',
        matchBy: 'none',
        taxId: k.taxId,
        invoiceNumber: k.invoiceNumber,
        issueDate: k.issueDate,
        counterpartyName: k.counterpartyName,
        ourInvoiceId: null,
        ourNetAmount: null,
        ourVatAmount: null,
        ourTotalAmount: null,
        kartableRowIndex: k.rowIndex,
        kartableNetAmount: fromMinor(k.netMinor),
        kartableVatAmount: fromMinor(k.vatMinor),
        kartableTotalAmount: fromMinor(k.totalMinor),
        vatDiff: fromMinor(k.vatMinor),
        totalDiff: fromMinor(k.totalMinor),
        note: 'در کارپوشه موجود است ولی در سیستم ثبت نشده',
      });
    }

    return {
      summary: {
        uploaded: true,
        fileName: file.originalname,
        formatId: parsed.formatId,
        kartableRowCount: inPeriodRows.length,
        outOfPeriodSkippedCount,
        ourInvoiceCount: dbInvoices.length,
        matchedCount,
        amountDifferenceCount,
        missingInOurSystemCount,
        missingInKartableCount,
        ourTaxableBase: fromMinor(ourTotals.baseMinor),
        ourVatTotal: fromMinor(ourTotals.vatMinor),
        ourGrossTotal: fromMinor(ourTotals.grossMinor),
        kartableTaxableBase: fromMinor(kartableBaseMinor),
        kartableVatTotal: fromMinor(kartableVatMinor),
        kartableGrossTotal: fromMinor(kartableGrossMinor),
      },
      rows,
      ourBaseMinor: ourTotals.baseMinor,
      ourVatMinor: ourTotals.vatMinor,
      ourGrossMinor: ourTotals.grossMinor,
      kartableBaseMinor,
      kartableVatMinor,
      kartableGrossMinor,
    };
  }
}

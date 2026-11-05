import { Injectable } from '@nestjs/common';
import {
  InvoicingImportInput,
  InvoicingService,
} from '../../invoicing/services/invoicing.service';
import {
  AdapterCommitResult,
  CommitRowResult,
  EntityImportAdapter,
  ImportFieldDefinition,
  NormalisedRecord,
  UndoOutcome,
} from './import-registry.types';

/** رجیستری ورود داده صورتحساب‌های فروش (Sales invoices). */
@Injectable()
export class SalesInvoicesRegistry implements EntityImportAdapter {
  readonly key = 'sales-invoices';
  readonly labelFa = 'صورتحساب‌های فروش';

  readonly fields: readonly ImportFieldDefinition[] = [
    {
      key: 'number',
      labelFa: 'شماره صورتحساب',
      required: true,
      type: 'text',
      synonyms: [
        'number',
        'invoice number',
        'ShomareFactor',
        'Factor',
        'شماره فاکتور',
        'شماره صورتحساب',
        'فاکتور',
      ],
    },
    {
      key: 'type',
      labelFa: 'نوع صورتحساب',
      required: false,
      type: 'text',
      synonyms: ['type', 'NoeFactor', 'نوع', 'نوع فاکتور', 'نوع صورتحساب'],
    },
    {
      key: 'date',
      labelFa: 'تاریخ',
      required: false,
      type: 'date',
      synonyms: ['date', 'TarikhFactor', 'Tarikh', 'تاریخ', 'تاریخ فاکتور'],
    },
    {
      key: 'partyCode',
      labelFa: 'کد طرف حساب',
      required: false,
      type: 'text',
      synonyms: [
        'partyCode',
        'party code',
        'TafziliCode',
        'PartyID',
        'Tafzili',
        'کد تفصیلی',
        'طرف حساب',
        'کد طرف حساب',
      ],
    },
    {
      key: 'itemCode',
      labelFa: 'کد کالا',
      required: false,
      type: 'text',
      synonyms: [
        'itemCode',
        'item code',
        'KalaCode',
        'CodeKala',
        'کد کالا',
        'کد کالای انبار',
        'شناسه کالا',
      ],
    },
    {
      key: 'quantity',
      labelFa: 'تعداد',
      required: false,
      type: 'number',
      synonyms: ['quantity', 'qty', 'Tedad', 'تعداد', 'مقدار'],
    },
    {
      key: 'unitPrice',
      labelFa: 'بهای واحد (ریال)',
      required: false,
      type: 'money',
      synonyms: [
        'unitPrice',
        'unit price',
        'BahayeVahed',
        'BahaVahed',
        'قیمت واحد',
        'بهای واحد',
        'بهای واحد (ریال)',
      ],
    },
    {
      key: 'currency',
      labelFa: 'ارز',
      required: false,
      type: 'text',
      synonyms: [
        'currency',
        'VahedPoolFactor',
        'VahedPool',
        'Arz',
        'ارز',
        'واحد پول',
      ],
    },
    {
      key: 'amount',
      labelFa: 'مبلغ',
      required: false,
      type: 'money',
      synonyms: [
        'amount',
        'MablaghKol_Asli',
        'MablaghKol',
        'Mablagh',
        'مبلغ',
        'مبلغ کل',
      ],
    },
    {
      key: 'fxRate',
      labelFa: 'نرخ تسعیر',
      required: false,
      type: 'number',
      synonyms: ['fxRate', 'NerkhTasir_BeRial', 'NerkhTasir', 'نرخ تسعیر'],
    },
    {
      key: 'vat',
      labelFa: 'مالیات ارزش افزوده',
      required: false,
      type: 'money',
      synonyms: [
        'vat',
        'MablaghMaliat_Rial',
        'MablaghMaliat',
        'مالیات',
        'ارزش افزوده',
        'مالیات ارزش افزوده',
      ],
    },
    {
      key: 'totalRial',
      labelFa: 'جمع نهایی (ریال)',
      required: false,
      type: 'money',
      synonyms: [
        'totalRial',
        'total rial',
        'MablaghKhales_Rial',
        'MablaghKhales',
        'جمع ریال',
        'مبلغ خالص',
        'جمع نهایی (ریال)',
      ],
    },
    {
      key: 'status',
      labelFa: 'وضعیت تسویه',
      required: false,
      type: 'text',
      synonyms: ['status', 'VazeiatTasvieh', 'Vazeiat', 'وضعیت', 'وضعیت تسویه'],
    },
  ];

  constructor(private readonly invoicingService: InvoicingService) {}

  duplicateKeys(record: NormalisedRecord): string[] {
    const number = record.values.number;
    if (typeof number !== 'string' || !number.trim()) {
      return [];
    }
    const content = JSON.stringify([
      record.values.type ?? '',
      record.values.date ?? '',
      record.values.partyCode ?? '',
      record.values.itemCode ?? '',
      record.values.quantity ?? '',
      record.values.unitPrice ?? '',
      record.values.amount ?? '',
      record.values.vat ?? '',
      record.values.totalRial ?? '',
      record.values.currency ?? '',
      record.values.fxRate ?? '',
      record.values.status ?? '',
    ]);
    return [`number:${number.trim()}|${content}`];
  }

  async findExistingDuplicateKeys(
    tenantId: string,
    keys: string[],
  ): Promise<string[]> {
    const numbers = new Set<string>();
    for (const key of keys) {
      if (key.startsWith('number:')) {
        numbers.add(key.slice('number:'.length).split('|')[0]);
      }
    }
    if (numbers.size === 0) {
      return [];
    }
    const found = new Set(
      await this.invoicingService.findExistingInvoiceNumbers(
        tenantId,
        Array.from(numbers),
      ),
    );
    return keys.filter((key) => found.has(key.slice('number:'.length).split('|')[0]));
  }

  async commit(
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<AdapterCommitResult> {
    if (records.length === 0) {
      return { inserted: [], failed: [] };
    }

    const inserted: CommitRowResult[] = [];
    const failed: Array<{ rowNumber: number; message: string }> = [];

    try {
      const results = await this.invoicingService.importInvoices(
        tenantId,
        records.map((record) => this.toInput(record)),
      );
      const seen = new Set<number>();
      for (const result of results) {
        seen.add(result.rowNumber);
        if (result.error) {
          failed.push({ rowNumber: result.rowNumber, message: result.error });
        } else if (result.invoiceId) {
          inserted.push({ rowNumber: result.rowNumber, ownerId: result.invoiceId });
        }
      }
      for (const record of records) {
        if (!seen.has(record.rowNumber)) {
          failed.push({
            rowNumber: record.rowNumber,
            message: 'شماره صورتحساب الزامی است.',
          });
        }
      }
    } catch (error) {
      const message = this.errorMessage(error, 'درج صورتحساب‌ها ناموفق بود.');
      for (const record of records) {
        failed.push({ rowNumber: record.rowNumber, message });
      }
    }

    return { inserted, failed };
  }

  async undo(tenantId: string, ownerIds: (number | string)[]): Promise<UndoOutcome> {
    const { removed } =
      await this.invoicingService.removeImportedInvoices(tenantId, ownerIds);
    return { removed, refused: [] };
  }

  private toInput(record: NormalisedRecord): InvoicingImportInput {
    const values = record.values;
    const input: InvoicingImportInput = {
      rowNumber: record.rowNumber,
      number: String(values.number ?? '').trim(),
    };
    if (values.type) {
      input.type = String(values.type);
    }
    if (typeof values.date === 'string') {
      input.date = values.date;
    }
    if (values.partyCode) {
      input.partyCode = String(values.partyCode);
    }
    if (values.itemCode) {
      input.itemCode = String(values.itemCode);
    }
    if (typeof values.quantity === 'number') {
      input.quantity = values.quantity;
    }
    if (typeof values.unitPrice === 'number') {
      input.unitPrice = values.unitPrice;
    }
    if (values.currency) {
      input.currency = String(values.currency);
    }
    if (typeof values.amount === 'number') {
      input.amount = values.amount;
    }
    if (typeof values.fxRate === 'number') {
      input.fxRate = values.fxRate;
    }
    if (typeof values.vat === 'number') {
      input.vat = values.vat;
    }
    if (typeof values.totalRial === 'number') {
      input.totalRial = values.totalRial;
    }
    return input;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }
}

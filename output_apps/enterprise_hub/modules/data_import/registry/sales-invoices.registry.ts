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
      synonyms: ['type', 'NoeFactor', 'نوع', 'نوع فاکتور'],
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
      synonyms: ['vat', 'MablaghMaliat_Rial', 'MablaghMaliat', 'مالیات', 'ارزش افزوده'],
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
    if (typeof number === 'string' && number.trim()) {
      return [`number:${number.trim()}`];
    }
    return [];
  }

  async findExistingDuplicateKeys(
    tenantId: string,
    keys: string[],
  ): Promise<string[]> {
    const numbers = keys
      .filter((key) => key.startsWith('number:'))
      .map((key) => key.slice('number:'.length));
    const found = await this.invoicingService.findExistingInvoiceNumbers(
      tenantId,
      numbers,
    );
    return found.map((number) => `number:${number}`);
  }

  async commit(
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<AdapterCommitResult> {
    const inserted: CommitRowResult[] = [];
    const failed = [];

    for (const record of records) {
      try {
        const ids = await this.invoicingService.importInvoices(tenantId, [
          this.toInput(record),
        ]);
        inserted.push({ rowNumber: record.rowNumber, ownerId: ids[0] });
      } catch (error) {
        failed.push({
          rowNumber: record.rowNumber,
          message: this.errorMessage(error, 'درج صورتحساب ناموفق بود.'),
        });
      }
    }

    return { inserted, failed };
  }

  async undo(tenantId: string, ownerIds: number[]): Promise<UndoOutcome> {
    const { removed } =
      await this.invoicingService.removeImportedInvoices(tenantId, ownerIds);
    return { removed, refused: [] };
  }

  private toInput(record: NormalisedRecord): InvoicingImportInput {
    const values = record.values;
    const input: InvoicingImportInput = {
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
    if (values.status) {
      input.status = String(values.status);
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

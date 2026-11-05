import * as fs from 'fs';
import * as path from 'path';
import { SalesInvoicesRegistry } from './sales-invoices.registry';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { groupInvoiceRows, InvoiceImportLookups, InvoiceImportRow } from '../../invoicing/services/invoice-import';
import { normaliseAndValidate } from './field-validation';
import { buildEntityFallbackMapping } from './entity-detect';
import { InvoiceDirection } from '../../invoicing/enums/invoice-kind.enum';
import { NormalisedRecord } from './import-registry.types';

const TENANT = 'tenant1';

const makeRegistry = () => {
  const mockInvoicingService = {
    importInvoices: jest.fn(),
    findExistingInvoiceNumbers: jest.fn(async () => []),
    removeImportedInvoices: jest.fn(async () => ({ removed: 0 })),
  } as unknown as InvoicingService;
  return { mockInvoicingService, registry: new SalesInvoicesRegistry(mockInvoicingService) };
};

const record = (rowNumber: number, values: Record<string, unknown>): NormalisedRecord =>
  ({ rowNumber, values } as unknown as NormalisedRecord);

describe('SalesInvoicesRegistry', () => {
  it('keys a duplicate on the full row content, not only the number', () => {
    const { registry } = makeRegistry();
    const values = {
      number: 'INV-S-1',
      type: 'فروش',
      date: '2024-04-01',
      partyCode: 'CUST-1',
      itemCode: 'ITM-1',
      quantity: 2,
      unitPrice: 1000,
      amount: 2000,
      vat: 200,
      totalRial: 2200,
      currency: 'IRR',
      fxRate: 1,
      status: 'صادرشده',
    };
    const [first] = registry.duplicateKeys(record(2, values));
    expect(first).toContain('number:INV-S-1|');

    const [again] = registry.duplicateKeys(record(9, { ...values }));
    expect(again).toBe(first);

    const [otherItem] = registry.duplicateKeys(record(3, { ...values, itemCode: 'ITM-2' }));
    expect(otherItem).not.toBe(first);

    expect(registry.duplicateKeys(record(4, { number: ' ' }))).toEqual([]);
  });

  it('finds existing numbers through findExistingDuplicateKeys across row-content keys', async () => {
    const { mockInvoicingService, registry } = makeRegistry();
    mockInvoicingService.findExistingInvoiceNumbers = jest.fn(async () => ['INV-1']);
    const keys = ['number:INV-1|["فروش"]', 'number:INV-2|["خرید"]'];
    await expect(registry.findExistingDuplicateKeys(TENANT, keys)).resolves.toEqual([
      'number:INV-1|["فروش"]',
    ]);
    expect(mockInvoicingService.findExistingInvoiceNumbers).toHaveBeenCalledWith(TENANT, ['INV-1', 'INV-2']);
  });

  it('commits all rows in one grouped call and maps row results back', async () => {
    const { mockInvoicingService, registry } = makeRegistry();
    mockInvoicingService.importInvoices = jest.fn(async () => [
      { rowNumber: 2, invoiceNumber: 'INV-1', invoiceId: 'uuid-1', error: null, duplicate: false, existingDuplicate: false },
      { rowNumber: 3, invoiceNumber: 'INV-1', invoiceId: 'uuid-1', error: null, duplicate: false, existingDuplicate: false },
      { rowNumber: 5, invoiceNumber: 'INV-2', invoiceId: null, error: 'خطا', duplicate: false, existingDuplicate: false },
    ]);

    const result = await registry.commit(TENANT, [
      record(2, { number: 'INV-1', type: 'فروش', itemCode: 'ITM-1', quantity: 2, unitPrice: 1000, amount: 2000, vat: 200, totalRial: 2200 }),
      record(3, { number: 'INV-1', type: 'فروش', itemCode: 'ITM-2', quantity: 1, unitPrice: 5000, amount: 5000, vat: 500, totalRial: 5500 }),
      record(5, { number: 'INV-2', type: 'خرید', itemCode: 'ITM-1', quantity: 1, unitPrice: 1000, amount: 1000, vat: 100, totalRial: 1100 }),
    ]);

    expect(mockInvoicingService.importInvoices).toHaveBeenCalledTimes(1);
    const inputs = (mockInvoicingService.importInvoices as jest.Mock).mock.calls[0][1];
    expect(inputs).toHaveLength(3);
    expect(inputs[0]).toMatchObject({
      rowNumber: 2,
      number: 'INV-1',
      type: 'فروش',
      itemCode: 'ITM-1',
      quantity: 2,
      unitPrice: 1000,
      amount: 2000,
      vat: 200,
      totalRial: 2200,
    });
    expect(result.inserted).toEqual([
      { rowNumber: 2, ownerId: 'uuid-1' },
      { rowNumber: 3, ownerId: 'uuid-1' },
    ]);
    expect(result.failed).toEqual([{ rowNumber: 5, message: 'خطا' }]);
  });

  it('reports rows the service skipped (blank number) as failures and survives a thrown commit', async () => {
    const { mockInvoicingService, registry } = makeRegistry();
    mockInvoicingService.importInvoices = jest.fn(async () => []);

    const blankResult = await registry.commit(TENANT, [record(2, { number: '' })]);
    expect(blankResult.inserted).toEqual([]);
    expect(blankResult.failed).toEqual([
      { rowNumber: 2, message: 'شماره صورتحساب الزامی است.' },
    ]);

    mockInvoicingService.importInvoices = jest.fn(async () => {
      throw new Error('دیتابیس در دسترس نیست.');
    });
    const thrownResult = await registry.commit(TENANT, [record(7, { number: 'INV-9' })]);
    expect(thrownResult.inserted).toEqual([]);
    expect(thrownResult.failed).toEqual([
      { rowNumber: 7, message: 'دیتابیس در دسترس نیست.' },
    ]);
  });

  it('undoes through removeImportedInvoices', async () => {
    const { mockInvoicingService, registry } = makeRegistry();
    mockInvoicingService.removeImportedInvoices = jest.fn(async () => ({ removed: 2 }));
    await expect(registry.undo(TENANT, ['uuid-1', 'uuid-2'])).resolves.toEqual({
      removed: 2,
      refused: [],
    });
  });

  it('sample company file: 360 rows form 238 distinct invoices (143 sales, 95 purchases) with 2 exact repeats and 6 walk-in rows', async () => {
    const { registry } = makeRegistry();
    const file = path.resolve(__dirname, '../../../../../e2e/fixtures/sample-company/invoices.csv');
    const [headerLine, ...lines] = fs
      .readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\r?\n/);
    const header = headerLine.split(',');
    const mapping = buildEntityFallbackMapping(registry.fields, header);

    expect(mapping['شماره صورتحساب']).toBe('number');
    expect(mapping['نوع صورتحساب']).toBe('type');
    expect(mapping['کد طرف حساب']).toBe('partyCode');
    expect(mapping['کد کالا']).toBe('itemCode');
    expect(mapping['تعداد']).toBe('quantity');
    expect(mapping['بهای واحد (ریال)']).toBe('unitPrice');
    expect(mapping['مبلغ']).toBe('amount');
    expect(mapping['مالیات ارزش افزوده']).toBe('vat');
    expect(mapping['جمع نهایی (ریال)']).toBe('totalRial');
    expect(mapping['ارز']).toBe('currency');
    expect(mapping['نرخ تسعیر']).toBe('fxRate');

    const rows: InvoiceImportRow[] = [];
    let rowNumber = 1;
    for (const line of lines) {
      const cells = line.split(',');
      const values: Record<string, unknown> = {};
      for (const [column, fieldKey] of Object.entries(mapping)) {
        const field = registry.fields.find((item) => item.key === fieldKey)!;
        const raw = cells[header.indexOf(column)];
        if (raw === undefined || raw.trim() === '') {
          continue;
        }
        const out = normaliseAndValidate(field, raw);
        expect(out.error).toBeNull();
        values[fieldKey] = out.value;
      }
      rowNumber += 1;
      rows.push({ rowNumber, number: String(values.number ?? ''), ...values } as unknown as InvoiceImportRow);
    }

    expect(rows).toHaveLength(360);

    const partyCodes = new Set(
      rows.map((row) => String(row.partyCode ?? '').trim()).filter(Boolean),
    );
    const skus = new Set(
      rows.map((row) => String(row.itemCode ?? '').trim()).filter(Boolean),
    );
    const lookups: InvoiceImportLookups = {
      partyByCode: new Map(
        Array.from(partyCodes).map((code) => [code, { id: 1, code, name: code }]),
      ),
      existingSkus: skus,
    };

    const plans = groupInvoiceRows(rows, lookups);
    const sales = plans.filter((plan) => plan.direction === InvoiceDirection.SALE);
    const purchases = plans.filter((plan) => plan.direction === InvoiceDirection.PURCHASE);
    const duplicates = plans.flatMap((plan) => plan.duplicateRows);
    const walkIns = plans.filter((plan) => plan.walkIn);

    expect(plans).toHaveLength(238);
    expect(sales).toHaveLength(143);
    expect(purchases).toHaveLength(95);
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map((duplicate) => duplicate.rowNumber).sort((a, b) => a - b)).toEqual([121, 201]);
    expect(walkIns).toHaveLength(6);
    expect(plans.every((plan) => plan.valid)).toBe(true);
    expect(plans.every((plan) => plan.lines.length > 0)).toBe(true);
    expect(plans.every((plan) => plan.date !== null)).toBe(true);
  });
});

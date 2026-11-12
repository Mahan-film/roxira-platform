import 'reflect-metadata';
import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessGuard } from '../access/access.guard';
import { AccessService } from '../access/services/access.service';
import { AccessStub } from '../../test/support/access-stub';
import { InvoiceDirection } from '../invoicing/enums/invoice-kind.enum';
import { KartableReconciliationController } from './controllers/kartable-reconciliation.controller';
import {
  KartableReconciliationRepository,
  QuarterDbInvoiceRecord,
} from './repositories/kartable-reconciliation.repository';
import { KartableReconciliationService } from './services/kartable-reconciliation.service';
import { parseKartableExportFile, parseKartableMoneyToMinor } from './utils/kartable-export.parser';
import {
  SYNTHETIC_KARTABLE_PURCHASES_XLSX,
  SYNTHETIC_KARTABLE_SALES_CSV,
} from './__fixtures__/synthetic-kartable.fixture';

function makeAccessContext(
  handler: (...args: unknown[]) => unknown,
  controllerClass: new (...args: never[]) => unknown,
  req: Record<string, unknown>,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('KartableReconciliation (parser, matching, quarterly VAT, AccessGuard)', () => {
  it('parses UTF-8 BOM CSV with Persian digits, comma amounts, and Toman conversion without float drift', async () => {
    const parsed = await parseKartableExportFile(SYNTHETIC_KARTABLE_SALES_CSV, 'kartable-sales.csv');
    expect(parsed.formatId).toBe('csv');
    expect(parsed.rows).toHaveLength(5);

    expect(parsed.rows[0]).toMatchObject({
      taxId: 'TAXSYNTH0000000001',
      invoiceNumber: 'INV-1405-001',
      issueDate: '2026-04-04',
      jalaliPeriod: { year: 1405, quarter: 1 },
      netMinor: 1_000_000_000n,
      vatMinor: 100_000_000n,
      totalMinor: 1_100_000_000n,
    });

    // Q2 row is parsed with quarter = 2 so reconciliation filters it for Q1
    expect(parsed.rows[4].jalaliPeriod).toEqual({ year: 1405, quarter: 2 });

    // Unit conversion checks: Toman * 10 vs Rial
    expect(parseKartableMoneyToMinor('۱۲٬۵۰۰ تومان')).toBe(12_500_000n);
    expect(parseKartableMoneyToMinor('۱۲٬۵۰۰ ریال')).toBe(1_250_000n);
  });

  it('parses minimal XLSX with Arabic letters and extracts purchases rows cleanly', async () => {
    const parsed = await parseKartableExportFile(SYNTHETIC_KARTABLE_PURCHASES_XLSX, 'purchases.xlsx');
    expect(parsed.formatId).toBe('xlsx');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      taxId: 'PURTAX001',
      invoiceNumber: 'PINV-101',
      netMinor: 400_000_000n,
      vatMinor: 40_000_000n,
      totalMinor: 440_000_000n,
    });
  });

  it('rejects empty buffer, non-spreadsheet JSON/binary payloads, and requests without any file', async () => {
    await expect(parseKartableExportFile(Buffer.alloc(0), 'empty.csv')).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      parseKartableExportFile(Buffer.from('{"a":1,"b":2}', 'utf8'), 'trick.csv'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      parseKartableExportFile(Buffer.from([0xff, 0x00, 0xfe, 0x11, 0x99, 0x01]), 'bad.xlsx'),
    ).rejects.toThrow(BadRequestException);

    const repo = { loadQuarterInvoices: jest.fn(async () => []) } as unknown as KartableReconciliationRepository;
    const service = new KartableReconciliationService(repo);
    await expect(service.reconcile('tenant-1', 1405, 1, {})).rejects.toThrow(BadRequestException);
  });

  it('reconciles sales (CSV) & purchases (XLSX) into all 4 buckets and computes quarterly VAT totals', async () => {
    const dbInvoices: QuarterDbInvoiceRecord[] = [
      // S1: matched by TaxID against CSV row 1
      {
        id: 'sale-1',
        direction: InvoiceDirection.SALE,
        taxInvoiceNumber: 'OLD-INV-NUM',
        taxId: 'TAX-SYNTH-0000000001',
        issueDate: '2026-04-04',
        counterpartyName: 'شرکت نمونه الف',
        salesMinor: 1_000_000_000n,
        vatMinor: 100_000_000n,
        receivableMinor: 1_100_000_000n,
      },
      // S2: matched by InvoiceNumber against CSV row 2, with VAT difference (our VAT 500,000 vs 450,000)
      {
        id: 'sale-2',
        direction: InvoiceDirection.SALE,
        taxInvoiceNumber: 'INV-1405-002',
        taxId: null,
        issueDate: '2026-04-30',
        counterpartyName: 'بازرگانی نمونه ب',
        salesMinor: 500_000_000n,
        vatMinor: 50_000_000n,
        receivableMinor: 550_000_000n,
      },
      // S3: matched by unique totalMinor (2,200,000 IRR) against CSV row 3
      {
        id: 'sale-3',
        direction: InvoiceDirection.SALE,
        taxInvoiceNumber: 'INV-LOCAL-33',
        taxId: null,
        issueDate: '2026-05-22',
        counterpartyName: 'فروشگاه نمونه ج',
        salesMinor: 200_000_000n,
        vatMinor: 20_000_000n,
        receivableMinor: 220_000_000n,
      },
      // S4: Missing in Kartable
      {
        id: 'sale-4',
        direction: InvoiceDirection.SALE,
        taxInvoiceNumber: 'INV-1405-LOCAL-ONLY',
        taxId: null,
        issueDate: '2026-06-05',
        counterpartyName: 'مشتری داخلی',
        salesMinor: 100_000_000n,
        vatMinor: 10_000_000n,
        receivableMinor: 110_000_000n,
      },
      // P1: Purchase matched by TaxID against XLSX row 1
      {
        id: 'pur-1',
        direction: InvoiceDirection.PURCHASE,
        taxInvoiceNumber: 'PINV-101',
        taxId: 'PUR-TAX-001',
        issueDate: '2026-04-14',
        counterpartyName: 'تأمین‌کننده الف',
        salesMinor: 400_000_000n,
        vatMinor: 40_000_000n,
        receivableMinor: 440_000_000n,
      },
      // P2: Purchase missing in Kartable
      {
        id: 'pur-2',
        direction: InvoiceDirection.PURCHASE,
        taxInvoiceNumber: 'PINV-ONLY-OUR',
        taxId: null,
        issueDate: '2026-05-01',
        counterpartyName: 'تأمین‌کننده داخلی',
        salesMinor: 200_000_000n,
        vatMinor: 20_000_000n,
        receivableMinor: 220_000_000n,
      },
    ];

    const repo = {
      loadQuarterInvoices: jest.fn(async () => dbInvoices),
    } as unknown as KartableReconciliationRepository;
    const service = new KartableReconciliationService(repo);

    const res = await service.reconcile('tenant-x', 1405, 1, {
      salesFile: { buffer: SYNTHETIC_KARTABLE_SALES_CSV, originalname: 'sales.csv' },
      purchasesFile: { buffer: SYNTHETIC_KARTABLE_PURCHASES_XLSX, originalname: 'purchases.xlsx' },
    });

    expect(res.period.year).toBe(1405);
    expect(res.period.quarter).toBe(1);

    expect(res.sales).toMatchObject({
      uploaded: true,
      formatId: 'csv',
      kartableRowCount: 4,
      outOfPeriodSkippedCount: 1,
      ourInvoiceCount: 4,
      matchedCount: 2, // S1 (taxId) + S3 (amount)
      amountDifferenceCount: 1, // S2 (invoiceNumber, VAT diff)
      missingInOurSystemCount: 1, // TAX-SYNTH-ONLY-KART
      missingInKartableCount: 1, // S4
      ourTaxableBase: 18_000_000,
      ourVatTotal: 1_800_000,
      ourGrossTotal: 19_800_000,
      kartableTaxableBase: 20_000_000,
      kartableVatTotal: 1_950_000,
      kartableGrossTotal: 21_950_000,
    });

    expect(res.purchases).toMatchObject({
      uploaded: true,
      formatId: 'xlsx',
      kartableRowCount: 2,
      outOfPeriodSkippedCount: 0,
      ourInvoiceCount: 2,
      matchedCount: 1,
      amountDifferenceCount: 0,
      missingInOurSystemCount: 1,
      missingInKartableCount: 1,
      ourVatTotal: 600_000,
      kartableVatTotal: 500_000,
    });

    expect(res.quarterlyVat).toEqual({
      our: {
        salesBase: 18_000_000,
        salesVat: 1_800_000,
        purchasesBase: 6_000_000,
        purchasesVat: 600_000,
        netVatPayable: 1_200_000,
      },
      kartable: {
        salesBase: 20_000_000,
        salesVat: 1_950_000,
        purchasesBase: 5_000_000,
        purchasesVat: 500_000,
        netVatPayable: 1_450_000,
      },
      diff: {
        salesVat: 150_000,
        purchasesVat: -100_000,
        netVatPayable: 250_000,
      },
    });

    const s1Row = res.rows.find((r) => r.ourInvoiceId === 'sale-1');
    const s2Row = res.rows.find((r) => r.ourInvoiceId === 'sale-2');
    const s3Row = res.rows.find((r) => r.ourInvoiceId === 'sale-3');
    expect(s1Row?.matchBy).toBe('taxId');
    expect(s1Row?.bucket).toBe('matched');
    expect(s2Row?.matchBy).toBe('invoiceNumber');
    expect(s2Row?.bucket).toBe('amount_difference');
    expect(s2Row?.vatDiff).toBe(-50_000);
    expect(s2Row?.totalDiff).toBe(-50_000);
    expect(s3Row?.matchBy).toBe('amount');
    expect(s3Row?.bucket).toBe('matched');
  });

  it('preserves exact decimal string precision for huge BigInt rial totals (> 2^51 minor units)', async () => {
    const csvHuge = Buffer.from(
      [
        'taxId,invoiceNumber,netAmount,vatAmount,totalAmount',
        'HUGE-TAX-1,INV-HUGE-1,900000000000000,90000000000000,990000000000000',
      ].join('\n'),
      'utf8',
    );
    const repo = {
      loadQuarterInvoices: jest.fn(async () => [
        {
          id: 'huge-1',
          direction: InvoiceDirection.SALE,
          taxInvoiceNumber: 'INV-HUGE-1',
          taxId: 'HUGE-TAX-1',
          issueDate: '2026-04-04',
          counterpartyName: 'سازمان بزرگ',
          salesMinor: 90_000_000_000_000_000n,
          vatMinor: 9_000_000_000_000_000n,
          receivableMinor: 99_000_000_000_000_000n,
        },
      ]),
    } as unknown as KartableReconciliationRepository;

    const service = new KartableReconciliationService(repo);
    const res = await service.reconcile('t-huge', 1405, 1, {
      salesFile: { buffer: csvHuge, originalname: 'huge.csv' },
    });

    expect(res.sales.matchedCount).toBe(1);
    expect(res.sales.ourGrossTotal).toBe('990000000000000.00');
    expect(res.quarterlyVat.our.salesVat).toBe('90000000000000.00');
    expect(res.quarterlyVat.diff.salesVat).toBe(0);
  });

  it('enforces AccessGuard: read_only gets 403 Forbidden, accountant succeeds and passes JWT tenantId', async () => {
    const stub = new AccessStub();
    stub.grant('u-ro', 'tenant-sec', 'read_only');
    stub.grant('u-acc', 'tenant-sec', 'accountant');

    const guard = new AccessGuard(new Reflector(), stub as unknown as AccessService);

    await expect(
      guard.canActivate(
        makeAccessContext(
          KartableReconciliationController.prototype.reconcile,
          KartableReconciliationController,
          { method: 'POST', user: { sub: 'u-ro', tenantId: 'tenant-sec', tenantRole: 'MEMBER' } },
        ),
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      guard.canActivate(
        makeAccessContext(
          KartableReconciliationController.prototype.reconcile,
          KartableReconciliationController,
          { method: 'POST', user: { sub: 'u-acc', tenantId: 'tenant-sec', tenantRole: 'MEMBER' } },
        ),
      ),
    ).resolves.toBe(true);

    const spyReconcile = jest.fn(async () => ({ ok: true }));
    const ctrl = new KartableReconciliationController({
      reconcile: spyReconcile,
    } as unknown as KartableReconciliationService);

    const salesFile = {
      buffer: Buffer.from('taxId,totalAmount\nTAX1,1000\n', 'utf8'),
      originalname: 's.csv',
    };
    await ctrl.reconcile(
      { user: { sub: 'u-acc', tenantId: 'tenant-sec' } } as never,
      { year: 1405, quarter: 1 },
      { salesFile: [salesFile] },
    );

    expect(spyReconcile).toHaveBeenCalledWith('tenant-sec', 1405, 1, {
      salesFile,
      purchasesFile: undefined,
    });
  });
});

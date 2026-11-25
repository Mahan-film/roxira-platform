import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AccountType } from '../accounting/enums/accounting.enum';
import { AccountingService } from '../accounting/services/accounting.service';
import { CurrencyService } from '../currency/services/currency.service';
import { SUITE_EVENT_INVOICE_STATUS_JOB } from './constants/suite-events.constants';
import { PayInvoiceDto } from './dto/pay-invoice.dto';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoiceSubject } from './enums/invoice-kind.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicingService } from './services/invoicing.service';

describe('InvoicingService.pay fundAccountCode selection (#497 b)', () => {
  const TENANT_ID = '11111111-1111-4111-8111-111111111111';
  const INVOICE_ID = '22222222-2222-4222-8222-222222222222';

  const buildInvoice = (over: Partial<InvoiceEntity> = {}): InvoiceEntity =>
    ({
      id: INVOICE_ID,
      tenantId: TENANT_ID,
      taxInvoiceNumber: 'INV-497-1',
      status: InvoiceStatus.ISSUED,
      subject: InvoiceSubject.ORIGINAL,
      sellerInfo: { name: 'Seller' },
      buyerInfo: { name: 'Buyer' },
      currency: 'IRR',
      totalAmount: 1000,
      totalDiscount: 0,
      totalTax: 0,
      finalPayable: 1000,
      items: [],
      issuedAt: new Date('2026-10-01T10:00:00Z'),
      paidAt: null,
      postingMeta: null,
      ...over,
    }) as InvoiceEntity;

  const buildHarness = (
    invoice: InvoiceEntity,
    accounts: Array<{ code: string; accountType: AccountType }> = [
      { code: '1101', accountType: AccountType.ASSET },
      { code: '1102', accountType: AccountType.ASSET },
      { code: '4101', accountType: AccountType.REVENUE },
    ],
    includeAccounting = true,
  ) => {
    let stored = invoice;
    const repo = {
      findById: jest.fn(async () => stored),
      save: jest.fn(async (_t: string, e: InvoiceEntity) => {
        stored = e;
        return e;
      }),
    } as unknown as InvoicingRepository;
    const currency = {
      convert: (v: number) => v,
      round: (v: number) => v,
    } as unknown as CurrencyService;
    const queue = {
      add: jest.fn(async () => ({ id: 'job-1' })),
    } as unknown as Queue;
    const accounting = includeAccounting
      ? ({
          listAccounts: jest.fn(async () => accounts),
        } as unknown as AccountingService)
      : undefined;

    const service = new InvoicingService(
      repo,
      currency,
      undefined,
      undefined,
      undefined,
      queue,
      undefined,
      undefined,
      undefined,
      accounting,
    );
    return { service, repo, queue, getStored: () => stored };
  };

  it('validates PayInvoiceDto via ValidationPipe (accepts empty body, trims string, rejects whitespace/non-string)', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    const meta = { type: 'body' as const, metatype: PayInvoiceDto };

    await expect(pipe.transform({}, meta)).resolves.toEqual({});
    await expect(pipe.transform({ fundAccountCode: ' 1102 ' }, meta)).resolves.toEqual({
      fundAccountCode: '1102',
    });
    await expect(pipe.transform({ fundAccountCode: '   ' }, meta)).rejects.toThrow(
      BadRequestException,
    );
    await expect(pipe.transform({ fundAccountCode: 1102 }, meta)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('stores paymentFundAccountCode on postingMeta and emits fundAccountCode in suite-events when chosen', async () => {
    const { service, queue, getStored } = buildHarness(buildInvoice());

    await service.pay(TENANT_ID, INVOICE_ID, { fundAccountCode: ' 1102 ' });

    expect(getStored().status).toBe(InvoiceStatus.PAID);
    expect(getStored().postingMeta?.paymentFundAccountCode).toBe('1102');
    expect(queue.add).toHaveBeenCalledWith(
      SUITE_EVENT_INVOICE_STATUS_JOB,
      {
        tenantId: TENANT_ID,
        invoiceId: INVOICE_ID,
        status: InvoiceStatus.PAID,
        fundAccountCode: '1102',
      },
      { removeOnComplete: true, removeOnFail: true },
    );
  });

  it('keeps default behavior when fundAccountCode is omitted', async () => {
    const { service, queue, getStored } = buildHarness(buildInvoice());

    await service.pay(TENANT_ID, INVOICE_ID);

    expect(getStored().status).toBe(InvoiceStatus.PAID);
    expect(getStored().postingMeta).toBeNull();
    expect(queue.add).toHaveBeenCalledWith(
      SUITE_EVENT_INVOICE_STATUS_JOB,
      {
        tenantId: TENANT_ID,
        invoiceId: INVOICE_ID,
        status: InvoiceStatus.PAID,
      },
      { removeOnComplete: true, removeOnFail: true },
    );
  });

  it('rejects unknown account code, non-ASSET account code, blank code, or missing accounting service', async () => {
    const h1 = buildHarness(buildInvoice());
    await expect(
      h1.service.pay(TENANT_ID, INVOICE_ID, { fundAccountCode: '9999' }),
    ).rejects.toThrow(BadRequestException);

    const h2 = buildHarness(buildInvoice());
    await expect(
      h2.service.pay(TENANT_ID, INVOICE_ID, { fundAccountCode: '4101' }),
    ).rejects.toThrow(BadRequestException);

    const h3 = buildHarness(buildInvoice());
    await expect(
      h3.service.pay(TENANT_ID, INVOICE_ID, { fundAccountCode: '   ' }),
    ).rejects.toThrow(BadRequestException);

    const h4 = buildHarness(buildInvoice(), [], false);
    await expect(
      h4.service.pay(TENANT_ID, INVOICE_ID, { fundAccountCode: '1102' }),
    ).rejects.toThrow(BadRequestException);
  });
});

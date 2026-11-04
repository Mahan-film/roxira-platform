/**
 * E1.3: line and invoice discounts, with VAT charged on the discounted base.
 * The invoice discount is spread over the lines (largest remainder, exact to the rial) so each
 * line's tax = (gross - discount) × its own rate.
 */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { allocateDiscount, percentOf, toMinor } from './services/invoice-discount';
import { InvoicingService } from './services/invoicing.service';

const T = 'tenant-a';

class MemoryRepo {
  rows: InvoiceEntity[] = [];
  async create(tenantId: string, data: Partial<InvoiceEntity>) {
    const row = { ...data, id: `inv-${this.rows.length + 1}`, tenantId, createdAt: new Date() } as InvoiceEntity;
    this.rows.push(row);
    return row;
  }
  async save(_tenantId: string, entity: InvoiceEntity) {
    return entity;
  }
  async findById(tenantId: string, id: string) {
    return this.rows.find((row) => row.id === id && row.tenantId === tenantId) ?? null;
  }
  async findByTaxInvoiceNumber(tenantId: string, number: string) {
    return this.rows.find((row) => row.taxInvoiceNumber === number && row.tenantId === tenantId) ?? null;
  }
}

const build = () => {
  const repo = new MemoryRepo();
  const service = new InvoicingService(
    repo as unknown as InvoicingRepository,
    { getRate: () => 1, round: (v: number) => v } as unknown as CurrencyService,
    undefined,
    undefined,
    { findDefaultVatRate: async () => 0.1 } as unknown as TenantsRepository,
  );
  return { service, repo };
};

let seq = 0;
const dto = (over: Partial<CreateInvoiceDto> = {}): CreateInvoiceDto => ({
  taxInvoiceNumber: `TI-D-${++seq}`,
  sellerInfo: { name: 'فروشنده' },
  buyerInfo: { name: 'خریدار' },
  currency: Currency.IRR,
  items: [{ description: 'کالا', quantity: 2, unitPrice: 1000 }],
  ...over,
});

describe('discount allocation helpers', () => {
  it('splits exactly, largest remainder first, earlier line on ties', () => {
    expect(allocateDiscount([100n, 100n, 100n], 100n)).toEqual([34n, 33n, 33n]);
    expect(allocateDiscount([1n, 2n, 0n], 3n)).toEqual([1n, 2n, 0n]);
    expect(allocateDiscount([500n, 300n], 0n)).toEqual([0n, 0n]);
    const shares = allocateDiscount([7_777_777n, 1_234_567n, 999n], 1_000_001n);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(1_000_001n);
  });

  it('works on amounts too large for float products', () => {
    const shares = allocateDiscount([9_000_000_000_000n, 1_000_000_000_000n], 5_000_000_000_001n);
    expect(shares).toEqual([4_500_000_000_001n, 500_000_000_000n]);
  });

  it('rounds percents half up in minor units', () => {
    expect(percentOf(1005n, 10)).toBe(101n); // 100.5 -> 101
    expect(percentOf(toMinor(12.34, 2), 12.5)).toBe(154n); // 154.25 -> 154
  });
});

describe('InvoicingService line and invoice discounts (E1.3)', () => {
  it('a line discount lowers the VAT base', async () => {
    const { service } = build();
    const inv = await service.create(T, dto({ items: [{ description: 'x', quantity: 2, unitPrice: 1000, discount: 200 }] }));
    expect(inv.items[0]).toMatchObject({ discount: 200, tax: 180, total: 1980 });
    expect(inv).toMatchObject({ totalAmount: 2000, totalDiscount: 200, invoiceDiscount: 0, totalTax: 180, finalPayable: 1980 });
  });

  it('a line discount percent is a percent of quantity × unit price', async () => {
    const { service } = build();
    const inv = await service.create(T, dto({ items: [{ description: 'x', quantity: 3, unitPrice: 333, discountPercent: 10 }] }));
    // gross 999, 10% = 99.9 -> 100 rials
    expect(inv.items[0]).toMatchObject({ discount: 100, tax: 90, total: 989 });
  });

  it('an invoice discount is spread over lines with different VAT rates, each taxed on its own base', async () => {
    const { service } = build();
    const inv = await service.create(
      T,
      dto({
        items: [
          { description: 'standard', quantity: 1, unitPrice: 6000, vatRate: 10 },
          { description: 'exempt', quantity: 1, unitPrice: 4000, vatRate: 0 },
        ],
        invoiceDiscount: 1000,
      }),
    );
    expect(inv.items[0]).toMatchObject({ discount: 600, invoiceDiscountShare: 600, tax: 540, total: 5940 });
    expect(inv.items[1]).toMatchObject({ discount: 400, invoiceDiscountShare: 400, tax: 0, total: 3600 });
    expect(inv).toMatchObject({ totalAmount: 10000, totalDiscount: 1000, invoiceDiscount: 1000, totalTax: 540, finalPayable: 9540 });
    // Net + VAT = payable, so the posting (receivable = net + VAT) balances.
    expect(inv.totalAmount - inv.totalDiscount + inv.totalTax).toBe(inv.finalPayable);
  });

  it('an invoice discount percent applies after the line discounts and never drifts by a rial', async () => {
    const { service } = build();
    const inv = await service.create(
      T,
      dto({
        items: [
          { description: 'a', quantity: 1, unitPrice: 1000, discount: 100 },
          { description: 'b', quantity: 1, unitPrice: 1000 },
          { description: 'c', quantity: 1, unitPrice: 1000 },
        ],
        invoiceDiscountPercent: 10,
      }),
    );
    // net 2900, 10% = 290 spread 90/100/100
    expect(inv.items.map((i) => i.invoiceDiscountShare)).toEqual([90, 100, 100]);
    expect(inv.items.map((i) => i.discount)).toEqual([190, 100, 100]);
    expect(inv.invoiceDiscount).toBe(290);
    expect(inv.totalDiscount).toBe(390);
    expect(inv.totalTax).toBe(81 + 90 + 90);
  });

  it('refuses a discount above the amount, and amount plus percent together', async () => {
    const { service } = build();
    await expect(
      service.create(T, dto({ items: [{ description: 'x', quantity: 1, unitPrice: 100, discount: 101 }] })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(T, dto({ items: [{ description: 'x', quantity: 1, unitPrice: 100, discount: 1, discountPercent: 1 }] })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(T, dto({ invoiceDiscount: 2001 }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(T, dto({ invoiceDiscount: 5, invoiceDiscountPercent: 5 }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a 100% invoice discount leaves nothing to tax', async () => {
    const { service } = build();
    const inv = await service.create(T, dto({ invoiceDiscountPercent: 100 }));
    expect(inv).toMatchObject({ totalTax: 0, finalPayable: 0, invoiceDiscount: 2000 });
  });

  it('quote gives the same totals as create (POS checks payments against it)', async () => {
    const { service } = build();
    const body = {
      items: [
        { description: 'a', quantity: 1, unitPrice: 777 },
        { description: 'b', quantity: 3, unitPrice: 111, discountPercent: 5 },
      ],
      invoiceDiscount: 99,
    };
    const quote = await service.quote(T, body);
    const inv = await service.create(T, dto(body));
    expect(quote.totals.finalPayable).toBe(inv.finalPayable);
    expect(quote.totals.totalTax).toBe(inv.totalTax);
  });

  it('update keeps the stored invoice discount when only lines change, and changes it when sent', async () => {
    const { service } = build();
    const inv = await service.create(T, dto({ invoiceDiscount: 200 }));
    expect(inv).toMatchObject({ invoiceDiscount: 200, totalTax: 180 });

    const relined = await service.update(T, inv.id, {
      items: [{ description: 'y', quantity: 4, unitPrice: 1000, discount: 0 }],
    });
    expect(relined).toMatchObject({ totalAmount: 4000, invoiceDiscount: 200, totalTax: 380, finalPayable: 4180 });

    const rediscounted = await service.update(T, inv.id, { invoiceDiscountPercent: 50 });
    expect(rediscounted.items[0]).toMatchObject({ discount: 2000, invoiceDiscountShare: 2000 });
    expect(rediscounted).toMatchObject({ invoiceDiscount: 2000, totalTax: 200, finalPayable: 2200 });
  });
});

import 'reflect-metadata';
import { CrmRepository } from '../crm/repositories/crm.repository';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { InventoryRepository } from '../inventory/repositories/inventory.repository';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { runMoadianPreFlightValidation } from '../tax_compliance/utils/moadian-preflight.validator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { computeLineMath, sumGrossMinor } from './services/invoice-line-math';
import { InvoicingService } from './services/invoicing.service';
import { fixtureVatRates } from './__fixtures__/vat-rate.fixture';

const currencyService = {
  getRate: jest.fn(() => 1),
  round: jest.fn((value: number) => value),
} as unknown as CurrencyService;

function buildService() {
  const rows: InvoiceEntity[] = [];
  const repository = {
    create: async (tenantId: string, data: Partial<InvoiceEntity>) => {
      const entity = { ...data, id: `invoice-${rows.length + 1}`, tenantId, createdAt: new Date() } as InvoiceEntity;
      rows.push(entity);
      return entity;
    },
    findByTaxInvoiceNumber: async () => null,
  } as unknown as InvoicingRepository;
  return new InvoicingService(
    repository,
    currencyService,
    {} as CrmRepository,
    {} as InventoryRepository,
    {} as TenantsRepository,
    undefined,
    undefined,
    fixtureVatRates(0.1),
  );
}

function dto(quantity: number, unitPrice: number): CreateInvoiceDto {
  return {
    taxInvoiceNumber: 'TI-LM-1',
    sellerInfo: { name: 'فروشنده', nationalId: '10380284790', economicCode: '10380284790', postalCode: '1985913111' },
    buyerInfo: { name: 'خریدار' },
    currency: Currency.IRR,
    items: [{ description: 'کالا', quantity, unitPrice, discount: 0, taxCode: '2330001234567' }],
  };
}

describe('invoice line math (shared by InvoicingService and the Moadian pre-flight)', () => {
  it('does not round gross per line: IRR scale 0, 10% VAT, 0.5 x 29 => tax 1, total 16', () => {
    const math = computeLineMath({ quantity: 5000n, unitPrice: 290000n, discount: 0n, vatRate: 100000n });
    expect(math.tax).toBe(1n);
    expect(math.total).toBe(16n);
    expect(sumGrossMinor([math])).toBe(15n); // 14.5 rounded once, half up
  });

  it('the invoice InvoicingService stores passes the pre-flight validator (repro of review blocker)', async () => {
    const created = await buildService().create('tenant-a', dto(0.5, 29));
    expect(created.items[0].tax).toBe(1);
    expect(created.items[0].total).toBe(16);

    const result = runMoadianPreFlightValidation(created, { expectedVatRate: 0.1 });
    const math = result.errors.filter((e) => /MATH_MISMATCH|HEADER_/.test(e.code));
    expect(math).toEqual([]);
  });

  it('stays consistent with the service across fractional quantities, fractional prices, and discounts', async () => {
    const service = buildService();
    for (const [qty, price] of [
      [0.5, 29],
      [2, 0.5],
      [1.25, 333],
      [2.75, 17],
      [0.01, 999],
      [3.5, 15],
    ]) {
      const created = await service.create('tenant-a', dto(qty, price));
      const result = runMoadianPreFlightValidation(created, { expectedVatRate: 0.1 });
      expect(result.errors.filter((e) => /MATH_MISMATCH|HEADER_/.test(e.code))).toEqual([]);
    }

    // Foreign currency (USD, scale 2)
    const usdDto = {
      ...dto(2, 10.55),
      currency: Currency.USD,
      fxRate: 900000,
    };
    const usdInvoice = await service.create('tenant-a', usdDto);
    expect(usdInvoice.items[0].unitPrice).toBe(10.55);
    const usdResult = runMoadianPreFlightValidation(usdInvoice, { expectedVatRate: 0.1 });
    expect(usdResult.errors.filter((e) => /MATH_MISMATCH|HEADER_/.test(e.code))).toEqual([]);
  });

  it('handles fractional unit prices with scale 0 (e.g. qty 1000 × 0.5 IRR → gross 500, tax 50, total 550)', async () => {
    const service = buildService();
    const fractionalDto = dto(1000, 0.5);
    const invoice = await service.create('tenant-a', fractionalDto);
    expect(invoice.items[0].unitPrice).toBe(0.5);
    expect(invoice.items[0].tax).toBe(50);
    expect(invoice.items[0].total).toBe(550);
    expect(invoice.totalAmount).toBe(500);
    expect(invoice.finalPayable).toBe(550);
    const result = runMoadianPreFlightValidation(invoice, { expectedVatRate: 0.1 });
    expect(result.errors.filter((e) => /MATH_MISMATCH|HEADER_/.test(e.code))).toEqual([]);
  });
});

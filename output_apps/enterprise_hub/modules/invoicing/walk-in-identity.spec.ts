import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { CrmLeadEntity } from '../crm/entities/crm-lead.entity';
import { CrmRepository } from '../crm/repositories/crm.repository';
import { CustomerIdentityService, WALK_IN_NAME } from '../crm/services/customer-identity.service';
import { normalizePhone } from '../crm/utils/phone';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { invoiceRuleFor } from './country/invoice-country-rules';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceEntity } from './entities/invoice.entity';
import { EInvoiceType } from './enums/invoice-kind.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicingService } from './services/invoicing.service';

const TENANT = 'tenant-a';

/** In-memory CRM repository with the behaviour the identity service relies on. */
class FakeCrm {
  leads: CrmLeadEntity[] = [];
  private n = 0;
  async findWalkInLead(tenantId: string) {
    return this.leads.find((l) => l.tenantId === tenantId && l.isWalkIn) ?? null;
  }
  async createWalkInLead(tenantId: string, fullName: string) {
    const lead = { id: ++this.n, tenantId, fullName, isWalkIn: true, email: null, phone: null } as unknown as CrmLeadEntity;
    this.leads.push(lead);
    return lead;
  }
  async findLeadByPhoneNormalized(tenantId: string, phone: string) {
    return this.leads.find((l) => l.tenantId === tenantId && !l.isWalkIn && l.phoneNormalized === phone) ?? null;
  }
  async createLead(tenantId: string, data: Partial<CrmLeadEntity>) {
    const lead = { id: ++this.n, tenantId, ...data, phoneNormalized: normalizePhone(data.phone) } as CrmLeadEntity;
    this.leads.push(lead);
    return lead;
  }
  async findLeadById(tenantId: string, id: number) {
    return this.leads.find((l) => l.tenantId === tenantId && l.id === id) ?? null;
  }
}

describe('phone normalisation', () => {
  it.each([
    ['09121234567', '09121234567'],
    ['+98 912 123 4567', '09121234567'],
    ['0098-912-123-4567', '09121234567'],
    ['۰۹۱۲۱۲۳۴۵۶۷', '09121234567'],
    ['٠٩١٢١٢٣٤٥٦٧', '09121234567'],
    ['(021) 2200 1100', '02122001100'],
  ])('%s -> %s', (raw, expected) => expect(normalizePhone(raw)).toBe(expected));

  it('returns null without digits and keeps other countries untouched', () => {
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('+98 912 123 4567', 'DE')).toBe('989121234567');
  });
});

describe('country rules', () => {
  it('Iran needs identity for type 1 only and defaults anonymous sales to type 2', () => {
    const ir = invoiceRuleFor('ir');
    expect(ir.anonymousType).toBe(EInvoiceType.WITHOUT_BUYER);
    expect(ir.identityNeeded(EInvoiceType.WITH_BUYER)).toBe('tax_id');
    expect(ir.identityNeeded(EInvoiceType.WITHOUT_BUYER)).toBe('none');
    expect(ir.identityNeeded(EInvoiceType.RETAIL)).toBe('none');
  });

  it('any other country needs no buyer identity', () => {
    const rule = invoiceRuleFor('DE');
    expect(rule.identityNeeded(EInvoiceType.WITH_BUYER)).toBe('none');
    expect(invoiceRuleFor(undefined).anonymousType).toBe(EInvoiceType.WITHOUT_BUYER);
  });
});

describe('customer identity levels', () => {
  const setup = () => {
    const crm = new FakeCrm();
    return { crm, identity: new CustomerIdentityService(crm as unknown as CrmRepository) };
  };

  it('level 1, nobody: the one walk-in customer, never a record per sale', async () => {
    const { crm, identity } = setup();
    const a = await identity.resolve(TENANT, undefined);
    const b = await identity.resolve(TENANT, {});
    expect(a.level).toBe('anonymous');
    expect(a.lead.id).toBe(b.lead.id);
    expect(a.lead.fullName).toBe(WALK_IN_NAME);
    expect(crm.leads).toHaveLength(1);
    // Another tenant gets its own.
    expect((await identity.resolve('tenant-b', undefined)).lead.id).not.toBe(a.lead.id);
  });

  it('level 2, phone only: creates a minimal customer once, then reuses it on any spelling', async () => {
    const { crm, identity } = setup();
    const first = await identity.resolve(TENANT, { phone: '0912 123 4567' });
    expect(first).toMatchObject({ level: 'phone', created: true });
    expect(first.lead).toMatchObject({ marketingConsent: false, source: 'POS', email: null, isWalkIn: false });
    const again = await identity.resolve(TENANT, { phone: '+98 912 123 4567' });
    expect(again).toMatchObject({ level: 'phone', created: false });
    expect(again.lead.id).toBe(first.lead.id);
    expect(crm.leads.filter((l) => !l.isWalkIn)).toHaveLength(1);
  });

  it('level 3, name and phone: reuses an exact phone match and keeps its name; new phone creates', async () => {
    const { identity } = setup();
    const known = await identity.resolve(TENANT, { phone: '09121234567', name: 'علی رضایی' });
    expect(known).toMatchObject({ level: 'name_phone', created: true });
    expect(known.lead.fullName).toBe('علی رضایی');
    const other = await identity.resolve(TENANT, { phone: '09121234567', name: 'نام دیگر' });
    expect(other.created).toBe(false);
    expect(other.lead.fullName).toBe('علی رضایی');
    const fresh = await identity.resolve(TENANT, { phone: '09350000000', name: 'سارا' });
    expect(fresh.created).toBe(true);
    expect(fresh.lead.id).not.toBe(known.lead.id);
  });

  it('the same phone in another tenant is a different customer', async () => {
    const { identity } = setup();
    const a = await identity.resolve(TENANT, { phone: '09121234567' });
    const b = await identity.resolve('tenant-b', { phone: '09121234567' });
    expect(b.created).toBe(true);
    expect(b.lead.id).not.toBe(a.lead.id);
  });
});

describe('invoice buyer rule (Iran)', () => {
  const build = (countryCode = 'IR') => {
    const crm = new FakeCrm();
    const identity = new CustomerIdentityService(crm as unknown as CrmRepository);
    const rows: InvoiceEntity[] = [];
    const repo = {
      findByTaxInvoiceNumber: async () => null,
      create: async (tenantId: string, data: Partial<InvoiceEntity>) => {
        const row = { ...data, id: `inv-${rows.length + 1}`, tenantId, createdAt: new Date() } as InvoiceEntity;
        rows.push(row);
        return row;
      },
    };
    const service = new InvoicingService(
      repo as unknown as InvoicingRepository,
      { getRate: () => 1, round: (v: number) => v } as unknown as CurrencyService,
      crm as unknown as CrmRepository,
      undefined,
      { findById: async () => ({ countryCode, name: 'ما' }), findDefaultVatRate: async () => 0.1 } as unknown as TenantsRepository,
      undefined,
      identity,
    );
    return { service, crm, rows };
  };
  const dto = (over: Partial<CreateInvoiceDto> = {}): CreateInvoiceDto => ({
    sellerInfo: { name: 'ما' },
    items: [{ description: 'کالا', quantity: 1, unitPrice: 1000 }],
    currency: Currency.IRR,
    ...over,
  });

  it('no customer at all: walk-in customer and type 2', async () => {
    const { service, crm } = build();
    const invoice = await service.create(TENANT, dto());
    expect(invoice.einvoiceType).toBe(EInvoiceType.WITHOUT_BUYER);
    expect(invoice.buyerInfo.name).toBe(WALK_IN_NAME);
    expect(invoice.customerId).toBe(crm.leads[0].id);
    await service.create(TENANT, dto());
    expect(crm.leads).toHaveLength(1);
  });

  it('type 1 without buyer identity is refused; with a tax id it is accepted', async () => {
    const { service } = build();
    await expect(service.create(TENANT, dto({ einvoiceType: EInvoiceType.WITH_BUYER }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(TENANT, dto({ einvoiceType: EInvoiceType.WITH_BUYER, buyerInfo: { name: 'شرکت' } })),
    ).rejects.toBeInstanceOf(BadRequestException);
    const ok = await service.create(
      TENANT,
      dto({ einvoiceType: EInvoiceType.WITH_BUYER, buyerInfo: { name: 'شرکت', economicCode: '411234567890' } }),
    );
    expect(ok.einvoiceType).toBe(EInvoiceType.WITH_BUYER);
  });

  it('a named buyer without tax id defaults to type 2; one with a national id defaults to type 1', async () => {
    const { service } = build();
    expect((await service.create(TENANT, dto({ buyerInfo: { name: 'علی' } }))).einvoiceType).toBe(EInvoiceType.WITHOUT_BUYER);
    expect(
      (await service.create(TENANT, dto({ buyerInfo: { name: 'علی', nationalId: '0012345678' } }))).einvoiceType,
    ).toBe(EInvoiceType.WITH_BUYER);
  });

  it('another country never demands identity, even for type 1', async () => {
    const { service } = build('DE');
    const invoice = await service.create(TENANT, dto({ einvoiceType: EInvoiceType.WITH_BUYER }));
    expect(invoice.buyerInfo.name).toBe(WALK_IN_NAME);
  });
});

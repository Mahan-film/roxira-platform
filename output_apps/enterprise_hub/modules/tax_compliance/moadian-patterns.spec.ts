import 'reflect-metadata';
import { Currency } from '../currency/enums/currency.enum';
import { InvoiceResponseDto } from '../invoicing/dto/invoice-response.dto';
import { InvoiceJurisdiction } from '../invoicing/enums/invoice-jurisdiction.enum';
import { EInvoiceType, InvoiceDirection, InvoiceSubject } from '../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import {
  MoadianBuyerType,
  MoadianInvoicePattern as P,
  MoadianInvoiceSubject,
  MoadianInvoiceType,
  MoadianSettlementMethod,
} from './enums/moadian.enum';
import { statusOf, HEADER_RULES, BODY_RULES } from './utils/moadian-pattern-rules';
import { MoadianMappingContext, MoadianMappingError, mapInvoiceToMoadianPacket } from './utils/moadian-packet.mapper';
import { validatePacketAgainstPattern } from './utils/moadian-packet.validator';

/** Synthetic data only: made-up ids and amounts, never a real taxpayer. No call leaves this file. */
const invoice = (over: Partial<InvoiceResponseDto> = {}): InvoiceResponseDto =>
  ({
    id: 'inv-1', taxInvoiceNumber: 'T-1', direction: InvoiceDirection.SALE, einvoiceType: EInvoiceType.WITH_BUYER,
    subject: InvoiceSubject.ORIGINAL, relatedInvoiceId: null, warehouseId: null, customerId: null,
    sellerInfo: { name: 'Seller', economicCode: '10101010101' },
    buyerInfo: { name: 'Buyer', nationalId: '0012345678', economicCode: '00123456780012' },
    items: [{ description: 'x', quantity: 2, unitPrice: 1_000_000, discount: 100_000, vatRate: 0.1, tax: 190_000, total: 2_090_000 }],
    currency: Currency.IRR, jurisdiction: InvoiceJurisdiction.IR, exchangeRate: 1, fxRate: 1, amountFx: null,
    baseCurrency: Currency.USD, totalAmount: 2_000_000, totalDiscount: 100_000, totalTax: 190_000, finalPayable: 2_090_000,
    baseTotalAmount: 0, baseTotalTax: 0, baseFinalPayable: 0, status: InvoiceStatus.ISSUED,
    issuedAt: new Date('2026-10-22T08:30:00Z'), paidAt: null, journalEntryId: null, paidJournalEntryId: null,
    reversalJournalEntryId: null, postingError: null, createdAt: new Date('2026-10-22T08:00:00Z'), ...over,
  }) as unknown as InvoiceResponseDto;

const ctx = (over: Partial<MoadianMappingContext> = {}): MoadianMappingContext => ({
  memoryId: 'A1B2C3', sellerEconomicCode: '10101010101', serial: 1, defaultSstid: '2330001234567',
  defaultMeasurementUnit: '1627', settlementMethod: MoadianSettlementMethod.CASH, ...over,
});

const map = (pattern: P, c: Partial<MoadianMappingContext> = {}, inv: Partial<InvoiceResponseDto> = {}) =>
  mapInvoiceToMoadianPacket(invoice(inv), ctx({ pattern, ...c }));

describe('Moadian rule table (copied from moadian-fields.md)', () => {
  it('spot checks of the status per type and pattern', () => {
    const t1 = MoadianInvoiceType.WITH_BUYER;
    const t2 = MoadianInvoiceType.WITHOUT_BUYER;
    expect(statusOf(HEADER_RULES, 'ft', t1, P.AIRLINE_TICKET)).toBe('M');
    expect(statusOf(HEADER_RULES, 'ft', t1, P.SALE)).toBe('I');
    expect(statusOf(HEADER_RULES, 'crn', t1, P.CONTRACT)).toBe('M');
    expect(statusOf(HEADER_RULES, 'billid', t1, P.UTILITY_BILLS)).toBe('M');
    expect(statusOf(HEADER_RULES, 'tprdis', t1, P.EXPORT)).toBe('I');
    expect(statusOf(HEADER_RULES, 'setm', t2, P.SALE)).toBe('I');
    expect(statusOf(HEADER_RULES, 'setm', t2, P.SALE_CURRENCY)).toBe('I');
    expect(statusOf(BODY_RULES, 'am', t1, P.SALE_CURRENCY)).toBe('I');
    expect(statusOf(BODY_RULES, 'consfee', t2, P.GOLD)).toBe('M');
    expect(statusOf(BODY_RULES, 'cpr', t1, P.SALE_CURRENCY)).toBe('M');
    expect(statusOf(BODY_RULES, 'ssrv', t1, P.EXPORT)).toBe('M');
  });
});

describe('type 1 and type 2, pattern 1 (sale)', () => {
  it('type 1 sends the settlement block and drops every out-of-pattern field', () => {
    const { header, body } = map(P.SALE);
    expect(header).toMatchObject({ inty: 1, inp: 1, ins: 1, setm: 1, indati2m: null, insr: null, irtaxid: null, ft: null, crn: null, billid: null, torv: null });
    expect(body[0]).toMatchObject({ cfee: null, ssrv: null, consfee: null, cpr: null });
    expect(header.tob).toBe(MoadianBuyerType.NATURAL);
  });

  it('type 2 (no buyer) drops setm, cap, insp, tvop, cop and vop', () => {
    const { header, body } = map(P.SALE, {}, { buyerInfo: { name: 'Walk-in' } });
    expect(header.inty).toBe(MoadianInvoiceType.WITHOUT_BUYER);
    expect(header).toMatchObject({ setm: null, cap: null, insp: null, tvop: null, tob: null, bid: null, tinb: null });
    expect(body[0]).toMatchObject({ cop: null, vop: null });
  });

  it('type 2 is refused for patterns other than 1 and 3', () => {
    for (const pattern of [P.SALE_CURRENCY, P.CONTRACT, P.UTILITY_BILLS, P.AIRLINE_TICKET, P.EXPORT]) {
      expect(() => map(pattern, {}, { buyerInfo: { name: 'Walk-in' } })).toThrow(/type 2 is allowed only/);
    }
  });

  it('cash and credit needs the cash part and then sends cap and insp', () => {
    const c = { settlementMethod: MoadianSettlementMethod.CASH_AND_CREDIT };
    expect(() => map(P.SALE, c)).toThrow(/cashPortion/);
    const { header } = map(P.SALE, { ...c, cashPortion: 1_000_000 });
    expect(header).toMatchObject({ cap: 1_000_000, insp: 1_090_000, tbill: 2_090_000 });
  });

  it('refuses a malformed seller code, buyer economic code or buyer id length', () => {
    expect(() => map(P.SALE, { sellerEconomicCode: '1010101010' })).toThrow(/tins/);
    expect(() => map(P.SALE, {}, { buyerInfo: { name: 'B', nationalId: '0012345678', economicCode: '1234567890' } })).toThrow(/tinb/);
  });
});

describe('pattern 2 (currency sale)', () => {
  const item = { cfee: 100, cut: 'USD', exr: 600_000, cpr: 590_000, sovat: 1_000_000 };
  it('drops am, fee and mu and carries the currency block', () => {
    const { body } = map(P.SALE_CURRENCY, { extras: { items: [item] } });
    expect(body[0]).toMatchObject({ am: null, fee: null, mu: null, cfee: 100, cut: 'USD', exr: 600_000, cpr: 590_000, sovat: 1_000_000 });
  });
  it('needs cfee, cut, exr, cpr and sovat and cpr below exr', () => {
    expect(() => map(P.SALE_CURRENCY)).toThrow(/cfee is mandatory/);
    expect(() => map(P.SALE_CURRENCY, { extras: { items: [{ ...item, cpr: 600_000 }] } })).toThrow(/cpr must satisfy/);
    expect(() => map(P.SALE_CURRENCY, { extras: { items: [{ ...item, cut: 'US' }] } })).toThrow(/cut has an invalid/);
  });
});

describe('pattern 3 (gold)', () => {
  const item = { consfee: 50_000, spro: 30_000, bros: 20_000, cui: 750 };
  it('totals the wages into tcpbs and adds them to adis', () => {
    const { body } = map(P.GOLD, { extras: { items: [item] } });
    expect(body[0]).toMatchObject({ tcpbs: 100_000, adis: 2_000_000 + 100_000 - 100_000, cui: 750 });
  });
  it('is allowed for type 2 and refuses missing wages', () => {
    const { header } = map(P.GOLD, { extras: { items: [item] } }, { buyerInfo: { name: 'W' } });
    expect(header.inty).toBe(2);
    expect(() => map(P.GOLD, { extras: { items: [{ ...item, consfee: null }] } })).toThrow(/consfee is mandatory/);
    expect(() => map(P.GOLD, { extras: { items: [{ cui: 1001, consfee: 1, spro: 1, bros: 1 }] } })).toThrow(/cui/);
  });
});

describe('pattern 4 (contract), 5 (utility bill), 6 (airline ticket)', () => {
  it('contract needs crn of at most 12 digits', () => {
    expect(() => map(P.CONTRACT)).toThrow(/crn is mandatory/);
    expect(() => map(P.CONTRACT, { extras: { header: { crn: '1234567890123' } } })).toThrow(/crn has an invalid/);
    expect(map(P.CONTRACT, { extras: { header: { crn: '123456789012' } } }).header.crn).toBe('123456789012');
  });
  it('utility bill needs billid of at most 19 digits', () => {
    expect(() => map(P.UTILITY_BILLS)).toThrow(/billid is mandatory/);
    expect(map(P.UTILITY_BILLS, { extras: { header: { billid: '1234567890123456789' } } }).header.billid).toBe('1234567890123456789');
  });
  it('airline ticket needs ft 1 or 2 and a passport or id for a foreign buyer', () => {
    expect(() => map(P.AIRLINE_TICKET)).toThrow(/ft is mandatory/);
    expect(() => map(P.AIRLINE_TICKET, { extras: { header: { ft: 3 } } })).toThrow(/ft has an invalid/);
    expect(map(P.AIRLINE_TICKET, { extras: { header: { ft: 1 } } }).header.ft).toBe(1);
    expect(() => map(P.AIRLINE_TICKET, { extras: { header: { ft: 2, tob: 4, bid: null } } }, { buyerInfo: { name: 'F', economicCode: '00123456780012' } })).toThrow(/bid|bpn/);
  });
  it('a pattern sends none of the other patterns fields', () => {
    expect(() => map(P.CONTRACT, { extras: { header: { crn: '1', billid: '2' } } })).not.toThrow();
    expect(map(P.CONTRACT, { extras: { header: { crn: '1', billid: '2' } } }).header.billid).toBeNull();
  });
});

describe('pattern 7 (export)', () => {
  const item = { ssrv: 6_000_000, sscv: 10, cut: 'USD', exr: 600_000, nw: 12.5 };
  it('drops the discount block, zero-rates VAT and totals the export values', () => {
    const { header, body } = map(P.EXPORT, { extras: { items: [item] } });
    expect(body[0]).toMatchObject({ prdis: null, dis: null, adis: null, vra: 0, vam: 0, ssrv: 6_000_000, tsstam: 6_000_000 });
    expect(header).toMatchObject({ tprdis: null, tdis: null, tadis: null, torv: 6_000_000, tocv: 10, tonw: 12.5, tbill: 6_000_000, tvam: 0 });
  });
  it('needs ssrv, sscv, cut and exr and refuses a corrective subject', () => {
    expect(() => map(P.EXPORT)).toThrow(/ssrv is mandatory/);
    expect(() => map(P.EXPORT, { subject: MoadianInvoiceSubject.CORRECTIVE, referenceTaxId: 'A'.repeat(22), extras: { items: [item] } })).toThrow(/pattern 7/);
  });
});

describe('extras', () => {
  it('refuses a field outside patterns 1 to 7 instead of sending it unchecked', () => {
    expect(() => map(P.SALE, { extras: { header: { lno: '1' } } })).toThrow(/outside patterns 1 to 7: lno/);
    expect(() => map(P.SALE, { extras: { items: [{ zzz: 1 }] } })).toThrow(/zzz/);
  });
});

describe('subject and late submission', () => {
  const ref = 'A1B2C30510C00000000019';
  it('a main invoice has no irtaxid, other subjects need one of 22 characters', () => {
    expect(() => map(P.SALE, { subject: MoadianInvoiceSubject.CANCELLATION })).toThrow(/irtaxid is required/);
    expect(map(P.SALE, { subject: MoadianInvoiceSubject.CANCELLATION, referenceTaxId: ref }).header.irtaxid).toBe(ref);
    expect(map(P.SALE, { referenceTaxId: ref }).header.irtaxid).toBeNull();
  });
  it('indati2m and insr go together and indati2m is later than indatim', () => {
    const issued = Date.parse('2026-10-22T08:30:00Z');
    expect(map(P.SALE, { lateRegistrationAt: issued + 1000 }).header).toMatchObject({ insr: 1, indati2m: issued + 1000 });
    expect(() => map(P.SALE, { lateRegistrationAt: issued })).toThrow(/indati2m must be later/);
  });
  it('type 3 and patterns beyond 7 are refused (unclear / not covered)', () => {
    expect(() => validatePacketAgainstPattern({ inty: 3, inp: 1 }, [])).toThrow(/unclear/);
    expect(() => map(8 as P)).toThrow(MoadianMappingError);
  });
});

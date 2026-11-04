import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceResponseDto } from '../../invoicing/dto/invoice-response.dto';
import { InvoiceJurisdiction } from '../../invoicing/enums/invoice-jurisdiction.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import {
  MoadianBuyerType,
  MoadianInvoicePattern,
  MoadianInvoiceSubject,
  MoadianInvoiceType,
  MoadianSettlementMethod,
} from '../enums/moadian.enum';
import { statusOf, HEADER_RULES, BODY_RULES, isType2Pattern } from './moadian-pattern-rules';
import { MoadianPacketValidationError, validatePacketAgainstPattern } from './moadian-packet.validator';
import { generateMoadianTaxId } from './moadian-tax-id.util';

/**
 * نگاشت صورتحساب داخلی به بستهٔ مودیان `{header, body[], payments[]}`.
 *
 * نام فیلدها همان کلیدهای کوتاه رسمی است (indatim, inty, tins, sstid, vra, vam, …).
 * تمام مبالغ به «ریال» و عدد صحیح ارسال می‌شوند:
 *   rial = round(amount × fxRate)   (IRR → 1، IRT → 10، ارز خارجی → fxRate صورتحساب)
 * VAT هر سطر (#795/#823) از `vatRate` و `tax` ذخیره‌شده روی همان سطر خوانده می‌شود:
 *   vra = vatRate × 100 (درصد)، vam = round(tax × fxRate).
 */

export interface MoadianInvoiceHeader {
  taxid: string;
  indatim: number;
  indati2m: number | null;
  inty: MoadianInvoiceType;
  inno: string;
  irtaxid: string | null;
  inp: MoadianInvoicePattern;
  ins: MoadianInvoiceSubject;
  tins: string;
  tob: MoadianBuyerType | null;
  bid: string | null;
  tinb: string | null;
  sbc: string | null;
  bpc: string | null;
  bbc: string | null;
  ft: number | null;
  bpn: string | null;
  scln: string | null;
  scc: string | null;
  crn: string | null;
  billid: string | null;
  tprdis: number | null;
  tdis: number | null;
  tadis: number | null;
  tvam: number;
  todam: number;
  tbill: number;
  setm: MoadianSettlementMethod | null;
  cap: number | null;
  insp: number | null;
  tvop: number | null;
  tax17: number | null;
  insr: number | null;
  cdcn: string | null;
  cdcd: number | null;
  tonw: number | null;
  torv: number | null;
  tocv: number | null;
  tinc: string | null;
  nti1: string | null;
  nti2: string | null;
}

export interface MoadianInvoiceBodyItem {
  sstid: string;
  sstt: string;
  am: number | null;
  mu: string | null;
  fee: number | null;
  cfee: number | null;
  cut: string | null;
  exr: number | null;
  prdis: number | null;
  dis: number | null;
  adis: number | null;
  vra: number;
  vam: number;
  odt: string | null;
  odr: number | null;
  odam: number | null;
  olt: string | null;
  olr: number | null;
  olam: number | null;
  consfee: number | null;
  spro: number | null;
  bros: number | null;
  tcpbs: number | null;
  cop: number | null;
  vop: number | null;
  bsrn: string | null;
  tsstam: number;
  nw: number | null;
  ssrv: number | null;
  sscv: number | null;
  cui: number | null;
  cpr: number | null;
  sovat: number | null;
}

export interface MoadianInvoicePayment {
  iinn: string | null;
  acn: string | null;
  trmn: string | null;
  pmt: number | null;
  trn: string | null;
  pcn: string | null;
  pid: string | null;
  pdt: number | null;
  pv: number | null;
}

export interface MoadianInvoicePacket {
  header: MoadianInvoiceHeader;
  body: MoadianInvoiceBodyItem[];
  payments: MoadianInvoicePayment[];
}

export interface MoadianMappingContext {
  memoryId: string;
  /** شماره اقتصادی فروشنده؛ در صورت تهی‌بودن از sellerInfo.economicCode. */
  sellerEconomicCode: string | null;
  /** سریال داخلی یکتای این صورتحساب در حافظه مالیاتی. */
  serial: number;
  /** شناسه ۱۳ رقمی کالا/خدمت پیش‌فرض برای سطرهای بدون شناسه. */
  defaultSstid: string | null;
  defaultMeasurementUnit: string | null;
  settlementMethod: MoadianSettlementMethod;
  /** Pattern `inp` 1 to 7; default 1 (sale). */
  pattern?: MoadianInvoicePattern;
  /** Subject `ins`; default 1 (main). */
  subject?: MoadianInvoiceSubject;
  /** Tax id of the referenced invoice: required when subject is not 1. */
  referenceTaxId?: string | null;
  /** Cash part in rials, required when the settlement method is cash and credit (3). */
  cashPortion?: number;
  /** Article 9 late submission: registration time (ms), sent as `indati2m` with `insr = 1`. */
  lateRegistrationAt?: number;
  /**
   * Pattern-specific data the invoice does not hold (airline ticket type, contract id, bill id,
   * currency, customs, gold wages ...), keyed by Moadian field name. `items[i]` is merged into line i.
   */
  extras?: { header?: Record<string, unknown>; items?: Array<Record<string, unknown>> };
}

export class MoadianMappingError extends Error {}

const SSTID_PATTERN = /^\d{13}$/;
const ECONOMIC_CODE_PATTERN = /^(\d{11}|\d{14})$/;

function toRial(amount: number, factor: number): number {
  return Math.round((Number(amount) + Number.EPSILON) * factor);
}

function rialFactor(invoice: InvoiceResponseDto): number {
  if (invoice.currency === Currency.IRR) {
    return 1;
  }
  const rate = Number(invoice.fxRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new MoadianMappingError('Invoice has no valid rial exchange rate (fxRate)');
  }
  return rate;
}

function digitsOnly(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').replace(/\s+/g, '');
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

/** نوع خریدار بر اساس طول شناسه ملی: ۱۰ رقم = حقیقی، ۱۱ رقم = حقوقی. */
function buyerTypeOf(nationalId: string | null): MoadianBuyerType | null {
  if (nationalId?.length === 10) {
    return MoadianBuyerType.NATURAL;
  }
  if (nationalId?.length === 11) {
    return MoadianBuyerType.LEGAL;
  }
  return null;
}

const BODY_KEYS = ['sstid', 'sstt', 'am', 'mu', 'fee', 'cfee', 'cut', 'exr', 'prdis', 'dis', 'adis', 'vra', 'vam', 'odt', 'odr', 'odam', 'olt', 'olr', 'olam', 'consfee', 'spro', 'bros', 'tcpbs', 'cop', 'vop', 'bsrn', 'tsstam', 'nw', 'ssrv', 'sscv', 'cui', 'cpr', 'sovat'] as const;
const HEADER_KEYS = ['taxid', 'indatim', 'indati2m', 'inty', 'inno', 'irtaxid', 'inp', 'ins', 'tins', 'tob', 'bid', 'tinb', 'sbc', 'bpc', 'bbc', 'ft', 'bpn', 'scln', 'scc', 'crn', 'billid', 'tprdis', 'tdis', 'tadis', 'tvam', 'todam', 'tbill', 'setm', 'cap', 'insp', 'tvop', 'tax17', 'insr', 'cdcn', 'cdcd', 'tonw', 'torv', 'tocv', 'tinc', 'nti1', 'nti2'] as const;

type Bag = Record<string, unknown>;

/** Applies the pattern's field statuses: fields out of pattern are dropped (set to null). */
function dropOutOfPattern(bag: Bag, rules: typeof HEADER_RULES, type: MoadianInvoiceType, pattern: MoadianInvoicePattern): void {
  // An impossible type/pattern pair has no table: leave it intact so the validator reports it.
  if (type === MoadianInvoiceType.WITHOUT_BUYER && !isType2Pattern(pattern)) return;
  for (const field of Object.keys(bag)) {
    if (rules[field] && statusOf(rules, field, type, pattern) === 'I') bag[field] = null;
  }
}

/**
 * Maps an internal invoice to a Moadian packet for type 1 or 2 and patterns 1 to 7. Field presence,
 * format and totals follow docs/legal_sources/iran/moadian-fields.md (see moadian-pattern-rules.ts and
 * moadian-packet.validator.ts). Anything the invoice does not hold comes from `ctx.extras`; fields
 * that the pattern ignores are dropped and anything missing or malformed is a MoadianMappingError.
 */
export function mapInvoiceToMoadianPacket(
  invoice: InvoiceResponseDto,
  ctx: MoadianMappingContext,
): MoadianInvoicePacket {
  if (invoice.jurisdiction !== InvoiceJurisdiction.IR) {
    throw new MoadianMappingError('Only domestic (IR) invoices are reported to Moadian');
  }
  if (invoice.status !== InvoiceStatus.ISSUED && invoice.status !== InvoiceStatus.PAID) {
    throw new MoadianMappingError('Only ISSUED or PAID invoices can be sent to Moadian');
  }
  if (!invoice.items?.length) {
    throw new MoadianMappingError('Invoice has no items');
  }
  const pattern = ctx.pattern ?? MoadianInvoicePattern.SALE;
  const subject = ctx.subject ?? MoadianInvoiceSubject.MAIN;

  const tins = digitsOnly(ctx.sellerEconomicCode) ?? digitsOnly(invoice.sellerInfo?.economicCode);
  if (!tins || !ECONOMIC_CODE_PATTERN.test(tins)) {
    throw new MoadianMappingError('Seller economic code (tins) must be 11 or 14 digits');
  }

  const factor = rialFactor(invoice);
  const issuedAt = invoice.issuedAt ?? invoice.createdAt;
  const indatim = new Date(issuedAt).getTime();
  if (!Number.isFinite(indatim)) {
    throw new MoadianMappingError('Invoice has no valid issue date');
  }

  const bid = digitsOnly(invoice.buyerInfo?.nationalId);
  const tinb = digitsOnly(invoice.buyerInfo?.economicCode);
  const inty = bid || tinb ? MoadianInvoiceType.WITH_BUYER : MoadianInvoiceType.WITHOUT_BUYER;

  const body: Bag[] = invoice.items.map((item, index) => {
    const sstid = ctx.defaultSstid;
    if (!sstid || !SSTID_PATTERN.test(sstid)) {
      throw new MoadianMappingError(`Item ${index + 1} has no 13-digit Moadian product/service id (sstid)`);
    }
    const am = Number(item.quantity);
    const fee = toRial(item.unitPrice, factor);
    const prdis = Math.round(am * fee);
    const dis = Math.min(prdis, toRial(item.discount ?? 0, factor));
    const row: Bag = Object.fromEntries(BODY_KEYS.map((k) => [k, null]));
    Object.assign(row, {
      sstid, sstt: item.description, am, mu: ctx.defaultMeasurementUnit, fee, prdis, dis, adis: prdis - dis,
      vra: Math.round(Number(item.vatRate ?? 0) * 100 * 100) / 100, vam: toRial(item.tax ?? 0, factor),
      odam: null, olam: null,
    });
    // Caller-supplied pattern data wins over computed values (currency, customs, gold wages ...).
    Object.assign(row, ctx.extras?.items?.[index] ?? {});
    if (pattern === MoadianInvoicePattern.GOLD) {
      row.tcpbs = Number(row.consfee ?? 0) + Number(row.spro ?? 0) + Number(row.bros ?? 0);
      row.adis = Number(row.prdis) + Number(row.tcpbs) - Number(row.dis);
    }
    if (pattern === MoadianInvoicePattern.EXPORT) {
      row.vra = 0;
      row.vam = 0;
    }
    return row;
  });

  const taxid = generateMoadianTaxId(ctx.memoryId, indatim, ctx.serial);
  const late = ctx.lateRegistrationAt !== undefined;
  const header: Bag = Object.fromEntries(HEADER_KEYS.map((k) => [k, null]));
  const bidValue = inty === MoadianInvoiceType.WITH_BUYER ? bid : null;
  Object.assign(header, {
    taxid, indatim, inty, inno: ctx.serial.toString(16).padStart(10, '0').toUpperCase(),
    irtaxid: subject === MoadianInvoiceSubject.MAIN ? null : ctx.referenceTaxId ?? null,
    inp: pattern, ins: subject, tins,
    tob: inty === MoadianInvoiceType.WITH_BUYER ? buyerTypeOf(bid) : null,
    bid: bidValue, tinb: inty === MoadianInvoiceType.WITH_BUYER ? tinb : null,
    indati2m: late ? ctx.lateRegistrationAt : null, insr: late ? 1 : null,
    setm: ctx.settlementMethod,
  });
  Object.assign(header, ctx.extras?.header ?? {});

  // Out-of-pattern fields are dropped on both levels before totals are built.
  dropOutOfPattern(header, HEADER_RULES, inty, pattern);
  body.forEach((row) => dropOutOfPattern(row, BODY_RULES, inty, pattern));
  // Which of the optional line fields to total is decided by what is still present.
  body.forEach((row) => {
    const parts = pattern === MoadianInvoicePattern.EXPORT
      ? [row.ssrv, row.vam, row.odam, row.olam]
      : [row.adis, row.vam, row.odam, row.olam];
    row.tsstam = parts.reduce<number>((a, v) => a + Number(v ?? 0), 0);
  });
  const total = (key: string): number | null => {
    const values = body.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
    return values.length === 0 ? null : values.reduce<number>((a, v) => a + Number(v), 0);
  };
  Object.assign(header, {
    tprdis: total('prdis'), tdis: total('dis'), tadis: total('adis'), tvam: total('vam') ?? 0,
    todam: (total('odam') ?? 0) + (total('olam') ?? 0), tbill: total('tsstam') ?? 0,
    tonw: total('nw'), torv: total('ssrv'), tocv: total('sscv'),
  });
  dropOutOfPattern(header, HEADER_RULES, inty, pattern);

  // Cash and credit: the cash part comes from the caller; the credit part is what is left.
  if (header.setm === MoadianSettlementMethod.CASH_AND_CREDIT && inty === MoadianInvoiceType.WITH_BUYER) {
    if (ctx.cashPortion === undefined) {
      throw new MoadianMappingError('cashPortion (rials) is required when the settlement method is cash and credit');
    }
    header.cap = ctx.cashPortion;
    header.insp = Number(header.tbill) - ctx.cashPortion;
  }

  try {
    validatePacketAgainstPattern(header, body);
  } catch (error) {
    if (error instanceof MoadianPacketValidationError) {
      throw new MoadianMappingError(error.message);
    }
    throw error;
  }
  return {
    header: header as unknown as MoadianInvoiceHeader,
    body: body as unknown as MoadianInvoiceBodyItem[],
    payments: [],
  };
}

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
  indati2m: number;
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
  tprdis: number;
  tdis: number;
  tadis: number;
  tvam: number;
  todam: number;
  tbill: number;
  setm: MoadianSettlementMethod;
  cap: number | null;
  insp: number | null;
  tvop: number | null;
  tax17: number | null;
}

export interface MoadianInvoiceBodyItem {
  sstid: string;
  sstt: string;
  am: number;
  mu: string | null;
  fee: number;
  cfee: number | null;
  cut: string | null;
  exr: number | null;
  prdis: number;
  dis: number;
  adis: number;
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
}

export class MoadianMappingError extends Error {}

const SSTID_PATTERN = /^\d{13}$/;
const ECONOMIC_CODE_PATTERN = /^\d{11,14}$/;

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

  const tins = digitsOnly(ctx.sellerEconomicCode) ?? digitsOnly(invoice.sellerInfo?.economicCode);
  if (!tins || !ECONOMIC_CODE_PATTERN.test(tins)) {
    throw new MoadianMappingError('Seller economic code (tins) is missing or invalid');
  }

  const factor = rialFactor(invoice);
  const issuedAt = invoice.issuedAt ?? invoice.createdAt;
  const indatim = new Date(issuedAt).getTime();
  if (!Number.isFinite(indatim)) {
    throw new MoadianMappingError('Invoice has no valid issue date');
  }

  const body: MoadianInvoiceBodyItem[] = invoice.items.map((item, index) => {
    const sstid = ctx.defaultSstid;
    if (!sstid || !SSTID_PATTERN.test(sstid)) {
      throw new MoadianMappingError(
        `Item ${index + 1} has no 13-digit Moadian product/service id (sstid)`,
      );
    }
    const am = Number(item.quantity);
    const fee = toRial(item.unitPrice, factor);
    const prdis = Math.round(am * fee);
    const dis = Math.min(prdis, toRial(item.discount ?? 0, factor));
    const adis = prdis - dis;
    const vatRate = Number(item.vatRate ?? 0);
    const vra = Math.round(vatRate * 100 * 100) / 100;
    const vam = toRial(item.tax ?? 0, factor);
    return {
      sstid,
      sstt: item.description,
      am,
      mu: ctx.defaultMeasurementUnit,
      fee,
      cfee: null,
      cut: null,
      exr: null,
      prdis,
      dis,
      adis,
      vra,
      vam,
      odt: null,
      odr: null,
      odam: null,
      olt: null,
      olr: null,
      olam: null,
      consfee: null,
      spro: null,
      bros: null,
      tcpbs: null,
      cop: null,
      vop: null,
      bsrn: null,
      tsstam: adis + vam,
    };
  });

  const sum = (pick: (row: MoadianInvoiceBodyItem) => number): number =>
    body.reduce((acc, row) => acc + pick(row), 0);
  const tprdis = sum((r) => r.prdis);
  const tdis = sum((r) => r.dis);
  const tadis = sum((r) => r.adis);
  const tvam = sum((r) => r.vam);
  const todam = 0;
  const tbill = tadis + tvam + todam;

  const bid = digitsOnly(invoice.buyerInfo?.nationalId);
  const tinb = digitsOnly(invoice.buyerInfo?.economicCode);
  const inty = bid || tinb ? MoadianInvoiceType.WITH_BUYER : MoadianInvoiceType.WITHOUT_BUYER;

  const taxid = generateMoadianTaxId(ctx.memoryId, indatim, ctx.serial);
  const header: MoadianInvoiceHeader = {
    taxid,
    indatim,
    indati2m: indatim,
    inty,
    inno: ctx.serial.toString(16).padStart(10, '0').toUpperCase(),
    irtaxid: null,
    inp: MoadianInvoicePattern.SALE,
    ins: MoadianInvoiceSubject.MAIN,
    tins,
    tob: inty === MoadianInvoiceType.WITH_BUYER ? buyerTypeOf(bid) : null,
    bid: inty === MoadianInvoiceType.WITH_BUYER ? bid : null,
    tinb: inty === MoadianInvoiceType.WITH_BUYER ? tinb : null,
    sbc: null,
    bpc: null,
    bbc: null,
    ft: null,
    bpn: null,
    scln: null,
    scc: null,
    crn: null,
    billid: null,
    tprdis,
    tdis,
    tadis,
    tvam,
    todam,
    tbill,
    setm: ctx.settlementMethod,
    cap: ctx.settlementMethod === MoadianSettlementMethod.CASH ? tbill : null,
    insp: ctx.settlementMethod === MoadianSettlementMethod.CREDIT ? tbill : null,
    tvop: null,
    tax17: null,
  };

  return { header, body, payments: [] };
}

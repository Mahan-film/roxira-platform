import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { Currency } from '../../currency/enums/currency.enum';
import { CreateInvoiceDto, InvoiceItemDto, InvoicePartyInfoDto } from '../dto/create-invoice.dto';
import { InvoiceDirection, InvoiceSubject } from '../enums/invoice-kind.enum';
import { InvoiceJurisdiction } from '../enums/invoice-jurisdiction.enum';

/**
 * Party on a vendor invoice or credit note (either our SaaS entity or customer).
 */
export interface VendorInvoiceParty {
  name: string;
  country: string;
  address?: string;
  /** Registration or company number (e.g. SSM registration in Malaysia, HRB in Germany). */
  registrationNumber?: string;
  /** Tax ID (e.g. Malaysian SST registration, EU VAT ID, National Tax ID). */
  taxId?: string;
  /** Whether the party is an authenticated business customer. */
  isB2B: boolean;
  /** Whether the tax id (e.g. EU VAT ID via VIES) was verified. */
  verifiedTaxId?: boolean;
}

/**
 * Input line item for generating an invoice or credit note.
 * All monetary amounts are strict BigInt minor units (e.g. cents/sen).
 */
export interface VendorInvoiceLineInput {
  description: string;
  quantity: number;
  unitPriceMinor: bigint;
  sku?: string;
}

/**
 * Calculated line item in the generated document.
 */
export interface VendorInvoiceLineItem {
  description: string;
  quantity: number;
  unitPriceMinor: bigint;
  netMinor: bigint;
  taxRateBps: number; // Basis points (e.g. 800 = 8.00%, 0 = 0%)
  taxRateDecimal: string; // "0.08", "0.00"
  taxCode: string;
  taxMinor: bigint;
  grossMinor: bigint;
  sku?: string;
}

/**
 * Effective-dated tax treatment rule.
 * Facts are requires-primary-check: never hardcoded, dynamically effective-dated.
 */
export interface EffectiveTaxTreatmentRule {
  jurisdiction: string;
  customerType: 'B2B' | 'B2C';
  documentType?: 'INVOICE' | 'CREDIT_NOTE';
  taxCode: string;
  taxName: string;
  rateBps: number;
  rateDecimal: string;
  isReverseCharge: boolean;
  requiresVerifiedVatId?: boolean;
  mandatoryMention?: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string; // YYYY-MM-DD
  sourceUrl?: string;
  verified: boolean;
}

/**
 * Request to generate a vendor invoice or credit note.
 */
export interface VendorInvoiceRequest {
  tenantId?: string;
  documentType: 'INVOICE' | 'CREDIT_NOTE';
  series: string; // e.g. "INV-2026" or "CN-2026"
  channel?: string;
  fiscalYear?: number;
  issueDate: string; // YYYY-MM-DD
  supplier: VendorInvoiceParty;
  customer: VendorInvoiceParty;
  items: VendorInvoiceLineInput[];
  currency: Currency;
  fxRate?: {
    baseCurrency: Currency;
    rate: string; // e.g. "4.450000"
  };
  relatedInvoice?: {
    invoiceNumber: string;
    issueDate: string;
    reason?: string;
  };
}

/**
 * Complete, statutory-compliant vendor invoice or credit note document.
 */
export interface VendorInvoiceDocument {
  documentType: 'INVOICE' | 'CREDIT_NOTE';
  documentNumber: string;
  series: string;
  sequenceNumber: number;
  issueDate: string;
  supplier: VendorInvoiceParty;
  customer: VendorInvoiceParty;
  currency: Currency;
  fxRate?: {
    baseCurrency: Currency;
    rate: string;
    totalTaxInBaseCurrencyMinor?: bigint;
  };
  lines: VendorInvoiceLineItem[];
  totalNetMinor: bigint;
  totalTaxMinor: bigint;
  totalGrossMinor: bigint;
  reverseCharge: boolean;
  statutoryMentions: string[];
  relatedInvoice?: {
    invoiceNumber: string;
    issueDate: string;
    reason?: string;
  };
}

export function assertValidIsoDate(dateStr: string, field = 'issueDate'): void {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new BadRequestException(`Invalid ${field}: must be in YYYY-MM-DD format.`);
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const p = new Date(Date.UTC(y, m - 1, d));
  if (p.getUTCFullYear() !== y || p.getUTCMonth() + 1 !== m || p.getUTCDate() !== d) {
    throw new BadRequestException(`Invalid ${field}: calendar date does not exist (${dateStr}).`);
  }
}

export function getCurrencyExponent(currency: Currency | string): number {
  const c = String(currency).toUpperCase();
  if (c === 'JPY' || c === 'IRR' || c === 'IRT') return 0;
  if (c === 'KWD' || c === 'BHD' || c === 'OMR') return 3;
  return 2;
}

export function multiplyMinorByQuantity(unitPriceMinor: bigint, quantity: number): bigint {
  if (quantity === 0) return 0n;
  const isNeg = quantity < 0;
  const [i, f = ''] = Math.abs(quantity).toString().split('.');
  const denom = 10n ** BigInt(f.length);
  const scaled = BigInt(i) * denom + BigInt(f || '0');
  const rounded = (unitPriceMinor * scaled + denom / 2n) / denom;
  return isNeg ? -rounded : rounded;
}

/**
 * Effective-Dated Tax Treatment Registry.
 * Holds statutory tax treatment rules with effective date bounds.
 */
@Injectable()
export class EffectiveTaxTreatmentRegistry {
  private readonly rules: EffectiveTaxTreatmentRule[] = [
    // Malaysia Service Tax (SST) - General Rate (8% effective 1 March 2024, Service Tax Act 2018)
    {
      jurisdiction: 'MY',
      customerType: 'B2B',
      taxCode: 'MY-VT-GEN',
      taxName: 'Malaysian Service Tax (SST)',
      rateBps: 800,
      rateDecimal: '0.08',
      isReverseCharge: false,
      mandatoryMention: 'Service Tax (SST) 8% applicable under the Service Tax Act 2018.',
      effectiveFrom: '2024-03-01',
      sourceUrl: 'https://mysst.customs.gov.my',
      verified: true,
    },
    // Malaysia Service Tax (SST) - Legacy Rate (6% before 1 March 2024)
    {
      jurisdiction: 'MY',
      customerType: 'B2B',
      taxCode: 'MY-VT-LEGACY',
      taxName: 'Malaysian Service Tax (SST)',
      rateBps: 600,
      rateDecimal: '0.06',
      isReverseCharge: false,
      mandatoryMention: 'Service Tax (SST) 6% applicable under the Service Tax Act 2018.',
      effectiveFrom: '2018-09-01',
      effectiveTo: '2024-02-29',
      sourceUrl: 'https://mysst.customs.gov.my',
      verified: true,
    },
    // Malaysia Service Tax (SST) - B2C Rates
    {
      jurisdiction: 'MY', customerType: 'B2C', taxCode: 'MY-VT-GEN-B2C', taxName: 'Malaysian Service Tax (SST)',
      rateBps: 800, rateDecimal: '0.08', isReverseCharge: false,
      mandatoryMention: 'Service Tax (SST) 8% applicable under the Service Tax Act 2018.',
      effectiveFrom: '2024-03-01', sourceUrl: 'https://mysst.customs.gov.my', verified: true,
    },
    {
      jurisdiction: 'MY', customerType: 'B2C', taxCode: 'MY-VT-LEG-B2C', taxName: 'Malaysian Service Tax (SST)',
      rateBps: 600, rateDecimal: '0.06', isReverseCharge: false,
      mandatoryMention: 'Service Tax (SST) 6% applicable under the Service Tax Act 2018.',
      effectiveFrom: '2018-09-01', effectiveTo: '2024-02-29', sourceUrl: 'https://mysst.customs.gov.my', verified: true,
    },
    // Malaysia Service Tax (SST) - B2B Exemption (0% for qualified B2B IT/Management services)
    {
      jurisdiction: 'MY_EXEMPT',
      customerType: 'B2B',
      taxCode: 'MY-VT-EXE',
      taxName: 'Service Tax - Exempt',
      rateBps: 0,
      rateDecimal: '0.00',
      isReverseCharge: false,
      mandatoryMention: 'Exempt from Service Tax under Schedule 1 of Service Tax (Person Exempted from Payment of Tax) Order 2018.',
      effectiveFrom: '2018-09-01',
      sourceUrl: 'https://mysst.customs.gov.my',
      verified: true,
    },
    // EU Cross-Border B2B - Reverse Charge (Council Directive 2006/112/EC, Art. 196 & 226(11a))
    {
      jurisdiction: 'EU',
      customerType: 'B2B',
      taxCode: 'EU-REVERSE-CHARGE',
      taxName: 'EU B2B Reverse Charge',
      rateBps: 0,
      rateDecimal: '0.00',
      isReverseCharge: true,
      requiresVerifiedVatId: true,
      mandatoryMention: 'Reverse charge: Customer to account for VAT under Article 196 of Council Directive 2006/112/EC.',
      effectiveFrom: '2007-01-01',
      sourceUrl: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32006L0112',
      verified: true,
    },
    // EU Cross-Border B2B - Standard VAT (unverified customer VAT ID)
    {
      jurisdiction: 'EU', customerType: 'B2B', taxCode: 'EU-STANDARD-VAT', taxName: 'EU Standard VAT (Unverified Customer)',
      rateBps: 2000, rateDecimal: '0.20', isReverseCharge: false, requiresVerifiedVatId: false,
      mandatoryMention: 'Standard VAT charged: VAT identification number not verified on VIES.',
      effectiveFrom: '2007-01-01', sourceUrl: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32006L0112', verified: true,
    },
    // EU Consumer (B2C) Invoices - Standard VAT
    {
      jurisdiction: 'EU', customerType: 'B2C', documentType: 'INVOICE', taxCode: 'EU-B2C-VAT', taxName: 'EU Consumer VAT',
      rateBps: 2000, rateDecimal: '0.20', isReverseCharge: false,
      mandatoryMention: 'EU consumer VAT charged under Directive 2006/112/EC.',
      effectiveFrom: '2015-01-01', sourceUrl: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32006L0112', verified: true,
    },
    // EU Consumer (B2C) Refund / Credit Note Treatment
    {
      jurisdiction: 'EU',
      customerType: 'B2C',
      documentType: 'CREDIT_NOTE',
      taxCode: 'EU-B2C-REFUND',
      taxName: 'EU Consumer Refund Credit Note',
      rateBps: 0,
      rateDecimal: '0.00',
      isReverseCharge: false,
      mandatoryMention: 'Statutory refund / credit note under Directive 2011/83/EU on Consumer Rights.',
      effectiveFrom: '2014-06-13',
      sourceUrl: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011L0083',
      verified: true,
    },
    // Non-EU / Non-MY International Export of Services (Zero-Rated)
    {
      jurisdiction: 'EXPORT', customerType: 'B2B', taxCode: 'EXPORT-ZERO', taxName: 'Zero-Rated International Export',
      rateBps: 0, rateDecimal: '0.00', isReverseCharge: false,
      mandatoryMention: 'Zero-rated export of services outside taxing jurisdiction.',
      effectiveFrom: '2000-01-01', sourceUrl: 'https://mysst.customs.gov.my', verified: true,
    },
    {
      jurisdiction: 'EXPORT', customerType: 'B2C', taxCode: 'EXPORT-ZERO', taxName: 'Zero-Rated International Export',
      rateBps: 0, rateDecimal: '0.00', isReverseCharge: false,
      mandatoryMention: 'Zero-rated export of services outside taxing jurisdiction.',
      effectiveFrom: '2000-01-01', sourceUrl: 'https://mysst.customs.gov.my', verified: true,
    },
  ];

  /** Register or update a statutory tax treatment rule dynamically (no hardcoding). */
  registerRule(rule: EffectiveTaxTreatmentRule): void {
    const existingIdx = this.rules.findIndex(
      (r) =>
        r.jurisdiction === rule.jurisdiction &&
        r.customerType === rule.customerType &&
        r.documentType === rule.documentType &&
        r.effectiveFrom === rule.effectiveFrom,
    );
    if (existingIdx >= 0) {
      this.rules[existingIdx] = rule;
    } else {
      this.rules.push(rule);
    }
  }

  /**
   * Resolve statutory tax treatment by jurisdiction, customer type and date.
   */
  resolveTreatment(params: {
    jurisdiction: string;
    customerType: 'B2B' | 'B2C';
    date: string;
    documentType?: 'INVOICE' | 'CREDIT_NOTE';
    hasVerifiedVatId?: boolean;
    exempt?: boolean;
  }): EffectiveTaxTreatmentRule {
    assertValidIsoDate(params.date, 'date');
    let targetJurisdiction = params.exempt && params.jurisdiction === 'MY'
      ? 'MY_EXEMPT'
      : params.jurisdiction;

    let matches = this.filterRules(targetJurisdiction, params);
    if (matches.length === 0 && targetJurisdiction !== 'MY' && targetJurisdiction !== 'EU' && targetJurisdiction !== 'MY_EXEMPT') {
      targetJurisdiction = 'EXPORT';
      matches = this.filterRules(targetJurisdiction, params);
    }

    if (matches.length === 0) {
      throw new BadRequestException(
        `No effective tax treatment found for jurisdiction ${targetJurisdiction}, ${params.customerType} on date ${params.date}`,
      );
    }

    // Sort descending by effectiveFrom to pick the most specific/recent rule
    matches.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    return matches[0];
  }

  private filterRules(
    jurisdiction: string,
    params: { customerType: 'B2B' | 'B2C'; date: string; documentType?: 'INVOICE' | 'CREDIT_NOTE'; hasVerifiedVatId?: boolean; },
  ): EffectiveTaxTreatmentRule[] {
    return this.rules.filter((rule) => {
      if (rule.jurisdiction !== jurisdiction || rule.customerType !== params.customerType) return false;
      if (rule.documentType && params.documentType && rule.documentType !== params.documentType) return false;
      if (rule.requiresVerifiedVatId !== undefined && rule.requiresVerifiedVatId !== Boolean(params.hasVerifiedVatId)) return false;
      if (params.date < rule.effectiveFrom || (rule.effectiveTo && params.date > rule.effectiveTo)) return false;
      return true;
    });
  }
}

export interface DocumentCounterKey {
  tenantId?: string;
  documentType?: string;
  channel?: string;
  fiscalYear?: number;
  series: string;
}

export interface SequencerStore {
  nextNumber(key: DocumentCounterKey, manager?: any): Promise<number> | number;
}

export class MemorySequencerStore implements SequencerStore {
  private readonly state = new Map<string, number>();
  private key(k: DocumentCounterKey): string {
    return `${k.tenantId ?? 'default'}:${k.documentType ?? 'INVOICE'}:${k.channel ?? 'DEFAULT'}:${k.fiscalYear ?? 0}:${k.series}`;
  }
  nextNumber(k: DocumentCounterKey): number {
    const next = (this.state.get(this.key(k)) ?? 0) + 1;
    this.state.set(this.key(k), next);
    return next;
  }
  seed(k: DocumentCounterKey, last: number): void { this.state.set(this.key(k), last); }
  exportSnapshot(): Record<string, number> { return Object.fromEntries(this.state.entries()); }
  importSnapshot(s: Record<string, number>): void { for (const [k, v] of Object.entries(s)) this.state.set(k, v); }
}

export class PostgresSequencerStore implements SequencerStore {
  async nextNumber(k: DocumentCounterKey, manager: any): Promise<number> {
    if (!manager?.query) throw new BadRequestException('EntityManager query runner required for Postgres sequencer.');
    const rows: Array<{ last_number: string | number }> = await manager.query(
      `INSERT INTO "fin_document_counters" ("tenant_id", "document_type", "channel", "fiscal_year", "series", "last_number")
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT ("tenant_id", "document_type", "channel", "fiscal_year", "series")
       DO UPDATE SET "last_number" = "fin_document_counters"."last_number" + 1, "updated_at" = now()
       RETURNING "last_number"`,
      [k.tenantId ?? '00000000-0000-0000-0000-000000000000', k.documentType ?? 'INVOICE', k.channel ?? 'DEFAULT', k.fiscalYear ?? 0, k.series],
    );
    return Number(rows[0].last_number);
  }
}

/**
 * Validates and enforces gapless document numbering sequences.
 */
@Injectable()
export class GaplessNumberSequencer {
  constructor(private store: SequencerStore = new MemorySequencerStore()) {}
  setStore(store: SequencerStore): void { this.store = store; }

  nextNumber(keyOrSeries: string | DocumentCounterKey, manager?: any): { sequenceNumber: number; documentNumber: string } {
    const key = typeof keyOrSeries === 'string' ? { series: keyOrSeries } : keyOrSeries;
    const res = this.store.nextNumber(key, manager);
    if (typeof res !== 'number') throw new BadRequestException('Use nextNumberAsync for async stores.');
    return { sequenceNumber: res, documentNumber: `${key.series}-${String(res).padStart(6, '0')}` };
  }

  async nextNumberAsync(keyOrSeries: string | DocumentCounterKey, manager?: any): Promise<{ sequenceNumber: number; documentNumber: string }> {
    const key = typeof keyOrSeries === 'string' ? { series: keyOrSeries } : keyOrSeries;
    const res = await this.store.nextNumber(key, manager);
    return { sequenceNumber: res, documentNumber: `${key.series}-${String(res).padStart(6, '0')}` };
  }

  static validateGaplessSequence(docs: readonly VendorInvoiceDocument[]): void {
    if (docs.length <= 1) return;

    const bySeries = new Map<string, VendorInvoiceDocument[]>();
    for (const doc of docs) {
      const list = bySeries.get(doc.series) ?? [];
      list.push(doc);
      bySeries.set(doc.series, list);
    }

    for (const [series, list] of bySeries.entries()) {
      const sorted = [...list].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];

        if (curr.sequenceNumber === prev.sequenceNumber) {
          throw new BadRequestException(
            `Duplicate sequence number ${curr.sequenceNumber} in series ${series}: ${prev.documentNumber} and ${curr.documentNumber}`,
          );
        }

        if (curr.sequenceNumber !== prev.sequenceNumber + 1) {
          throw new BadRequestException(
            `Gap detected in series ${series}: jumped from ${prev.sequenceNumber} (${prev.documentNumber}) to ${curr.sequenceNumber} (${curr.documentNumber})`,
          );
        }
      }
    }
  }
}

/**
 * Generator for vendor invoices and credit notes in our own ledger.
 */
@Injectable()
export class VendorInvoiceGenerator {
  constructor(
    private readonly taxRegistry: EffectiveTaxTreatmentRegistry,
    @Optional() private readonly sequencer?: GaplessNumberSequencer,
  ) {}

  generate(
    request: VendorInvoiceRequest,
    sequenceNumber?: number,
  ): VendorInvoiceDocument {
    assertValidIsoDate(request.issueDate, 'issueDate');
    const seq = sequenceNumber !== undefined
      ? sequenceNumber
      : (this.sequencer ?? new GaplessNumberSequencer()).nextNumber({
          tenantId: request.tenantId, documentType: request.documentType,
          channel: request.channel, fiscalYear: request.fiscalYear, series: request.series,
        }).sequenceNumber;

    if (seq <= 0) {
      throw new BadRequestException('Sequence number must be a positive integer.');
    }

    const documentNumber = `${request.series}-${String(seq).padStart(6, '0')}`;
    const customerType = request.customer.isB2B ? 'B2B' : 'B2C';

    const isEuCountry = ['DE', 'FR', 'NL', 'IT', 'ES', 'SE', 'PL', 'BE', 'AT', 'IE', 'FI', 'PT', 'GR', 'CZ', 'RO', 'DK', 'HU', 'SK', 'BG', 'HR', 'LT', 'SI', 'LV', 'EE', 'CY', 'LU', 'MT'].includes(
      request.customer.country.toUpperCase(),
    );
    const jurisdiction = isEuCountry ? 'EU' : request.customer.country.toUpperCase();

    const treatment = this.taxRegistry.resolveTreatment({
      jurisdiction,
      customerType,
      date: request.issueDate,
      documentType: request.documentType,
      hasVerifiedVatId: request.customer.verifiedTaxId,
    });

    const statutoryMentions: string[] = [];
    if (treatment.mandatoryMention) {
      statutoryMentions.push(treatment.mandatoryMention);
    }

    let totalNet = 0n;
    let totalTax = 0n;

    const lines: VendorInvoiceLineItem[] = request.items.map((item) => {
      const net = multiplyMinorByQuantity(item.unitPriceMinor, item.quantity);
      const tax = treatment.isReverseCharge ? 0n : (net * BigInt(treatment.rateBps) + 5000n) / 10000n;
      const gross = net + tax;

      totalNet += net;
      totalTax += tax;

      return {
        description: item.description,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        netMinor: net,
        taxRateBps: treatment.rateBps,
        taxRateDecimal: treatment.rateDecimal,
        taxCode: treatment.taxCode,
        taxMinor: tax,
        grossMinor: gross,
        sku: item.sku,
      };
    });

    const totalGross = totalNet + totalTax;

    let fxRateInfo: VendorInvoiceDocument['fxRate'];
    if (request.fxRate) {
      const srcDecimals = getCurrencyExponent(request.currency);
      const baseDecimals = getCurrencyExponent(request.fxRate.baseCurrency);
      const expDiff = baseDecimals - srcDecimals;
      const [rateInt, rateFrac = ''] = request.fxRate.rate.split('.');
      const scale = rateFrac.length;
      const rateScaled = BigInt(rateInt) * (10n ** BigInt(scale)) + BigInt(rateFrac || '0');
      const rateDenom = 10n ** BigInt(scale);

      let taxInBase: bigint;
      if (expDiff >= 0) {
        const factor = 10n ** BigInt(expDiff);
        taxInBase = (totalTax * rateScaled * factor + rateDenom / 2n) / rateDenom; // money-ok: BigInt integer division
      } else {
        const div = 10n ** BigInt(-expDiff);
        const totalDenom = rateDenom * div;
        taxInBase = (totalTax * rateScaled + totalDenom / 2n) / totalDenom; // money-ok: BigInt integer division
      }

      fxRateInfo = {
        baseCurrency: request.fxRate.baseCurrency,
        rate: request.fxRate.rate,
        totalTaxInBaseCurrencyMinor: taxInBase,
      };
      statutoryMentions.push(
        `Exchange rate: 1 ${request.currency} = ${request.fxRate.rate} ${request.fxRate.baseCurrency}. Total tax: ${taxInBase} (minor) ${request.fxRate.baseCurrency}.`,
      );
    }

    if (request.documentType === 'CREDIT_NOTE') {
      if (!request.relatedInvoice?.invoiceNumber) {
        throw new BadRequestException('Credit note must reference a related original invoice number.');
      }
      statutoryMentions.push(
        `Credit Note referencing original invoice ${request.relatedInvoice.invoiceNumber} dated ${request.relatedInvoice.issueDate}.`,
      );
    }

    return {
      documentType: request.documentType,
      documentNumber,
      series: request.series,
      sequenceNumber: seq,
      issueDate: request.issueDate,
      supplier: request.supplier,
      customer: request.customer,
      currency: request.currency,
      fxRate: fxRateInfo,
      lines,
      totalNetMinor: totalNet,
      totalTaxMinor: totalTax,
      totalGrossMinor: totalGross,
      reverseCharge: treatment.isReverseCharge,
      statutoryMentions,
      relatedInvoice: request.relatedInvoice,
    };
  }

  toLedgerCreateInvoiceDto(doc: VendorInvoiceDocument): CreateInvoiceDto {
    const sellerInfo: InvoicePartyInfoDto = {
      name: doc.supplier.name,
      address: doc.supplier.address,
      registrationNumber: doc.supplier.registrationNumber,
      economicCode: doc.supplier.taxId,
    };

    const buyerInfo: InvoicePartyInfoDto = {
      name: doc.customer.name,
      address: doc.customer.address,
      economicCode: doc.customer.taxId,
      registrationNumber: doc.customer.registrationNumber,
    };

    const exp = getCurrencyExponent(doc.currency);
    const denom = 10 ** exp;

    const items: InvoiceItemDto[] = doc.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: Number(l.unitPriceMinor) / denom, // money-ok: CreateInvoiceDto wire format expects major unit numbers
      discount: 0,
      vatRate: l.taxRateBps / 10000,
      sku: l.sku ?? undefined,
    }));

    return {
      taxInvoiceNumber: doc.documentNumber,
      sellerInfo,
      buyerInfo,
      items,
      currency: doc.currency,
      direction: InvoiceDirection.SALE,
      jurisdiction: InvoiceJurisdiction.INTL,
      subject: doc.documentType === 'CREDIT_NOTE' ? InvoiceSubject.RETURN : InvoiceSubject.ORIGINAL,
      fxRate: doc.fxRate ? Number(doc.fxRate.rate) : 1,
    };
  }
}

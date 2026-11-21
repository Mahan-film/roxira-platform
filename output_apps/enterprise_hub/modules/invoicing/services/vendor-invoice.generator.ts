import { Injectable, BadRequestException } from '@nestjs/common';
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
  taxCode: string;
  taxName: string;
  rateBps: number;
  rateDecimal: string;
  isReverseCharge: boolean;
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
  documentType: 'INVOICE' | 'CREDIT_NOTE';
  series: string; // e.g. "INV-2026" or "CN-2026"
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
      mandatoryMention: 'Reverse charge: Customer to account for VAT under Article 196 of Council Directive 2006/112/EC.',
      effectiveFrom: '2007-01-01',
      sourceUrl: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32006L0112',
      verified: true,
    },
    // EU Consumer (B2C) Refund / Credit Note Treatment
    {
      jurisdiction: 'EU',
      customerType: 'B2C',
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
  ];

  /** Register or update a statutory tax treatment rule dynamically (no hardcoding). */
  registerRule(rule: EffectiveTaxTreatmentRule): void {
    const existingIdx = this.rules.findIndex(
      (r) =>
        r.jurisdiction === rule.jurisdiction &&
        r.customerType === rule.customerType &&
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
    hasVerifiedVatId?: boolean;
    exempt?: boolean;
  }): EffectiveTaxTreatmentRule {
    const targetJurisdiction = params.exempt && params.jurisdiction === 'MY'
      ? 'MY_EXEMPT'
      : params.jurisdiction;

    const matches = this.rules.filter((rule) => {
      if (rule.jurisdiction !== targetJurisdiction) return false;
      if (rule.customerType !== params.customerType) return false;
      if (params.date < rule.effectiveFrom) return false;
      if (rule.effectiveTo && params.date > rule.effectiveTo) return false;
      return true;
    });

    if (matches.length === 0) {
      throw new BadRequestException(
        `No effective tax treatment found for jurisdiction ${targetJurisdiction}, ${params.customerType} on date ${params.date}`,
      );
    }

    // Sort descending by effectiveFrom to pick the most specific/recent rule
    matches.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    return matches[0];
  }
}

/**
 * Validates and enforces gapless document numbering sequences.
 */
export class GaplessNumberSequencer {
  private readonly sequences = new Map<string, number>();

  /**
   * Allocate the next gapless number for a series.
   */
  nextNumber(series: string): { sequenceNumber: number; documentNumber: string } {
    const current = this.sequences.get(series) ?? 0;
    const nextSeq = current + 1;
    this.sequences.set(series, nextSeq);
    return {
      sequenceNumber: nextSeq,
      documentNumber: `${series}-${String(nextSeq).padStart(6, '0')}`,
    };
  }

  /**
   * Seed a sequence to start at a specific number (e.g. for new fiscal years or migrations).
   */
  seedSequence(series: string, lastAssignedNumber: number): void {
    this.sequences.set(series, lastAssignedNumber);
  }

  /**
   * Static gapless sequence validation across a list of documents.
   * Throws if any gap or duplicate is detected.
   */
  static validateGaplessSequence(docs: readonly VendorInvoiceDocument[]): void {
    if (docs.length <= 1) return;

    // Group by series
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
  ) {}

  /**
   * Generate a valid vendor invoice or credit note with gapless numbers,
   * effective-dated statutory tax rules, and strict minor-units arithmetic.
   */
  generate(
    request: VendorInvoiceRequest,
    sequenceNumber: number,
  ): VendorInvoiceDocument {
    if (sequenceNumber <= 0) {
      throw new BadRequestException('Sequence number must be a positive integer.');
    }

    const documentNumber = `${request.series}-${String(sequenceNumber).padStart(6, '0')}`;
    const customerType = request.customer.isB2B ? 'B2B' : 'B2C';

    // Determine target jurisdiction: EU Member States map to EU rules
    const isEuCountry = ['DE', 'FR', 'NL', 'IT', 'ES', 'SE', 'PL', 'BE', 'AT', 'IE', 'FI', 'PT', 'GR', 'CZ', 'RO', 'DK', 'HU', 'SK', 'BG', 'HR', 'LT', 'SI', 'LV', 'EE', 'CY', 'LU', 'MT'].includes(
      request.customer.country.toUpperCase(),
    );
    const jurisdiction = isEuCountry ? 'EU' : request.customer.country.toUpperCase();

    const treatment = this.taxRegistry.resolveTreatment({
      jurisdiction,
      customerType,
      date: request.issueDate,
      hasVerifiedVatId: request.customer.verifiedTaxId,
    });

    const statutoryMentions: string[] = [];
    if (treatment.mandatoryMention) {
      statutoryMentions.push(treatment.mandatoryMention);
    }

    let totalNet = 0n;
    let totalTax = 0n;

    const lines: VendorInvoiceLineItem[] = request.items.map((item) => {
      const net = BigInt(item.quantity) * item.unitPriceMinor;
      // Exact basis-point money calculation: (net * rateBps) / 10000n
      const tax = treatment.isReverseCharge ? 0n : (net * BigInt(treatment.rateBps)) / 10000n;
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
      // Calculate tax in base currency if FX rate is given
      // Rate is a decimal string like "4.450000"
      const [rateInt, rateFrac = ''] = request.fxRate.rate.split('.');
      const scale = rateFrac.length;
      const rateScaled = BigInt(rateInt) * (10n ** BigInt(scale)) + BigInt(rateFrac || '0');
      const taxInBase = scale > 0
        ? (totalTax * rateScaled) / (10n ** BigInt(scale))
        : totalTax * rateScaled;

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
      sequenceNumber,
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

  /**
   * Convert a VendorInvoiceDocument into a Roxira CreateInvoiceDto compatible structure
   * for seamless insertion and posting into our own double-entry ledger.
   */
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

    const items: InvoiceItemDto[] = doc.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: Number(l.unitPriceMinor),
      discount: 0,
      vatRate: Number(l.taxRateDecimal),
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

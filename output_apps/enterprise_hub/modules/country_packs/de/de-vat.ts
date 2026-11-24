import deVatData from './data/de-vat-data.v1.json';

export interface DeVatRateInfo {
  readonly code: string;
  readonly rate: string;
  readonly percent: number;
  readonly label: string;
  readonly legalBasis: string;
  readonly effectiveFrom: string;
  readonly sourceUrl: string;
  readonly verified: boolean;
}

export interface DeReverseChargeCodeInfo {
  readonly code: string;
  readonly label: string;
  readonly legalBasis: string;
  readonly verified: boolean;
  readonly sourceUrl: string;
  readonly description: string;
}

export interface KleinunternehmerStatusResult {
  readonly status: 'EXEMPT' | 'WARNING' | 'STOP_EXCEEDED';
  readonly canIssueExemptInvoice: boolean;
  readonly warnings: readonly string[];
  readonly priorYearTurnoverCents: bigint;
  readonly currentYearTurnoverCents: bigint;
  readonly priorYearCeilingCents: bigint;
  readonly currentYearCeilingCents: bigint;
  readonly warningCeilingCents: bigint;
}

export interface Section34aInvoiceInput {
  readonly taxNumber?: string | null;
  readonly vatId?: string | null;
  readonly smallBusinessId?: string | null;
  readonly exemptNoticeText?: string | null;
  readonly isSelfBilling?: boolean;
  readonly selfBillingText?: string | null;
}

export interface Section34aValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly missingIdentifiers: boolean;
  readonly missingExemptNotice: boolean;
  readonly missingSelfBillingNotice: boolean;
}

export type ReturnFrequency = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL_EXEMPT';

export interface ReturnFrequencyResult {
  readonly frequency: ReturnFrequency;
  readonly priorYearVatPayableCents: bigint;
  readonly monthlyThresholdCents: bigint;
  readonly annualExemptionThresholdCents: bigint;
  readonly permanentExtensionRequiresPrepayment: boolean;
  readonly specialPrepaymentDeadline: string;
  readonly calculateSpecialPrepayment: (totalPriorYearVatLiabilityCents: bigint) => bigint;
}

export interface ViesValidationResult {
  readonly valid: boolean;
  readonly memberState: string;
  readonly normalizedVatNumber: string;
  readonly error?: string;
}

export const DE_VAT_RATES: readonly DeVatRateInfo[] = deVatData.vatRates;
export const DE_REVERSE_CHARGE_CODES: readonly DeReverseChargeCodeInfo[] = deVatData.reverseChargeCodes;

export const DE_KLEINUNTERNEHMER_CONFIG = {
  priorYearTurnoverCeilingCents: BigInt(deVatData.kleinunternehmer.priorYearTurnoverCeilingCents),
  currentYearTurnoverCeilingCents: BigInt(deVatData.kleinunternehmer.currentYearTurnoverCeilingCents),
  warningThresholdPercent: BigInt(deVatData.kleinunternehmer.warningThresholdPercent),
  legalBasis: deVatData.kleinunternehmer.legalBasis,
  noticeText: deVatData.invoiceRequirements.section19Notice,
  selfBillingNotice: deVatData.invoiceRequirements.selfBillingNotice,
};

export const DE_RETURN_FREQUENCY_CONFIG = {
  monthlyThresholdVatCents: BigInt(deVatData.returnFrequency.monthlyThresholdVatCents),
  annualExemptionThresholdVatCents: BigInt(deVatData.returnFrequency.annualExemptionThresholdVatCents),
  permanentExtensionDeadline: deVatData.returnFrequency.permanentExtensionDeadline,
  specialPrepaymentNumerator: BigInt(deVatData.returnFrequency.specialPrepaymentNumerator),
  specialPrepaymentDenominator: BigInt(deVatData.returnFrequency.specialPrepaymentDenominator),
};

// Recognized EU member state ISO codes (excluding domestic DE)
export const EU_MEMBER_STATES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE',
  'SI', 'SK',
]);

// Structural regex pattern for EU VAT numbers per member state
const EU_VAT_PATTERNS: Readonly<Record<string, RegExp>> = {
  AT: /^ATU\d{8}$/,
  BE: /^BE0?\d{9,10}$/,
  BG: /^BG\d{9,10}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[A-Z0-9]{2}\d{9}$/,
  GR: /^GR\d{9}$/,
  HR: /^HR\d{11}$/,
  HU: /^HU\d{8}$/,
  IE: /^IE\d{7}[A-W][A-I]?$|^IE\d[A-Z\d]\d{5}[A-W]$/,
  IT: /^IT\d{11}$/,
  LT: /^LT(\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/,
  SI: /^SI\d{8}$/,
  SK: /^SK\d{10}$/,
};

/**
 * § 19 UStG Kleinunternehmer evaluation.
 * Evaluates whether small business exemption applies, triggers a warning at 90%
 * of current or prior year ceiling, and enforces immediate cessation of exempt invoices
 * when current year turnover crosses EUR 100,000 mid-year.
 */
export function evaluateKleinunternehmerStatus(
  priorYearTurnoverCents: bigint,
  currentYearTurnoverCents: bigint,
): KleinunternehmerStatusResult {
  const priorCeiling = DE_KLEINUNTERNEHMER_CONFIG.priorYearTurnoverCeilingCents;
  const currentCeiling = DE_KLEINUNTERNEHMER_CONFIG.currentYearTurnoverCeilingCents;
  const warningCeiling = (currentCeiling * DE_KLEINUNTERNEHMER_CONFIG.warningThresholdPercent) / 100n;
  const priorWarningCeiling = (priorCeiling * DE_KLEINUNTERNEHMER_CONFIG.warningThresholdPercent) / 100n;

  const warnings: string[] = [];

  // Stop condition: current year crossed 100k or prior year exceeded 25k
  if (currentYearTurnoverCents > currentCeiling) {
    warnings.push(
      `Current year turnover (${currentYearTurnoverCents} cents) exceeds statutory Kleinunternehmer ceiling (${currentCeiling} cents / EUR 100,000). Small business exemption terminated immediately (§ 19 Abs. 1 UStG). Subsequent invoices must charge standard VAT.`,
    );
    return {
      status: 'STOP_EXCEEDED',
      canIssueExemptInvoice: false,
      warnings,
      priorYearTurnoverCents,
      currentYearTurnoverCents,
      priorYearCeilingCents: priorCeiling,
      currentYearCeilingCents: currentCeiling,
      warningCeilingCents: warningCeiling,
    };
  }

  if (priorYearTurnoverCents > priorCeiling) {
    warnings.push(
      `Prior year turnover (${priorYearTurnoverCents} cents) exceeded statutory ceiling (${priorCeiling} cents / EUR 25,000). Kleinunternehmer exemption does not apply for current fiscal year (§ 19 Abs. 1 UStG).`,
    );
    return {
      status: 'STOP_EXCEEDED',
      canIssueExemptInvoice: false,
      warnings,
      priorYearTurnoverCents,
      currentYearTurnoverCents,
      priorYearCeilingCents: priorCeiling,
      currentYearCeilingCents: currentCeiling,
      warningCeilingCents: warningCeiling,
    };
  }

  // Warning condition: 90% threshold reached
  if (currentYearTurnoverCents >= warningCeiling) {
    warnings.push(
      `Current year turnover (${currentYearTurnoverCents} cents) has reached 90% of statutory ceiling (${warningCeiling} cents / EUR 90,000). Monitor revenue closely: crossing EUR 100,000 requires immediate transition to standard VAT (§ 19 UStG).`,
    );
    return {
      status: 'WARNING',
      canIssueExemptInvoice: true,
      warnings,
      priorYearTurnoverCents,
      currentYearTurnoverCents,
      priorYearCeilingCents: priorCeiling,
      currentYearCeilingCents: currentCeiling,
      warningCeilingCents: warningCeiling,
    };
  }

  if (priorYearTurnoverCents >= priorWarningCeiling) {
    warnings.push(
      `Prior year turnover (${priorYearTurnoverCents} cents) reached 90% of ceiling (${priorWarningCeiling} cents / EUR 22,500).`,
    );
    return {
      status: 'WARNING',
      canIssueExemptInvoice: true,
      warnings,
      priorYearTurnoverCents,
      currentYearTurnoverCents,
      priorYearCeilingCents: priorCeiling,
      currentYearCeilingCents: currentCeiling,
      warningCeilingCents: warningCeiling,
    };
  }

  return {
    status: 'EXEMPT',
    canIssueExemptInvoice: true,
    warnings: [],
    priorYearTurnoverCents,
    currentYearTurnoverCents,
    priorYearCeilingCents: priorCeiling,
    currentYearCeilingCents: currentCeiling,
    warningCeilingCents: warningCeiling,
  };
}

/**
 * Validates invoice requirements under § 34a UStDV and § 14 Abs. 4 UStG for small-business invoices:
 * 1. Must carry Steuernummer, USt-IdNr., or Wirtschafts-ID (W-IdNr. / smallBusinessId).
 * 2. Must contain reference to § 19 UStG exemption.
 * 3. In self-billing (Gutschrift), must explicitly state "Gutschrift".
 */
export function validateSection34aInvoice(invoice: Section34aInvoiceInput): Section34aValidationResult {
  const errors: string[] = [];

  const hasIdentifier = Boolean(
    invoice.taxNumber?.trim() || invoice.vatId?.trim() || invoice.smallBusinessId?.trim(),
  );

  if (!hasIdentifier) {
    errors.push('Invoice must carry at least one tax identifier (Steuernummer, USt-IdNr. or Wirtschafts-Identifikationsnummer) pursuant to § 34a UStDV / § 14 Abs. 4 Satz 1 Nr. 2 UStG.');
  }

  const notice = invoice.exemptNoticeText?.trim() || '';
  const hasExemptNotice = notice.includes('§ 19') || notice.toLowerCase().includes('kleinunternehmer');

  if (!hasExemptNotice) {
    errors.push('Small-business invoice must state statutory exemption note pursuant to § 19 UStG (e.g. "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.").');
  }

  let missingSelfBilling = false;
  if (invoice.isSelfBilling) {
    const sbNotice = invoice.selfBillingText?.trim() || '';
    if (!sbNotice.toLowerCase().includes('gutschrift')) {
      missingSelfBilling = true;
      errors.push('Self-billing invoice issued by recipient must explicitly carry the designation "Gutschrift" (§ 14 Abs. 4 Satz 1 Nr. 10 UStG, § 34a UStDV).');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingIdentifiers: !hasIdentifier,
    missingExemptNotice: !hasExemptNotice,
    missingSelfBillingNotice: missingSelfBilling,
  };
}

/**
 * § 18 UStG return frequency determination:
 * - Prior-year VAT > EUR 9,000 -> Monthly (monatlich)
 * - Prior-year VAT EUR 2,000 - EUR 9,000 -> Quarterly (vierteljährlich)
 * - Prior-year VAT <= EUR 2,000 -> Eligible for annual return exemption (Befreiung von Voranmeldungen)
 *
 * For monthly filers, permanent extension (Dauerfristverlängerung) requires a 1/11th special prepayment
 * (Sondervorauszahlung) calculated from the prior year's total VAT liability (§§ 46-48 UStDV).
 */
export function determineReturnFrequency(priorYearVatPayableCents: bigint): ReturnFrequencyResult {
  const monthlyThreshold = DE_RETURN_FREQUENCY_CONFIG.monthlyThresholdVatCents;
  const annualThreshold = DE_RETURN_FREQUENCY_CONFIG.annualExemptionThresholdVatCents;

  let frequency: ReturnFrequency = 'QUARTERLY';
  let requiresPrepayment = false;

  if (priorYearVatPayableCents > monthlyThreshold) {
    frequency = 'MONTHLY';
    requiresPrepayment = true;
  } else if (priorYearVatPayableCents <= annualThreshold) {
    frequency = 'ANNUAL_EXEMPT';
    requiresPrepayment = false;
  } else {
    frequency = 'QUARTERLY';
    requiresPrepayment = false;
  }

  const calculateSpecialPrepayment = (totalPriorYearVatLiabilityCents: bigint): bigint => {
    if (!requiresPrepayment || totalPriorYearVatLiabilityCents <= 0n) {
      return 0n;
    }
    // Exactly 1/11th of total prior-year VAT liability using pure BigInt integer math
    return (
      (totalPriorYearVatLiabilityCents * DE_RETURN_FREQUENCY_CONFIG.specialPrepaymentNumerator) /
      DE_RETURN_FREQUENCY_CONFIG.specialPrepaymentDenominator
    );
  };

  return {
    frequency,
    priorYearVatPayableCents,
    monthlyThresholdCents: monthlyThreshold,
    annualExemptionThresholdCents: annualThreshold,
    permanentExtensionRequiresPrepayment: requiresPrepayment,
    specialPrepaymentDeadline: DE_RETURN_FREQUENCY_CONFIG.permanentExtensionDeadline,
    calculateSpecialPrepayment,
  };
}

/**
 * Validates an EU VAT ID structurally against EU member state formats (excluding domestic DE).
 */
export function validateViesEuVatNumber(vatNumber: string, expectedCountryCode?: string): ViesValidationResult {
  const clean = vatNumber.replace(/[\s.-]/g, '').toUpperCase();
  if (clean.length < 4) {
    return { valid: false, memberState: '', normalizedVatNumber: clean, error: 'VAT number is too short' };
  }

  const country = clean.substring(0, 2);

  if (expectedCountryCode && expectedCountryCode.toUpperCase() !== country) {
    return {
      valid: false,
      memberState: country,
      normalizedVatNumber: clean,
      error: `VAT number country prefix (${country}) does not match expected customer country (${expectedCountryCode})`,
    };
  }

  if (country === 'DE') {
    return {
      valid: false,
      memberState: 'DE',
      normalizedVatNumber: clean,
      error: 'German domestic VAT number cannot be used for zero-rated intra-Community supply (§ 6a UStG)',
    };
  }

  if (!EU_MEMBER_STATES.has(country)) {
    return {
      valid: false,
      memberState: country,
      normalizedVatNumber: clean,
      error: `Country code ${country} is not a valid EU member state for intra-Community zero rating`,
    };
  }

  const pattern = EU_VAT_PATTERNS[country];
  if (!pattern || !pattern.test(clean)) {
    return {
      valid: false,
      memberState: country,
      normalizedVatNumber: clean,
      error: `VAT number ${clean} does not conform to member state ${country} official structure`,
    };
  }

  return {
    valid: true,
    memberState: country,
    normalizedVatNumber: clean,
  };
}

/**
 * Pre-flight guard for zero-rated intra-community EU supplies (§ 4 Nr. 1b i.V.m. § 6a UStG).
 * Throws or returns an error before generating or posting a zero-rated EU invoice if customer VAT ID
 * is missing, invalid or domestic.
 */
export function assertZeroRatedEuInvoiceAllowed(
  customerVatId: string | null | undefined,
  customerCountryCode: string,
): { allowed: boolean; normalizedVatId: string; error?: string } {
  if (!customerCountryCode) {
    return { allowed: false, normalizedVatId: '', error: 'Customer country code is missing' };
  }

  const country = customerCountryCode.toUpperCase();

  if (country === 'DE') {
    return {
      allowed: false,
      normalizedVatId: customerVatId || '',
      error: 'Intra-community zero rating is strictly disallowed for domestic German supplies (§ 1 Abs. 1 UStG). Standard or reduced VAT applies.',
    };
  }

  if (!EU_MEMBER_STATES.has(country)) {
    // Non-EU countries are third-country exports (§ 4 Nr. 1a UStG), handled under export customs proof, not intra-community VIES
    return {
      allowed: false,
      normalizedVatId: customerVatId || '',
      error: `Country ${country} is outside the EU; intra-community supply (§ 4 Nr. 1b UStG) does not apply (third-country export requires customs proof).`,
    };
  }

  if (!customerVatId || !customerVatId.trim()) {
    return {
      allowed: false,
      normalizedVatId: '',
      error: `Zero-rated intra-community supply to EU customer in ${country} requires a valid EU VAT ID (VIES check, § 6a Abs. 1 Nr. 4 UStG).`,
    };
  }

  const viesCheck = validateViesEuVatNumber(customerVatId, country);
  if (!viesCheck.valid) {
    return {
      allowed: false,
      normalizedVatId: customerVatId,
      error: `VIES validation failed for EU customer VAT ID "${customerVatId}": ${viesCheck.error}`,
    };
  }

  return {
    allowed: true,
    normalizedVatId: viesCheck.normalizedVatNumber,
  };
}

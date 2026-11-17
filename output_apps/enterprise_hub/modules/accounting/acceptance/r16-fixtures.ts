/**
 * Typed fixtures and expected values for the R16 core acceptance tests (T177).
 * Source of truth: docs/strategy/research/R16_ACCEPTANCE_TESTS.md. All amounts are bigint minor
 * units (2 decimals) unless a name says otherwise. Scenarios the core cannot run yet keep their
 * data here and are `it.skip`ped in the specs with the row that fixes them.
 */

/** Minor units of a plain decimal such as "1182.50". */
export const m = (decimal: string): bigint => {
  const negative = decimal.startsWith('-');
  const [integer, fraction = ''] = decimal.replace('-', '').replace(/,/g, '').split('.');
  const minor = BigInt(integer + fraction.padEnd(2, '0'));
  return negative ? -minor : minor;
};

export const R16_T1_CONSOLIDATION = {
  parentOwnershipPercent: 80,
  subsidiaryExternalSales: m('120000.00'),
  subsidiaryExternalExpenses: m('60000.00'),
  intercompanyFee: m('10000.00'),
  parentStandaloneExternalProfit: m('90000.00'),
  investmentInSubsidiary: m('40000.00'),
  subsidiaryEquityAtAcquisition: m('50000.00'),
  expected: {
    nciEquityAtAcquisition: m('10000.00'),
    consolidatedNetIncomeBeforeNci: m('150000.00'),
    nci: m('10000.00'),
    controllingNetIncome: m('140000.00'),
  },
} as const;

/** Rates are scaled integers with 6 decimals. */
export const R16_T2_FX = {
  gbpInvoice: { amountGbp: m('1000.00'), gbpToEur: 1_182_500n, eurToUsd: 1_085_000n },
  threeLineInvoice: { lineGbp: m('10.00'), lines: 3, gbpToEur: 1_182_550n },
  closing: { gbpToEur: 1_201_255n },
  settlement: { usd: m('1300.00'), usdToEur: 915_000n, contractualGbpToUsd: 1_300_000n },
  expected: {
    inv101Eur: m('1182.50'),
    inv101Usd: m('1283.01'),
    lineEur: m('11.83'),
    headerEur: m('35.48'),
    roundingResidualEur: m('0.01'),
    unrealisedGainEur: m('18.76'),
    settlementBankEur: m('1189.50'),
    realisedGainEur: m('7.00'),
    reportingSettlementDiffUsd: m('16.99'),
  },
} as const;

export const R16_T3_PERIODS = {
  draftBill: { id: 'DRAFT-9', date: '2026-10-20' },
  lockedMonth: { start: '2026-10-01', end: '2026-10-31' },
  postingDateInLockedMonth: '2026-10-15',
  expected: { clerkStatus: 422, clerkCode: 'PERIOD_LOCKED' },
} as const;

export const R16_T4_AUDIT = {
  journal: { number: 42, rent: m('2500.00'), accountsPayable: m('2500.00') },
  reversalNumber: 43,
  expected: { chain: 'VALID', gaps: 0, verified: '43/43' },
} as const;

export const R16_T5_DIMENSIONS = {
  bill: { id: 'BILL-55', total: m('1000.00'), splits: { 'CC-RND': m('600.00'), 'CC-SALES': m('400.00') } },
  rename: { from: 'CC-SALES', to: 'CC-EMEA-SALES', effective: '2026-11-01' },
  expected: { errorCode: 'DIMENSION_RULE_VIOLATION', salesAt20261031: m('400.00') },
} as const;

export const R16_T6_BUDGET = {
  account: '6400',
  costCentre: 'CC-MKT',
  october: m('5000.00'),
  warnAtPercent: 80,
  blockAtPercent: 100,
  po88: m('4200.00'),
  po89: m('1000.00'),
  revisedBudget: m('5500.00'),
  expected: { po88WarningPercent: 84, po88Remaining: m('800.00'), po89Percent: 104, remainingAfterRevision: m('300.00') },
} as const;

export const R16_T7_ASSET = {
  costEur: m('24000.00'),
  book1: { method: 'STRAIGHT_LINE' as const, lifeMonths: 48, monthly: m('500.00') },
  book2: { method: 'DECLINING_BALANCE' as const, annualRate: '0.30', monthlyYear1: m('600.00') },
  saleNetEur: m('22000.00'),
  saleVatEur: m('4180.00'),
  expected: {
    q1: { book1Accumulated: m('1500.00'), book1Nbv: m('22500.00'), book2Accumulated: m('1800.00'), book2Nbv: m('22200.00') },
    sale: { book1Gain: m('1000.00'), book2Gain: m('1600.00') },
  },
} as const;

export const R16_T8_INVENTORY = {
  receipts: [
    { day: 1, qty: 10, unitCost: 10 },
    { day: 2, qty: 10, unitCost: 12 },
  ],
  deliveredQty: 12,
  expected: {
    fifo: { cogs: m('124.00'), ending: m('96.00') },
    avco: { cogs: m('132.00'), ending: m('88.00') },
    standard: { standardCost: 11, ppvDay1: m('10.00'), ppvDay2: m('-10.00'), cogs: m('132.00'), ending: m('88.00') },
  },
} as const;

export const R16_T9_BANK = {
  openInvoices: { 'INV-101': m('1190.00'), 'INV-102': m('600.00'), 'INV-103': m('400.00') },
  statement: [
    { id: 'TX-1', amount: m('1190.00'), reference: 'INV-101' },
    { id: 'TX-2', amount: m('970.00'), reference: 'PAYOUT INV-102 INV-103', fee: m('30.00') },
  ],
} as const;

export const R16_T10_TAX = {
  rates: { standardUntil20260630: 19, standardFrom20260701: 20 },
  creditNote: { date: '2026-07-10', originalInvoiceDate: '2026-06-20', net: m('1000.00'), expectedVat: m('190.00') },
  reverseCharge: { net: m('1000.00'), vat: m('190.00') },
  nonResident: {
    net: m('1000.00'),
    selfAssessedVat: m('150.00'),
    withholding: m('50.00'),
    bankPaid: m('950.00'),
    certificate: 'WHT-2026-0001',
  },
} as const;

export const R16_T11_EINVOICE = {
  ksa: { icv: 103, b2b: { id: 'KSA-B2B-104', net: m('1000.00'), vat: m('150.00') }, b2c: { id: 'KSA-B2C-105', total: m('115.00') } },
  uae: { id: 'UAE-FTZ-201', net: m('1000.00'), vat: m('50.00') },
  expected: { resubmissionIcv: 105, rejectedStatus: 'CLEARANCE_REJECTED' },
} as const;

export const R16_T12_ACCOUNTANT = { tenants: 3, tag: 'PARTNER_ADJUSTMENT', ibanEditStatus: 403, revokeWithinSeconds: 60 } as const;

export const R16_T13_API = {
  idempotencyKey: 'k-999',
  amount: m('500.00'),
  conflictingAmount: m('600.00'),
  expected: { replayStatus: 201, conflictStatus: 409, conflictCode: 'IDEMPOTENCY_CONFLICT', burstStatus: 429, webhookAttempts: 3 },
} as const;

export const R16_T14_EXPORT = { lines: 50_000, quarter: '2026-Q1', firstAuditNumber: 1, lastAuditNumber: 50_000 } as const;

export const R16_T15_AI = {
  purchaseOrder: { id: 'PO-200', total: m('2400.00') },
  deferralMonths: 12,
  unusualJournal: { amount: m('50000.00'), time: '02:14' },
} as const;

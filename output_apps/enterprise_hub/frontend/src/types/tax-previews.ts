/**
 * قراردادهای تایپ‌سیف پیش‌نمایش‌های مالیاتی (DTX-01 تا DTX-04)
 * منطبق بر DTOهای بک‌اند در modules/tax_compliance/dto/
 * اعداد همگی از API دریافت شده و هیچ محاسبه‌ای در مرورگر انجام نمی‌شود.
 */

export interface StatutoryParameterUse {
  key: string;
  value: unknown;
  effectiveFrom: string;
  version: number;
  source: string;
  verified: boolean;
}

// -------------------------------------------------------------
// ۱. مالیات بر درآمد شرکت‌ها (Corporate Income Tax Preview)
// -------------------------------------------------------------
export interface CorporateTaxPreviewDto {
  fiscalYear: number;
  accountingProfit: string;
  nonDeductibleAdditions: string;
  exemptIncomeAndDeductions: string;
  lossesBroughtForward: string;
  expenseAccountCode?: string;
  payableAccountCode?: string;
}

export interface CorporateTaxPreview {
  status: "preview";
  fiscalYear: number;
  currency: "IRR";
  worksheet: Array<{ step: string; amount: string }>;
  taxableIncome: string;
  taxByRate: string;
  floorTax: string;
  provision: string;
  floorApplied: boolean;
  effectiveRate: string | null;
  voucher: {
    posted: false;
    lines: Array<{
      accountCode: string | null;
      debit: string;
      credit: string;
      description: string;
    }>;
  };
  parameters: StatutoryParameterUse[];
  notes: string[];
}

// -------------------------------------------------------------
// ۲. مالیات صاحبان مشاغل و مشارکت مدنی (Business Tax Preview - Art. 101)
// -------------------------------------------------------------
export interface BusinessUnitDto {
  revenue: string;
  deductibleExpenses: string;
}

export interface PartnerDto {
  name?: string;
  shareBps: number;
  spouseGroup?: string;
  isHusband?: boolean;
}

export interface BusinessTaxPreviewDto {
  fiscalYear: number;
  mode: "SOLE" | "PARTNERSHIP";
  units: BusinessUnitDto[];
  partners?: PartnerDto[];
}

export interface TaxpayerLine {
  label: string;
  incomeShare: string;
  exemption: string;
  taxableIncome: string;
  tax: string;
}

export interface BusinessTaxPreview {
  status: "preview";
  fiscalYear: number;
  mode: "SOLE" | "PARTNERSHIP";
  currency: "IRR";
  totalIncome: string;
  exemptionsUsed: number;
  taxpayers: TaxpayerLine[];
  totalTax: string;
  parameters: StatutoryParameterUse[];
  voucher: { posted: false };
  notes: string[];
}

// -------------------------------------------------------------
// ۳. مالیات بر درآمد اجاره (Rental Income Tax Preview - Art. 53 & 57)
// -------------------------------------------------------------
export interface RentalTaxPreviewDto {
  fiscalYear: number;
  rentReceived: string;
  inKindIncome?: string;
  lessorIsOwner: boolean;
  rentPaid?: string;
  exemptRentPortion?: string;
  otherTaxableIncome?: string;
  minorUnderGuardianship?: boolean;
}

export interface RentalTaxPreview {
  status: "preview";
  fiscalYear: number;
  currency: "IRR";
  grossRent: string;
  taxableRent: string;
  exemptionAmount: string;
  taxableAfterExemption: string;
  tax: string;
  worksheet: Array<{ step: string; amount: string }>;
  parameters: StatutoryParameterUse[];
  voucher: { posted: false };
  notes: string[];
}

// -------------------------------------------------------------
// ۴. مالیات تکلیفی حق‌الزحمه پزشکان (Doctor Fee Withholding Preview)
// -------------------------------------------------------------
export type DoctorPaymentKind = "FEE" | "SALARY" | "BONUS";

export interface DoctorPaymentDto {
  paidOn: string;
  amount: string;
  doctorRef: string;
  kind: DoctorPaymentKind;
}

export interface DoctorWithholdingPreviewDto {
  fiscalYear: number;
  payments: DoctorPaymentDto[];
  remittedOn?: string;
}

export interface DoctorWithholdingLine {
  doctorRef: string;
  paidOn: string;
  kind: string;
  amount: string;
  withheld: string;
  netToDoctor: string;
  excludedReason: string | null;
  remitBy: string;
  latePenalty: { monthsLate: number; amount: string } | null;
}

export interface DoctorWithholdingPreview {
  status: "preview";
  fiscalYear: number;
  currency: "IRR";
  lines: DoctorWithholdingLine[];
  byDoctor: Array<{ doctorRef: string; gross: string; withheld: string }>;
  totalWithheld: string;
  latePenalty: { remittedOn: string; monthsLate: number; amount: string } | null;
  parameters: StatutoryParameterUse[];
  voucher: { posted: false };
  notes: string[];
}

export enum DamageCalculationMethod {
  CPI_INDEX = 'CPI_INDEX',
  ANNUAL_RATE = 'ANNUAL_RATE',
}

export const DAMAGE_CALCULATION_METHOD_LABELS: Record<DamageCalculationMethod, string> = {
  [DamageCalculationMethod.CPI_INDEX]: 'شاخص تورم بانک مرکزی (ماده ۵۲۲)',
  [DamageCalculationMethod.ANNUAL_RATE]: 'نرخ سود سالانه قراردادی',
};

export interface CreateDamageCalculationRequest {
  principalAmount: number;
  dueDate: string;
  paymentDate: string;
  calculationMethod: DamageCalculationMethod;
  cpiIndexAtDueDate?: number;
  cpiIndexAtPaymentDate?: number;
  annualInterestRate?: number;
  contractReferenceNumber?: string;
}

export interface DamageCalculationResponse {
  id: string;
  principalAmount: number;
  dueDate: string;
  paymentDate: string;
  calculationMethod: DamageCalculationMethod;
  delayedDays: number;
  damageAmount: number;
  totalPayable: number;
  legalBasis: string;
  contractReferenceNumber?: string;
  createdAt: string;
}

export interface QueryDamageCalculationParams {
  page?: number;
  limit?: number;
  contractReferenceNumber?: string;
}

export interface PaginatedDamageCalculationResponse {
  data: DamageCalculationResponse[];
  total: number;
  page: number;
  limit: number;
}

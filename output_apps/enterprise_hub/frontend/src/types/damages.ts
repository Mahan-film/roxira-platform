export enum DamageCalculationMethod {
  CPI_INDEX = 'CPI_INDEX',
  ANNUAL_RATE = 'ANNUAL_RATE',
}

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

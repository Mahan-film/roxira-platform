export enum DamageCalculationMethod {
  CPI_INDEX = 'CPI_INDEX',
  ANNUAL_RATE = 'ANNUAL_RATE',
}

export const DAMAGE_CALCULATION_METHOD_LABELS: Record<DamageCalculationMethod, string> = {
  [DamageCalculationMethod.CPI_INDEX]: 'شاخص تورم بانک مرکزی (ماده ۵۲۲)',
  [DamageCalculationMethod.ANNUAL_RATE]: 'نرخ سود سالانه قراردادی',
};

export interface CreateDamageCalculationDto {
  principalAmount: number;
  dueDate: string;
  paymentDate: string;
  calculationMethod: DamageCalculationMethod;
  cpiIndexAtDueDate?: number;
  cpiIndexAtPaymentDate?: number;
  annualInterestRate?: number;
  contractReferenceNumber?: string;
}

export type CreateDamageCalculationRequest = CreateDamageCalculationDto;

export interface DamageCalculationResponseDto {
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

export type DamageCalculationResponse = DamageCalculationResponseDto;

export interface QueryDamageCalculationDto {
  page?: number;
  limit?: number;
  contractReferenceNumber?: string;
}

export type QueryDamageCalculationParams = QueryDamageCalculationDto;

export interface PaginatedDamageCalculationResponse {
  data: DamageCalculationResponseDto[];
  total: number;
  page: number;
  limit: number;
}

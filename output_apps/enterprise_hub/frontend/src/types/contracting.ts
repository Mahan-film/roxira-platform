export type Money = number | string;
export type ContractSide = "employer" | "contractor";
export type ContractStatus = "draft" | "active" | "closed";
export type StatementStatus = "draft" | "approved" | "posted";
export type InsuranceType = "MECHANICAL" | "NON_MECHANICAL" | "CIVIL_EXECUTIVE" | "CIVIL_CONSULTING";

export interface Project {
  id: number;
  code: string;
  name: string;
  costCentreCode: string | null;
  budget: Money;
  startDate: string | null;
  endDate: string | null;
  status: "active" | "closed";
}

export interface Contract {
  id: number;
  code: string;
  title: string;
  side: ContractSide;
  partyCode: string;
  projectId: number | null;
  contractDate: string;
  amount: Money;
  advanceAmount: Money;
  insuranceType: InsuranceType | null;
  status: ContractStatus;
}

export interface TermUse {
  key: string;
  label: string;
  rate: string;
  version: number;
  source: string;
  verified: boolean;
  tenantOverride: boolean;
  legalFact: boolean;
}

export interface Statement {
  id: number;
  contractId: number;
  number: number;
  statementDate: string;
  cumulativeAmount: Money;
  previousAmount: Money;
  periodAmount: Money;
  retentionAmount: Money;
  insuranceAmount: Money;
  advanceRecoveryAmount: Money;
  netPayable: Money;
  status: StatementStatus;
  journalEntryNumber: string | null;
  termsUsed: TermUse[];
}

export interface Movement {
  id: number;
  kind: "advance" | "retention_release";
  date: string;
  amount: Money;
  journalEntryNumber: string | null;
}

export interface ProfitabilityRow {
  projectId: number;
  code: string;
  name: string;
  budget: Money;
  billed: Money;
  actual: { subcontracts: Money; ledger: Money | null; total: Money };
  budgetRemaining: Money;
  margin: Money;
  ledgerLinked: boolean;
}

export interface PartyOption {
  code: string;
  name: string;
  role: "customer" | "supplier" | "both";
}

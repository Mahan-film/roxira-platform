/** Project profitability from three sources, all bigint minor units. Pure. */
export interface ProjectFigures {
  budget: bigint;
  /** Posted contractor-side statements: what we billed employers. */
  billed: bigint;
  /** Posted employer-side statements: what subcontractors billed us. */
  subcontracts: bigint;
  /** Expense posted in the ledger on the project's cost centre; null when the project has no (valid) cost centre. */
  ledgerExpense: bigint | null;
}

export interface ProjectProfitability {
  budget: bigint;
  billed: bigint;
  actual: { subcontracts: bigint; ledger: bigint | null; total: bigint };
  budgetRemaining: bigint;
  /** billed - actual cost. */
  margin: bigint;
  ledgerLinked: boolean;
}

export function profitability(f: ProjectFigures): ProjectProfitability {
  const total = f.subcontracts + (f.ledgerExpense ?? 0n);
  return {
    budget: f.budget,
    billed: f.billed,
    actual: { subcontracts: f.subcontracts, ledger: f.ledgerExpense, total },
    budgetRemaining: f.budget - total,
    margin: f.billed - total,
    ledgerLinked: f.ledgerExpense !== null,
  };
}

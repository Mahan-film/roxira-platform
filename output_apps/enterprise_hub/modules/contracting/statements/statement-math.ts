/** Pure bigint (minor unit) math for progress statements. No Number arithmetic. */
export type StatementErrorCode = 'NOT_INCREASING' | 'OVER_CONTRACT' | 'DEDUCTIONS_EXCEED';

export class StatementError extends Error {
  constructor(readonly code: StatementErrorCode, message: string) {
    super(message);
  }
}

/** This statement's period amount: cumulative minus the previous cumulative, within the contract price. */
export function nextPeriod(previousCumulative: bigint, cumulative: bigint, contractAmount: bigint): bigint {
  if (cumulative <= previousCumulative) throw new StatementError('NOT_INCREASING', 'cumulative must grow');
  if (cumulative > contractAmount) throw new StatementError('OVER_CONTRACT', 'cumulative exceeds the contract amount');
  return cumulative - previousCumulative;
}

/** What is payable after deductions. */
export function netPayable(period: bigint, retention: bigint, insurance: bigint, advanceRecovery: bigint): bigint {
  const net = period - retention - insurance - advanceRecovery;
  if (net < 0n) throw new StatementError('DEDUCTIONS_EXCEED', 'deductions exceed the period amount');
  return net;
}

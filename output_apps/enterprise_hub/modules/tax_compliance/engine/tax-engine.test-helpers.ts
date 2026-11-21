import { WhtCertificateSequenceStore } from './tax-engine.types';

/** TEST ONLY: in-memory certificate counter. Production must inject a DB-backed store. */
export class InMemoryWhtCertificateSequenceStore implements WhtCertificateSequenceStore {
  private readonly counters = new Map<string, number>();

  async next(prefix: string, year: number): Promise<number> {
    const key = `${prefix}:${year}`;
    const nextSeq = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, nextSeq);
    return nextSeq;
  }
}

/** TEST ONLY: the one place fixture percentages (19 = 19%) are converted to integer basis points. */
export function percentToBps(percent: number): number {
  const bps = percent * 100;
  if (!Number.isInteger(bps)) throw new Error(`percent ${percent} is not a whole number of basis points`);
  return bps;
}

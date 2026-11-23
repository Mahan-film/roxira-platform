/**
 * Per-key cooldown for a rotating API key pool. A key that answered 401/403/429 is skipped for a while
 * so the next request goes straight to a healthy key instead of re-hitting the dead one first.
 * Keys are only ever Map keys here: nothing is logged or exposed.
 */
export class KeyCooldowns {
  private until = new Map<string, number>();
  constructor(private now: () => number = Date.now) {}

  /** skip `key` for `ms` from now (a longer existing cooldown is kept) */
  mark(key: string, ms: number): void {
    if (ms <= 0) return;
    this.until.set(key, Math.max(this.until.get(key) ?? 0, this.now() + ms));
  }

  isCooled(key: string): boolean {
    const u = this.until.get(key);
    if (u === undefined) return false;
    if (u <= this.now()) { this.until.delete(key); return false; }
    return true;
  }

  /**
   * Keys to try, in order: healthy keys rotated to start at `start`. When every key is cooled the one
   * that comes back soonest is returned alone (a cooldown must never turn the pool into zero keys).
   */
  order(keys: string[], start = 0): string[] {
    if (!keys.length) return [];
    const n = keys.length;
    const live: string[] = [];
    for (let i = 0; i < n; i++) {
      const k = keys[(((start + i) % n) + n) % n];
      if (!this.isCooled(k)) live.push(k);
    }
    if (live.length) return live;
    return [keys.reduce((a, b) => ((this.until.get(b) ?? 0) < (this.until.get(a) ?? 0) ? b : a))];
  }
}

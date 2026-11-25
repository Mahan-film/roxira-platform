/** Rolling-window cap on outgoing alerts. Pure and in-memory: a restart only resets the window. */
export class AlertThrottle {
  private sent: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  tryAcquire(now: number = Date.now()): boolean {
    this.prune(now);
    if (this.sent.length >= this.max) return false;
    this.sent.push(now);
    return true;
  }

  remaining(now: number = Date.now()): number {
    this.prune(now);
    return this.max - this.sent.length;
  }

  private prune(now: number): void {
    this.sent = this.sent.filter((t) => now - t < this.windowMs);
  }
}

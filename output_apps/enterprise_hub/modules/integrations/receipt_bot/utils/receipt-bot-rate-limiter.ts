import { Injectable, Optional } from '@nestjs/common';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * In-memory sliding window rate limiter per user.
 * Prevents spam/abuse on bot photo uploads and webhook processing.
 */
@Injectable()
export class ReceiptBotRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly timestamps = new Map<string, number[]>();

  constructor(
    @Optional() windowMs?: number,
    @Optional() maxRequests?: number,
  ) {
    this.windowMs = typeof windowMs === 'number' ? windowMs : 60_000;
    this.maxRequests = typeof maxRequests === 'number' ? maxRequests : 10;
  }

  isAllowed(key: string): RateLimitResult {
    const now = Date.now();
    const history = this.timestamps.get(key) ?? [];
    const valid = history.filter((ts) => now - ts < this.windowMs);

    if (valid.length >= this.maxRequests) {
      const oldest = valid[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    valid.push(now);
    this.timestamps.set(key, valid);
    return { allowed: true };
  }

  /** Non-recording check: true when `key` already used up its quota in the window. */
  isBlocked(key: string): RateLimitResult {
    const now = Date.now();
    const valid = (this.timestamps.get(key) ?? []).filter((ts) => now - ts < this.windowMs);
    if (valid.length >= this.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((valid[0] + this.windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true };
  }

  /** Record one event (e.g. a failed attempt) for `key` without checking the quota. */
  record(key: string): void {
    const now = Date.now();
    const valid = (this.timestamps.get(key) ?? []).filter((ts) => now - ts < this.windowMs);
    valid.push(now);
    this.timestamps.set(key, valid);
  }

  reset(key?: string): void {
    if (key) {
      this.timestamps.delete(key);
    } else {
      this.timestamps.clear();
    }
  }
}

import { Injectable } from '@nestjs/common';

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

  constructor(windowMs = 60_000, maxRequests = 10) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
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

  reset(key?: string): void {
    if (key) {
      this.timestamps.delete(key);
    } else {
      this.timestamps.clear();
    }
  }
}

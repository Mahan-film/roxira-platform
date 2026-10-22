import { Injectable, Logger } from '@nestjs/common';
import {
  ALERT_DEDUPE_WINDOW_MS,
  ALERT_GLOBAL_MAX,
  ALERT_GLOBAL_WINDOW_MS,
  ALERT_MAX_TRACKED,
} from '../constants/client-errors.constants';
import { ReportClientErrorDto } from '../dto/report-client-error.dto';
import { ClientErrorAlertSender } from './client-error-alert.sender';

const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const BEARER = /bearer\s+[A-Za-z0-9._-]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const LONG_TOKEN = /[A-Za-z0-9_-]{32,}/g;

/** Remove anything token/PII-like from a client-supplied string. */
export function scrubText(text: string): string {
  return text
    .replace(JWT, '[jwt]')
    .replace(BEARER, '[bearer]')
    .replace(EMAIL, '[email]')
    .replace(LONG_TOKEN, '[token]');
}

/** Drop query string and fragment from a path/URL. */
export function stripQuery(path: string): string {
  return path.split(/[?#]/, 1)[0];
}

/**
 * Receives browser error reports: writes one structured JSON log line each and sends a
 * rate-limited alert (<= 1 per distinct message per 30 min, <= 10 total per 10 min).
 * State is in-memory (single backend instance; resets on restart, which is acceptable).
 */
@Injectable()
export class ClientErrorsService {
  private readonly logger = new Logger(ClientErrorsService.name);
  private readonly lastAlertAt = new Map<string, number>();
  private globalAlerts: number[] = [];

  constructor(private readonly sender: ClientErrorAlertSender) {}

  async report(dto: ReportClientErrorDto, now: number = Date.now()): Promise<{ alerted: boolean }> {
    const message = scrubText(dto.message);
    const path = scrubText(stripQuery(dto.path));
    const entry = {
      event: 'client_error',
      kind: dto.kind ?? 'error',
      message,
      path,
      build: dto.build ?? null,
      userAgent: dto.userAgent ? scrubText(dto.userAgent) : null,
      clientTime: dto.timestamp ?? null,
      stack: dto.stack ? scrubText(dto.stack) : null,
    };
    this.logger.warn(JSON.stringify(entry));

    if (!this.shouldAlert(message, now)) return { alerted: false };
    const text = `خطای کلاینت (${entry.kind}) ${path}\n${message.slice(0, 300)}${
      entry.build ? `\nbuild ${entry.build}` : ''
    }`;
    const alerted = await this.sender.send(text);
    return { alerted };
  }

  private shouldAlert(key: string, now: number): boolean {
    const last = this.lastAlertAt.get(key);
    if (last !== undefined && now - last < ALERT_DEDUPE_WINDOW_MS) return false;

    this.globalAlerts = this.globalAlerts.filter((t) => now - t < ALERT_GLOBAL_WINDOW_MS);
    if (this.globalAlerts.length >= ALERT_GLOBAL_MAX) return false;

    if (this.lastAlertAt.size >= ALERT_MAX_TRACKED) this.prune(now);
    if (this.lastAlertAt.size >= ALERT_MAX_TRACKED) return false;

    this.lastAlertAt.set(key, now);
    this.globalAlerts.push(now);
    return true;
  }

  private prune(now: number): void {
    for (const [k, t] of this.lastAlertAt) {
      if (now - t >= ALERT_DEDUPE_WINDOW_MS) this.lastAlertAt.delete(k);
    }
  }
}

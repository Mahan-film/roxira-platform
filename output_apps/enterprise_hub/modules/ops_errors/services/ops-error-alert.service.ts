import { Injectable, Logger, Optional } from '@nestjs/common';
import { MailService } from '../../auth/services/mail.service';
import { ClientErrorAlertSender } from '../../client-errors/services/client-error-alert.sender';
import { AlertThrottle } from '../alert-throttle';
import {
  ALERT_MAX_PER_HOUR,
  ALERT_WINDOW_MS,
  DIGEST_TOP_N,
  RETENTION_DAYS,
} from '../constants/ops-errors.constants';
import { shortId } from '../ops-errors.util';
import {
  OpsErrorDigestRow,
  OpsErrorEventsRepository,
  OpsErrorRow,
} from '../repositories/ops-error-events.repository';

/**
 * Turns stored events into Telegram alerts (new fingerprint, or a 10x hourly jump) and a daily digest
 * (Telegram and one e-mail). Messages carry only route, count, short fingerprint id, release and the
 * error class: never a message, stack or tenant id.
 */
@Injectable()
export class OpsErrorAlertService {
  private readonly logger = new Logger(OpsErrorAlertService.name);
  readonly throttle = new AlertThrottle(ALERT_MAX_PER_HOUR, ALERT_WINDOW_MS);

  constructor(
    private readonly repo: OpsErrorEventsRepository,
    private readonly telegram: ClientErrorAlertSender,
    @Optional() private readonly mail?: MailService,
  ) {}

  /** Runs every 5 minutes. Returns how many Telegram messages were sent. */
  async scan(now: number = Date.now()): Promise<number> {
    let sent = 0;
    for (const row of await this.repo.findNewUnalerted(ALERT_MAX_PER_HOUR)) {
      if (!this.throttle.tryAcquire(now)) return sent;
      if (await this.telegram.send(formatAlert('NEW', row))) {
        await this.repo.markAlerted(row.id);
        sent += 1;
      }
    }
    for (const row of await this.repo.findSpikes(ALERT_MAX_PER_HOUR)) {
      if (!this.throttle.tryAcquire(now)) return sent;
      if (await this.telegram.send(formatAlert('SPIKE', row))) {
        await this.repo.markSpikeAlerted(row.id);
        sent += 1;
      }
    }
    return sent;
  }

  /** Daily: top fingerprints of the last 24 h to Telegram and e-mail, then purge old rows. */
  async digest(): Promise<{ rows: number }> {
    const top = await this.repo.topLast24h(DIGEST_TOP_N);
    if (top.length > 0) {
      const text = formatDigest(top);
      await this.telegram.send(text);
      const to = process.env.OPS_ALERT_EMAIL_TO ?? process.env.BACKUP_NOTIFY_TO;
      if (to && this.mail) {
        await this.mail.sendSecurityAlert(to, '[Roxira] daily error digest', text);
      }
    }
    await this.repo.purgeOlderThan(RETENTION_DAYS).catch((e) => this.logger.warn(`purge failed: ${(e as Error).message}`));
    return { rows: top.length };
  }
}

export function formatAlert(kind: 'NEW' | 'SPIKE', r: OpsErrorRow): string {
  const rate = kind === 'SPIKE' ? ` hour=${r.hourCount} (prev ${r.prevHourCount})` : '';
  return (
    `[ROXIRA ERROR ${kind}] ${shortId(r.fingerprint)} ${r.httpMethod ?? '-'} ${r.route ?? '-'} ` +
    `status=${r.status ?? '-'} count=${r.count}${rate} class=${r.errorClass} ` +
    `source=${r.source} release=${r.release ?? '-'}`
  );
}

export function formatDigest(rows: OpsErrorDigestRow[]): string {
  const lines = rows.map(
    (r, i) =>
      `${i + 1}. ${shortId(r.fingerprint)} x${r.total} ${r.route ?? '-'} class=${r.errorClass} ` +
      `source=${r.source} release=${r.release ?? '-'}`,
  );
  return [`[ROXIRA] error digest, last 24h (top ${rows.length})`, ...lines].join('\n');
}

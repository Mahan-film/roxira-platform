import { MoadianInquiryStatus } from '../enums/moadian.enum';
import { TaxTransmissionMode } from '../enums/tax-transmission.enum';
import { MoadianApiError } from '../services/moadian-api.client';
import {
  TaxTransmissionAdapter,
  TransmissionContext,
  TransmissionInquiryResult,
  TransmissionItem,
  TransmissionSubmitResult,
} from '../transmission/tax-transmission.adapter';

export interface FakeSubmitScript {
  kind: 'ok' | 'timeout' | 'http500' | 'reject';
  /** What the fake "server" stores for the uid, whatever the caller saw (a lost response stores SUCCESS). */
  stored?: MoadianInquiryStatus;
}

/**
 * In-memory stand-in for a TSP. TESTS ONLY: it is never registered in a Nest module, and no real TSP
 * adapter exists (their APIs are private).
 */
export class FakeTspAdapter implements TaxTransmissionAdapter {
  readonly modes = [TaxTransmissionMode.TSP_TAXPAYER_KEY, TaxTransmissionMode.TSP_TSP_KEY] as const;
  readonly server = new Map<string, MoadianInquiryStatus>();
  readonly submitted: TransmissionItem[] = [];
  readonly inquired: string[][] = [];
  script: FakeSubmitScript[] = [];

  async submitBatch(_ctx: TransmissionContext, items: TransmissionItem[]): Promise<TransmissionSubmitResult[]> {
    return items.map((item) => {
      this.submitted.push(item);
      const step = this.script.shift() ?? { kind: 'ok' };
      if (step.stored) this.server.set(item.uid, step.stored);
      else if (step.kind === 'ok') this.server.set(item.uid, MoadianInquiryStatus.PENDING);
      switch (step.kind) {
        case 'ok':
          return { uid: item.uid, referenceNumber: `REF-${item.uid.slice(0, 8)}`, error: null };
        case 'timeout':
          return { uid: item.uid, referenceNumber: null, error: new MoadianApiError('timeout', null, true) };
        case 'http500':
          return { uid: item.uid, referenceNumber: null, error: new MoadianApiError('HTTP 500', 500, true) };
        default:
          return {
            uid: item.uid,
            referenceNumber: null,
            error: new MoadianApiError('HTTP 400', 400, false, [{ code: '4001', message: 'bad packet' }]),
          };
      }
    });
  }

  async inquireByUid(_ctx: TransmissionContext, uids: string[]): Promise<TransmissionInquiryResult[]> {
    this.inquired.push(uids);
    return uids.map((uid) => ({
      uid,
      status: this.server.get(uid) ?? MoadianInquiryStatus.NOT_FOUND,
      referenceNumber: this.server.has(uid) ? `REF-${uid.slice(0, 8)}` : null,
      errors: [],
      warnings: [],
    }));
  }
}

import { MoadianMessage } from '../entities/moadian-submission.entity';
import { FiscalMemoryProfileEntity } from '../entities/fiscal-memory-profile.entity';
import { MoadianInquiryStatus } from '../enums/moadian.enum';
import { TaxTransmissionMode } from '../enums/tax-transmission.enum';
import type { MoadianApiError } from '../services/moadian-api.client';

export interface TransmissionContext {
  tenantId: string;
  profile: FiscalMemoryProfileEntity;
}

export interface TransmissionItem {
  uid: string;
  taxId: string;
  packet: unknown;
}

/** Per item result. `error` is set when the call failed; `retryable` errors mean "unknown whether it arrived". */
export interface TransmissionSubmitResult {
  uid: string;
  referenceNumber: string | null;
  error: MoadianApiError | null;
}

export interface TransmissionInquiryResult {
  uid: string;
  status: MoadianInquiryStatus | string;
  referenceNumber: string | null;
  errors: MoadianMessage[];
  warnings: MoadianMessage[];
}

/** One way of getting packets to the tax authority. Chosen by the profile's mode. */
export interface TaxTransmissionAdapter {
  readonly modes: readonly TaxTransmissionMode[];
  submitBatch(ctx: TransmissionContext, items: TransmissionItem[]): Promise<TransmissionSubmitResult[]>;
  /** Missing uids are reported as NOT_FOUND by the caller; adapters may omit them. */
  inquireByUid(ctx: TransmissionContext, uids: string[]): Promise<TransmissionInquiryResult[]>;
}

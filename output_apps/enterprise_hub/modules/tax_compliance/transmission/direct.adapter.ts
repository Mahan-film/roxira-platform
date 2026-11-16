import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MOADIAN_ENV, MOADIAN_PRODUCTION_BASE_URL } from '../constants/moadian.constants';
import { TaxTransmissionEnvironment, TaxTransmissionMode } from '../enums/tax-transmission.enum';
import { MoadianRepository } from '../repositories/moadian.repository';
import { MoadianApiClient, MoadianApiError, MoadianAuthContext } from '../services/moadian-api.client';
import { openSecret, parseMasterKey } from '../utils/secret-box.util';
import {
  TaxTransmissionAdapter,
  TransmissionContext,
  TransmissionInquiryResult,
  TransmissionItem,
  TransmissionSubmitResult,
} from './tax-transmission.adapter';

/** Direct mode: the existing Moadian v2 client, signed with the tenant's own sealed key. */
@Injectable()
export class DirectAdapter implements TaxTransmissionAdapter {
  readonly modes = [TaxTransmissionMode.DIRECT] as const;

  constructor(
    private readonly client: MoadianApiClient,
    private readonly repository: MoadianRepository,
    private readonly config: ConfigService,
  ) {}

  /** The client talks to one configured base URL; refuse a profile that points at the other environment. */
  private assertEnvironment(ctx: TransmissionContext): void {
    const actual =
      this.client.baseUrl === MOADIAN_PRODUCTION_BASE_URL
        ? TaxTransmissionEnvironment.PRODUCTION
        : TaxTransmissionEnvironment.SANDBOX;
    if (actual !== ctx.profile.environment) {
      throw new MoadianApiError(
        `Profile environment ${ctx.profile.environment} does not match the configured Moadian base URL (${actual}).`,
        null,
        false,
      );
    }
  }

  private async auth(ctx: TransmissionContext): Promise<MoadianAuthContext> {
    this.assertEnvironment(ctx);
    const credential = await this.repository.findCredentialWithPrivateKey(ctx.tenantId);
    if (!credential?.privateKeySealed) {
      throw new MoadianApiError('Moadian credential not found for tenant', null, false);
    }
    let masterKey: Buffer;
    try {
      masterKey = parseMasterKey(this.config.get<string>(MOADIAN_ENV.KEY_ENCRYPTION_KEY));
    } catch (error) {
      throw new MoadianApiError(
        `Moadian key storage is not configured: ${(error as Error).message}`,
        null,
        false,
      );
    }
    return {
      memoryId: ctx.profile.memoryId,
      certificatePem: credential.certificatePem,
      privateKeyPem: openSecret(credential.privateKeySealed, masterKey, ctx.tenantId),
    };
  }

  async submitBatch(
    ctx: TransmissionContext,
    items: TransmissionItem[],
  ): Promise<TransmissionSubmitResult[]> {
    const auth = await this.auth(ctx);
    const results: TransmissionSubmitResult[] = [];
    for (const item of items) {
      try {
        const sent = await this.client.sendInvoice(auth, item.uid, item.packet);
        results.push({ uid: item.uid, referenceNumber: sent.referenceNumber, error: null });
      } catch (error) {
        if (!(error instanceof MoadianApiError)) throw error;
        results.push({ uid: item.uid, referenceNumber: null, error });
      }
    }
    return results;
  }

  async inquireByUid(ctx: TransmissionContext, uids: string[]): Promise<TransmissionInquiryResult[]> {
    const auth = await this.auth(ctx);
    const rows = await this.client.inquiryByUid(auth, uids);
    return rows
      .filter((r): r is typeof r & { uid: string } => typeof r.uid === 'string')
      .map((r) => ({
        uid: r.uid,
        status: r.status,
        referenceNumber: r.referenceNumber,
        errors: r.errors,
        warnings: r.warnings,
      }));
  }
}

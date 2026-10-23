import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MOADIAN_DEFAULT_HTTP_TIMEOUT_MS,
  MOADIAN_ENV,
  MOADIAN_FETCH,
  MOADIAN_NONCE_TTL_SECONDS,
  MOADIAN_SANDBOX_BASE_URL,
  MOADIAN_SERVER_KEY_CACHE_MS,
} from '../constants/moadian.constants';
import { MoadianInquiryStatus } from '../enums/moadian.enum';
import { MoadianMessage } from '../entities/moadian-submission.entity';
import { encryptMoadianJwe, signMoadianJws } from '../utils/moadian-jose.util';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** اطلاعات احراز هویت مستأجر (کلید خصوصی رمزگشایی‌شده؛ فقط در حافظه). */
export interface MoadianAuthContext {
  memoryId: string;
  privateKeyPem: string;
  certificatePem: string;
}

export interface MoadianServerKey {
  id: string;
  key: string;
}

export interface MoadianSendResult {
  uid: string;
  referenceNumber: string | null;
}

export interface MoadianInquiryResult {
  uid: string | null;
  referenceNumber: string | null;
  status: MoadianInquiryStatus | string;
  errors: MoadianMessage[];
  warnings: MoadianMessage[];
}

/** خطای HTTP مودیان؛ `retryable` برای خطای شبکه/5xx/429. */
export class MoadianApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly retryable: boolean,
    readonly errors: MoadianMessage[] = [],
  ) {
    super(message);
  }
}

function toMessages(list: unknown): MoadianMessage[] {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((row: Record<string, unknown>) => ({
    code: String(row?.code ?? row?.errorCode ?? ''),
    message: String(row?.message ?? row?.detail ?? ''),
  }));
}

/**
 * کلاینت HTTP سامانه مودیان (API v2 — `/requestsmanager/api/v2`).
 *
 * جریان: GET /nonce → توکن JWS `{nonce, clientId}` → `Authorization: Bearer`.
 * ارسال: POST /invoice با `[{payload: JWE(JWS(packet)), header: {requestTraceId, fiscalId}}]`.
 * استعلام: GET /inquiry-by-reference-id یا /inquiry-by-uid.
 */
@Injectable()
export class MoadianApiClient {
  private serverKeyCache: { baseUrl: string; key: MoadianServerKey; expiresAt: number } | null =
    null;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(MOADIAN_FETCH) fetchImpl?: FetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  get baseUrl(): string {
    const configured = this.config.get<string>(MOADIAN_ENV.BASE_URL);
    return (configured && configured.trim()) || MOADIAN_SANDBOX_BASE_URL;
  }

  private get timeoutMs(): number {
    const raw = Number(this.config.get<string>(MOADIAN_ENV.HTTP_TIMEOUT_MS));
    return Number.isFinite(raw) && raw > 0 ? raw : MOADIAN_DEFAULT_HTTP_TIMEOUT_MS;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { accept: 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new MoadianApiError(
        `Moadian request failed: ${(error as Error).message}`,
        null,
        true,
      );
    }
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const errors = toMessages((body as { errors?: unknown })?.errors);
      const retryable = response.status >= 500 || response.status === 429;
      throw new MoadianApiError(
        `Moadian HTTP ${response.status}${errors[0] ? `: ${errors[0].code} ${errors[0].message}` : ''}`,
        response.status,
        retryable,
        errors,
      );
    }
    return body as T;
  }

  async getNonce(): Promise<string> {
    const body = await this.request<{ nonce?: string }>(
      `/nonce?timeToLive=${MOADIAN_NONCE_TTL_SECONDS}`,
    );
    if (!body?.nonce) {
      throw new MoadianApiError('Moadian nonce response has no nonce', null, true);
    }
    return body.nonce;
  }

  async buildAuthorization(auth: MoadianAuthContext, now: Date = new Date()): Promise<string> {
    const nonce = await this.getNonce();
    const token = signMoadianJws(
      { nonce, clientId: auth.memoryId },
      auth.privateKeyPem,
      auth.certificatePem,
      now,
    );
    return `Bearer ${token}`;
  }

  /** کلید عمومی رمزنگاری سازمان امور مالیاتی (با کش درون‌حافظه‌ای). */
  async getServerKey(auth: MoadianAuthContext): Promise<MoadianServerKey> {
    const now = Date.now();
    if (
      this.serverKeyCache &&
      this.serverKeyCache.baseUrl === this.baseUrl &&
      this.serverKeyCache.expiresAt > now
    ) {
      return this.serverKeyCache.key;
    }
    const body = await this.request<{ publicKeys?: Array<{ id?: string; key?: string }> }>(
      '/server-information',
      { headers: { Authorization: await this.buildAuthorization(auth) } },
    );
    const first = body?.publicKeys?.find((k) => k?.id && k?.key);
    if (!first?.id || !first.key) {
      throw new MoadianApiError('Moadian server-information has no public key', null, true);
    }
    const key = { id: first.id, key: first.key };
    this.serverKeyCache = { baseUrl: this.baseUrl, key, expiresAt: now + MOADIAN_SERVER_KEY_CACHE_MS };
    return key;
  }

  /** امضا، رمزنگاری و ارسال یک بسته صورتحساب. */
  async sendInvoice(
    auth: MoadianAuthContext,
    uid: string,
    packet: unknown,
    now: Date = new Date(),
  ): Promise<MoadianSendResult> {
    const serverKey = await this.getServerKey(auth);
    const jws = signMoadianJws(packet, auth.privateKeyPem, auth.certificatePem, now);
    const payload = encryptMoadianJwe(jws, serverKey.key, serverKey.id);
    const body = await this.request<{ result?: Array<{ uid?: string; referenceNumber?: string }> }>(
      '/invoice',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await this.buildAuthorization(auth, now),
        },
        body: JSON.stringify([
          { payload, header: { requestTraceId: uid, fiscalId: auth.memoryId } },
        ]),
      },
    );
    const row = body?.result?.find((r) => r?.uid === uid) ?? body?.result?.[0];
    return { uid, referenceNumber: row?.referenceNumber ?? null };
  }

  private parseInquiry(body: unknown): MoadianInquiryResult[] {
    const rows = Array.isArray(body)
      ? body
      : Array.isArray((body as { result?: unknown })?.result)
        ? (body as { result: unknown[] }).result
        : [];
    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const data = (row.data ?? {}) as Record<string, unknown>;
      return {
        uid: (row.uid as string) ?? null,
        referenceNumber: (row.referenceNumber as string) ?? null,
        status: String(row.status ?? MoadianInquiryStatus.NOT_FOUND),
        errors: toMessages(data.error),
        warnings: toMessages(data.warning),
      };
    });
  }

  async inquiryByReferenceId(
    auth: MoadianAuthContext,
    referenceIds: string[],
  ): Promise<MoadianInquiryResult[]> {
    const query = referenceIds
      .map((id) => `referenceIds=${encodeURIComponent(id)}`)
      .join('&');
    const body = await this.request<unknown>(`/inquiry-by-reference-id?${query}`, {
      headers: { Authorization: await this.buildAuthorization(auth) },
    });
    return this.parseInquiry(body);
  }

  async inquiryByUid(auth: MoadianAuthContext, uids: string[]): Promise<MoadianInquiryResult[]> {
    const query = [
      ...uids.map((id) => `uidList=${encodeURIComponent(id)}`),
      `fiscalId=${encodeURIComponent(auth.memoryId)}`,
    ].join('&');
    const body = await this.request<unknown>(`/inquiry-by-uid?${query}`, {
      headers: { Authorization: await this.buildAuthorization(auth) },
    });
    return this.parseInquiry(body);
  }
}

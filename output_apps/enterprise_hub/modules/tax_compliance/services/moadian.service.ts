import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  X509Certificate,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
} from 'crypto';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import {
  MOADIAN_DEFAULT_MAX_POLLS,
  MOADIAN_DEFAULT_POLL_DELAY_MS,
  MOADIAN_ENV,
  MOADIAN_JOB_ATTEMPTS,
  MOADIAN_JOB_BACKOFF_MS,
  MOADIAN_POLL_JOB,
  MOADIAN_QUEUE,
  MOADIAN_SEND_JOB,
} from '../constants/moadian.constants';
import {
  MoadianCredentialResponseDto,
  MoadianSubmissionResponseDto,
} from '../dto/moadian-response.dto';
import { PutMoadianCredentialDto } from '../dto/put-moadian-credential.dto';
import { MoadianCredentialEntity } from '../entities/moadian-credential.entity';
import { MoadianSubmissionEntity } from '../entities/moadian-submission.entity';
import {
  MoadianInquiryStatus,
  MoadianInvoicePattern,
  MoadianInvoiceSubject,
  MoadianSettlementMethod,
  MoadianSubmissionStatus,
} from '../enums/moadian.enum';
import { MoadianRepository } from '../repositories/moadian.repository';
import { choosePattern, MoadianPatternSelectionError } from '../utils/moadian-pattern-select';
import { SubmitMoadianInvoiceDto } from '../dto/submit-moadian-invoice.dto';
import { MoadianMappingError, mapInvoiceToMoadianPacket } from '../utils/moadian-packet.mapper';
import { openSecret, parseMasterKey, sealSecret } from '../utils/secret-box.util';
import { MoadianApiClient, MoadianApiError, MoadianAuthContext } from './moadian-api.client';

/** payload کارهای صف `moadian` — فقط شناسه‌ها؛ هیچ کلید یا بسته‌ای در Redis نمی‌رود. */
export interface MoadianJobData {
  tenantId: string;
  submissionId: string;
}

export type MoadianJobOutcome = 'poll' | 'done';

/**
 * اتصال زنده به سامانه مودیان پشت پرچم `MOADIAN_ENABLED` (پیش‌فرض خاموش).
 *
 * چرخه: submitInvoice → (BullMQ) processSend → SENT → (BullMQ، با تأخیر) processPoll
 * → SUCCESS / FAILED. وضعیت هر صورتحساب در `moadian_submissions` ذخیره می‌شود.
 */
@Injectable()
export class MoadianService {
  private readonly logger = new Logger(MoadianService.name);

  constructor(
    private readonly repository: MoadianRepository,
    private readonly invoicingService: InvoicingService,
    private readonly client: MoadianApiClient,
    private readonly config: ConfigService,
    @InjectQueue(MOADIAN_QUEUE) private readonly queue: Queue<MoadianJobData>,
  ) {}

  isEnabled(): boolean {
    return String(this.config.get<string>(MOADIAN_ENV.ENABLED) ?? 'false').toLowerCase() === 'true';
  }

  /** Flag + whether this tenant has stored credentials; never throws when the flag is off. */
  async getStatus(tenantId: string): Promise<{ enabled: boolean; configured: boolean }> {
    const credential = await this.repository.findCredential(tenantId);
    return { enabled: this.isEnabled(), configured: credential !== null };
  }

  private numberSetting(name: string, fallback: number): number {
    const raw = Number(this.config.get<string>(name));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  private masterKey(): Buffer {
    try {
      return parseMasterKey(this.config.get<string>(MOADIAN_ENV.KEY_ENCRYPTION_KEY));
    } catch (error) {
      throw new ServiceUnavailableException(
        `Moadian key storage is not configured: ${(error as Error).message}`,
      );
    }
  }

  private assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'اتصال به سامانه مودیان غیرفعال است (MOADIAN_ENABLED=false).',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // اطلاعات اتصال مستأجر
  // ---------------------------------------------------------------------------

  async putCredential(
    tenantId: string,
    dto: PutMoadianCredentialDto,
  ): Promise<MoadianCredentialResponseDto> {
    let certificate: X509Certificate;
    let privateKey: ReturnType<typeof createPrivateKey>;
    try {
      certificate = new X509Certificate(dto.certificatePem);
      privateKey = createPrivateKey(dto.privateKeyPem);
    } catch {
      throw new BadRequestException('گواهی یا کلید خصوصی قابل خواندن نیست.');
    }
    if (privateKey.asymmetricKeyType !== 'rsa') {
      throw new BadRequestException('کلید خصوصی باید RSA باشد.');
    }
    const keyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }) as Buffer;
    const certDer = certificate.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    if (!keyDer.equals(certDer)) {
      throw new BadRequestException('کلید خصوصی با کلید عمومی گواهی مطابقت ندارد.');
    }

    const privateKeySealed = sealSecret(
      privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      this.masterKey(),
      tenantId,
    );
    const saved = await this.repository.upsertCredential(tenantId, {
      memoryId: dto.memoryId.trim().toUpperCase(),
      economicCode: dto.economicCode,
      certificatePem: certificate.toString(),
      privateKeySealed,
      keyFingerprint: createHash('sha256').update(certDer).digest('hex'),
      defaultSstid: dto.defaultSstid ?? null,
      defaultMeasurementUnit: dto.defaultMeasurementUnit ?? null,
      settlementMethod: dto.settlementMethod ?? MoadianSettlementMethod.CASH,
    });
    return this.toCredentialResponse(saved);
  }

  async getCredential(tenantId: string): Promise<MoadianCredentialResponseDto> {
    const credential = await this.repository.findCredential(tenantId);
    if (!credential) {
      throw new NotFoundException('اطلاعات اتصال مودیان برای این سازمان ثبت نشده است.');
    }
    return this.toCredentialResponse(credential);
  }

  private toCredentialResponse(entity: MoadianCredentialEntity): MoadianCredentialResponseDto {
    let subject: string | null = null;
    let validTo: string | null = null;
    try {
      const cert = new X509Certificate(entity.certificatePem);
      subject = cert.subject;
      validTo = cert.validTo;
    } catch {
      // گواهی ذخیره‌شده خوانا نیست؛ فقط فیلدهای عمومی بازگردانده می‌شوند.
    }
    return {
      memoryId: entity.memoryId,
      economicCode: entity.economicCode,
      keyFingerprint: entity.keyFingerprint,
      certificateSubject: subject,
      certificateValidTo: validTo,
      defaultSstid: entity.defaultSstid,
      defaultMeasurementUnit: entity.defaultMeasurementUnit,
      settlementMethod: Number(entity.settlementMethod) as MoadianSettlementMethod,
      enabled: this.isEnabled(),
      baseUrl: this.client.baseUrl,
      updatedAt: entity.updatedAt,
    };
  }

  private async loadAuth(tenantId: string): Promise<MoadianAuthContext> {
    const credential = await this.repository.findCredentialWithPrivateKey(tenantId);
    if (!credential?.privateKeySealed) {
      throw new MoadianApiError('Moadian credential not found for tenant', null, false);
    }
    return {
      memoryId: credential.memoryId,
      certificatePem: credential.certificatePem,
      privateKeyPem: openSecret(credential.privateKeySealed, this.masterKey(), tenantId),
    };
  }

  // ---------------------------------------------------------------------------
  // ارسال صورتحساب
  // ---------------------------------------------------------------------------

  async submitInvoice(
    tenantId: string,
    invoiceId: string,
    options: SubmitMoadianInvoiceDto = {},
  ): Promise<MoadianSubmissionResponseDto> {
    this.assertEnabled();
    // findOne خود به مستأجر محدود است و برای صورتحساب سازمان دیگر NotFound می‌دهد.
    const invoice = await this.invoicingService.findOne(tenantId, invoiceId);
    if ((invoice.direction ?? 'SALE') !== 'SALE') {
      throw new BadRequestException(
        'صورتحساب خرید را تأمین‌کننده به سامانه مودیان ارسال می‌کند؛ از اینجا ارسال نمی‌شود.',
      );
    }
    const subject = Number(invoice.subject ?? 1) as MoadianInvoiceSubject;
    let pattern: MoadianInvoicePattern;
    try {
      pattern = choosePattern(options.pattern, options.extras);
    } catch (error) {
      if (error instanceof MoadianPatternSelectionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    // Corrective, cancel and return documents point at the tax id of the invoice they amend.
    let referenceTaxId: string | null = null;
    if (subject !== MoadianInvoiceSubject.MAIN) {
      const related = invoice.relatedInvoiceId
        ? await this.repository.findSubmissionByInvoice(tenantId, invoice.relatedInvoiceId)
        : null;
      if (related?.status !== MoadianSubmissionStatus.SUCCESS) {
        throw new BadRequestException(
          'صورتحساب مرجع (اصلی) باید قبلاً با موفقیت در سامانه مودیان ثبت شده باشد تا اصلاحی، ابطالی یا برگشتی ارسال شود.',
        );
      }
      referenceTaxId = related.taxId;
    }
    const credential = await this.repository.findCredential(tenantId);
    if (!credential) {
      throw new BadRequestException('ابتدا اطلاعات اتصال مودیان را ثبت کنید.');
    }

    const existing = await this.repository.findSubmissionByInvoice(tenantId, invoiceId);
    if (existing?.status === MoadianSubmissionStatus.SUCCESS) {
      throw new ConflictException('این صورتحساب قبلاً در سامانه مودیان ثبت شده است.');
    }
    if (
      existing?.status === MoadianSubmissionStatus.QUEUED ||
      existing?.status === MoadianSubmissionStatus.SENT
    ) {
      return this.toSubmissionResponse(existing);
    }

    const mapWith = (serial: number) => {
      try {
        return mapInvoiceToMoadianPacket(invoice, {
          memoryId: credential.memoryId,
          sellerEconomicCode: credential.economicCode,
          serial,
          defaultSstid: credential.defaultSstid,
          defaultMeasurementUnit: credential.defaultMeasurementUnit,
          settlementMethod: Number(credential.settlementMethod) as MoadianSettlementMethod,
          pattern,
          subject,
          referenceTaxId,
          cashPortion: options.cashPortion,
          lateRegistrationAt: options.lateRegistrationAt,
          extras: options.extras,
        });
      } catch (error) {
        if (error instanceof MoadianMappingError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
    };
    // Validate the invoice first (placeholder serial) so a rejected invoice
    // never burns a serial number; the real mapping happens after reservation.
    mapWith(1);
    const serial = await this.repository.reserveSerial(tenantId);
    const packet = mapWith(serial);

    const fields: Partial<MoadianSubmissionEntity> = {
      invoiceId,
      uid: randomUUID(),
      taxId: packet.header.taxid,
      serial: String(serial),
      referenceNumber: null,
      status: MoadianSubmissionStatus.QUEUED,
      errors: [],
      warnings: [],
      pollCount: 0,
      sentAt: null,
      lastPolledAt: null,
      packet: packet as unknown as Record<string, unknown>,
    };
    let submission: MoadianSubmissionEntity;
    try {
      submission = existing
        ? ((await this.repository.updateSubmission(tenantId, existing.id, fields)) as MoadianSubmissionEntity)
        : await this.repository.createSubmission(tenantId, fields);
    } catch (error) {
      // A concurrent submit of the same invoice hit the (tenant_id, invoice_id) unique index.
      const code =
        (error as { code?: string; driverError?: { code?: string } }).code ??
        (error as { driverError?: { code?: string } }).driverError?.code;
      if (code === '23505') {
        throw new ConflictException('این صورتحساب هم‌زمان در حال ارسال به سامانه مودیان است.');
      }
      throw error;
    }

    await this.queue.add(
      MOADIAN_SEND_JOB,
      { tenantId, submissionId: submission.id },
      {
        jobId: `moadian-send-${submission.id}-${serial}`,
        attempts: MOADIAN_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: MOADIAN_JOB_BACKOFF_MS },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
    return this.toSubmissionResponse(submission);
  }

  async getSubmission(tenantId: string, invoiceId: string): Promise<MoadianSubmissionResponseDto> {
    const submission = await this.repository.findSubmissionByInvoice(tenantId, invoiceId);
    if (!submission) {
      throw new NotFoundException('این صورتحساب هنوز به سامانه مودیان ارسال نشده است.');
    }
    return this.toSubmissionResponse(submission);
  }

  private toSubmissionResponse(entity: MoadianSubmissionEntity): MoadianSubmissionResponseDto {
    return {
      id: entity.id,
      invoiceId: entity.invoiceId,
      uid: entity.uid,
      taxId: entity.taxId,
      referenceNumber: entity.referenceNumber,
      status: entity.status,
      errors: entity.errors ?? [],
      warnings: entity.warnings ?? [],
      pollCount: entity.pollCount ?? 0,
      sentAt: entity.sentAt,
      lastPolledAt: entity.lastPolledAt,
      updatedAt: entity.updatedAt,
    };
  }

  private async schedulePoll(data: MoadianJobData, pollCount: number): Promise<void> {
    await this.queue.add(MOADIAN_POLL_JOB, data, {
      jobId: `moadian-poll-${data.submissionId}-${pollCount}`,
      delay: this.numberSetting(MOADIAN_ENV.POLL_DELAY_MS, MOADIAN_DEFAULT_POLL_DELAY_MS),
      attempts: MOADIAN_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: MOADIAN_JOB_BACKOFF_MS },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  // ---------------------------------------------------------------------------
  // پردازش صف (فراخوانی از MoadianProcessor)
  // ---------------------------------------------------------------------------

  /**
   * ارسال بسته. خطای قابل‌تکرار (شبکه/5xx) دوباره پرتاب می‌شود تا BullMQ با
   * backoff تکرار کند؛ در آخرین تلاش وضعیت ERROR ثبت می‌شود.
   */
  async processSend(data: MoadianJobData, isFinalAttempt: boolean): Promise<MoadianJobOutcome> {
    if (!this.isEnabled()) {
      this.logger.warn('Moadian send skipped: MOADIAN_ENABLED is not true.');
      return 'done';
    }
    const { tenantId, submissionId } = data;
    const submission = await this.repository.findSubmissionById(tenantId, submissionId);
    if (!submission || submission.status !== MoadianSubmissionStatus.QUEUED) {
      return 'done';
    }

    try {
      const auth = await this.loadAuth(tenantId);
      const result = await this.client.sendInvoice(auth, submission.uid, submission.packet);
      await this.repository.updateSubmission(tenantId, submissionId, {
        status: MoadianSubmissionStatus.SENT,
        referenceNumber: result.referenceNumber,
        sentAt: new Date(),
        errors: [],
      });
      await this.schedulePoll(data, 0);
      return 'poll';
    } catch (error) {
      const apiError = error instanceof MoadianApiError ? error : null;
      if (apiError && !apiError.retryable) {
        await this.repository.updateSubmission(tenantId, submissionId, {
          status: MoadianSubmissionStatus.FAILED,
          errors: apiError.errors.length
            ? apiError.errors
            : [{ code: String(apiError.httpStatus ?? 'CLIENT'), message: apiError.message }],
        });
        return 'done';
      }
      if (isFinalAttempt) {
        await this.repository.updateSubmission(tenantId, submissionId, {
          status: MoadianSubmissionStatus.ERROR,
          errors: [{ code: 'TRANSPORT', message: (error as Error).message }],
        });
      }
      throw error;
    }
  }

  /** استعلام وضعیت؛ تا رسیدن به SUCCESS/FAILED یا سقف `MOADIAN_MAX_POLLS` تکرار می‌شود. */
  async processPoll(data: MoadianJobData): Promise<MoadianJobOutcome> {
    if (!this.isEnabled()) {
      return 'done';
    }
    const { tenantId, submissionId } = data;
    const submission = await this.repository.findSubmissionById(tenantId, submissionId);
    if (!submission || submission.status !== MoadianSubmissionStatus.SENT) {
      return 'done';
    }

    const auth = await this.loadAuth(tenantId);
    const rows = submission.referenceNumber
      ? await this.client.inquiryByReferenceId(auth, [submission.referenceNumber])
      : await this.client.inquiryByUid(auth, [submission.uid]);
    const row =
      rows.find(
        (r) =>
          (submission.referenceNumber && r.referenceNumber === submission.referenceNumber) ||
          r.uid === submission.uid,
      ) ?? null;
    const pollCount = (submission.pollCount ?? 0) + 1;
    const now = new Date();

    if (row?.status === MoadianInquiryStatus.SUCCESS) {
      await this.repository.updateSubmission(tenantId, submissionId, {
        status: MoadianSubmissionStatus.SUCCESS,
        warnings: row.warnings,
        errors: [],
        pollCount,
        lastPolledAt: now,
      });
      return 'done';
    }
    if (row?.status === MoadianInquiryStatus.FAILED) {
      await this.repository.updateSubmission(tenantId, submissionId, {
        status: MoadianSubmissionStatus.FAILED,
        errors: row.errors,
        warnings: row.warnings,
        pollCount,
        lastPolledAt: now,
      });
      return 'done';
    }

    const maxPolls = this.numberSetting(MOADIAN_ENV.MAX_POLLS, MOADIAN_DEFAULT_MAX_POLLS);
    if (pollCount >= maxPolls) {
      await this.repository.updateSubmission(tenantId, submissionId, {
        pollCount,
        lastPolledAt: now,
        errors: [
          {
            code: 'POLL_LIMIT',
            message: `No final Moadian status after ${pollCount} inquiries (last: ${row?.status ?? 'NOT_FOUND'})`,
          },
        ],
      });
      return 'done';
    }
    await this.repository.updateSubmission(tenantId, submissionId, {
      pollCount,
      lastPolledAt: now,
    });
    await this.schedulePoll(data, pollCount);
    return 'poll';
  }
}

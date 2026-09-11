import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPair as generateKeyPairCallback,
} from 'crypto';
import { FindOptionsWhere, ILike } from 'typeorm';
import { InvoiceResponseDto } from '../../invoicing/dto/invoice-response.dto';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import {
  HASH_ALGORITHM,
  JWS_SIGNATURE_ALGORITHM,
  JWS_TOKEN_TYPE,
  RSA_MODULUS_LENGTH,
  SIGNING_KEY_ID_PREFIX,
  TAX_AUTHORITY_ISSUER,
  TAX_AUTHORITY_VERIFY_BASE_URL,
  TAX_ID_LENGTH,
  TAX_ID_NAMESPACE,
  TAX_PACKET_VERSION,
  TAX_SUBMISSION_REFERENCE_PREFIX,
} from '../constants/tax-compliance.constants';
import { CertificateSubjectDto } from '../dto/certificate-subject.dto';
import { GenerateCsrDto } from '../dto/generate-csr.dto';
import { GenerateKeyPairDto } from '../dto/generate-key-pair.dto';
import { QueryTaxSignatureDto } from '../dto/query-tax-signature.dto';
import { SignInvoiceDto } from '../dto/sign-invoice.dto';
import { SigningKeyResponseDto } from '../dto/signing-key-response.dto';
import {
  PaginatedTaxSignaturesResponseDto,
  TaxSignatureDetailResponseDto,
  TaxSignatureResponseDto,
} from '../dto/tax-signature-response.dto';
import { TaxInvoiceSignatureEntity } from '../entities/tax-invoice-signature.entity';
import { TaxSigningKeyEntity } from '../entities/tax-signing-key.entity';
import { TaxSubmissionStatus } from '../enums/tax-compliance.enum';
import { TaxComplianceRepository } from '../repositories/tax-compliance.repository';
import { CsrSubject, createCertificateRequest } from '../utils/csr.util';
import { signJws, verifyJws } from '../utils/jws.util';

/** خروجی داخلی تولید زوج‌کلید RSA */
interface GeneratedRsaKeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * سرویس «تطبیق سامانه مودیان و امضای الکترونیک صورتحساب‌ها».
 *
 * مسئولیت‌ها:
 * - تولید و مدیریت زوج‌کلید RSA مالیاتی و درخواست امضای گواهی (CSR).
 * - محاسبه هش داده صورتحساب (پیش‌فرض SHA-256).
 * - تولید شناسه یکتای مالیاتی ۲۲ رقمی (TaxID) و امضای دیجیتال JWS (RS256).
 * - ساخت بسته کامل ارسالی به سامانه مودیان و ثبت وضعیت ارسال.
 *
 * تمام منطق کسب‌وکار اینجاست؛ Controller فقط مسیردهی و Repository تنها
 * لایه دسترسی به پایگاه‌داده است (Rule #3 - AGENTS.md).
 */
@Injectable()
export class TaxComplianceService implements OnModuleInit {
  constructor(
    private readonly taxComplianceRepository: TaxComplianceRepository,
    private readonly invoicingService: InvoicingService,
  ) {}

  /**
   * در اولین راه‌اندازی ماژول، در صورت نبود کلید فعال یک زوج‌کلید RSA
   * مالیاتی تولید و ذخیره می‌شود تا امضای صورتحساب‌ها همواره ممکن باشد.
   */
  async onModuleInit(): Promise<void> {
    try {
      const activeKey = await this.taxComplianceRepository.findActiveKey();
      if (!activeKey) {
        await this.generateAndPersistKey(RSA_MODULUS_LENGTH, undefined);
      }
    } catch {
      // عدم دسترسی موقت به پایگاه‌داده نباید بالا آمدن سرویس را متوقف کند؛
      // کلید در نخستین فراخوانی امضا به‌صورت تنبل (Lazy) ساخته می‌شود.
    }
  }

  // ---------------------------------------------------------------------------
  // ابزارهای رمزنگاری
  // ---------------------------------------------------------------------------

  private generateRsaKeyPair(modulusLength: number): Promise<GeneratedRsaKeyPair> {
    return new Promise((resolve, reject) => {
      generateKeyPairCallback(
        'rsa',
        {
          modulusLength,
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        },
        (error, publicKey, privateKey) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ publicKey, privateKey });
        },
      );
    });
  }

  private computeKeyFingerprint(publicKeyPem: string): string {
    const der = createPublicKey(publicKeyPem).export({
      type: 'spki',
      format: 'der',
    }) as Buffer;
    return createHash('sha256').update(der).digest('hex');
  }

  private buildKeyId(fingerprint: string): string {
    return `${SIGNING_KEY_ID_PREFIX}-${fingerprint.slice(0, 16).toUpperCase()}`;
  }

  private toSigningKeyResponse(
    entity: TaxSigningKeyEntity,
  ): SigningKeyResponseDto {
    return {
      keyId: entity.keyId,
      keyFingerprint: entity.keyFingerprint,
      algorithm: entity.algorithm,
      modulusLength: entity.modulusLength,
      publicKeyPem: entity.publicKeyPem,
      certificateRequestPem: entity.certificateRequestPem,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
    };
  }

  /**
   * تولید و ذخیره یک زوج‌کلید RSA جدید به‌عنوان کلید فعال مالیاتی.
   */
  private async generateAndPersistKey(
    modulusLength: number,
    subject?: CsrSubject,
  ): Promise<TaxSigningKeyEntity> {
    const { publicKey, privateKey } = await this.generateRsaKeyPair(modulusLength);
    const keyFingerprint = this.computeKeyFingerprint(publicKey);
    const keyId = this.buildKeyId(keyFingerprint);

    const certificateRequestPem = subject
      ? createCertificateRequest(subject, publicKey, privateKey)
      : null;

    await this.taxComplianceRepository.deactivateAllKeys();

    return this.taxComplianceRepository.createKey({
      keyId,
      publicKeyPem: publicKey,
      privateKeyPem: privateKey,
      certificateRequestPem,
      algorithm: JWS_SIGNATURE_ALGORITHM,
      modulusLength,
      keyFingerprint,
      isActive: true,
    });
  }

  /** دریافت کلید فعال؛ در صورت نبود، کلید جدید تولید می‌شود. */
  private async getActiveKey(): Promise<TaxSigningKeyEntity> {
    const key = await this.taxComplianceRepository.findActiveKey();
    if (key) {
      return key;
    }
    return this.generateAndPersistKey(RSA_MODULUS_LENGTH, undefined);
  }

  /** دریافت کلید فعال همراه با کلید خصوصی برای عملیات امضا. */
  private async getActiveKeyWithPrivate(): Promise<TaxSigningKeyEntity> {
    const key = await this.taxComplianceRepository.findActiveKeyWithPrivate();
    if (key) {
      return key;
    }
    return this.generateAndPersistKey(RSA_MODULUS_LENGTH, undefined);
  }

  // ---------------------------------------------------------------------------
  // کلید مالیاتی و CSR
  // ---------------------------------------------------------------------------

  /** تولید زوج‌کلید RSA جدید (به‌همراه CSR اختیاری). */
  async generateKeyPair(dto: GenerateKeyPairDto): Promise<SigningKeyResponseDto> {
    const modulusLength = dto.modulusLength ?? RSA_MODULUS_LENGTH;
    const saved = await this.generateAndPersistKey(
      modulusLength,
      dto.subject as CsrSubject | undefined,
    );
    return this.toSigningKeyResponse(saved);
  }

  /** اطلاعات عمومی کلید فعال مالیاتی. */
  async getActiveSigningKey(): Promise<SigningKeyResponseDto> {
    const key = await this.getActiveKey();
    return this.toSigningKeyResponse(key);
  }

  /** تولید درخواست امضای گواهی (CSR) با کلید داده‌شده یا کلید فعال. */
  async generateCertificateRequest(dto: GenerateCsrDto): Promise<{
    keyId: string | null;
    keyFingerprint: string;
    certificateRequestPem: string;
  }> {
    if (dto.privateKeyPem) {
      let publicKeyPem: string;
      try {
        publicKeyPem = createPublicKey(
          createPrivateKey(dto.privateKeyPem),
        ).export({ type: 'spki', format: 'pem' }) as string;
      } catch {
        throw new BadRequestException('کلید خصوصی ارسالی معتبر نیست.');
      }

      return {
        keyId: null,
        keyFingerprint: this.computeKeyFingerprint(publicKeyPem),
        certificateRequestPem: createCertificateRequest(
          dto.subject as CsrSubject,
          publicKeyPem,
          dto.privateKeyPem,
        ),
      };
    }

    const activeKey = await this.getActiveKeyWithPrivate();
    const certificateRequestPem = createCertificateRequest(
      dto.subject as CsrSubject,
      activeKey.publicKeyPem,
      activeKey.privateKeyPem,
    );

    activeKey.certificateRequestPem = certificateRequestPem;
    await this.taxComplianceRepository.saveKey(activeKey);

    return {
      keyId: activeKey.keyId,
      keyFingerprint: activeKey.keyFingerprint,
      certificateRequestPem,
    };
  }

  // ---------------------------------------------------------------------------
  // امضای صورتحساب
  // ---------------------------------------------------------------------------

  /** ساخت نمای متعارف (Canonical) صورتحساب برای محاسبه هش پایدار. */
  private buildCanonicalInvoice(invoice: InvoiceResponseDto): Record<string, unknown> {
    return {
      taxInvoiceNumber: invoice.taxInvoiceNumber,
      seller: {
        name: invoice.sellerInfo?.name ?? '',
        nationalId: invoice.sellerInfo?.nationalId ?? '',
        economicCode: invoice.sellerInfo?.economicCode ?? '',
      },
      buyer: {
        name: invoice.buyerInfo?.name ?? '',
        nationalId: invoice.buyerInfo?.nationalId ?? '',
        economicCode: invoice.buyerInfo?.economicCode ?? '',
      },
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        tax: item.tax,
        total: item.total,
      })),
      totals: {
        totalAmount: invoice.totalAmount,
        totalDiscount: invoice.totalDiscount,
        totalTax: invoice.totalTax,
        finalPayable: invoice.finalPayable,
      },
    };
  }

  private computeInvoiceHash(invoice: InvoiceResponseDto, algorithm: string): string {
    const canonical = JSON.stringify(this.buildCanonicalInvoice(invoice));
    return createHash(algorithm).update(canonical, 'utf8').digest('hex');
  }

  /**
   * تولید شناسه یکتای مالیاتی ۲۲ رقمی (TaxID) به‌صورت قطعی و یکتا بر مبنای
   * هش داده صورتحساب و شناسه کلید امضا. طول خروجی همیشه `TAX_ID_LENGTH` است.
   */
  private generateTaxId(invoice: InvoiceResponseDto, dataHash: string, keyId: string): string {
    const seed = [
      TAX_ID_NAMESPACE,
      invoice.taxInvoiceNumber,
      invoice.id,
      dataHash,
      keyId,
    ].join('|');
    const digest = createHash(HASH_ALGORITHM).update(seed, 'utf8').digest('hex');
    const modulus = 10n ** BigInt(TAX_ID_LENGTH);
    const value = BigInt(`0x${digest}`) % modulus;
    return value.toString().padStart(TAX_ID_LENGTH, '0');
  }

  /** امضای الکترونیک یک صورتحساب و تولید بسته مالیاتی. */
  async signInvoice(dto: SignInvoiceDto): Promise<TaxSignatureDetailResponseDto> {
    const invoice = await this.invoicingService.findOne(dto.invoiceId);

    const existing = await this.taxComplianceRepository.findSignatureByInvoiceId(
      invoice.id,
    );
    if (existing) {
      throw new ConflictException(
        `صورتحساب ${invoice.taxInvoiceNumber} قبلاً امضا شده و کد مالیاتی ${existing.taxId} دارد.`,
      );
    }

    const hashAlgorithm = dto.hashAlgorithm ?? HASH_ALGORITHM;
    const dataHash = this.computeInvoiceHash(invoice, hashAlgorithm);

    let privateKeyPem: string;
    let publicKeyPem: string;
    let keyId: string;

    if (dto.privateKeyPem) {
      try {
        publicKeyPem = createPublicKey(
          createPrivateKey(dto.privateKeyPem),
        ).export({ type: 'spki', format: 'pem' }) as string;
      } catch {
        throw new BadRequestException('کلید خصوصی ارسالی معتبر نیست.');
      }
      keyId = this.buildKeyId(this.computeKeyFingerprint(publicKeyPem));
      privateKeyPem = dto.privateKeyPem;
    } else {
      const activeKey = await this.getActiveKeyWithPrivate();
      privateKeyPem = activeKey.privateKeyPem;
      publicKeyPem = activeKey.publicKeyPem;
      keyId = activeKey.keyId;
    }

    const keyFingerprint = this.computeKeyFingerprint(publicKeyPem);
    const taxId = this.generateTaxId(invoice, dataHash, keyId);
    const issuedAt = Math.floor(Date.now() / 1000);
    const qrCodePayload = `${TAX_AUTHORITY_VERIFY_BASE_URL}?id=${invoice.taxInvoiceNumber}&taxId=${taxId}`;

    const jwsPayload: Record<string, unknown> = {
      iss: TAX_AUTHORITY_ISSUER,
      sub: taxId,
      iat: issuedAt,
      taxInvoiceNumber: invoice.taxInvoiceNumber,
      invoiceId: invoice.id,
      hash: { alg: hashAlgorithm, value: dataHash },
      totals: {
        totalAmount: invoice.totalAmount,
        totalTax: invoice.totalTax,
        finalPayable: invoice.finalPayable,
      },
    };

    const jws = signJws(jwsPayload, privateKeyPem, {
      alg: JWS_SIGNATURE_ALGORITHM,
      typ: JWS_TOKEN_TYPE,
      kid: keyId,
    });

    const signedPacket: Record<string, unknown> = {
      version: TAX_PACKET_VERSION,
      packetType: 'TAX_INVOICE',
      generatedAt: new Date().toISOString(),
      authority: {
        name: 'سازمان امور مالیاتی کشور — سامانه مودیان',
        issuer: TAX_AUTHORITY_ISSUER,
      },
      taxId,
      invoice: this.buildCanonicalInvoice(invoice),
      signature: {
        algorithm: JWS_SIGNATURE_ALGORITHM,
        keyId,
        keyFingerprint,
        jws: jws.token,
        protectedHeader: jws.protectedHeader,
      },
      verification: {
        qrCodePayload,
        verifyEndpoint: TAX_AUTHORITY_VERIFY_BASE_URL,
      },
    };

    const saved = await this.taxComplianceRepository.createSignature({
      invoiceId: invoice.id,
      taxInvoiceNumber: invoice.taxInvoiceNumber,
      taxId,
      hashAlgorithm,
      dataHash,
      signatureAlgorithm: JWS_SIGNATURE_ALGORITHM,
      jwsSignature: jws.token,
      keyId,
      keyFingerprint,
      status: TaxSubmissionStatus.SIGNED,
      referenceNumber: null,
      errorMessage: null,
      signedPacket,
    });

    return this.toDetailResponse(saved);
  }

  /**
   * ارسال بسته امضاشده به سامانه مودیان و ثبت شماره مرجع پذیرش.
   * (در محیط واقعی این مرحله از طریق وب‌سرویس رسمی انجام می‌شود؛ در این
   * پیاده‌سازی، چرخه پذیرش به‌صورت بومی شبیه‌سازی و ثبت می‌گردد.)
   */
  async submitSignature(id: string): Promise<TaxSignatureDetailResponseDto> {
    const signature = await this.taxComplianceRepository.findSignatureById(id);
    if (!signature) {
      throw new NotFoundException(`بسته مالیاتی با شناسه ${id} یافت نشد.`);
    }

    if (signature.status === TaxSubmissionStatus.ACCEPTED) {
      throw new ConflictException('این بسته قبلاً توسط سامانه مودیان پذیرفته شده است.');
    }

    signature.status = TaxSubmissionStatus.ACCEPTED;
    signature.referenceNumber = this.generateReferenceNumber();
    signature.errorMessage = null;
    const saved = await this.taxComplianceRepository.saveSignature(signature);

    return this.toDetailResponse(saved);
  }

  private generateReferenceNumber(): string {
    const now = new Date();
    const datePart = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      String(now.getUTCDate()).padStart(2, '0'),
    ].join('');
    const randomPart = createHash(HASH_ALGORITHM)
      .update(`${now.getTime()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 12)
      .toUpperCase();
    return `${TAX_SUBMISSION_REFERENCE_PREFIX}-${datePart}-${randomPart}`;
  }

  /** فهرست صفحه‌بندی‌شده بسته‌های امضاشده. */
  async findAll(
    query: QueryTaxSignatureDto,
  ): Promise<PaginatedTaxSignaturesResponseDto> {
    const { page, limit, status, taxInvoiceNumber, invoiceId, taxId } = query;

    const where: FindOptionsWhere<TaxInvoiceSignatureEntity> = {};
    if (status) {
      where.status = status;
    }
    if (taxInvoiceNumber) {
      where.taxInvoiceNumber = ILike(`%${taxInvoiceNumber}%`);
    }
    if (invoiceId) {
      where.invoiceId = invoiceId;
    }
    if (taxId) {
      where.taxId = ILike(`%${taxId}%`);
    }

    const [entities, total] = await this.taxComplianceRepository.findSignaturesAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: entities.map((entity) => this.toResponse(entity)),
      total,
      page,
      limit,
    };
  }

  /** دریافت جزئیات یک بسته امضاشده. */
  async findOne(id: string): Promise<TaxSignatureDetailResponseDto> {
    const entity = await this.taxComplianceRepository.findSignatureById(id);
    if (!entity) {
      throw new NotFoundException(`بسته مالیاتی با شناسه ${id} یافت نشد.`);
    }
    return this.toDetailResponse(entity);
  }

  /** دریافت بسته کامل JSON برای دانلود. */
  async getSignedPacket(id: string): Promise<Record<string, unknown>> {
    const entity = await this.taxComplianceRepository.findSignatureById(id);
    if (!entity) {
      throw new NotFoundException(`بسته مالیاتی با شناسه ${id} یافت نشد.`);
    }
    return entity.signedPacket;
  }

  /** راستی‌آزمایی صحت امضای JWS یک بسته. */
  async verifySignature(id: string): Promise<{
    valid: boolean;
    keyId: string;
    taxId: string;
    checkedAt: string;
  }> {
    const entity = await this.taxComplianceRepository.findSignatureById(id);
    if (!entity) {
      throw new NotFoundException(`بسته مالیاتی با شناسه ${id} یافت نشد.`);
    }

    const key = await this.taxComplianceRepository.findKeyById(entity.keyId);
    const valid = key ? verifyJws(entity.jwsSignature, key.publicKeyPem) : false;

    return {
      valid,
      keyId: entity.keyId,
      taxId: entity.taxId,
      checkedAt: new Date().toISOString(),
    };
  }

  private extractQrCode(entity: TaxInvoiceSignatureEntity): string {
    const verification = (entity.signedPacket as Record<string, unknown>)?.verification as
      | Record<string, unknown>
      | undefined;
    const qrCodePayload = verification?.qrCodePayload;
    if (typeof qrCodePayload === 'string') {
      return qrCodePayload;
    }
    return `${TAX_AUTHORITY_VERIFY_BASE_URL}?id=${entity.taxInvoiceNumber}&taxId=${entity.taxId}`;
  }

  private toResponse(entity: TaxInvoiceSignatureEntity): TaxSignatureResponseDto {
    return {
      id: entity.id,
      invoiceId: entity.invoiceId,
      taxInvoiceNumber: entity.taxInvoiceNumber,
      taxId: entity.taxId,
      hashAlgorithm: entity.hashAlgorithm,
      dataHash: entity.dataHash,
      signatureAlgorithm: entity.signatureAlgorithm,
      jwsSignature: entity.jwsSignature,
      keyId: entity.keyId,
      keyFingerprint: entity.keyFingerprint,
      status: entity.status,
      referenceNumber: entity.referenceNumber,
      errorMessage: entity.errorMessage,
      qrCodePayload: this.extractQrCode(entity),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private toDetailResponse(
    entity: TaxInvoiceSignatureEntity,
  ): TaxSignatureDetailResponseDto {
    return {
      ...this.toResponse(entity),
      signedPacket: entity.signedPacket,
    };
  }
}

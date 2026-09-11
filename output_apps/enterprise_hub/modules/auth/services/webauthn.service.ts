import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT } from '../constants/auth.constants';
import {
  WEBAUTHN_AUTHENTICATION_CHALLENGE_PREFIX,
  WEBAUTHN_CHALLENGE_BYTES,
  WEBAUTHN_CHALLENGE_TTL_SECONDS,
  WEBAUTHN_ORIGINS_DEFAULT,
  WEBAUTHN_PUBLIC_KEY_ALGORITHMS,
  WEBAUTHN_REGISTRATION_CHALLENGE_PREFIX,
  WEBAUTHN_RP_ID_DEFAULT,
  WEBAUTHN_RP_NAME_DEFAULT,
  WEBAUTHN_TIMEOUT_MS,
} from '../constants/webauthn.constants';
import { AuthSessionDto } from '../dto/auth-session.dto';
import {
  PublicKeyCredentialParameterDto,
  WebAuthnAuthenticationOptionsRequestDto,
  WebAuthnAuthenticationOptionsResponseDto,
  WebAuthnAuthenticationVerifyRequestDto,
  WebAuthnRegistrationOptionsRequestDto,
  WebAuthnRegistrationOptionsResponseDto,
  WebAuthnRegistrationVerifyRequestDto,
  WebAuthnRegistrationVerifyResponseDto,
} from '../dto/webauthn.dto';
import { AuthServiceDomain } from '../enums/auth-service.enum';
import { RedisClient } from '../providers/redis.provider';
import { AuthRepository } from '../repositories/auth.repository';
import { PasskeyRepository } from '../repositories/passkey.repository';
import { decodeCbor } from '../utils/cbor.util';
import {
  base64UrlToBuffer,
  bufferToBase64Url,
  coseToPublicKey,
  generateChallenge,
  generateUserHandle,
  parseAuthenticatorData,
  sha256,
  verifyAssertionSignature,
} from '../utils/cose.util';
import { AuthService } from './auth.service';

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
}

interface StoredAuthenticationChallenge {
  phone: string | null;
}

/** خلاصه عمومی یک Passkey برای نمایش در پروفایل (بدون کلید عمومی). */
export interface PasskeySummary {
  id: string;
  label: string | null;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * سرویس احراز هویت Passkey / WebAuthn.
 *
 * مسئولیت‌ها:
 *   • تولید گزینه‌های ثبت و احراز هویت (شامل چالش تصادفی امن CSPRNG)
 *   • ذخیره چالش در Redis با انقضای ۹۰ ثانیه (ضد Replay)
 *   • بررسی امضای Assertion با کلید عمومی COSE و صدور سشن JWT
 *
 * تمام منطق کسب‌وکار اینجاست و دسترسی به پایگاه‌داده فقط از طریق
 * AuthRepository و PasskeyRepository انجام می‌شود (Rule #3 — AGENTS.md).
 */
@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly passkeyRepository: PasskeyRepository,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
  ) {}

  private get rpId(): string {
    return this.config.get<string>('WEBAUTHN_RP_ID', WEBAUTHN_RP_ID_DEFAULT);
  }

  private get rpName(): string {
    return this.config.get<string>(
      'WEBAUTHN_RP_NAME',
      WEBAUTHN_RP_NAME_DEFAULT,
    );
  }

  private allowedOrigins(): string[] {
    return this.config
      .get<string>('WEBAUTHN_ORIGINS', WEBAUTHN_ORIGINS_DEFAULT)
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  private registrationKey(userId: string): string {
    return `${WEBAUTHN_REGISTRATION_CHALLENGE_PREFIX}${userId}`;
  }

  private authenticationKey(challenge: string): string {
    return `${WEBAUTHN_AUTHENTICATION_CHALLENGE_PREFIX}${challenge}`;
  }

  private publicKeyParams(): PublicKeyCredentialParameterDto[] {
    return WEBAUTHN_PUBLIC_KEY_ALGORITHMS.map((alg) => ({
      type: 'public-key',
      alg,
    }));
  }

  private parseClientData(clientDataJSON: string): ClientData {
    let parsed: ClientData;
    try {
      parsed = JSON.parse(
        base64UrlToBuffer(clientDataJSON).toString('utf8'),
      ) as ClientData;
    } catch {
      throw new BadRequestException('clientDataJSON نامعتبر است.');
    }
    if (!parsed?.challenge || !parsed?.type || !parsed?.origin) {
      throw new BadRequestException('ساختار clientDataJSON نامعتبر است.');
    }
    return parsed;
  }

  private assertOrigin(origin: string): void {
    if (!this.allowedOrigins().includes(origin)) {
      throw new UnauthorizedException(
        `مبدأ درخواست WebAuthn مجاز نیست: ${origin}`,
      );
    }
  }

  private assertRpIdHash(rpIdHash: Buffer): void {
    if (!sha256(Buffer.from(this.rpId, 'utf8')).equals(rpIdHash)) {
      throw new UnauthorizedException(
        'شناسه دامنه (rpIdHash) با سرور مطابقت ندارد.',
      );
    }
  }

  private asMap(value: unknown, label: string): Map<unknown, unknown> {
    if (!(value instanceof Map)) {
      throw new BadRequestException(`${label} نامعتبر است.`);
    }
    return value;
  }

  private asByteString(value: unknown, label: string): Buffer {
    if (value instanceof Uint8Array) {
      return Buffer.from(value);
    }
    throw new BadRequestException(`${label} نامعتبر است.`);
  }

  /**
   * تولید گزینه‌های ثبت Passkey جدید (PublicKeyCredentialCreationOptions).
   * چالش تولیدشده در Redis با کلید کاربر ذخیره می‌شود.
   */
  async generateRegistrationOptions(
    dto: WebAuthnRegistrationOptionsRequestDto,
    serviceDomain: AuthServiceDomain,
  ): Promise<WebAuthnRegistrationOptionsResponseDto> {
    const { user } = await this.authRepository.findOrCreateByPhone(
      dto.phone,
      serviceDomain,
    );

    const existing = await this.passkeyRepository.findByUserId(user.id);
    const challenge = generateChallenge(WEBAUTHN_CHALLENGE_BYTES);

    await this.redis.set(
      this.registrationKey(user.id),
      challenge,
      'EX',
      WEBAUTHN_CHALLENGE_TTL_SECONDS,
    );

    this.logger.log(
      `[WEBAUTHN] چالش ثبت صادر شد | userId=${user.id} | credentials=${existing.length}`,
    );

    return {
      challenge,
      rp: { name: this.rpName, id: this.rpId },
      user: {
        id: generateUserHandle(user.id),
        name: user.phone,
        displayName: user.displayName ?? user.phone,
      },
      pubKeyCredParams: this.publicKeyParams(),
      timeout: WEBAUTHN_TIMEOUT_MS,
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        requireResidentKey: false,
        userVerification: 'preferred',
      },
      excludeCredentials: existing.map((credential) => ({
        type: 'public-key',
        id: credential.credentialId,
        transports: credential.transports
          ? credential.transports.split(',').filter(Boolean)
          : undefined,
      })),
      extensions: {},
      challengeBytes: WEBAUTHN_CHALLENGE_BYTES,
    };
  }

  /**
   * تولید گزینه‌های احراز هویت با Passkey
   * (PublicKeyCredentialRequestOptions). در صورت ارسال شماره همراه،
   * اعتبارنامه‌های همان کاربر محدود می‌شوند؛ در غیر این‌صورت Passkeyهای
   * Discoverable مجاز خواهند بود.
   */
  async generateAuthenticationOptions(
    dto: WebAuthnAuthenticationOptionsRequestDto,
  ): Promise<WebAuthnAuthenticationOptionsResponseDto> {
    let allowCredentials: WebAuthnAuthenticationOptionsResponseDto['allowCredentials'] =
      [];

    if (dto.phone) {
      const user = await this.authRepository.findByPhone(dto.phone);
      if (user) {
        const credentials = await this.passkeyRepository.findByUserId(user.id);
        allowCredentials = credentials.map((credential) => ({
          type: 'public-key',
          id: credential.credentialId,
          transports: credential.transports
            ? credential.transports.split(',').filter(Boolean)
            : undefined,
        }));
      }
    }

    const challenge = generateChallenge(WEBAUTHN_CHALLENGE_BYTES);
    const stored: StoredAuthenticationChallenge = { phone: dto.phone ?? null };

    await this.redis.set(
      this.authenticationKey(challenge),
      JSON.stringify(stored),
      'EX',
      WEBAUTHN_CHALLENGE_TTL_SECONDS,
    );

    return {
      challenge,
      rpId: this.rpId,
      timeout: WEBAUTHN_TIMEOUT_MS,
      userVerification: 'preferred',
      allowCredentials,
      allowDiscoverable: allowCredentials.length === 0,
    };
  }

  /**
   * تأیید ثبت Passkey: بررسی چالش/مبدأ، تجزیه Attestation، استخراج کلید
   * عمومی COSE و ذخیره اعتبارنامه.
   */
  async verifyRegistration(
    dto: WebAuthnRegistrationVerifyRequestDto,
  ): Promise<WebAuthnRegistrationVerifyResponseDto> {
    const user = await this.authRepository.findByPhone(dto.phone);
    if (!user) {
      throw new UnauthorizedException('کاربر برای ثبت Passkey یافت نشد.');
    }

    const key = this.registrationKey(user.id);
    const storedChallenge = await this.redis.get(key);
    await this.redis.del(key);
    if (!storedChallenge) {
      throw new UnauthorizedException(
        'چالش ثبت منقضی شده است؛ دوباره درخواست کنید.',
      );
    }

    const clientData = this.parseClientData(dto.response.clientDataJSON);
    if (clientData.type !== 'webauthn.create') {
      throw new BadRequestException('نوع عملیات ثبت Passkey نامعتبر است.');
    }
    if (clientData.challenge !== storedChallenge) {
      throw new UnauthorizedException('چالش ثبت Passkey مطابقت ندارد.');
    }
    this.assertOrigin(clientData.origin);

    const attestation = this.asMap(
      decodeCbor(base64UrlToBuffer(dto.response.attestationObject)),
      'attestationObject',
    );
    const authData = this.asByteString(attestation.get('authData'), 'authData');
    const parsed = parseAuthenticatorData(authData);

    if (!parsed.userPresent) {
      throw new UnauthorizedException(
        'حضور کاربر در Authenticator تأیید نشد.',
      );
    }
    if (
      !parsed.hasAttestedCredentialData ||
      !parsed.credentialId ||
      !parsed.credentialPublicKey
    ) {
      throw new BadRequestException(
        'دادهٔ اعتبارنامه در پاسخ Authenticator یافت نشد.',
      );
    }
    this.assertRpIdHash(parsed.rpIdHash);

    const credentialId = bufferToBase64Url(parsed.credentialId);
    if (dto.rawId && dto.rawId !== credentialId) {
      throw new BadRequestException('شناسه اعتبارنامه با rawId مطابقت ندارد.');
    }

    const coseMap = this.asMap(
      decodeCbor(parsed.credentialPublicKey),
      'credentialPublicKey',
    );
    const algorithm = Number(coseMap.get(3));
    if (!WEBAUTHN_PUBLIC_KEY_ALGORITHMS.includes(algorithm)) {
      throw new BadRequestException(
        `الگوریتم کلید عمومی پشتیبانی نمی‌شود: ${algorithm}`,
      );
    }

    const duplicate =
      await this.passkeyRepository.findByCredentialId(credentialId);
    if (duplicate) {
      throw new ConflictException('این Passkey قبلاً ثبت شده است.');
    }

    await this.passkeyRepository.create({
      userId: user.id,
      credentialId,
      publicKey: bufferToBase64Url(parsed.credentialPublicKey),
      publicKeyAlg: algorithm,
      signCount: parsed.signCount,
      transports: dto.transports?.join(',') ?? null,
      deviceType: dto.deviceType ?? null,
      backedUp: dto.backedUp ?? false,
      label: dto.label ?? null,
      lastUsedAt: new Date(),
    });

    this.logger.log(
      `[WEBAUTHN] Passkey ثبت شد | userId=${user.id} | alg=${algorithm}`,
    );

    return {
      verified: true,
      credentialId,
      algorithm,
      registeredAt: new Date().toISOString(),
    };
  }

  /**
   * تأیید احراز هویت با Passkey و صدور سشن JWT.
   * شامل بررسی چالش، مبدأ، rpIdHash و امضای Assertion.
   */
  async verifyAuthentication(
    dto: WebAuthnAuthenticationVerifyRequestDto,
  ): Promise<AuthSessionDto> {
    const clientData = this.parseClientData(dto.response.clientDataJSON);
    if (clientData.type !== 'webauthn.get') {
      throw new BadRequestException('نوع عملیات احراز هویت Passkey نامعتبر است.');
    }
    this.assertOrigin(clientData.origin);

    const challengeKey = this.authenticationKey(clientData.challenge);
    const storedRaw = await this.redis.get(challengeKey);
    await this.redis.del(challengeKey);
    if (!storedRaw) {
      throw new UnauthorizedException(
        'چالش احراز هویت منقضی شده یا نامعتبر است.',
      );
    }

    let stored: StoredAuthenticationChallenge;
    try {
      stored = JSON.parse(storedRaw) as StoredAuthenticationChallenge;
    } catch {
      throw new UnauthorizedException('چالش احراز هویت نامعتبر است.');
    }
    if (dto.phone && stored.phone && dto.phone !== stored.phone) {
      throw new UnauthorizedException('شماره همراه با چالش مطابقت ندارد.');
    }

    const credential = await this.passkeyRepository.findByCredentialId(dto.id);
    if (!credential) {
      throw new UnauthorizedException('Passkey یافت نشد.');
    }

    const authDataBuffer = base64UrlToBuffer(dto.response.authenticatorData);
    const parsed = parseAuthenticatorData(authDataBuffer);
    if (!parsed.userPresent) {
      throw new UnauthorizedException('حضور کاربر تأیید نشد.');
    }
    this.assertRpIdHash(parsed.rpIdHash);

    const clientDataBuffer = base64UrlToBuffer(dto.response.clientDataJSON);
    const publicKey = coseToPublicKey(
      base64UrlToBuffer(credential.publicKey),
      credential.publicKeyAlg,
    );

    const signatureValid = verifyAssertionSignature({
      publicKey,
      alg: credential.publicKeyAlg,
      authenticatorData: authDataBuffer,
      clientDataJSON: clientDataBuffer,
      signature: base64UrlToBuffer(dto.response.signature),
    });
    if (!signatureValid) {
      throw new UnauthorizedException('امضای Passkey معتبر نیست.');
    }

    if (credential.signCount > 0 && parsed.signCount <= credential.signCount) {
      throw new UnauthorizedException(
        'شمارنده امضا نامعتبر است؛ احتمال کلون‌شدن کلید وجود دارد.',
      );
    }

    credential.signCount = Math.max(parsed.signCount, credential.signCount);
    credential.lastUsedAt = new Date();
    if (dto.deviceType) credential.deviceType = dto.deviceType;
    if (typeof dto.backedUp === 'boolean') credential.backedUp = dto.backedUp;
    await this.passkeyRepository.save(credential);

    const user = await this.authRepository.findById(credential.userId);
    if (!user) {
      throw new UnauthorizedException('کاربر مربوط به این Passkey یافت نشد.');
    }

    const session = await this.authService.issueSessionForUser(user);

    this.logger.log(
      `[WEBAUTHN] ورود موفق با Passkey | userId=${user.id} | phone=${user.phone}`,
    );

    return session;
  }

  /**
   * فهرست Passkeyهای ثبت‌شده کاربر (بدون افشای کلید عمومی) برای پروفایل.
   */
  async listCredentials(phone: string): Promise<PasskeySummary[]> {
    const user = await this.authRepository.findByPhone(phone);
    if (!user) {
      throw new UnauthorizedException('کاربر یافت نشد.');
    }
    const credentials = await this.passkeyRepository.findByUserId(user.id);
    return credentials.map((credential) => ({
      id: credential.credentialId,
      label: credential.label,
      deviceType: credential.deviceType,
      backedUp: credential.backedUp,
      createdAt: credential.createdAt,
      lastUsedAt: credential.lastUsedAt,
    }));
  }
}

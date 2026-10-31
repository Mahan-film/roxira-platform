import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, scryptSync } from 'crypto';
import { TotpRepository } from '../repositories/totp.repository';
import {
  base32Decode, base32Encode, decryptSecret, encryptSecret, otpauthUri, verifyTotp,
} from '../utils/totp.util';

const RECOVERY_CODES = 10;
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const normaliseRecovery = (v: string): string => v.replace(/[\s-]/g, '').toLowerCase();

/**
 * TOTP second factor (RFC 6238) with one-time recovery codes. The secret is
 * encrypted at rest (AES-256-GCM, key from TOTP_ENC_KEY, falling back to a key
 * derived from JWT_SECRET); recovery codes are stored as SHA-256 only.
 */
@Injectable()
export class TotpService {
  private key: Buffer | null = null;

  constructor(
    private readonly repo: TotpRepository,
    private readonly config: ConfigService,
  ) {}

  private encKey(): Buffer {
    if (!this.key) {
      const material = this.config.get<string>('TOTP_ENC_KEY') || this.config.getOrThrow<string>('JWT_SECRET');
      this.key = scryptSync(material, 'roxira-totp-v1', 32);
    }
    return this.key;
  }

  async isEnabled(userId: string): Promise<boolean> {
    return (await this.repo.find(userId))?.enabled === true;
  }

  /** Start enrolment: returns the secret once for the authenticator app. Not active until confirmed. */
  async begin(userId: string, account: string): Promise<{ secret: string; otpauthUri: string }> {
    const existing = await this.repo.find(userId);
    if (existing?.enabled) throw new ConflictException('Two-factor sign-in is already enabled.');
    const secret = base32Encode(randomBytes(20));
    await this.repo.save({
      userId,
      secretEnc: encryptSecret(secret, this.encKey()),
      enabled: false,
      recoveryHashes: [],
      lastUsedStep: null,
      enabledAt: null,
    });
    return { secret, otpauthUri: otpauthUri(secret, account) };
  }

  /** Confirm with a live code; returns the recovery codes (shown once). */
  async confirm(userId: string, code: string): Promise<string[]> {
    const row = await this.repo.find(userId);
    if (!row || row.enabled) throw new BadRequestException('Start setup first.');
    const step = verifyTotp(base32Decode(decryptSecret(row.secretEnc, this.encKey())), code, Date.now(), null);
    if (step === null) throw new UnauthorizedException('That code is not correct.');
    const codes = Array.from({ length: RECOVERY_CODES }, () => {
      const h = randomBytes(5).toString('hex');
      return `${h.slice(0, 5)}-${h.slice(5)}`;
    });
    await this.repo.save({
      ...row,
      enabled: true,
      enabledAt: new Date(),
      lastUsedStep: String(step),
      recoveryHashes: codes.map((c) => sha256(normaliseRecovery(c))),
    });
    return codes;
  }

  /** Accept a current TOTP code or an unused recovery code. */
  async verify(userId: string, code: string): Promise<boolean> {
    const row = await this.repo.find(userId);
    if (!row?.enabled) return false;
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed)) {
      const last = row.lastUsedStep === null ? null : Number(row.lastUsedStep);
      const step = verifyTotp(base32Decode(decryptSecret(row.secretEnc, this.encKey())), trimmed, Date.now(), last);
      return step !== null && (await this.repo.advanceStep(userId, step, row.lastUsedStep));
    }
    const hash = sha256(normaliseRecovery(trimmed));
    if (!row.recoveryHashes.includes(hash)) return false;
    row.recoveryHashes = row.recoveryHashes.filter((h) => h !== hash);
    await this.repo.save(row);
    return true;
  }

  async disable(userId: string, code: string): Promise<void> {
    if (!(await this.verify(userId, code))) throw new UnauthorizedException('That code is not correct.');
    await this.repo.remove(userId);
  }
}

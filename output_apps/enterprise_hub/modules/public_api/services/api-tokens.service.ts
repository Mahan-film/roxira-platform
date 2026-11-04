import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  LAST_USED_REFRESH_MS,
  MAX_ACTIVE_TOKENS_PER_TENANT,
  TOKEN_PREFIX,
  TOKEN_REGEX,
} from '../constants/public-api.constants';
import { ApiTokenResponseDto, CreateApiTokenDto, CreatedApiTokenResponseDto } from '../dto/api-token.dto';
import { ApiTokenEntity } from '../entities/api-token.entity';
import { ApiTokensRepository } from '../repositories/api-tokens.repository';

/** What the guard attaches to the request after a token passes. */
export interface ApiPrincipal {
  tenantId: string;
  tokenId: number;
  scopes: string[];
  rateLimitPerMinute: number;
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

@Injectable()
export class ApiTokensService {
  constructor(private readonly repository: ApiTokensRepository) {}

  async create(tenantId: string, userId: string, dto: CreateApiTokenDto): Promise<CreatedApiTokenResponseDto> {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('تاریخ انقضا باید در آینده باشد.');
    }
    if ((await this.repository.countActive(tenantId)) >= MAX_ACTIVE_TOKENS_PER_TENANT) {
      throw new BadRequestException(`حداکثر ${MAX_ACTIVE_TOKENS_PER_TENANT} توکن فعال مجاز است؛ ابتدا یکی را باطل کنید.`);
    }
    const token = `${TOKEN_PREFIX}_${tenantId}_${randomBytes(32).toString('base64url')}`;
    const row = await this.repository.create(tenantId, {
      name: dto.name.trim(),
      tokenPrefix: token.slice(0, 12),
      tokenHash: hashToken(token),
      scopes: [...dto.scopes],
      rateLimitPerMinute: dto.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE,
      createdBy: userId,
      expiresAt,
    });
    return { ...this.toDto(row), token };
  }

  async list(tenantId: string): Promise<ApiTokenResponseDto[]> {
    return (await this.repository.list(tenantId)).map((r) => this.toDto(r));
  }

  async revoke(tenantId: string, id: number): Promise<void> {
    if (!(await this.repository.revoke(tenantId, id, new Date()))) {
      throw new NotFoundException('توکن یافت نشد.');
    }
  }

  /**
   * Resolves a plain token to its principal, or null (unknown, malformed, revoked or expired).
   * The tenant id inside the token only selects which tenant's rows to search; the stored hash is
   * what authenticates, compared in constant time.
   */
  async authenticate(plain: string, now = new Date()): Promise<ApiPrincipal | null> {
    const match = TOKEN_REGEX.exec(plain);
    if (!match) return null;
    const tenantId = match[1].toLowerCase();
    const hash = hashToken(plain);
    const row = await this.repository.findByHash(tenantId, hash);
    if (!row || row.tenantId !== tenantId) return null;
    if (!timingSafeEqual(Buffer.from(row.tokenHash), Buffer.from(hash))) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_REFRESH_MS) {
      void this.repository.touch(tenantId, row.id, now).catch(() => undefined);
    }
    return { tenantId, tokenId: row.id, scopes: row.scopes, rateLimitPerMinute: row.rateLimitPerMinute };
  }

  private toDto(r: ApiTokenEntity): ApiTokenResponseDto {
    return {
      id: r.id,
      name: r.name,
      tokenPrefix: r.tokenPrefix,
      scopes: r.scopes,
      rateLimitPerMinute: r.rateLimitPerMinute,
      expiresAt: iso(r.expiresAt),
      revokedAt: iso(r.revokedAt),
      lastUsedAt: iso(r.lastUsedAt),
      createdAt: r.createdAt.toISOString(),
    };
  }
}

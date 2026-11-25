import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PasskeyCredentialEntity } from '../entities/passkey-credential.entity';

/**
 * لایه Repository اعتبارنامه‌های Passkey — تنها نقطه دسترسی به جدول
 * `auth_passkey_credentials` (Rule #3 — AGENTS.md).
 */
@Injectable()
export class PasskeyRepository {
  constructor(
    @InjectRepository(PasskeyCredentialEntity)
    private readonly repository: Repository<PasskeyCredentialEntity>,
  ) {}

  private withUserScope<T>(
    userId: string,
    fn: (repo: Repository<PasskeyCredentialEntity>) => Promise<T>,
  ): Promise<T> {
    return this.repository.manager.transaction(async (em) => {
      await em.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      return fn(em.getRepository(PasskeyCredentialEntity));
    });
  }

  async findByCredentialId(
    credentialId: string,
  ): Promise<PasskeyCredentialEntity | null> {
    const rows = await this.repository.query(
      `SELECT id, user_id, credential_id, public_key, public_key_alg, sign_count,
              transports, device_type, backed_up, label, last_used_at, created_at
       FROM public.lookup_passkey_by_credential_id($1)`,
      [credentialId],
    );
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return this.repository.create({
      id: r.id,
      userId: r.user_id,
      credentialId: r.credential_id,
      publicKey: r.public_key,
      publicKeyAlg: Number(r.public_key_alg),
      signCount: Number(r.sign_count),
      transports: r.transports,
      deviceType: r.device_type,
      backedUp: Boolean(r.backed_up),
      label: r.label,
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
    });
  }

  async findByUserId(userId: string): Promise<PasskeyCredentialEntity[]> {
    return this.withUserScope(userId, (r) =>
      r.find({
        where: { userId },
        order: { createdAt: 'DESC' },
      }),
    );
  }

  async create(
    data: Partial<PasskeyCredentialEntity>,
  ): Promise<PasskeyCredentialEntity> {
    if (!data.userId) {
      throw new Error('PasskeyRepository.create requires userId for RLS scope');
    }
    return this.withUserScope(data.userId, (r) => r.save(r.create(data)));
  }

  async save(
    entity: PasskeyCredentialEntity,
  ): Promise<PasskeyCredentialEntity> {
    if (!entity.userId) {
      throw new Error('PasskeyRepository.save requires userId for RLS scope');
    }
    return this.withUserScope(entity.userId, (r) => r.save(entity));
  }
}

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

  async findByCredentialId(
    credentialId: string,
  ): Promise<PasskeyCredentialEntity | null> {
    return this.repository.findOne({ where: { credentialId } });
  }

  async findByUserId(userId: string): Promise<PasskeyCredentialEntity[]> {
    return this.repository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    data: Partial<PasskeyCredentialEntity>,
  ): Promise<PasskeyCredentialEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async save(
    entity: PasskeyCredentialEntity,
  ): Promise<PasskeyCredentialEntity> {
    return this.repository.save(entity);
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { TenantScope } from '../../../access/services/tenant-scope';
import { ReceiptBotLinkCodeEntity } from '../entities/receipt-bot-link-code.entity';
import { ReceiptBotUserLinkEntity } from '../entities/receipt-bot-user-link.entity';

export interface TelegramLinkedUser {
  tenantId: string;
  userId: string;
  defaultKind: 'petty_cash' | 'purchase';
  telegramUsername?: string | null;
}

@Injectable()
export class ReceiptBotRepository {
  constructor(
    @InjectRepository(ReceiptBotLinkCodeEntity)
    private readonly codesRepo: Repository<ReceiptBotLinkCodeEntity>,
    @InjectRepository(ReceiptBotUserLinkEntity)
    private readonly linksRepo: Repository<ReceiptBotUserLinkEntity>,
    private readonly tenantScope: TenantScope,
  ) {}

  async createLinkCode(
    tenantId: string,
    userId: string,
    code: string,
    expiresAt: Date,
  ): Promise<ReceiptBotLinkCodeEntity> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager.getRepository(ReceiptBotLinkCodeEntity);
      // Clean up previous unconsumed codes for this user
      await repo.delete({ tenantId, userId, usedAt: IsNull() });

      const entity = repo.create({
        tenantId,
        userId,
        code,
        expiresAt,
        usedAt: null,
      });
      return repo.save(entity);
    });
  }

  async findActiveCode(tenantId: string, userId: string): Promise<ReceiptBotLinkCodeEntity | null> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager.getRepository(ReceiptBotLinkCodeEntity);
      return repo.findOne({
        where: {
          tenantId,
          userId,
          usedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
        order: { createdAt: 'DESC' },
      });
    });
  }

  async findLinkByTenantUser(
    tenantId: string,
    userId: string,
  ): Promise<ReceiptBotUserLinkEntity | null> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager.getRepository(ReceiptBotUserLinkEntity);
      return repo.findOne({ where: { tenantId, userId } });
    });
  }

  async unlink(tenantId: string, userId: string): Promise<boolean> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager.getRepository(ReceiptBotUserLinkEntity);
      const res = await repo.delete({ tenantId, userId });
      return (res.affected ?? 0) > 0;
    });
  }

  async updatePreferences(
    tenantId: string,
    userId: string,
    defaultKind: 'petty_cash' | 'purchase',
  ): Promise<ReceiptBotUserLinkEntity | null> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const repo = manager.getRepository(ReceiptBotUserLinkEntity);
      await repo.update({ tenantId, userId }, { defaultKind, updatedAt: new Date() });
      return repo.findOne({ where: { tenantId, userId } });
    });
  }

  /**
   * Pre-tenant lookup executed during incoming Telegram webhooks.
   * Uses the SECURITY DEFINER function so non-superuser roxira_app role can safely resolve
   * which tenant and user own this Telegram ID.
   */
  async lookupLinkByTelegramId(telegramUserId: string): Promise<TelegramLinkedUser | null> {
    const raw = await this.linksRepo.query(
      `SELECT tenant_id, user_id, default_kind, telegram_username FROM receipt_bot_lookup_link($1)`,
      [String(telegramUserId)],
    );
    if (!raw || raw.length === 0) return null;
    const row = raw[0];
    return {
      tenantId: row.tenant_id,
      userId: row.user_id,
      defaultKind: row.default_kind as 'petty_cash' | 'purchase',
      telegramUsername: row.telegram_username,
    };
  }

  /**
   * Consumes a link code and binds the Telegram user.
   * Atomically marks the code as used and updates the link using SECURITY DEFINER function.
   */
  async consumeCode(
    code: string,
    telegramUserId: string,
    telegramUsername?: string,
  ): Promise<TelegramLinkedUser | null> {
    const raw = await this.codesRepo.query(
      `SELECT tenant_id, user_id, default_kind FROM receipt_bot_consume_code($1, $2, $3)`,
      [code.trim(), String(telegramUserId), telegramUsername ?? null],
    );
    if (!raw || raw.length === 0) return null;
    const row = raw[0];
    return {
      tenantId: row.tenant_id,
      userId: row.user_id,
      defaultKind: row.default_kind as 'petty_cash' | 'purchase',
      telegramUsername: telegramUsername ?? null,
    };
  }

  /**
   * Idempotency guard for webhook deliveries. Returns true the first time an (bot, update_id)
   * pair is seen and false for every retry. Pre-tenant, via a SECURITY DEFINER function.
   */
  async claimUpdate(botId: string, updateId: number): Promise<boolean> {
    const raw = await this.codesRepo.query(
      `SELECT receipt_bot_claim_update($1, $2) AS claimed`,
      [botId, String(updateId)],
    );
    return raw?.[0]?.claimed === true;
  }
}

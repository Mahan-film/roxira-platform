import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { fromDb, fromMinor } from '../../accounting/money';
import { StatutoryService } from '../../hr/statutory/statutory.service';
import { PostingRuleError } from '../../posting_rules/domain/posting-error';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { ContractEntity } from '../entities/contract.entity';
import { ContractMovementEntity } from '../entities/contract-movement.entity';
import { ContractSide, ContractStatus } from '../enums/contracting.enum';
import { ContractRepository } from '../repositories/contract.repository';
import { MovementRepository } from '../repositories/movement.repository';
import { percentOf, requireRate, termUse, UnclearTermError } from '../statements/deductions';
import { moneyToColumn } from './project.service';

export const MOVEMENT_SOURCE = 'contract_movement';
const DOC_TYPE = {
  advance: { [ContractSide.CONTRACTOR]: 'contract.advance.contractor', [ContractSide.EMPLOYER]: 'contract.advance.employer' },
  retention_release: { [ContractSide.CONTRACTOR]: 'contract.retention_release.contractor', [ContractSide.EMPLOYER]: 'contract.retention_release.employer' },
} as const;

export interface MovementRequest {
  date: string;
  amount: string;
  /** Client-chosen key: sending the same request again returns the first result and posts nothing. */
  requestKey?: string;
}

export interface MovementResponse {
  id: number;
  contractId: number;
  kind: 'advance' | 'retention_release';
  date: string;
  amount: number | string;
  journalEntryId: number | null;
  journalEntryNumber: string | null;
  termsUsed: unknown[];
  replayed: boolean;
}

const toResponse = (m: ContractMovementEntity, replayed: boolean): MovementResponse => ({
  id: m.id,
  contractId: m.contractId,
  kind: m.kind,
  date: String(m.movementDate),
  amount: fromMinor(fromDb(m.amount)),
  journalEntryId: m.journalEntryId ?? null,
  journalEntryNumber: m.journalEntryNumber ?? null,
  termsUsed: (m.termsSnapshot as unknown[]) ?? [],
  replayed,
});

/** Advance payments and retention releases of an active contract; each is created and posted in one transaction. */
@Injectable()
export class MovementService {
  constructor(
    private readonly movements: MovementRepository,
    private readonly contracts: ContractRepository,
    private readonly postingRules: PostingRulesService,
    private readonly statutory: StatutoryService,
  ) {}

  async list(tenantId: string, contractId: number): Promise<MovementResponse[]> {
    if (!(await this.contracts.findById(tenantId, contractId))) throw new NotFoundException('قرارداد یافت نشد.');
    return (await this.movements.list(tenantId, contractId)).map((m) => toResponse(m, false));
  }

  /**
   * Advance: at most the contract's agreed advance, and at most the statutory cap x contract amount.
   * The cap figure is read from the store; when it is unclear the advance is refused (never unlimited).
   */
  advance(tenantId: string, contractId: number, req: MovementRequest): Promise<MovementResponse> {
    return this.run(tenantId, contractId, 'advance', req, async (contract, amount, manager) => {
      const terms = await this.statutory.contractTermsOn(tenantId, req.date);
      const cap = percentOf(fromDb(contract.amount), requireRate(terms.advancePaymentMax));
      const already = await this.movements.sum(tenantId, contractId, 'advance', manager);
      if (already + amount > fromDb(contract.advanceAmount)) throw new BadRequestException('پیش‌پرداخت از مبلغ توافق‌شده در قرارداد بیشتر است.');
      if (already + amount > cap) throw new BadRequestException('پیش‌پرداخت از سقف قانونی بیشتر است.');
      return [termUse(terms.advancePaymentMax)];
    });
  }

  /** Release of retention: at most what posted statements withheld minus what was already released. */
  releaseRetention(tenantId: string, contractId: number, req: MovementRequest): Promise<MovementResponse> {
    return this.run(tenantId, contractId, 'retention_release', req, async (_contract, amount, manager) => {
      const held = await this.movements.retentionHeld(tenantId, contractId, manager);
      const released = await this.movements.sum(tenantId, contractId, 'retention_release', manager);
      if (released + amount > held) throw new BadRequestException('مبلغ آزادسازی از سپرده نگهداری‌شده بیشتر است.');
      return [];
    });
  }

  private run(
    tenantId: string,
    contractId: number,
    kind: 'advance' | 'retention_release',
    req: MovementRequest,
    check: (contract: ContractEntity, amount: bigint, manager: EntityManager) => Promise<unknown[]>,
  ): Promise<MovementResponse> {
    return this.movements.runInTransaction(tenantId, async (manager) => {
      await manager.query(`SELECT "id" FROM "erp_contracts" WHERE "tenant_id" = $1 AND "id" = $2 FOR UPDATE`, [tenantId, contractId]);
      const contract = await this.contracts.findById(tenantId, contractId, manager);
      if (!contract) throw new NotFoundException('قرارداد یافت نشد.');
      if (contract.status !== ContractStatus.ACTIVE) throw new ConflictException('فقط قرارداد فعال را می‌توان استفاده کرد.');
      if (req.requestKey) {
        const existing = await this.movements.findByKey(tenantId, contractId, kind, req.requestKey, manager);
        if (existing) return toResponse(existing, true);
      }
      const column = moneyToColumn(req.amount);
      const amount = fromDb(column);
      if (amount <= 0n) throw new BadRequestException('مبلغ باید بزرگ‌تر از صفر باشد.');
      let used: unknown[];
      try {
        used = await check(contract, amount, manager);
      } catch (error) {
        if (error instanceof UnclearTermError) throw new UnprocessableEntityException(error.message);
        throw error;
      }
      const row = await this.movements.insert(tenantId, { contractId, kind, movementDate: req.date, amount: column, requestKey: req.requestKey ?? null, termsSnapshot: used }, manager);
      try {
        const posted = await this.postingRules.post(
          tenantId,
          {
            docType: DOC_TYPE[kind][contract.side],
            sourceType: MOVEMENT_SOURCE,
            sourceId: String(row.id),
            date: req.date,
            description: `${kind === 'advance' ? 'پیش‌پرداخت' : 'آزادسازی سپرده'} قرارداد ${contract.code}`,
            partyCode: contract.partyCode,
            amounts: { amount },
          },
          manager,
        );
        await this.movements.attachJournal(tenantId, row.id, { journalEntryId: posted.entryId, journalEntryNumber: posted.entryNumber }, manager);
        return toResponse({ ...row, journalEntryId: posted.entryId, journalEntryNumber: posted.entryNumber }, false);
      } catch (error) {
        if (error instanceof PostingRuleError) throw new ConflictException(error.message);
        throw error;
      }
    });
  }
}

import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { AccountType } from '../../accounting/enums/accounting.enum';
import { minorToDecimal } from '../../accounting/money';
import { AccountingService } from '../../accounting/services/accounting.service';
import { TREASURY_ACCOUNT_DEFINITIONS } from '../constants/treasury.constants';
import {
  AdvanceAllocationInput,
  DocumentPostingInput,
  TreasuryLine,
  buildAdvanceAllocationLines,
  buildDocumentLines,
} from './treasury-lines';
import { PostingContext, TreasuryPostingPort } from './treasury-posting.port';

/**
 * Posts treasury documents straight to the ledger through `AccountingService.createJournalEntry`.
 * The interim implementation of `TreasuryPostingPort`: replace it with an adapter over
 * `modules/posting_rules` by changing one provider in `treasury.module.ts`.
 */
@Injectable()
export class TreasuryLedgerPostingAdapter implements TreasuryPostingPort {
  constructor(private readonly accountingService: AccountingService) {}

  async postDocument(
    tenantId: string,
    context: PostingContext,
    input: DocumentPostingInput,
    manager: EntityManager,
  ): Promise<number> {
    return this.post(tenantId, context, 'doc', buildDocumentLines(input), manager);
  }

  async postAdvanceAllocation(
    tenantId: string,
    context: PostingContext,
    input: AdvanceAllocationInput,
    manager: EntityManager,
  ): Promise<number> {
    return this.post(tenantId, context, 'adv', buildAdvanceAllocationLines(input), manager);
  }

  private async post(
    tenantId: string,
    context: PostingContext,
    marker: string,
    lines: TreasuryLine[],
    manager: EntityManager,
  ): Promise<number> {
    await this.ensureAccounts(tenantId);
    const entry = await this.accountingService.createJournalEntry(
      tenantId,
      {
        entryNumber: `TRS-${context.docNumber}-${marker}-${randomUUID().slice(0, 8)}`,
        date: `${context.date}T00:00:00.000Z`,
        description: context.description,
        lines: lines.map((l) => ({
          accountCode: l.accountCode,
          debit: minorToDecimal(l.debit),
          credit: minorToDecimal(l.credit),
          partyCode: l.partyCode,
        })),
      },
      manager,
    );
    return entry.id;
  }

  /** Same approach as the cheques module: checked against the live chart on every call. */
  private async ensureAccounts(tenantId: string): Promise<void> {
    const existing = new Set((await this.accountingService.listAccounts(tenantId)).map((a) => a.code));
    for (const definition of TREASURY_ACCOUNT_DEFINITIONS) {
      if (existing.has(definition.code)) continue;
      try {
        await this.accountingService.createAccount(tenantId, {
          code: definition.code,
          name: definition.name,
          accountType: definition.accountType as AccountType,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }
  }
}

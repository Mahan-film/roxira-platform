import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { AccountType } from '../../accounting/enums/accounting.enum';
import { AccountingService } from '../../accounting/services/accounting.service';
import { VariableLineInput } from '../../posting_rules/domain/posting-engine';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { TREASURY_ACCOUNT_DEFINITIONS } from '../constants/treasury.constants';
import { TreasuryDocKind } from '../enums/treasury.enum';
import { AdvanceAllocationInput, DocumentPostingInput } from './treasury-lines';
import { PostingContext, TreasuryPostingPort } from './treasury-posting.port';

/** The posting-rules template of each treasury document kind. */
const DOC_TYPE: Record<TreasuryDocKind, string> = {
  [TreasuryDocKind.RECEIPT]: 'bank.receipt',
  [TreasuryDocKind.PAYMENT]: 'bank.payment',
};

function isDuplicateAccountError(error: unknown): boolean {
  if (error instanceof ConflictException) return true;
  const err = error as { code?: string; driverError?: { code?: string } } | null;
  return err?.code === '23505' || err?.driverError?.code === '23505';
}

/**
 * The `TreasuryPostingPort` implementation over `modules/posting_rules`: it ensures required
 * treasury accounts exist in the tenant's chart, maps a treasury document or advance allocation
 * to variable lines on `bank.receipt` / `bank.payment`, and lets the engine resolve tenant role
 * mappings, validate the voucher, protect against duplicate source replays, and write it inside
 * the caller's transaction.
 */
@Injectable()
export class TreasuryPostingRulesAdapter implements TreasuryPostingPort {
  constructor(
    private readonly postingRules: PostingRulesService,
    private readonly accountingService: AccountingService,
    private readonly tenantScope: TenantScope,
  ) {}

  async postDocument(
    tenantId: string,
    context: PostingContext,
    input: DocumentPostingInput,
    manager: EntityManager,
  ): Promise<number> {
    await this.ensureAccounts(tenantId, manager);
    const receipt = input.kind === TreasuryDocKind.RECEIPT;
    const variableLines: VariableLineInput[] = [];

    for (const fund of input.funds) {
      if (fund.amount === 0n) continue;
      variableLines.push({
        role: 'bank',
        side: receipt ? 'debit' : 'credit',
        amount: fund.amount,
        ...(fund.accountCode ? { accountCode: fund.accountCode } : {}),
      });
    }

    if (input.writeoff !== 0n) {
      variableLines.push({
        role: receipt ? 'writeoff_receipt' : 'writeoff_payment',
        side: receipt ? 'debit' : 'credit',
        amount: input.writeoff,
      });
    }

    const partyNet = input.applied + input.writeoff - input.chequeTotal;
    if (partyNet > 0n) {
      variableLines.push({
        role: receipt ? 'receivable' : 'payable',
        side: receipt ? 'credit' : 'debit',
        amount: partyNet,
        partyCode: input.partyCode,
      });
    } else if (partyNet < 0n) {
      variableLines.push({
        role: receipt ? 'receivable' : 'payable',
        side: receipt ? 'debit' : 'credit',
        amount: -partyNet,
        partyCode: input.partyCode,
      });
    }

    if (input.advance !== 0n) {
      variableLines.push({
        role: receipt ? 'customer_advances' : 'supplier_advances',
        side: receipt ? 'credit' : 'debit',
        amount: input.advance,
        partyCode: input.partyCode,
      });
    }

    const result = await this.postingRules.post(
      tenantId,
      {
        docType: DOC_TYPE[input.kind],
        sourceType: 'treasury_document',
        sourceId: `${context.docNumber}:${input.kind}`,
        date: `${context.date}T00:00:00.000Z`,
        amounts: {},
        variableLines,
        description: context.description,
        partyCode: input.partyCode,
        entryNumber: `TRS-${context.docNumber}-doc`,
      },
      manager,
    );
    return result.entryId;
  }

  async postAdvanceAllocation(
    tenantId: string,
    context: PostingContext,
    input: AdvanceAllocationInput,
    manager: EntityManager,
  ): Promise<number> {
    await this.ensureAccounts(tenantId, manager);
    const receipt = input.kind === TreasuryDocKind.RECEIPT;
    const settled = input.applied + input.writeoff;
    const variableLines: VariableLineInput[] = [];

    if (receipt) {
      if (input.applied !== 0n) {
        variableLines.push({
          role: 'customer_advances',
          side: 'debit',
          amount: input.applied,
          partyCode: input.partyCode,
        });
      }
      if (input.writeoff !== 0n) {
        variableLines.push({
          role: 'writeoff_receipt',
          side: 'debit',
          amount: input.writeoff,
        });
      }
      if (settled !== 0n) {
        variableLines.push({
          role: 'receivable',
          side: 'credit',
          amount: settled,
          partyCode: input.partyCode,
        });
      }
    } else {
      if (settled !== 0n) {
        variableLines.push({
          role: 'payable',
          side: 'debit',
          amount: settled,
          partyCode: input.partyCode,
        });
      }
      if (input.applied !== 0n) {
        variableLines.push({
          role: 'supplier_advances',
          side: 'credit',
          amount: input.applied,
          partyCode: input.partyCode,
        });
      }
      if (input.writeoff !== 0n) {
        variableLines.push({
          role: 'writeoff_payment',
          side: 'credit',
          amount: input.writeoff,
        });
      }
    }

    const result = await this.postingRules.post(
      tenantId,
      {
        docType: DOC_TYPE[input.kind],
        sourceType: 'treasury_advance_allocation',
        sourceId: `${context.docNumber}:${input.kind}`,
        date: `${context.date}T00:00:00.000Z`,
        amounts: {},
        variableLines,
        description: context.description,
        partyCode: input.partyCode,
        entryNumber: `TRS-${context.docNumber}-adv`,
      },
      manager,
    );
    return result.entryId;
  }

  /** Creates any missing treasury accounts in the tenant's chart before the engine validates them. */
  private async ensureAccounts(tenantId: string, manager: EntityManager): Promise<void> {
    await this.tenantScope.within(tenantId, manager, async () => {
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
          if (!isDuplicateAccountError(error)) throw error;
        }
      }
    });
  }
}

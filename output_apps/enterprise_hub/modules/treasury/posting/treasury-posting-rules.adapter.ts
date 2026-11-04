import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { TREASURY_ACCOUNTS } from '../constants/treasury.constants';
import { TreasuryDocKind } from '../enums/treasury.enum';
import { AdvanceAllocationInput, DocumentPostingInput, FundLine } from './treasury-lines';
import { PostingContext, TreasuryPostingPort } from './treasury-posting.port';

/** The posting-rules template of each treasury document kind. */
const DOC_TYPE: Record<TreasuryDocKind, string> = {
  [TreasuryDocKind.RECEIPT]: 'bank.receipt',
  [TreasuryDocKind.PAYMENT]: 'bank.payment',
};

/** The party account the document settles: receivable on a receipt, payable on a payment. */
const PARTY_ACCOUNT: Record<TreasuryDocKind, string> = {
  [TreasuryDocKind.RECEIPT]: TREASURY_ACCOUNTS.RECEIVABLES,
  [TreasuryDocKind.PAYMENT]: TREASURY_ACCOUNTS.PAYABLES,
};

/** The advance account: customer advances on a receipt, supplier advances on a payment. */
const ADVANCE_ACCOUNT: Record<TreasuryDocKind, string> = {
  [TreasuryDocKind.RECEIPT]: TREASURY_ACCOUNTS.CUSTOMER_ADVANCES,
  [TreasuryDocKind.PAYMENT]: TREASURY_ACCOUNTS.SUPPLIER_ADVANCES,
};

/**
 * The `TreasuryPostingPort` implementation over `modules/posting_rules`: it maps a treasury
 * document to the engine's `bank.receipt` / `bank.payment` template and lets the engine resolve
 * the accounts, validate the voucher and write it inside the caller's transaction.
 *
 * The engine's template is two lines (a money account against the party), so this adapter accepts
 * the document shapes that map onto it one-to-one and refuses the rest with a clear error rather
 * than posting a wrong voucher: a single fund account, no cheque line (the cheques module posts
 * its own entry) and no write-off. A fully applied document posts the fund against the party
 * account; a document left entirely as an advance posts the fund against the advance account. The
 * interim `TreasuryLedgerPostingAdapter` stays the wired implementation until the engine's
 * templates cover mixed funds, cheques and write-offs.
 */
@Injectable()
export class TreasuryPostingRulesAdapter implements TreasuryPostingPort {
  constructor(private readonly postingRules: PostingRulesService) {}

  async postDocument(
    tenantId: string,
    context: PostingContext,
    input: DocumentPostingInput,
    manager: EntityManager,
  ): Promise<number> {
    if (input.writeoff !== 0n) throw new BadRequestException('ثبت تخفیف از طریق موتور قواعد ثبت هنوز پشتیبانی نمی‌شود.');
    if (input.chequeTotal !== 0n) throw new BadRequestException('سند دارای چک باید از طریق ماژول چک ثبت شود؛ موتور قواعد ثبت هنوز این حالت را پشتیبانی نمی‌کند.');
    if (input.applied > 0n && input.advance > 0n) {
      throw new BadRequestException('ثبت همزمان تخصیص و پیش‌پرداخت/پیش‌دریافت از طریق موتور قواعد ثبت هنوز پشتیبانی نمی‌شود.');
    }

    const { account, amount } = this.singleFund(input.funds);
    const counter = input.advance > 0n ? ADVANCE_ACCOUNT[input.kind] : PARTY_ACCOUNT[input.kind];
    const marker = randomUUID().slice(0, 8);
    const result = await this.postingRules.post(
      tenantId,
      {
        docType: DOC_TYPE[input.kind],
        sourceType: 'treasury_document',
        sourceId: `${context.docNumber}-${marker}`,
        date: `${context.date}T00:00:00.000Z`,
        amounts: { amount },
        description: context.description,
        partyCode: input.partyCode,
        overrides: { bank: account, counter },
        entryNumber: `TRS-${context.docNumber}-doc-${marker}`,
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
    if (input.writeoff !== 0n) throw new BadRequestException('ثبت تخفیف در تخصیص پیش‌پرداخت/پیش‌دریافت از طریق موتور قواعد ثبت هنوز پشتیبانی نمی‌شود.');

    const marker = randomUUID().slice(0, 8);
    const result = await this.postingRules.post(
      tenantId,
      {
        docType: DOC_TYPE[input.kind],
        sourceType: 'treasury_advance_allocation',
        sourceId: `${context.docNumber}-${marker}`,
        date: `${context.date}T00:00:00.000Z`,
        amounts: { amount: input.applied },
        description: context.description,
        partyCode: input.partyCode,
        overrides: { bank: ADVANCE_ACCOUNT[input.kind], counter: PARTY_ACCOUNT[input.kind] },
        entryNumber: `TRS-${context.docNumber}-adv-${marker}`,
      },
      manager,
    );
    return result.entryId;
  }

  /**
   * The template carries one money line, so the document must use exactly one fund account. Zero
   * amounts are dropped; a negative amount is passed to the engine, which refuses it with its own
   * `NEGATIVE_AMOUNT`.
   */
  private singleFund(funds: readonly FundLine[]): { account: string; amount: bigint } {
    const used = funds.filter((f) => f.amount !== 0n);
    const accounts = [...new Set(used.map((f) => f.accountCode))];
    if (accounts.length > 1) {
      throw new BadRequestException('ثبت سند با چند حساب وجه نقد/بانک از طریق موتور قواعد ثبت هنوز پشتیبانی نمی‌شود.');
    }
    const amount = funds.reduce((sum, f) => sum + f.amount, 0n);
    return { account: accounts[0] ?? TREASURY_ACCOUNTS.BANK, amount };
  }
}

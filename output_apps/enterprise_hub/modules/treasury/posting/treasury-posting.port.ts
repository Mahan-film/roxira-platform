import { EntityManager } from 'typeorm';
import { AdvanceAllocationInput, DocumentPostingInput } from './treasury-lines';

/** Injection token of the single posting seam of the treasury module. */
export const TREASURY_POSTING = Symbol('TREASURY_POSTING');

export interface PostingContext {
  /** Document number: becomes part of the journal entry number. */
  docNumber: string;
  /** YYYY-MM-DD. */
  date: string;
  description: string;
}

/**
 * Everything treasury knows about the ledger lives behind this port. Today
 * `TreasuryLedgerPostingAdapter` builds the lines itself and calls the accounting service; when
 * `modules/posting_rules` lands, a second adapter delegates to it and only the provider line in
 * `treasury.module.ts` changes. Both run in the caller's transaction and return the journal
 * entry id, so a failed posting rolls the whole document back.
 */
export interface TreasuryPostingPort {
  postDocument(
    tenantId: string,
    context: PostingContext,
    input: DocumentPostingInput,
    manager: EntityManager,
  ): Promise<number>;

  postAdvanceAllocation(
    tenantId: string,
    context: PostingContext,
    input: AdvanceAllocationInput,
    manager: EntityManager,
  ): Promise<number>;
}

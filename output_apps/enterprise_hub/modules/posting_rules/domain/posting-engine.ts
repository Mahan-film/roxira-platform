import { DEFAULT_ROLE_ACCOUNTS, POSTING_ROLES, PostingRole } from '../constants/posting-roles';
import { minorToDecimal } from '../../accounting/money';
import { PostingRuleError } from './posting-error';
import { findTemplate, PostingTemplate } from './posting-templates';

/** Integer minor units, same unit as accounting/money.ts. */
export type Amounts = Readonly<Record<string, bigint>>;
/** Role -> account code chosen for this call (a tenant mapping or a caller's override). */
export type RoleAccounts = Readonly<Partial<Record<PostingRole, string>>>;

export interface ProposalLine {
  role: PostingRole;
  accountCode: string;
  debit: bigint;
  credit: bigint;
  description: string;
  partyCode?: string;
}

export interface VoucherProposal {
  docType: string;
  lines: ProposalLine[];
  total: bigint;
}

export interface BuildInput {
  docType: string;
  amounts: Amounts;
  /** Tenant mapping for this doc type (already merged with the tenant-wide mapping). */
  mapping?: RoleAccounts;
  /** Explicit accounts that win over the mapping (bank ledger code, petty cash fund...). */
  overrides?: RoleAccounts;
  partyCode?: string;
}

export function requireTemplate(docType: string): PostingTemplate {
  const template = findTemplate(docType);
  if (!template) throw new PostingRuleError('UNKNOWN_DOC_TYPE', `نوع سند «${docType}» قالب ثبت خودکار ندارد.`);
  return template;
}

/** The account a role resolves to: override, tenant mapping, template default, global default. */
export function resolveRole(template: PostingTemplate, role: PostingRole, mapping: RoleAccounts = {}, overrides: RoleAccounts = {}): string | undefined {
  return overrides[role] ?? mapping[role] ?? template.defaults?.[role] ?? DEFAULT_ROLE_ACCOUNTS[role];
}

/**
 * Builds the voucher of a document: pure, no I/O. Zero lines are dropped. Refuses (Persian
 * PostingRuleError) a missing or negative amount, a role without an account, an empty voucher
 * and a voucher whose debit and credit totals differ, in integer minor units with no tolerance.
 */
export function buildProposal(input: BuildInput): VoucherProposal {
  const template = requireTemplate(input.docType);
  for (const name of template.amounts) {
    const value = input.amounts[name];
    if (typeof value !== 'bigint') {
      throw new PostingRuleError('MISSING_AMOUNT', `مبلغ «${name}» برای سند ${template.title} ارسال نشده است.`);
    }
    if (value < 0n) {
      throw new PostingRuleError('NEGATIVE_AMOUNT', `مبلغ «${name}» برای سند ${template.title} نمی‌تواند منفی باشد.`);
    }
  }

  const lines: ProposalLine[] = [];
  for (const spec of template.lines) {
    const amount = input.amounts[spec.amount];
    if (amount === 0n) continue;
    const accountCode = resolveRole(template, spec.role, input.mapping, input.overrides);
    if (!accountCode) {
      throw new PostingRuleError(
        'UNMAPPED_ROLE',
        `برای نقش «${POSTING_ROLES[spec.role].label}» در سند ${template.title} حسابی تعیین نشده است؛ از تنظیمات ثبت خودکار حساب را انتخاب کنید.`,
      );
    }
    lines.push({
      role: spec.role,
      accountCode,
      debit: spec.side === 'debit' ? amount : 0n,
      credit: spec.side === 'credit' ? amount : 0n,
      description: spec.description,
      ...(spec.party && input.partyCode ? { partyCode: input.partyCode } : {}),
    });
  }

  const debit = lines.reduce((sum, l) => sum + l.debit, 0n);
  const credit = lines.reduce((sum, l) => sum + l.credit, 0n);
  if (debit !== credit) {
    throw new PostingRuleError(
      'UNBALANCED',
      `سند ${template.title} تراز نیست: جمع بدهکار (${minorToDecimal(debit)}) با جمع بستانکار (${minorToDecimal(credit)}) برابر نیست.`,
    );
  }
  if (lines.length < 2 || debit === 0n) {
    throw new PostingRuleError('EMPTY_VOUCHER', `سند ${template.title} مبلغی برای ثبت ندارد.`);
  }
  return { docType: input.docType, lines, total: debit };
}

/** The reversal of a proposal: every line with debit and credit swapped. Nets to zero with it. */
export function reverseProposal(proposal: VoucherProposal): VoucherProposal {
  return {
    docType: proposal.docType,
    total: proposal.total,
    lines: proposal.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
  };
}

/** Net balance per account code (debit minus credit) of one or more proposals. */
export function netByAccount(...proposals: VoucherProposal[]): Map<string, bigint> {
  const net = new Map<string, bigint>();
  for (const p of proposals) {
    for (const l of p.lines) net.set(l.accountCode, (net.get(l.accountCode) ?? 0n) + l.debit - l.credit);
  }
  return net;
}

/** Journal-entry lines for AccountingService.createJournalEntry (decimal strings). */
export function toJournalLines(proposal: VoucherProposal) {
  return proposal.lines.map((l) => ({
    accountCode: l.accountCode,
    debit: minorToDecimal(l.debit),
    credit: minorToDecimal(l.credit),
    ...(l.description ? { description: l.description } : {}),
    ...(l.partyCode ? { partyCode: l.partyCode } : {}),
  }));
}

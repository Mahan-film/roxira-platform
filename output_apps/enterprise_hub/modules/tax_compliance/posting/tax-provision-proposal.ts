import { minorToDecimal, parseMinor } from '../../accounting/money';
import type { PostingRole } from '../../posting_rules/constants/posting-roles';
import type { BuildInput, RoleAccounts, VoucherProposal } from '../../posting_rules/domain/posting-engine';
import type { CorporateTaxPreview } from '../services/corporate-tax.service';

/** Posting-engine template key of the corporate income-tax provision voucher. */
export const TAX_PROVISION_DOC_TYPE = 'tax.provision';

/** A `tax.provision` voucher line in the preview's decimal (string) shape. */
export interface TaxProvisionLine {
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
}

/**
 * The caller's account codes as engine overrides. Only the codes actually supplied become
 * overrides; a missing one leaves its role to the tenant mapping / template default (5220 / 2021).
 */
export function taxProvisionOverrides(
  expenseAccountCode?: string | null,
  payableAccountCode?: string | null,
): RoleAccounts | undefined {
  const overrides: Partial<Record<PostingRole, string>> = {};
  if (expenseAccountCode) overrides.income_tax_expense = expenseAccountCode;
  if (payableAccountCode) overrides.income_tax_payable = payableAccountCode;
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

/** The engine proposal's lines in the corporate-tax preview's decimal shape. */
export function taxProvisionLines(proposal: VoucherProposal): TaxProvisionLine[] {
  return proposal.lines.map((line) => ({
    accountCode: line.accountCode,
    debit: minorToDecimal(line.debit),
    credit: minorToDecimal(line.credit),
    description: line.description,
  }));
}

/**
 * Pure mapper: the corporate-tax provision preview -> the input of `buildProposal` for
 * `tax.provision`. The account codes the preview resolved (the caller's `expenseAccountCode` /
 * `payableAccountCode`) become overrides, which win over the tenant mapping; a missing code leaves
 * its role to the mapping/default. The provision is exact integer minor units (rials) — no float.
 *
 * It does not post and does not touch the ledger: a zero provision maps to a zero amount, which
 * `buildProposal` refuses as an empty voucher (no lines to post).
 */
export function toTaxProvisionBuildInput(preview: CorporateTaxPreview): BuildInput {
  const overrides = taxProvisionOverrides(preview.voucher.lines[0]?.accountCode, preview.voucher.lines[1]?.accountCode);
  const input: BuildInput = {
    docType: TAX_PROVISION_DOC_TYPE,
    amounts: { provision: parseMinor(preview.provision) },
  };
  return overrides ? { ...input, overrides } : input;
}

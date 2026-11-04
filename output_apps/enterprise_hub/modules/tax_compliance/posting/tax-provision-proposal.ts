import { parseMinor } from '../../accounting/money';
import type { PostingRole } from '../../posting_rules/constants/posting-roles';
import type { BuildInput } from '../../posting_rules/domain/posting-engine';
import type { CorporateTaxPreview } from '../services/corporate-tax.service';

/** Posting-engine template key of the corporate income-tax provision voucher. */
export const TAX_PROVISION_DOC_TYPE = 'tax.provision';

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
  const overrides: Partial<Record<PostingRole, string>> = {};
  const expense = preview.voucher.lines[0]?.accountCode;
  const payable = preview.voucher.lines[1]?.accountCode;
  if (expense) overrides.income_tax_expense = expense;
  if (payable) overrides.income_tax_payable = payable;

  const input: BuildInput = {
    docType: TAX_PROVISION_DOC_TYPE,
    amounts: { provision: parseMinor(preview.provision) },
  };
  return Object.keys(overrides).length > 0 ? { ...input, overrides } : input;
}

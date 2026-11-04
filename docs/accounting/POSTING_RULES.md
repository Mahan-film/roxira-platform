# Posting rules engine

Module: `output_apps/enterprise_hub/modules/posting_rules` (issue #230, PR #233). Inventory of today's posting sites:
`docs/accounting/POSTING_MAP.md`.

## Model

- **Template** (`domain/posting-templates.ts`): one per document type (`payroll.run`, `cheque.received.clear`, ...).
  Lines are `role + side + amount name`. A template may carry `defaults` that keep the accounts its module posted
  before the engine, so adopting it does not change any voucher.
- **Role** (`constants/posting-roles.ts`): `receivable`, `revenue`, `vat_output`, `cogs`, `inventory`, `cash`,
  `bank`, `cheques_receivable`, `payroll_payable`, `wage_tax_payable`, `insurance_payable`,
  `depreciation_expense`, `accumulated_depreciation`, `retention_receivable`, ... Each role lists the account types it
  accepts; the settings page and `setMapping` enforce that and the posting level.
- **Tenant mapping** (`fin_posting_role_maps`, FORCE RLS): role -> account code per document type, or `*` for all.
  Resolution order: caller override (e.g. the bank account's own ledger code) > doc type mapping > `*` mapping >
  template default > global default from `iran-chart-template.ts`.
- **Source ledger** (`fin_posting_sources`, FORCE RLS): unique `(tenant, source_type, source_id)`. A second `post()` for
  the same source returns the first voucher (`replayed: true`) and writes nothing.

## API for modules

```ts
await postingRules.post(tenantId, {
  docType: 'payroll.run', sourceType: 'payroll_run', sourceId: String(run.id),
  date: isoDate, description, entryNumber,           // entryNumber optional
  amounts: { gross, employerCost, insurance, incomeTax, otherDeductions, net }, // bigint minor units
}, manager);                                          // joins the caller's transaction
await postingRules.reverse(tenantId, 'payroll_run', String(run.id), { reason });
```

Refusals are `PostingRuleError` (HTTP 400, Persian message, `code`): `MISSING_AMOUNT`, `NEGATIVE_AMOUNT`,
`UNMAPPED_ROLE`, `UNBALANCED`, `EMPTY_VOUCHER`, `UNKNOWN_ACCOUNT`, `HEADER_ACCOUNT`, `INVALID_MAPPING`.
Zero-amount lines are dropped; the voucher must balance exactly in integer minor units.

## Adding a document type

1. Add a template (and a role if needed) and an old-vs-new fixture spec in the adopting module.
2. Replace the module's hardcoded codes with `postingRules.post`. Keep the legacy codes as template `defaults`.
3. Update `POSTING_MAP.md`.

## Tests

`domain/posting-engine.property.spec.ts` (fast-check): for every template any balanced amounts give a balanced voucher
and its reversal nets to zero per account; perturbed amounts are refused with `UNBALANCED`.
Tenant isolation: `modules/access/rls/tenant-rls.pg.spec.ts` ("posting rules").

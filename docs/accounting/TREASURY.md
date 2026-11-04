# Treasury: receipts and payments (TRS-01)

Module: `output_apps/enterprise_hub/modules/treasury`. API prefix `enterprise-hub/treasury`, gated by the
`banking` module permissions (accountant role). Tables: `fin_treasury_documents`, `fin_treasury_document_lines`,
`fin_treasury_allocations`, `fin_treasury_settings` (all `tenant_id`, FORCE RLS, migration `1789500000000`).

## Model
- **Document** = receipt (customer) or payment (supplier), number `RC-000001` / `PY-000001`, gap-free per tenant.
- **Method lines**: `cash`, `bank_transfer`, `card` (bank account of `modules/banking`), `cheque` (registered through
  `ChequesService.create`, which posts its own entry). A document with several lines is a mixed payment.
- **Allocation** = rows (invoice id, cash amount, write-off). Open amount of an invoice = `finalPayable` minus all
  allocation rows. The rules are in `allocation/allocation-engine.ts`: a row cannot exceed the open amount; the sum of
  cash cannot exceed the document; money not allocated stays on the document as an **advance** (`advance_remaining`) and
  is allocated later with `POST documents/:id/allocations`; a **write-off** must close the invoice and be at most the
  tenant tolerance (`PUT settings`, default 0 = off). Only `ISSUED` invoices of the right direction (sale for receipts,
  purchase for payments) can be settled.
- Concurrency: transaction advisory locks per invoice, taken in sorted order, then the open amount is re-read.

## Ledger (default accounts, need the accountant's confirmation)
Receipt: Dr cash `1011` / bank `1010` (or the bank account's ledger account) / write-off `4030`; Cr receivable `1020`
(party) and customer advances `2070` (party). Payment: the mirror, with payable `2010`, supplier advances `1040`,
write-off income `4090`. A cheque line is posted by the cheques module (Dr `1110`, Cr `1020`), so the document only
posts the difference. Later allocation of an advance: Dr `2070` / Cr `1020` (receipt), Dr `2010` / Cr `1040` (payment).
All of it goes through `TreasuryPostingPort` (`posting/treasury-posting.port.ts`); today's adapter is
`TreasuryLedgerPostingAdapter`. When `modules/posting_rules` lands, add an adapter and change the one provider in
`treasury.module.ts`.

## For ageing
`GET enterprise-hub/treasury/allocations?partyCode=&asOf=` (and `TreasuryService.listAllocations`) returns the real
settlement per payment and invoice. Ageing (`modules/accounting/reports/ageing.ts`, laptop-owned) still uses FIFO.

## Known limits
- Cheque registration is a separate transaction: if the document fails after a cheque was registered, the cheque stays.
  Validation runs first to make that rare. Fix: let `ChequesService.create` take a manager.
- The allocation is not checked against the invoice's party (invoices carry a CRM customer id, the ledger a party code).
- Invoice status is not set to PAID by treasury (laptop-owned); use the allocation data.
- Reversal of a document, cash boxes, transfers, fees, POS settlement and the pages follow in TRS-02/03.

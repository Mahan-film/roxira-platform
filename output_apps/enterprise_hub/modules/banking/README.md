# Banking: bank accounts, statement import and reconciliation

Business suite phase 2 (docs/strategy/ROXIRA_BUSINESS_SUITE_2026-10-22.md §4).

## Tables (migration `1789280000000-CreateBankReconciliation`)

- `fin_bank_accounts`: one row per bank account, `tenant_id`, linked to a ledger account
  (`ledger_account_id` → `fin_chart_of_accounts`). Unique `(tenant_id, account_number)`.
- `fin_bank_statement_lines`: imported statement rows, `tenant_id`, `bank_account_id`, amounts from
  the bank's point of view (`withdrawal`, `deposit`, optional `balance`, `reference`). A line is
  matched when `matched_journal_line_id` is set (FK, `ON DELETE SET NULL`); a partial unique index
  keeps a journal line matched to at most one statement line.

Every repository read and write is scoped by `tenant_id`; the tenant comes only from the JWT.

## Import (`bank-statement` entity in `data_import`)

Upload the Excel/CSV export in the import wizard; the wizard asks for the target bank account
(`bankAccountId` on commit; a tenant with a single bank account needs no choice). Undo removes the
batch's lines except lines already matched.

Assumptions (header names differ per bank and per internet-bank version; the synonyms were collected
from common exports and should be extended when a real file does not detect):

| Bank | Typical columns |
| --- | --- |
| Mellat | ردیف، تاریخ، زمان، شرح، شماره پیگیری، بدهکار، بستانکار، مانده، شعبه |
| Melli | تاریخ، ساعت، شرح عملیات، شماره سند، برداشت، واریز، مانده، کد شعبه |
| Saderat | تاریخ، شرح، بدهکار، بستانکار، مانده، شماره چک |
| Tejarat | تاریخ تراکنش، شرح تراکنش، مبلغ برداشت، مبلغ واریز، مانده حساب، شماره مرجع |
| Pasargad | تاریخ، زمان، شرح، کد پیگیری، مبلغ بدهکار، مبلغ بستانکار، مانده |
| Saman | تاریخ، شرح، شماره سریال، برداشت، واریز، مانده |

- بدهکار/برداشت = money out, بستانکار/واریز = money in. A single signed «مبلغ» column also works.
- Dates are Jalali text (`1403/07/15`, optionally followed by a time). Two-digit years and Excel
  serial dates are not supported.
- Amounts are rial unless the cell says تومان; negatives as `-500`, `500-` or `(500)`.
- Title rows above the table (bank name, account number, period) are skipped: the header row is
  located automatically (`locateHeaderRow`). Rows without an amount (totals, brought-forward) are
  reported as failed rows.
- Oldest-first and newest-first exports both work (the closing balance follows the running balance).
- Re-importing the same file skips rows already imported (key: date, time, amounts, balance,
  reference). Two identical rows in one file without a balance or time column are treated as one.

## Reconciliation (`/enterprise-hub/banking`, UI at `/app/accounting/bank`)

- Auto-match: same direction (deposit = book debit on the bank's ledger account, withdrawal = book
  credit), amount ±1 rial, dates within a window (default 3 days, max 31). A book line whose entry
  number or description contains the statement reference wins; otherwise the closest date. Ties
  are left for manual matching. Invoice payments post a «bank / receivables» entry, so they are
  matched like any other journal line.
- Manual match / unmatch; create a journal entry from an unmatched line (bank account vs a chosen
  counter account), which is matched immediately.
- Summary as of a date: bank balance, book balance, unmatched items on each side, adjusted balances
  and the difference (0 when reconciled).

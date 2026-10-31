# Bank reconciliation assistant: accounting policy questions for the owner

Each item says what the code does today (the default) so nothing is blocked while you decide.

1. **Auto-match confidence.** Today a unique candidate with the same amount and direction within
   1 day is matched automatically (confidence 0.91); 2-3 days is only suggested. Is 1 day right, or
   should only same-day / reference / cheque matches be automatic? (tenant setting `autoMatchMinConfidence`)
2. **Date window.** Default 3 days between bank date and voucher date. Cheques/Sayad are matched
   up to 120 days apart. Acceptable?
3. **Small fees.** Defaults: bank fee up to 5,000,000 rial, SMS fee up to 500,000 rial. Right order
   of magnitude? Should the VAT on bank fees be a separate line/account?
4. **Auto-post of fees.** Off by default; when a tenant admin turns it on, only rule-detected
   withdrawals under the threshold are posted, with the fee expense account chosen in settings.
   Should it also require a minimum number of manually approved fees first?
5. **Default accounts per category.** None are assumed. Which chart-of-accounts codes should the
   default chart use for: bank fee, SMS fee, payroll, loan principal vs interest, tax, partner
   current account, own-account transfer (a transit account?), sale receipts (receivable vs
   revenue), purchase payments (payable vs expense)? Today the customer sets them in settings or
   per answer.
6. **Loan instalments.** One voucher splits principal and interest in practice; today an
   instalment is one line to one account. Do you want a principal/interest split question?
7. **Sale / purchase.** A deposit that is a sale: debit bank, credit receivable (clears an invoice)
   or revenue directly? Matching to an open invoice is not done yet.
8. **Own-account transfers.** Two statements (both banks) each show one side. Today each side is a
   separate draft to a transit account. Should the system pair the two sides across statements?
9. **Opening balance.** On the first import the file's opening balance is compared with the bank
   account's `opening_balance`. If they differ we ask. Should the first import be allowed to set it?
10. **Period overlap.** Overlapping files can import "only new rows". Rows are identified by
    date/time/amounts/balance/reference/description; two identical rows in one file are both kept.
11. **Roles.** Everything requires tenant admin (as the legacy banking routes). Do you want a
    preparer role (upload, answer, create drafts) and a separate approver role (batch approve,
    reverse, settings), with approver != preparer for the same draft?
12. **Reversal date.** A reversal uses the ledger's default date. If the original period is locked
    the reversal is refused (423). Should it post in the first open period instead?
13. **Report basis.** Only confirmed matches clear items; suggested ones stay outstanding. Ledger
    balance is the sum of the bank GL account up to the period end. Should post-dated cheques be
    shown separately?
14. **Person type** (real/legal) is a name heuristic. For tax reporting do you need national id /
    company id capture per counterparty?
15. **Real samples.** All bank layouts are `synthetic` (from the README). Please provide masked real
    exports for Mellat, Melli, Saderat, Tejarat, Pasargad, Saman, Sepah to promote them to `verified`
    and to label real descriptions for the classification evaluation.

# Cheques (received and issued): design, Sayad rules, accounting treatment

Status: first version, 2026-10-31. Module `output_apps/enterprise_hub/modules/cheques`, page `/app/cheques`.

**Scope statement.** There is **no live Sayad integration**. The Sayad number is a 16-digit field the user types in.
The "registered in Sayad" tick is the user's own declaration; the system never calls the Central Bank of Iran (CBI) and
never checks the cheque's status or the drawer's credit colour. Everything marked **[ACCOUNTANT]** below is a
proposal that a licensed Iranian accountant must confirm before a customer relies on it. Nothing here is legal advice.

## 1. What the public sources say about Sayad

| Point | Source |
| --- | --- |
| CBI launched the integrated cheque system Sayad in 1396 (2017); issuing, registering, transferring and inquiring happen through it. | Sepidar, "چک صیادی چیست" (1) |
| Every cheque leaf carries a 16-digit Sayad ID at the top left; registration, transfer and inquiry use it. | (1), Mashregh/Digiato/Bankavl explainers (4) |
| Flow: the issuer registers the cheque (ID, serial, amount, due date, payee national code and name); the receiver confirms after getting the paper; a transfer repeats this with the new holder. Traditional endorsement (پشت‌نویسی) is replaced by registered transfer. | (1) |
| Amendment of the Cheque Law approved 12/08/1397, in force 1/1/1400 (21 March 2021): a cheque not registered in Sayad is not valid and cashable; bearer cheques are no longer allowed (payee full name must be registered); bounced-cheque holders can apply directly to a court for an enforcement writ; the issuer's accounts can be blocked up to the shortfall. | Nouraei & Mostafavi law firm (2) |
| An academic paper argues that obliging registration is not consistent with the wider cheque legal framework, and courts' views differ. | Ensani.ir paper (3) |
| Inquiry colours (white, yellow, orange, brown, red) summarise the drawer's bounced-cheque history; the thresholds and amounts change with CBI circulars. | (1) |
| Cheque issuance rules for paper and electronic books were separated in July 2026; electronic cheque use is growing. | Intellinews (5) |

Sources
1. https://www.sepidarsystem.com/blog/sayad-check/
2. https://nourlaw.com/strict-amendments-to-the-check-law-now-applicable/
3. https://www.ensani.ir/fa/article/628497/ (courts of Tehran province on mandatory Sayad registration)
4. https://digiato.com/training/what-is-sayad-cheque , https://bankavl.com (Sayad explainers)
5. https://www.intellinews.com/iran-eases-cheque-book-rules-to-boost-electronic-cheque-adoption-457837/

Gaps we could not close from public pages: the exact structure of the 16-digit ID (no public check-digit rule was found,
so we validate length and digits only), the CBI's official API terms for third-party software, and current thresholds of
the inquiry colours. **[LEGAL]** confirm the enforceability position for unregistered cheques before we show any
"valid/invalid" wording to customers; the product does not.

## 2. What the product does with Sayad

* `sayad_number`: optional, exactly 16 digits (Persian digits are converted), unique per tenant when present.
  A database CHECK (`^[0-9]{16}$`) and a partial unique index enforce it.
* `sayad_verified`: boolean the user ticks. It is shown as "(تأییدنشده)" when a number exists and the box is not ticked.
* Future work, not built: CBI/bank API inquiry, status sync, automatic transfer registration.

### 2a. Sayad fields added for CHK-01 (2026-11-04)

| Field | Rule | Source status |
| --- | --- | --- |
| `sayad_number` | 16 digits, not one repeated digit, unique per tenant | length from public explainers; no public check-digit rule: **unclear** |
| `sayad_registration_status` | `unknown` / `registered` / `unregistered`, declared by the user | manual; never read from Sayad |
| `receiver_national_id` | 10 digits (person, mod-11 check) or 11 digits (company, weighted check) | public checksum algorithms, not in `docs/legal_sources/iran/`: **unclear** |
| `sayad_verified` + `sayad_verified_by` + `sayad_verified_at` | manual tick; who and when are stored, an event row keeps the history; DB CHECK refuses a verified row without a verifier | n/a |

`POST .../:id/sayad-verification {verified, sayadRegistrationStatus?, note?}` sets or clears the tick. Rows verified before
this change are marked `legacy`. There is still no call to Sayad.

### 2b. New moves (CHK-01)

* Issued: `registered -> delivered` (status only, liability already posted at issue), then `delivered -> cleared / bounced / returned`.
  `registered -> cleared` stays for cheques paid without a recorded hand-over.
* Endorsement (`spent`) now stores `spent_to_code` and `spent_to_national_id`; the payable line carries the third party's code.
* Partial payment: `POST .../:id/partial-payment {amount}` posts Dr 1010 / Cr 1110 or 1120 (received, from `registered` or `deposited`)
  or Dr 2110 / Cr 1010 (issued, from `registered`, `delivered`, `bounced`) for the part only. The cheque keeps its status and
  `settled_amount` grows. The closing move (clear, bounce, return) posts only the remainder. A payment equal to or above the
  remainder is refused (use the normal clear move). A cheque with a payment taken cannot be endorsed.
  **[LEGAL] unclear:** the cheque law's rule that the holder may not refuse partial payment is not in `docs/legal_sources/iran/`;
  the lawyer must confirm it, and whether a partly paid cheque may still be endorsed or returned.

### 2c. Bank reconciliation and reports (CHK-01)

* `GET .../reconciliation?bankAccountId=&fromDate=&toDate=&windowDays=` lists each clearing event (a `cleared` move or a
  partial payment) with a state: `reconciled`, `suggested` (statement lines of the same amount and direction within the
  window, default 5 days), `unmatched`, or `no_bank_line` (the clearing entry posted to 1010 but the bank account is linked
  to another ledger account). `POST .../reconciliation/match` confirms one pair; `POST .../reconciliation/apply` applies
  every item with exactly one candidate that no other item also wants. Matching uses only the exported `BankingService`
  (`listBookLines`, `listStatementLines`, `manualMatch`), which re-checks amount and direction and refuses double matches.
* `GET .../due?days=N` (already existed): open cheques due in N days plus overdue. `GET .../bounced?asOf=&direction=`:
  bounced cheques aged from their latest bounce event (due date when none) in buckets 0-30, 31-60, 61-90, 90+, with the
  unpaid remainder summed per direction.

## 3. Lifecycle and postings

Amounts are IRR. Account codes: 1010 bank/cash, 1020 trade receivables, 2010 trade payables (default chart);
**1110** اسناد دریافتنی نزد صندوق, **1120** اسناد دریافتنی در جریان وصول, **2110** اسناد پرداختنی are created per tenant on
first use (the accounting module is untouched; the cheques service calls `createAccount`). Each posting is one balanced
entry via `createJournalEntry`, in the same transaction as the status change and the history row.

Received cheques

| Move | Debit | Credit |
| --- | --- | --- |
| Receive (creation, state registered) | 1110 | 1020 |
| registered → deposited | 1120 | 1110 |
| deposited → cleared | 1010 | 1120 |
| deposited → bounced | 1020 | 1120 (receivable restored) |
| bounced → deposited (re-present) | 1120 | 1020 |
| registered → cleared (presented at the counter, no deposit step) | 1010 | 1110 |
| registered → bounced (counter presentation refused) | 1020 | 1110 |
| registered → spent (endorsed to a supplier) | 2010 | 1110 |
| registered → returned to drawer | 1020 | 1110 |
| bounced → returned to drawer | none | none (receivable is already restored) |

Issued cheques

| Move | Debit | Credit |
| --- | --- | --- |
| Issue (creation, state registered) | 2010 | 2110 |
| registered or bounced → cleared | 2110 | 1010 |
| registered or bounced → returned (cancelled) | 2110 | 2010 |
| registered → bounced | none | none (the bank did not pay, the liability stays) |

Cleared, returned and spent are terminal. Illegal moves are rejected with 400 and nothing is posted.

**Money.** Amounts use the accounting module's exact money helpers (`money.ts`, `@IsMoneyAmount`): JSON number or
decimal string in, `numeric(18,2)` decimal string in the entity, `bigint` minor units in the lifecycle and postings, and
number-or-string out. Amounts up to 9999999999999999.99 keep full precision (the UI only formats with `Number()` for
display).

**Due list.** Open = registered, deposited or bounced. A bounced cheque stays in the list and in the overdue count
until it is cleared or returned.

**Chart.** The three cheque accounts are checked against the live chart before every move (no process cache), so a chart
reset or import cannot leave them missing.

Sources for the pattern: Sepidar cheque operations guide, Maktabkhooneh cheque bookkeeping guide, Mohaseban cheque and
notes articles (search results 2026-10-31; the articles give the received/in-collection/cleared/endorsed/payable entries
and say the exact account structure depends on the chart). The bounce and re-present entries are our own inference from
that logic.
* https://www.sepidarsystem.com/blog/cheques-operation-in-sepidar-software/
* https://maktabkhooneh.org/mag/check-bookkeeping/
* https://www.sepidarsystem.com/blog/registration-of-receivables-and-payables-in-accounting/

## 4. Items for the accountant's review

1. **[ACCOUNTANT]** Account names and codes 1110, 1120, 2110. Some practices use one "اسناد دریافتنی" account with
   sub-accounts, and separate "اسناد برگشتی/واخواست‌شده" for bounced cheques. We restore the receivable (1020) on bounce.
2. **[ACCOUNTANT]** Post-dated cheque presentation: a received cheque with a far due date is recorded as notes receivable
   at face value. No discounting, no short/long-term split (cheques due beyond one year), no present-value adjustment.
3. **[ACCOUNTANT]** Issued cheque posting at issue (Dr 2010 / Cr 2110) versus posting only at clearing. Day-cheques
   (چک روز) are treated the same as term cheques here.
4. **[ACCOUNTANT]** Endorsement (خرج چک): we debit trade payables 2010 without a supplier sub-ledger link, because the
   supplier is captured only as free text (`spent_to_name`). A supplier party code should be added with the supplier master.
5. **[ACCOUNTANT]** A spent cheque that later bounces back to us, collection fees, bank charges and bounce penalties, and
   the issuer's enforcement or settlement (رضایت‌نامه) are not modelled.
6. **[ACCOUNTANT]** Deposit/clear postings use cash and bank 1010 only, not the specific bank account of the Banking
   module, so bank reconciliation of a cleared cheque is manual until the two are linked.
7. **[ACCOUNTANT]** Guarantee/collateral cheques (چک ضمانت) should not hit receivables or payables. Not handled: enter
   them only as memo records outside the ledger for now.
8. **[ACCOUNTANT]** Entries carry the event date as the journal date. Period locks (Phase 0 of the accounting plan) will
   reject postings into a locked period, and the cheque move then fails and rolls back as a whole.
9. **[LEGAL]** Wording shown to users about validity of unregistered cheques.

## 5. Technical notes

* Tenant: `tenant_id` on both tables, resolved only from the verified JWT claim; every repository method filters by it;
  row lock (`FOR UPDATE`) on transitions; unique Sayad per tenant.
* Dates: stored as ISO `date`; the UI takes and shows Jalali (`1405/08/10`). The API speaks ISO.
* Migration `1789295000000-CreateCheques` was verified up, idempotent up, down and up again on a local PostgreSQL 15 with
  its CHECK and unique constraints exercised (a stub `fin_journal_entries` table stood in for the full chain).
* Endpoints: `GET /enterprise-hub/cheques`, `GET .../due?days=`, `POST .../`, `GET .../:id`, `POST .../:id/transition`.
  Access requires tenant admin like the banking module.

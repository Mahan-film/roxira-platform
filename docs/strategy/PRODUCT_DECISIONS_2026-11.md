# Product decisions from the 2026-11 Deep Research

Source: the owner's Deep Research report on accounting UX, data migration and low-cost AI, received 2026-11-04. The prompt is in `roxira-review/DEEP_RESEARCH_ROXIRA_UX_2026-11.md`. This page holds the **decisions** taken from that report. The report's prices and quotas are research input, not verified fact. Re-check them with `scripts/check_models.py` before relying on them.

Scope: roxira.ir (Iran). Priority 1 is still the accounting system (#230). The design audit is in `docs/design/DESIGN_AUDIT_2026-11.md` (#289).

## 1. Dashboard: role-based, cash first

- **Three views from one switch:** owner (default for admins), accountant, and salesperson. An admin can switch at any time.
- **Owner view, top to bottom:**
  1. Hero strip of 4 cards: total cash available, net sales (today or this month), net receivables against payables, and Moadian/VAT status (invoices waiting for the 12-day deadline, plus this season's VAT estimate). Each card shows a Δ% against the previous period.
  2. Liquidity panel, 40% width. It has tabs for banks, cash boxes and petty cash, next to a 6-month cash in/out chart at 60% width.
  3. Cheque radar: cheques payable in the next 7 days against the bank balance, and receivable cheques due. Next to it, AR/AP ageing bars (current, 1-30, 31-60, 60+), with the top 5 overdue debtors.
  4. P&L snapshot (FIFO COGS), stock alerts (below reorder point, top sellers, slow movers), and tasks (draft or unbalanced vouchers, issues not invoiced, recent documents).
- **Petty cash is never its own top card.** It sits inside the liquidity panel. A threshold badge appears when a petty-cash balance falls below 20% of its limit, or when any cash box goes negative.
- **Accountant view:** Moadian inbox (unsent with a 12-day countdown, errors, waiting for approval), bank and POS reconciliation cards, voucher control (drafts, unbalanced vouchers, unbilled issues), a cash-box and petty-cash table with recharge and expense actions, and the account watchlist.
- **Salesperson view:** target gauge and commission, a quick invoice/POS button with open quotes, my customers' overdue invoices with a pay-link action, and a stock and price lookup.
- **Privacy mode:** a header toggle blurs every amount, with a 4-digit PIN to reveal them.

## 2. Menu: task-based, at most 2 levels

Level 1, in order:

1. پیشخوان
2. طرف‌حساب‌ها و کالاها
3. فروش و پایانه فروشگاهی
4. خرید و هزینه‌ها
5. انبارداری
6. خزانه‌داری (banks, cash boxes, petty cash, receipts and payments, transfers, cheques, reconciliation)
7. حسابداری و اموال (vouchers, chart of accounts, account browser, cost centres, projects, fixed assets, fiscal year and close)
8. حقوق و دستمزد و مالیات (Moadian inbox, VAT and seasonal returns, payroll, insurance and wage-tax files)
9. گزارش‌ها و تنظیمات

Every page also gets a global "+ ثبت جدید" quick-create button and a Ctrl+K command palette. The Persian terms follow the research glossary: سند حسابداری، دفتر روزنامه، دفتر کل، معین، تفصیلی شناور، تراز ۲/۴/۶/۸ ستونی، صندوق، تنخواه‌گردان، خزانه‌داری، دریافت و پرداخت، اسناد دریافتنی و پرداختنی، صورتحساب (official and Moadian) or فاکتور (everyday use)، رسید و حواله انبار، کاردکس، مرکز هزینه، پروژه.

## 3. Screens

- **Theme:** keep a *calibrated* dark theme. No `#000` or `#fff`: the background is around `#0F172A`, surfaces around `#1E293B`, and text around `#F1F5F9`, with desaturated semantic colours. **Add a light theme toggle.** Long ledger and trial-balance sessions read better in light mode.
- **Numbers:**
  - Use `font-variant-numeric: tabular-nums` everywhere.
  - Show negatives as `(۱۲٬۵۰۰٬۰۰۰)` in muted red.
  - Mark balances «بد» / «بس» / «بی‌حساب».
  - Never use colour alone to convey meaning (WCAG 2.2 AA: contrast of at least 4.5:1, and the focus ring must never be hidden behind sticky headers).
- **Money:** store and show official amounts in **rials**. Under every money input, show a live helper with the toman equivalent and the amount in Persian words. Add shortcuts for 000 and 0000.
- **Dates:** a Jalali picker with typed input and a mask (`14050814` → `۱۴۰۵/۰۸/۱۴`), arrow keys, and preset ranges for today, this month, each tax season and the fiscal year.
- **Sales invoice form:**
  - When the customer has an economic code or national id, Moadian type and pattern are set to type 1 / pattern 1; otherwise type 2. The contracting pattern requires the contract id.
  - Picking the customer shows their balance and credit limit.
  - F2 quick-creates a party or item inline.
  - Barcode mode merges repeated scans into one line.
  - Each line shows live stock.
  - Discounts can be entered as a percentage or an amount. A whole-invoice discount can be spread across the lines.
  - Settlement can be split across cash, card, transfer, cheque and credit.
  - The form works keyboard-first: Enter/Tab, a new line from the last row, Ctrl+S or F9 to save.
  - A pre-flight check refuses fractional rials. A full return becomes «ابطالی», not «برگشت».
- **Lists:**
  - Status tabs for payment status and Moadian status.
  - Filter chips and saved views.
  - A density switch with 32, 40 and 48 px rows.
  - A sticky footer with the page total and the filtered total.
  - Bulk actions: Moadian batch send, batch settlement, print, and «رأس‌گیری» (weighted due date).
  - Native XLSX export with Jalali dates.
- **Mobile, below 768 px:** tables become cards. The mobile flows are the owner's pulse, salesperson quotes with share links, and petty-cash receipt photos.

## 4. Big-file migration (5 to 50 GB)

1. **Upload:** the browser uploads straight to R2 or S3 in about 50 MB parts, as multipart with presigned URLs, using tus as the fallback. It computes SHA-256 in a Web Worker. Uploads are resumable for up to 7 days, and the staging bucket keeps files for 72 h. This is in progress in #324.
2. **SQL Server backups (`.bak`):** start with `RESTORE HEADERONLY`.
   - SQL 2008 R2 and later restore in an isolated `mssql/server` Linux container with `--network none`.
   - **SQL 2000/2005 backups (old Holoo) cannot restore there (error 3169).** Route them through an intermediate SQL 2008 R2 upgrade step, or give the customer a small Windows extractor that reads the tables and uploads Parquet.
3. **Transform:** convert the data to Parquet and use DuckDB out-of-core, so 50 GB fits in under 2 GB of RAM. Normalise Arabic ي/ك. Use AI schema discovery on 5 sample rows per table rather than fixed column names, because Iranian vendors do not publish their schemas. Load the result with `COPY BINARY` into a per-tenant staging schema.
4. **Migration reconciliation certificate (PDF):** it covers three things.
   - The trial balance per account matches the source to the rial. Differences go to a «حساب واسط توازن افتتاحیه», with the bad source document named.
   - AR and AP subledger totals and in-transit cheques match.
   - Stock quantity and FIFO value per item and warehouse match. Negative source stock is listed, with a proposed adjustment.

   Nothing becomes live until the customer approves. Option: migrate the opening balance plus open items and the current year, and keep older years in a Parquet archive.

## 5. AI models: cache, then free, then cheap, then strong

- **Cache first:** an exact and semantic cache keyed on the normalised request.
- **Then free:** Groq, OpenRouter `:free`, and NVIDIA NIM. **Never send real customer documents or bank statements to free tiers that train on data.** Google AI Studio's free tier is for dev/test only. This tightens the #204 policy for production tenants once real customers arrive.
- **Then cheap:** DeepSeek V4.1 Flash, DeepSeek V3.2 hosts, Gemini Flash-Lite (paid, zero data retention), Gemma 4 31B, and Devstral for code.
- **Strong only when** the model's `confidence_score` is below 0.80.
- **Prefix caching:** put the fixed chart-of-accounts and Moadian rules prompt at the start of every request.
- **Micro-batching:** send 25 to 50 bank lines per call.
- **Off-peak:** DeepSeek's discount runs from **19:30 to 03:30 Tehran time** (16:00 to 00:00 UTC). Schedule batch jobs such as migration schema discovery, bulk classification and the review desk at about 20:00 Tehran time.
- Set a token budget per tenant and per task. Keep model ids only in `config/models.yaml`, so a provider change is a config change.

## 6. Accounting engine

- **Backdated documents and FIFO:** a backdated purchase or sale saves instantly, with quantity checks only. The rial FIFO re-costing of later documents runs in a background queue (a `fifo_dirty` flag per item and date), never inside the save request.
- **Tax rules stay data-driven:** statutory store, versioned by date. The Moadian technical spec changes, such as v7.9, and budget-law extensions must not need code changes.

## Uncertain (verify before use)

- Model prices and free quotas change often. The report itself lists several 2026 changes.
- The internal schemas of Sepidar, Hamkaran, Mahak and Holoo are not public and differ between editions and versions.
- Vision OCR is not available on Groq. Use Gemini Flash-Lite (paid) or DeepSeek V4.1 Flash multimodal.
- Reachability of foreign AI APIs from Iranian networks. Keep a relay, and add a self-hosted fallback with open weights if needed.

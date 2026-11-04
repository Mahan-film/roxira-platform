# Design audit of roxira.ir/app — 2026-11

Scope: the pages under `/app` (the assistant, damages and settings pages only skimmed, see §15) in `output_apps/enterprise_hub/frontend` (`src/app/app/**`, nav in
`src/components/app/app-shell.tsx`). Goal: match international SMB accounting/ERP UX (Xero, QuickBooks Online,
Zoho Books, Odoo) and what Iranian accountants expect (Sepidar, Hamkaran, Holoo, Tahesab). Tracking: #230 (priority 1).

## How this audit was made (read first)

- **Method: source review of every page and shared component.** Findings are marked **[code]** (confirmed by
  reading the code) or **[data]** (reported by the owner from the live app, not re-observed here).
- **Screenshots are NOT included yet.** The tour helper (`e2e/tests/helpers/prod-tour.ts`) creates a new tenant on
  production by signing up through the UI; the agent that wrote this audit is not allowed to create accounts on a
  production site. Run it once from a trusted machine, then commit the PNGs (instructions in
  `docs/design/audit-2026-11/README.md`). Every statement tagged **[data]** must be re-checked against them.
- The `impeccable` and `design:design-critique` skills were not run as tools in this session; their checklists
  (hierarchy, information architecture, cognitive load, states, accessibility, copy) were applied by hand. Re-run
  `/design:design-critique` on the screenshots when they exist.
- No product code was changed.

## Top 10 problems (ranked)

| # | Problem | Evidence |
|---|---------|----------|
| 1 | **No financial home page.** `/app` shows module blocks (CRM, HR, inventory, ledger) in that order. The real management dashboard is hidden at `/app/accounting/dashboard`, behind a button on the chart-of-accounts page. | [code] `app/page.tsx`, `accounting/page.tsx` |
| 2 | **The management dashboard leads with «صندوق و تنخواه»** and shows only 8 raw balances: no overdue, no period comparison, no VAT due date, no cheques due, no tasks, no chart. Petty cash is a sub-ledger, not a headline. | [code] `accounting/dashboard/page.tsx` |
| 3 | **Home dashboard exposes ledger internals:** «جمع بدهکار», «جمع بستانکار», «وضعیت تراز», «حساب‌های دارای گردش». | [code] `app/page.tsx` |
| 4 | **Navigation is by module, not by job.** Reports, fiscal years, petty cash and the dashboard are reachable only through six header buttons on the «حساب‌ها» page. No «خرید», «خزانه» or «گزارش‌ها» menu item exists. | [code] `app-shell.tsx` NAV_ITEMS |
| 5 | **Invoice list mixes calendars and currencies per row** (foreign invoices: Gregorian `dd/mm/yyyy` + currency such as CNY; others: Jalali + ریال) and has no due-date/overdue column. | [code] `invoicing/page.tsx` L410-436 |
| 6 | **Placeholder party names** («طرف حساب 2322») or `—` when `buyerInfo.name` is missing; no link from an invoice to a party record. | [data]+[code] `invoicing/page.tsx` L422-425 |
| 7 | **Absurd demo balances** (bank 51 trillion rials) and raw full-integer rial figures with no ریال/تومان/میلیون switch. | [data]; `formatMoneyRial`, `formatReportMoney` print every digit |
| 8 | **Status colours likely fail WCAG AA** (class-based estimate; measure rendered colours, open question 6). `text-amber-600` (about 3.2:1) and `text-emerald-600` (about 3.8:1) on white, 75 occurrences of `text-(amber\|emerald\|red\|rose)-(500\|600)`; colour is the only signal for «payable». | [code] grep; ratios computed on #fff |
| 9 | **Wide tables on a phone.** Invoice list: 9 columns, `whitespace-nowrap`, a 16rem actions column; no card or row-menu pattern outside CRM. | [code] `invoicing/page.tsx` L372-385; verify at 375 px |
| 10 | **Inconsistent page patterns and naming:** header button rows (6 on accounting, 3 on bank, 1 on cheques); plain-text empty row on invoicing while CRM/HR/inventory have an import prompt; «ورود داده (import)» and «کارکنان (HR)» mix Latin into Persian labels; «خسارت» uses a different route root (`/damages`). | [code] |

## Standards used

These are working hypotheses from general knowledge; cheque statuses, numbering rules and competitor layouts are confirmed only by the open questions below.

- **Dashboard order (SMB norm):** cash position → receivables/payables with overdue → income/profit this period vs
  previous → tax due → items needing action (bank, cheques) → low stock → tasks. Reference products: Xero (business
  snapshot, bank accounts, invoices owed to you, bills to pay), QuickBooks (cash flow, P&L, aged invoices), Zoho Books
  (receivables, payables, cash flow, income and expense), Odoo (one card per journal with «to reconcile / to pay»),
  Sepidar/Hamkaran (financial summary, cheque status, receivable/payable ageing). These are design references from
  general knowledge; open question 10 lists what to verify hands-on.
- **Menu by job** (Odoo / Zoho / Sepidar): Sales, Purchases, Inventory, Treasury, Accounting, Payroll, Tax, Reports, Settings.
- **Iranian expectations:** Jalali dates everywhere (display, filters, sorting), amounts in ریال with separators and a
  تومان switch, Persian digits, «سند حسابداری» with a sequence number, ledger levels «کل / معین / تفصیلی», «تنخواه»
  under treasury, cheque statuses (در جریان وصول، وصول‌شده، برگشتی، خرج‌شده)، VAT season returns, Moadian status.
- **UX/accessibility:** WCAG 2.1 AA (4.5:1 text, 3:1 UI components; 24 px minimum target is AA in WCAG 2.2, and we adopt 44 px on mobile as our own stricter rule, not an AA requirement), logical CSS for RTL
  (`ms-/me-/ps-/pe-`, `text-start`), colour never the only signal, empty state = what / why / primary action, one
  primary action per page, destructive actions confirmed.

## New menu tree (proposal)

Persian labels are exact. Items show only when the module is entitled and the role can read it (as today).

```
داشبورد                         /app
دستیار هوشمند                   /app/assistant

فروش
  مشتریان و سرنخ‌ها             /app/crm
  فاکتورهای فروش                /app/sales/invoices      (today /app/invoicing, direction=SALE)
  دریافت‌ها                      /app/treasury/receipts

خرید
  تأمین‌کنندگان                  /app/purchases/suppliers
  فاکتورهای خرید                /app/purchases/invoices  (today /app/invoicing, direction=PURCHASE)
  پرداخت‌ها                      /app/treasury/payments

انبار
  کالاها و موجودی               /app/inventory

خزانه
  صندوق و تنخواه                /app/treasury/cash      (today /app/accounting/petty-cash)
  حساب‌های بانکی                 /app/treasury/bank      (today /app/accounting/bank)
  مغایرت‌گیری بانکی              /app/treasury/reconcile
  چک‌ها                         /app/cheques

حسابداری
  اسناد حسابداری                /app/accounting/vouchers
  سرفصل حساب‌ها                 /app/accounting/chart
  سال مالی و بستن حساب‌ها        /app/accounting/fiscal-years

حقوق و دستمزد
  کارکنان                       /app/hr
  حقوق ماهانه                   /app/hr/payroll
  بیمه و مالیات حقوق             /app/hr/statutory

مالیات
  اظهارنامه ارزش افزوده          /app/tax#vat
  سامانه مودیان                 /app/tax#moadian

گزارش‌ها                         /app/reports
  صورت‌های مالی · دفاتر · مطالبات و بدهی‌ها (گزارش سنی)

تنظیمات
  ورود از اکسل · اعضا و نقش‌ها · ماژول‌ها · گزارش رخدادها · امنیت حساب
```

Rules: (1) top-level groups are jobs, not modules; (2) «خسارت» appears only for tenants entitled to it; (3) the
platform-operator item «ماژول‌های مشتریان» leaves the customer menu and moves to `/admin`; (4) old URLs stay as
redirects for one release; (5) on mobile the menu is a bottom sheet with the same groups plus a persistent «+ جدید».

## Dashboard spec (`/app`)

Replaces the module blocks. Data are tenant-scoped from the posted ledger and sub-ledgers; every tile links to the
filtered list behind it.

Row 1 — position (4 KPI tiles):
1. موجودی نقد و بانک: one number, sub-line «صندوق/تنخواه x · بانک y», 30-day sparkline.
2. مطالبات: total plus **سررسید گذشته** amount (with count) in the danger colour plus the word «سررسید گذشته» and a warning icon; links to the ageing report.
3. بدهی‌ها: total plus overdue; links to the ageing report.
4. مالیات بر ارزش افزوده پرداختنی این فصل: amount and **deadline date** (Jalali) with days left.

Row 2 — performance:
5. فروش و هزینه ۶ ماه اخیر (columns, current month highlighted).
6. سود این ماه در مقابل ماه قبل: income, expenses, net, % change.

Row 3 — needs action (lists of 5, each row clickable):
7. چک‌های سررسید این هفته (date, party, amount, status).
8. فاکتورهای سررسید گذشته (party, days late, amount) with «ثبت دریافت».
9. کالاهای زیر حد سفارش (name, stock, minimum).

Row 4 — tasks and shortcuts:
10. کارهای باقی‌مانده: تراکنش بانکی مغایرت‌نخورده، سند پیش‌نویس، مهلت اظهارنامه، فاکتور ارسال‌نشده به مودیان.
11. دسترسی سریع: «+ فاکتور فروش» is the page's single filled (primary) button; «+ دریافت», «+ پرداخت», «+ سند» are outline buttons.

Rules: ریال/تومان/میلیون switch remembered per user; Persian digits; negatives in parentheses; period picker (ماه جاری /
فصل / سال مالی) in the header; empty tenant shows the import prompt plus a 3-step setup checklist (سرفصل‌ها، حساب بانکی،
اولین فاکتور); CRM/HR counters move to their own module pages; the trial-balance state becomes a small footer badge
«دفتر تراز است ✓». `/app/accounting/dashboard` is removed and redirects here. Backend: one `GET /dashboard/summary`
returning all tiles in a single call.

## Per-page findings and proposed design

Format: wrong → why → proposal.

### 1. `/app` Dashboard
- Wrong: module counters (CRM first), ledger internals, the password card on the home page. [code]
- Why: problems 1-3; password management belongs in settings.
- Proposal: dashboard spec above; move `PasswordSettingsCard` to `/app/settings/security` (page exists).

### 2. `/app/accounting` (chart, trial balance, journal)
- Wrong: one page stacks chart tree, trial balance, ledger drawer and journal list, with six outline buttons in the
  header; the label «حساب‌ها» does not say what the page is. [code]
- Why: Odoo and Zoho separate Chart of Accounts, Journal Entries and Reports; Sepidar has «اسناد حسابداری» as its own
  filterable list.
- Proposal: split into `/accounting/vouchers` (filters: شماره، تاریخ جلالی، وضعیت پیش‌نویس/قطعی، مبلغ، شرح; primary
  «+ سند جدید»; row menu: مشاهده، ویرایش، رونوشت، سند معکوس; per-voucher «تراز/نامتراز» badge) and `/accounting/chart`.

### 3. `/app/accounting/dashboard`
- Wrong: first tile «صندوق و تنخواه»; «فروش/سود سال جاری» without comparison; no overdue; hidden route. [code]
- Proposal: merged into `/app`; API reused.

### 4. `/app/accounting/petty-cash`
- Wrong: treated as a top-level accounting feature and the first dashboard tile. [code]
- Why: in Sepidar/Hamkaran petty cash sits in treasury beside bank and cheque.
- Proposal: «صندوق و تنخواه» in the Treasury group: list of boxes with balance, custodian, limit, last settlement;
  primary «+ هزینه تنخواه», secondary «تسویه تنخواه».

### 5. `/app/accounting/bank`, `/bank/reconcile`
- Wrong: three names for one feature («بانک و تطبیق» in the menu, «بانک و مغایرت‌گیری» as page title, «مغایرت‌گیری
  هوشمند» button); statement import jumps to the generic `/app/import`. [code]
- Proposal: «حساب‌های بانکی» (balance, unreconciled count, last statement date) and «مغایرت‌گیری بانکی»; statement
  import becomes a dialog on the bank page.

### 6. `/app/accounting/reports`
- Wrong: nine reports in tabs on a page reached from an accounting button; no «گزارش‌ها» menu item. [code]
- Proposal: `/app/reports` hub (three groups, a card per report with a one-line description); every report gets a
  Jalali period picker, comparison toggle, Excel/PDF export and a print layout.

### 7. `/app/accounting/fiscal-years`
- Wrong: reachable only through a header button. [code]
- Proposal: under «حسابداری»; show current year, lock state per period, a pre-close checklist (draft vouchers, unreconciled
  bank lines, depreciation run) and a typed-confirmation «بستن سال مالی».

### 8. `/app/invoicing`
- Note: the invoicing module has no due-date field today (grep `dueDate` in `modules/invoicing` = 0 hits), so the due-date/overdue/outstanding columns need a backend field first; the issue for this page must include it.
- Wrong: 9-column table; mixed calendars and currencies; party `—` or placeholder; no due date, no outstanding amount,
  no overdue badge; plain-text empty row; 16rem actions column. [code]
- Why: Xero and QBO lists show number, party, issue date, due date, amount, status badge and one primary action; Iranian
  practice needs Jalali dates and the Moadian status.
- Proposal: tabs «فروش | خرید» (maps to direction); columns شماره، طرف حساب (link)، تاریخ (Jalali)، سررسید، مبلغ کل، مانده،
  وضعیت (badge with word + icon)، وضعیت مودیان; the rest in a row menu. Foreign-currency invoices show ریال as the main
  figure with the original currency as a secondary line; Gregorian date only in a tooltip. Empty state: «اولین فاکتور
  فروش را بسازید» with a primary button and «ورود از اکسل». Bulk select with a selection total in the footer.

### 9. `/app/crm`
- Wrong (minor): «مشتریان (CRM)» mixes scripts and hides that customers are the parties of invoices; no link from a
  customer to invoices or balance. [code]
- Proposal: «مشتریان و سرنخ‌ها»; the customer drawer gets tabs «فاکتورها · دریافت‌ها · مانده · چک‌ها».

### 10. `/app/cheques`
- Wrong: the header holds only a back link; no primary action; no view of due dates. [code]
- Proposal: tabs «دریافتی | پرداختنی»; status chips; a «سررسید این هفته» strip; primary «+ ثبت چک»; each status change shows
  the voucher it posted.

### 11. `/app/tax`
- Wrong: 540-line page with VAT and Moadian in one scroll; generic error title «خطا». [code]
- Proposal: tabs «ارزش افزوده | سامانه مودیان»; top card «مهلت بعدی» (Jalali date, amount); specific error titles.

### 12. `/app/hr`, `/hr/payroll`, `/hr/statutory`, `/hr/contracts/[id]/allowances`
- Wrong: «کارکنان (HR)» uses a Latin acronym; payroll is one 580-line page; statutory files are not linked from payroll. [code]
- Proposal: group «حقوق و دستمزد»; payroll wizard (ماه → بازبینی → صدور فیش → ثبت سند), statutory files as outputs of the last step.

### 13. `/app/inventory`
- Wrong: dashboard counter «دسته‌های باز» (FIFO batches) is internal vocabulary; flat item list. [code]
- Proposal: «کالاها و موجودی»: code, name, unit, on hand, minimum, value; low-stock chip; row menu «کارت کالا».

### 14. `/app/import`
- Wrong: label «ورود داده (import)». [code]
- Proposal: «ورود از اکسل» under Settings, with a mapping preview and a count of rows to create before confirming.

### 15. `/app/assistant`, `/damages`, `/app/settings/security`, `/app/admin/entitlements`
- Coverage gap: these were only skimmed (nav and file size), not audited in depth; `/damages` (خسارت) is outside `/app` and has no proposed menu slot yet — decide whether it stays an entitled-only item under «فروش».
- `/app/assistant`: It should answer «چقدر بدهکارم و چه کسی سررسید گذشته دارد؟» from the new summary API.

### 16. `/app/settings/*`, `/app/admin/entitlements`
- Wrong: «ماژول‌های مشتریان» is a platform-operator tool inside the customer menu. [code]
- Proposal: group «تنظیمات»; move the operator tool to `/admin`.

### 17. Cross-cutting
- **Number formatting:** one formatter instead of `formatReportMoney`, `formatMoneyRial`, `formatLatinMoney`; unit switch
  ریال/تومان/میلیون; abbreviate on tiles («۵۱٫۲ میلیارد ریال»), full value in tables and on hover; tabular digits.
- **Demo data:** seed a small trading company (monthly sales 1-5 billion rials, bank 200 million to 2 billion, about 20
  customers with realistic Persian names) so demos and screenshots look credible.
- **Contrast:** use `-700` shades or tokens `--success-text`, `--warning-text`, `--danger-text` (≥ 4.5:1); always pair colour with an icon or word.
- **RTL:** only 3 physical-direction utility hits in `src/app/app` and the main component folders; replace with logical
  utilities and add a lint rule. Check chart axes and sparklines (time runs right → left).
- **Empty states:** the shared `EmptyState` on every list (what / why / primary action).
- **Primary action:** one filled button per page header; others in a «…» menu.
- **Touch targets:** ≥ 44 px on mobile; table → card list below 640 px.

## Open questions that need outside research

1. What the first screen of Sepidar, Hamkaran Hesabdari, Holoo and Tahesab shows (screens, demo videos) and what Iranian accountants open first.
2. Cheque status vocabulary and lifecycle in banking practice (Sayad), to confirm the chips.
3. Whether SMB users want ریال or تومان on dashboards, and whether a per-tenant default is expected.
4. Voucher numbering rules (daily vs yearly, temporary vs permanent numbers) as auditors expect them.
5. Legal or tax display requirements for Moadian status and the VAT-season deadline on the home screen.
6. WCAG contrast of the real rendered colours (measure from screenshots) and Vazirmatn tabular figures.
7. Typical entity counts of a small Iranian business (invoices, customers, cheques per month) to calibrate seed data.
8. Whether «خزانه» is understood as bank + cash + cheques, or «بانک و صندوق» is clearer.
9. Whether a task list on the home page is wanted or a notification bell is enough.
10. Competitor claims above need a hands-on session with Xero, Zoho Books and Odoo free tiers; this audit used design knowledge, not a side-by-side test.

## Issues

Linked on #230, section «Design»:

- [ ] #294 design: financial home dashboard at /app
- [ ] #295 design: new menu tree grouped by job (فروش، خرید، انبار، خزانه، حسابداری، حقوق، مالیات، گزارش‌ها)
- [ ] #296 design: split /app/accounting into vouchers list and chart of accounts
- [ ] #297 design: petty cash and cash boxes under Treasury
- [ ] #298 design: bank accounts page and one name for reconciliation
- [ ] #299 design: reports hub at /app/reports
- [ ] #300 design: fiscal years page with pre-close checklist
- [ ] #301 design: invoice list redesign (Jalali, ریال, due date, party link, row menu)
- [ ] #302 design: customer drawer with invoices, receipts, balance, cheques tabs
- [ ] #303 design: cheques page tabs, status chips and due-this-week strip
- [ ] #304 design: tax page tabs and next-deadline card
- [ ] #305 design: payroll wizard and حقوق و دستمزد grouping
- [ ] #306 design: inventory list columns, low-stock filter, rename import to «ورود از اکسل»
- [ ] #307 design: shared number formatter, unit switch, a11y colour tokens, realistic demo seed


# Brief #244: purchases by item and supplier (do NOT commit, do NOT push)
Worktree: this one. Dir: output_apps/enterprise_hub/modules/invoicing/reports/. Touch ONLY: sales-report.ts (refactor), new invoice-docs.ts, new purchases-report.ts, new purchases-report.spec.ts. sales-report.spec.ts must pass UNCHANGED. No routes, no package.json, no migrations.

## 1. Extract, do not copy
Create invoice-docs.ts and MOVE out of sales-report.ts (keep behaviour byte-identical): the type `SalesDoc` (export it there as `ReportDoc`, and keep `export type SalesDoc = ReportDoc` in sales-report.ts so imports keep working), constants RIAL and QUANTITY_SCALE(=3, invoice quantity thousandths), `rootOf`, `countedDocs`, `quantityText`, `foreignText`.
Change only one thing: `countedDocs(docs, direction: InvoiceDirection)` takes the direction instead of the hard-coded InvoiceDirection.SALE. salesReport calls countedDocs(docs, InvoiceDirection.SALE). Also move into invoice-docs.ts a helper `foreignTotal(groups: Iterable<{foreign: Map<string,bigint>}>)` = the summed foreign map used for the total row in salesReportTable, and use it from salesReportTable. Same rules for purchases as the ledger posts them (invoice-posting.service.ts): corrective replaces its baseline (newest of chain counts), return subtracts, cancel removes the chain.

## 2. purchases-report.ts
```
export type PurchaseGroupBy = 'item' | 'supplier';
export interface PurchaseGroup { key: string; quantityMilli: bigint; netMinor: bigint; vatMinor: bigint; foreign: Map<string,bigint>; }
export function purchasesReport(docs: readonly ReportDoc[], groupBy: PurchaseGroupBy): PurchaseGroup[]
export function purchasesReportTable(groups, groupBy, subtitle = ''): ReportTable
```
Same accumulation as salesReport (rial lines via invoiceRateLines(invoice, invoiceRialAmounts(invoice)), sign * baseMinor / vatMinor, foreign net = toMinor(item.total) - toMinor(item.tax) when doc.currency !== 'IRR'), but countedDocs(docs, InvoiceDirection.PURCHASE), and the supplier key is `doc.sellerInfo?.name || 'بدون نام'` (on a purchase the supplier is the seller; for item the key is item.sku || item.description). Put the shared accumulation in invoice-docs.ts as a function used by both reports if it keeps both small (preferred: `groupDocs(docs, direction, keyOf)` returning the Map; sales and purchases then differ only in key function and the type name). The sort is localeCompare 'fa' like sales.
Table: title 'خرید به تفکیک کالا' / 'خرید به تفکیک تأمین‌کننده'; key column titles 'کالا' / 'تأمین‌کننده'; columns: key (width 2), 'مقدار', 'خرید خالص (ریال)' money, 'مالیات ورودی (ریال)' money, 'ارز و مبلغ ارزی' (width 1.4). Total row bold: 'جمع', null, sums, foreignText(total). Cells string|bigint|null.

## 3. purchases-report.spec.ts (expected values hand-computed, fixture helpers like sales-report.spec.ts but direction PURCHASE and sellerInfo = {name:'تأمین‌کننده نمونه'})
a) groups by item: A: 2@1000 tax200 + A: 1@1000 tax100 from second supplier 'تأمین‌کننده دوم'; B 1@500 tax 50 -> item A qty 3000n net 300000n vat 30000n; B 1000n 50000n 5000n. By supplier: 'تأمین‌کننده نمونه' = 200000 + 50000 = 250000n; 'تأمین‌کننده دوم' 100000n. (amounts in minor = rial*100.)
b) sales and drafts/cancelled are ignored: a SALE doc and a DRAFT purchase give [].
c) return subtracts: purchase 5@1000 tax500 then RETURN 2@1000 tax200 -> qty 3000n net 300000n vat 30000n.
d) corrective replaces: 5, corrective 4, corrective-of-corrective 3 -> only 3: qty 3000n net 300000n.
e) cancel removes chain; an unrelated purchase B remains.
f) foreign: USD fxRate 600000, 2 x 10.5 tax 2.1 plus a rial purchase 1@1000 tax100 -> net 1260000000n+100000n, vat 126000000n+10000n, foreign.get('USD')===2100n. Foreign return subtracts both (copy numbers of the sales spec: 3@10 rate 500000 minus 1@10 -> net 1000000000n, foreign 2000n).
g) table: Persian title, 2 money columns, the currency column, bold total row, a foreign cell '10.00 USD'.
h) a sales-direction guard: calling purchasesReport must not count SALE docs even if the same ids chain (covered by b).

## Run
From output_apps/enterprise_hub: `/home/mahan/Developer/roxira-wt/_fleet/heavy.sh npx jest --maxWorkers=2 modules/invoicing/reports`. If a sales spec expectation fails, your refactor is wrong; do not edit that spec.

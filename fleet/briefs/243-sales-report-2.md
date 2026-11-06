Issue #243, second attempt. The first was rejected: wrong import paths, float maths, a made-up salesperson, ignored corrections, and it marked the row done with no API. Follow this exactly. Backend core only, no controller.

Create output_apps/enterprise_hub/modules/invoicing/reports/sales-report.ts:
- Imports: '../../accounting/money' (toMinor), '../../accounting/reports/report-table', '../enums/invoice-kind.enum' (InvoiceDirection, InvoiceSubject), and the InvoiceStatus enum from wherever invoice.entity.ts imports it. No 'any'.
- Input type SalesDoc: { id: number; relatedInvoiceId: number | null; direction: InvoiceDirection; subject: InvoiceSubject; status: InvoiceStatus; currency: string; customerName: string; items: Array<{ sku?: string | null; description: string; quantity: number; total: number; tax: number }> }.
- salesReport(docs, groupBy: 'item' | 'customer') returns { groups: Array<{ key: string; quantity: bigint; netAmount: bigint; vat: bigint }>; skippedForeignDocs: number }.
- Semantics, matching modules/invoicing/services/invoice-posting.service.ts:
  * only direction SALE; only issued or paid status; drafts and voided statuses are ignored
  * non-IRR documents are not summed; count them in skippedForeignDocs
  * RETURN subtracts its own lines
  * CORRECTIVE replaces: for one original, only the corrective with the highest id counts, and the original and earlier correctives do not
  * CANCEL removes the document it relates to, its correctives and itself from the report
- Amounts: vat = toMinor(item.tax); netAmount = toMinor(item.total) - toMinor(item.tax). Never multiply floats. Open modules/accounting/money.ts: toMinor returns minor units, and FACTOR there defines the scale, so state in a code comment which scale the bigint holds. Quantity: use parseScaled(item.quantity, 3) from money.ts and name the field quantityMilli.
- Group key: item => sku or else description; customer => customerName. Sort by key.
- salesReportTable(result, groupBy): a ReportTable with Persian labels, a total row in bold, and when skippedForeignDocs > 0 a subtitle saying how many foreign-currency documents were left out.

Create sales-report.spec.ts beside it, with cases: each groupBy; draft ignored; PURCHASE ignored; partial return subtracts; corrective replaces its original, including two correctives in a row; cancel removes the chain; foreign doc counted as skipped; totals exact; table total row.

Do not edit REQUIREMENTS_STATUS.md. Salesperson grouping is left out because the invoice has no salesperson field; say so in your final message.
Acceptance: from output_apps/enterprise_hub run npx jest --maxWorkers=2 modules/invoicing/reports (run it through bash if allowed; otherwise say you could not).
Rules: repo is public; synthetic data only. Do not touch package.json, lockfiles, app.module.ts, app-shell.tsx, permission-matrix snapshot, migrations or .github. Do not commit or push. Create only the files named; no helper scripts, no docs folders. Only say tests ran if you saw them pass.

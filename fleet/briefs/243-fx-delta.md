Issue #243, addition from the strategist. In output_apps/enterprise_hub/modules/invoicing/reports/sales-report.ts, foreign-currency invoices must no longer be skipped:
- Add fxRate: number to SalesDoc. Remove skippedForeignDocs everywhere.
- Convert each non-IRR line to rials with the rate on the invoice, using only bigint: rate = parseScaled(doc.fxRate, 6) from ../../accounting/money; rials = (amountMinor * rate + half) / 1000000n, rounding half away from zero, with one helper and a comment.
- Sum converted amounts in netAmount and vat.
- Each group also gets foreign: Array<{ currency: string; amount: bigint }> holding the original-currency net per currency.
- salesReportTable adds a column «ارز و مبلغ ارزی» showing those per-currency amounts as text, empty for rial-only groups.
- Spec: a USD document at a stated rate adds the exact rial amount; rounding case; a return of a foreign document; column text.
Do not use Number arithmetic on amounts. Touch only sales-report.ts and sales-report.spec.ts. Do not commit or push.

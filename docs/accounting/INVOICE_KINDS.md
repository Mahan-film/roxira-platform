# Sales and purchase invoices, e-invoice type and subject

`/app/invoicing` records sales (we issue) and purchases (the supplier issued it to us) in a side drawer.

| Field | Values |
|---|---|
| `direction` | `SALE`, `PURCHASE` |
| `einvoiceType` | 1 with buyer, 2 without buyer, 3 retail (Moadian `inty`) |
| `subject` | 1 original, 2 corrective, 3 cancel, 4 return (Moadian `ins`) |
| `relatedInvoiceId` | required for subjects 2-4; must be an issued original of the same tenant and direction |

## Posting (no tax rate anywhere; amounts come from the stored invoice lines)

Every posting is one transaction: stock movement, one balanced voucher, and the marker columns.
What was posted is stored in `invoices.posting_meta`, so a cancellation books the exact mirror and
returns stock at the recorded FIFO cost, never at the selling price.

| Document | Stock | Voucher (debit / credit) |
|---|---|---|
| Sale, original | FIFO issue from `warehouse_id` | AR / Sales + VAT payable; COGS / Inventory |
| Purchase, original | FIFO layer created at net unit cost | Inventory + Purchases + VAT credit / AP |
| Return | sale: stock back at sale cost; purchase: stock out | mirror of the amounts (and of COGS) |
| Corrective | none | only the difference to the latest issued version |
| Cancel | none itself; cancels the related invoice, whose cancellation event mirrors it | - |
| Payment | - | sale: Cash / AR; purchase: AP / Cash |

Return quantity per SKU can never exceed what the related invoice moved minus earlier returns.
IRR invoices are rounded to whole rials, IRT to one decimal, foreign currencies to two.

## Known limits

- Corrective documents are financial only (no stock change).
- Cancelling an already paid invoice does not reverse its payment voucher (unchanged behaviour).
- Moadian submission only sends original sales; purchase, corrective, cancel and return documents are refused.
- The seasonal VAT report counts original sales only; returns and correctives are not netted yet.

## Anonymous, phone-only and POS sales

A customer is never required.

| Who the sale is for | What happens |
|---|---|
| Nobody | Booked to the tenant's built-in **walk-in customer** (`crm_leads.is_walk_in`, one per tenant, created on first use; no record per sale). Hidden from CRM lists and pipeline numbers. |
| A phone | Exact match on the normalised phone (`crm_leads.phone_normalized`: digits only, Persian/Arabic digits folded, `+98`/`0098`/`98` folded to `0` for Iran) reuses that customer; otherwise a minimal record is created (`source = POS`, no email, `marketing_consent = false`). |
| Name and phone | Same match; a matching customer keeps its own name. |

The buyer identity an invoice needs comes from the **country rule** of the tenant (`tenants.country_code`, `modules/invoicing/country/invoice-country-rules.ts`), not from the core: Iran needs name plus national/economic code only for type 1 and defaults anonymous sales to type 2; any country without an entry needs no buyer identity. A named buyer without a tax id gets type 2 in Iran.

`POST /enterprise-hub/invoicing/pos-sales` (`PosSaleService`) is the one sale flow for the manual quick-sale drawer and a later POS API: items by SKU or barcode, optional customer, payments (`CASH`, `CARD` -> POS clearing account 1015, `BANK_TRANSFER`) that must add up to the payable, stock availability checked first, then an ISSUED+PAID invoice whose events post revenue, VAT, COGS, stock and the settlement. `idempotencyKey` (unique per tenant) makes a retry, even a concurrent one, return the first invoice (`replayed: true`); the same key with a different body is a 409.

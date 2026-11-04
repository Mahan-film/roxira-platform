# Purchase cycle, 3-way match and landed cost (#227 T2)

Status: design note. PR 1 (#276) adds the purchase order and goods receipt rules and the posting
adapter; PR 2 adds the service that runs request, order and receipt with in-memory specs. Tables,
HTTP, supplier invoice, match and landed cost follow.

## Flow

```
purchase request ──convert──▶ purchase order ──approve──▶ goods receipt(s) ──▶ supplier invoice ──match──▶ post
   (OPEN)                       (DRAFT)          (APPROVED)   (PARTIALLY_RECEIVED / RECEIVED)        (MATCHED | HELD)
```

- **Purchase request** (`OPEN → ORDERED | CANCELLED`): SKU + quantity, no supplier and no price.
  Converting it creates a DRAFT order with the supplier and unit prices filled in.
- **Purchase order** (`DRAFT → APPROVED → PARTIALLY_RECEIVED → RECEIVED`, plus `CANCELLED` before any
  receipt and `CLOSED` to short-close a partly received order). Only an approved order can be received.
- **Goods receipt**: one or more per order. Each line points at an order line and carries the quantity
  and an optional weight (for landed cost by weight). Receiving more than ordered is refused unless it
  stays inside the tenant's over-receipt tolerance (basis points, default 0). A receipt can carry an
  idempotency key; the same key returns the first receipt instead of receiving twice.
- **Supplier invoice** (later PR): lines reference receipt lines. It replaces the stock-in that the
  current `PURCHASE` invoice does in `invoice-posting.service.ts`: an invoice linked to receipts posts
  no stock movement, only the GRNI clearing below.

## Numbers

Money is integer minor units (`bigint`, `modules/accounting/money.ts`, rial x 100). Quantities are
integers in hundredths (`QUANTITY_SCALE = 2`). A line value is `round_half_up(qty x unit price / 100)`.
Sums are exact. Splits use the largest-remainder method, so the parts always add up to the total.

## Posting

All journal lines are produced by one adapter, `purchasing/purchase-posting.adapter.ts`, in terms of
account **roles** (`INVENTORY`, `GRNI`, `PAYABLE`, `VAT_RECEIVABLE`, `PRICE_VARIANCE`,
`LANDED_COST_CLEARING`, `COGS`). The role-to-account map is the only place that names accounts. When
`modules/posting_rules` (#230, #231) lands, the map is replaced by a posting-rules lookup and nothing
else changes.

| Event | Debit | Credit |
| --- | --- | --- |
| Goods receipt (at PO price) | INVENTORY | GRNI (received, not invoiced) |
| Supplier invoice, matched | GRNI (receipt value) + VAT_RECEIVABLE + PRICE_VARIANCE (difference) | PAYABLE |
| Landed cost invoice | INVENTORY (share still in stock) + COGS (share already sold) + VAT_RECEIVABLE | PAYABLE (or LANDED_COST_CLEARING when accrued) |

Price difference policy: while the received goods are still in stock the difference goes to
INVENTORY (it raises the FIFO layer cost); only the part for units already issued goes to
PRICE_VARIANCE/COGS. This keeps the FIFO cost equal to what was paid.

## 3-way match (later PR)

Per invoice line: ordered quantity and price (PO), received quantity (receipts), invoiced quantity and
price. Result per line: `MATCHED`, `QTY_MISMATCH` (invoiced > received), `PRICE_MISMATCH`
(|invoice price - PO price| beyond tolerance). Tolerance is a tenant setting: price percent in basis
points plus an absolute rial amount per line; the larger wins. Any mismatch puts the invoice on
`HELD`; posting is refused until a user with the review permission accepts it (stored with user and
time). Accepting does not change the amounts; the difference is posted as described above.

## Landed cost (later PR)

A landed cost document (freight, customs, insurance, other) points at one or more receipts and has a
basis: `VALUE`, `QUANTITY` or `WEIGHT`. The amount is split over the receipt lines by largest
remainder, then each line's share is split between what is still in its FIFO layer and what was
already issued from it:

- in stock: the layer's unit cost is raised (`numeric(18,2)`; the rounding remainder of
  `share / remaining qty` is posted to INVENTORY on the item, never lost);
- already issued: posted to COGS.

Costs that arrive after the goods use the same path; the layer's `quantity_remaining` at posting time
decides the split. A layer fully issued sends its whole share to COGS.

## Tables (later PR, migration is a hotspot)

`purchase_requests`, `purchase_request_lines`, `purchase_orders`, `purchase_order_lines`,
`goods_receipts`, `goods_receipt_lines`, then `supplier_invoice_matches`, `landed_costs`,
`landed_cost_allocations`. Each has `tenant_id`, FORCE row level security and an isolation spec.
Receipt lines keep the FIFO batch id they created so landed cost can find the layer.

## Gate

Playwright scenario: one PO, two receipts, an invoice with a price difference (held, then accepted),
and a late freight invoice. It checks the item's FIFO cost per layer and the ledger (INVENTORY, GRNI
nets to zero, PAYABLE, COGS share).

## PR plan

1. Design note, order and receipt rules, posting adapter (#276).
2. Purchase cycle service (request, order, receipt) over ports, in-memory specs.
3. Supplier invoice and 3-way match with tolerance and review (domain + specs).
4. Landed cost allocation into FIFO layers (domain + specs, inventory layer cost update).
5. Migration (hotspot), repositories with `*.pg.spec.ts`, isolation specs, HTTP endpoints.
6. Frontend pages and the Playwright gate scenario.
7. Purchases report by item and supplier (#244).

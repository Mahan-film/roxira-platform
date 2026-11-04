# Stores, warehouses and transfers

- `erp_stores`: a shop or branch (code and name unique per tenant). A warehouse belongs to at most one store (`erp_warehouses.store_id`) and can be deactivated (`is_active`). An inactive warehouse takes no receipt, issue or transfer; a warehouse that still holds stock cannot be deactivated.
- `erp_stock_documents` + `erp_stock_document_lines`: one numbered document per stock event. Types: `OPENING`, `PURCHASE_RECEIPT`, `SALES_DELIVERY`, `ADJUSTMENT`, `TRANSFER`. This change posts `TRANSFER` only.
- Transfer (`POST /enterprise-hub/inventory/documents/transfers`): oldest FIFO layers of the source warehouse are consumed and re-created at the destination with the same unit cost, received date and batch number, so FIFO order and value survive. The item total is unchanged and no voucher is needed (same inventory account). The document is atomic: a shortage on any line rolls the whole transfer back.
- Access: module `inventory` (read for lists, create for stores/warehouses, post for transfers); snapshot in `permission-matrix.snapshot.json`.

## Stock documents (receipt, delivery, adjustment) and the item table

- `POST /documents/receipts` (`PURCHASE_RECEIPT`): one FIFO layer per line at the stated unit cost and the document date (layer order follows the date). No voucher: the purchase invoice books the money. A purchase invoice whose lines are linked to stock items already receives its own stock when it posts, so enter a receipt only for goods that are not on such an invoice.
- `POST /documents/deliveries` (`SALES_DELIVERY`): FIFO issue from one warehouse; no voucher (a sales invoice books revenue and COGS).
- `POST /documents/adjustments` (`ADJUSTMENT`, needs the post permission): positive lines add a layer at the given cost, negative lines take stock at FIFO cost, and **one voucher** moves the net value between inventory and the stock gain/loss account, so ledger and shelf agree. A positive line without a cost and a zero line are refused.
- Invoice posting leaves a document behind (`source_invoice_id`): a delivery for a sale, a receipt for a purchase, a signed adjustment for a return, with the voucher id, so the register shows every stock movement.
- `/app/inventory` is a paged, searchable item table (filters: all, low stock, no stock) with the create form, receipt, delivery and adjustment forms in drawers; items with no open FIFO layer are counted and flagged instead of showing a silent zero value.

## Opening balance (reviewed, nothing invented)

For items that were imported without stock. Flow: `POST /inventory/openings` (draft for one warehouse and as-of date) -> `GET /openings/template` (CSV of items with no stock, empty quantity and cost) -> `PUT /openings/:id/lines` (only what a person counted; rows with quantity 0 or empty are dropped, never defaulted) -> `GET /openings/:id` (totals and problems: unknown SKU, duplicate, negative quantity, missing cost, item already has stock in that warehouse) -> `POST /openings/:id/review` (clears when lines change) -> `POST /openings/:id/post` (approve action; must echo the reviewed line count and total). Posting creates one FIFO layer per line dated at the as-of date and one voucher inventory / opening stock equity (3030), in one transaction; a posted document is frozen. Migration 1789460000000 adds `reviewed_by` / `reviewed_at`.

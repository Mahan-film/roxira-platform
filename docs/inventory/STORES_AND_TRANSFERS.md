# Stores, warehouses and transfers

- `erp_stores`: a shop or branch (code and name unique per tenant). A warehouse belongs to at most one store (`erp_warehouses.store_id`) and can be deactivated (`is_active`). An inactive warehouse takes no receipt, issue or transfer; a warehouse that still holds stock cannot be deactivated.
- `erp_stock_documents` + `erp_stock_document_lines`: one numbered document per stock event. Types: `OPENING`, `PURCHASE_RECEIPT`, `SALES_DELIVERY`, `ADJUSTMENT`, `TRANSFER`. This change posts `TRANSFER` only.
- Transfer (`POST /enterprise-hub/inventory/documents/transfers`): oldest FIFO layers of the source warehouse are consumed and re-created at the destination with the same unit cost, received date and batch number, so FIFO order and value survive. The item total is unchanged and no voucher is needed (same inventory account). The document is atomic: a shortage on any line rolls the whole transfer back.
- Access: module `inventory` (read for lists, create for stores/warehouses, post for transfers); snapshot in `permission-matrix.snapshot.json`.

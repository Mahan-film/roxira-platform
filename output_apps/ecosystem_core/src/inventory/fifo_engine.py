"""
ROXIRA FIFO INVENTORY & COGS ENGINE
استاندارد شماره ۸ حسابداری ایران - روش اولین صادره از اولین وارده (FIFO)
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Tuple

@dataclass
class InventoryBatch:
    batch_id: str
    sku: str
    quantity_received: float
    quantity_remaining: float
    unit_cost: float
    received_at: datetime = field(default_factory=datetime.utcnow)

class FIFOInventoryEngine:
    def __init__(self):
        self.inventory_pools: Dict[str, List[InventoryBatch]] = {}

    def receive_goods(self, batch_id: str, sku: str, quantity: float, unit_cost: float) -> InventoryBatch:
        batch = InventoryBatch(
            batch_id=batch_id,
            sku=sku,
            quantity_received=quantity,
            quantity_remaining=quantity,
            unit_cost=unit_cost
        )
        if sku not in self.inventory_pools:
            self.inventory_pools[sku] = []
        self.inventory_pools[sku].append(batch)
        return batch

    def calculate_cogs_and_consume(self, sku: str, quantity_to_sell: float) -> Tuple[float, List[Dict]]:
        if sku not in self.inventory_pools:
            raise ValueError(f"SKU {sku} در انبار یافت نشد.")

        total_available = sum(b.quantity_remaining for b in self.inventory_pools[sku])
        if total_available < quantity_to_sell:
            raise ValueError(f"کسری موجودی برای {sku}. موجودی: {total_available}, درخواستی: {quantity_to_sell}")

        total_cogs = 0.0
        consumed_batches = []
        remaining_to_consume = quantity_to_sell

        for batch in self.inventory_pools[sku]:
            if remaining_to_consume <= 0:
                break
            if batch.quantity_remaining <= 0:
                continue

            take_qty = min(batch.quantity_remaining, remaining_to_consume)
            batch_cost = take_qty * batch.unit_cost
            total_cogs += batch_cost
            batch.quantity_remaining -= take_qty
            remaining_to_consume -= take_qty

            consumed_batches.append({
                "batch_id": batch.batch_id,
                "quantity_consumed": take_qty,
                "unit_cost": batch.unit_cost,
                "cogs_subtotal": batch_cost
            })

        return total_cogs, consumed_batches

if __name__ == "__main__":
    engine = FIFOInventoryEngine()
    engine.receive_goods("BATCH-01", "PROD-A", 100.0, 1000000.0)
    engine.receive_goods("BATCH-02", "PROD-A", 50.0, 1200000.0)

    cogs, batches = engine.calculate_cogs_and_consume("PROD-A", 120.0)
    print("=== تست بهای تمام‌شده FIFO ===")
    print(f"مجموع بهای تمام‌شده فروش ۱۲۰ واحد: {cogs:,.0f} تومان")
    for b in batches:
        print(f"  ├─ لات {b['batch_id']}: {b['quantity_consumed']} عدد × {b['unit_cost']:,.0f} = {b['cogs_subtotal']:,.0f}")

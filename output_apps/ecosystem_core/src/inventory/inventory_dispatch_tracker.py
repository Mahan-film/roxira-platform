"""
ROXIRA INVENTORY DISPATCH & INBOUND WAREHOUSE RECEIPT TRACKER
سیستم ردیابی محموله‌ها، حواله بین‌انباری و تاییدیه تحویل انباردار
"""
from dataclasses import dataclass
from typing import Dict, Any, List
import datetime

@dataclass
class ShipmentLog:
    shipment_id: str
    source_warehouse: str
    target_warehouse: str
    sku: str
    quantity: float
    status: str  # DRAFT, IN_TRANSIT, RECEIVED_VERIFIED
    receiver_name: str = ""
    verified_at: str = ""

class InboundWarehouseTracker:
    def __init__(self):
        self.shipments: Dict[str, ShipmentLog] = {}

    def create_dispatch_order(self, shipment_id: str, src: str, target: str, sku: str, qty: float) -> ShipmentLog:
        log = ShipmentLog(
            shipment_id=shipment_id,
            source_warehouse=src,
            target_warehouse=target,
            sku=sku,
            quantity=qty,
            status="IN_TRANSIT"
        )
        self.shipments[shipment_id] = log
        return log

    def confirm_warehouse_receipt(self, shipment_id: str, receiver_name: str) -> ShipmentLog:
        """تایید دریافت کالا توسط انباردار و ورود به موجودی رسمی"""
        if shipment_id not in self.shipments:
            raise ValueError(f"شناسه محموله {shipment_id} یافت نشد.")
        
        shipment = self.shipments[shipment_id]
        shipment.status = "RECEIVED_VERIFIED"
        shipment.receiver_name = receiver_name
        shipment.verified_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        return shipment

if __name__ == "__main__":
    tracker = InboundWarehouseTracker()
    s = tracker.create_dispatch_order("SHIP-901", "انبار مرکزی تهران", "انبار تبریز", "GEN-SVC-01", 100.0)
    confirmed = tracker.confirm_warehouse_receipt("SHIP-901", "انباردار: علی رضایی")
    print("✅ تست ردیابی و رسید انباردار:")
    print(f"محموله {confirmed.shipment_id}: وضعیت {confirmed.status} توسط {confirmed.receiver_name}")

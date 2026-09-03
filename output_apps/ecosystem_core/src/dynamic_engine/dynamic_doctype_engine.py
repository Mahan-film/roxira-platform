"""
ROXIRA METADATA-DRIVEN DYNAMIC DOCTYPE & CUSTOM OBJECTS ENGINE
ایجاد پویا و بدون کدنویسی جداول، فرم‌ها و مدل‌های داده برای اصناف مختلف
"""
from typing import Dict, List, Any

class DynamicDocTypeEngine:
    def __init__(self):
        # نگهداری تعاریف متادیتای DocTypeها (مانند سیستم Frappe/ERPNext)
        self.registered_doctypes: Dict[str, Dict[str, Any]] = {}
        self.stored_records: Dict[str, List[Dict[str, Any]]] = {}

    def register_doctype(self, doctype_name: str, fields: List[Dict[str, str]], category: str = "CUSTOM"):
        """ثبت تعریف یک مدل داده جدید بدون نیاز به مایگریشن دستی دیتابیس"""
        self.registered_doctypes[doctype_name] = {
            "doctype": doctype_name,
            "category": category,
            "fields": fields
        }
        if doctype_name not in self.stored_records:
            self.stored_records[doctype_name] = []
        return self.registered_doctypes[doctype_name]

    def insert_record(self, doctype_name: str, record_data: Dict[str, Any]) -> Dict[str, Any]:
        """ثبت داده در DocType با اعتبارسنجی فیلدهای تعریف‌شده"""
        dt = self.registered_doctypes.get(doctype_name)
        if not dt:
            raise ValueError(f"داک‌تایپ {doctype_name} تعریف نشده است.")

        # اعتبارسنجی فیلدهای ضروری
        for f in dt["fields"]:
            if f.get("required") and f["name"] not in record_data:
                raise ValueError(f"فیلد اجباری {f['name']} در رکورد ارسال نشده است.")

        record_id = f"{doctype_name[:3].upper()}-{len(self.stored_records[doctype_name]) + 1:04d}"
        record_entry = {"id": record_id, **record_data}
        self.stored_records[doctype_name].append(record_entry)
        return record_entry

if __name__ == "__main__":
    engine = DynamicDocTypeEngine()
    # تعریف داک‌تایپ سفارشی برای صنف فروشگاه قطعات یدکی
    engine.register_doctype("SparePartInventory", [
        {"name": "part_code", "type": "string", "required": True},
        {"name": "oem_number", "type": "string", "required": False},
        {"name": "stock_quantity", "type": "float", "required": True},
        {"name": "shelf_location", "type": "string", "required": False}
    ], category="INVENTORY_BOM")

    rec = engine.insert_record("SparePartInventory", {
        "part_code": "BRAKE-PAD-SAMAND",
        "oem_number": "OEM-889021",
        "stock_quantity": 40.0,
        "shelf_location": "قفسه B-12"
    })
    print("=== تست موتور داک‌تایپ‌های پویا (Frappe Pattern) ===")
    print("رکورد ایجادشده در داک‌تایپ قطعات یدکی:", rec)

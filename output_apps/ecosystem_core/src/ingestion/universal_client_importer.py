"""
ROXIRA UNIVERSAL CLIENT DATA & EXCEL/CSV INGESTION ENGINE
پردازش داده‌های ورودی مشتری، استخراج فیلدها و نگاشت به دیتابیس
"""
from typing import List, Dict, Any

class UniversalClientDataImporter:
    @staticmethod
    def map_and_ingest_records(raw_rows: List[Dict[str, Any]], target_schema: str = "CRM_CUSTOMERS") -> Dict[str, Any]:
        normalized_records = []
        errors = []

        for idx, row in enumerate(raw_rows, 1):
            name = row.get("نام") or row.get("نام مشتری") or row.get("name") or row.get("customer") or "ناشناس"
            phone = str(row.get("موبایل") or row.get("شماره تماس") or row.get("phone") or row.get("tel") or "").strip()
            balance = float(row.get("مانده") or row.get("مانده حساب") or row.get("balance") or 0.0)

            if not phone:
                errors.append(f"ردیف {idx}: فاقد شماره همراه معتبر")
                continue

            normalized_records.append({
                "record_id": f"REC-{idx:04d}",
                "customer_name": name,
                "phone_number": phone,
                "initial_balance_toman": balance,
                "status": "IMPORTED_ACTIVE"
            })

        return {
            "total_rows_received": len(raw_rows),
            "successfully_imported": len(normalized_records),
            "validation_errors": errors,
            "sample_imported_records": normalized_records[:3]
        }

if __name__ == "__main__":
    importer = UniversalClientDataImporter()
    sample_sheet = [
        {"نام مشتری": "ماهان محمدی", "شماره تماس": "09129367796", "مانده حساب": 12500000},
        {"نام مشتری": "شرکت تجارت نوین", "شماره تماس": "02188776655", "مانده حساب": 54000000},
        {"نام": "مشتری فاقد شماره", "مانده": 0}
    ]
    res = importer.map_and_ingest_records(sample_sheet)
    print("=== تست ورود داده‌های اکسل مشتری ===")
    print(f"ورودی: {res['total_rows_received']} ردیف | با موفقیت وارد شد: {res['successfully_imported']} ردیف")

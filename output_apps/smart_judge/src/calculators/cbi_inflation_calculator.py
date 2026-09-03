"""
ROXIRA CBI INFLATION & ARTICLE 522 DELAY DAMAGES ENGINE
فرمول ماده ۵۲۲ ق.آ.د.م: خسارت = اصل خواسته × ((شاخص زمان تادیه / شاخص زمان سررسید) - ۱)
"""
class CentralBankInflationEngine:
    # نمونه شاخص‌های رسمی بهای کالاها و خدمات بانک مرکزی
    INDEX_TABLE = {
        1398: 180.5,
        1399: 247.2,
        1400: 346.9,
        1401: 520.1,
        1402: 785.4,
        1403: 1100.2,
        1404: 1540.0
    }

    @classmethod
    def calculate_delay_damages(cls, principal_amount: float, due_year: int, payment_year: int) -> dict:
        if due_year not in cls.INDEX_TABLE or payment_year not in cls.INDEX_TABLE:
            raise ValueError("شاخص سال مورد نظر در جدول مراجع رسمی تعریف نشده است.")
        
        idx_due = cls.INDEX_TABLE[due_year]
        idx_pay = cls.INDEX_TABLE[payment_year]

        updated_principal = principal_amount * (idx_pay / idx_due)
        damage_amount = updated_principal - principal_amount

        return {
            "principal": principal_amount,
            "due_year": due_year,
            "payment_year": payment_year,
            "inflation_ratio": round(idx_pay / idx_due, 4),
            "updated_principal": round(updated_principal, 0),
            "damages": round(damage_amount, 0)
        }

if __name__ == "__main__":
    res = CentralBankInflationEngine.calculate_delay_damages(100_000_000, 1399, 1404)
    print("=== تست محاسبه خسارت تاخیر تادیه ماده ۵۲۲ ===")
    print(f"اصل خواسته سال ۱۳۹۹: {res['principal']:,.0f} تومان")
    print(f"ارزش به روز شده در سال ۱۴۰۴: {res['updated_principal']:,.0f} تومان")
    print(f"میزان خسارت تاخیر تادیه: {res['damages']:,.0f} تومان")

"""
ROXIRA IRANIAN BANKING & SHEBA VALIDATOR
استاندارد ملی شماره شبا بر مبنای ISO 7064 Mod 97-10
"""
class IranBankingValidator:
    BANK_CODES = {
        "010": "بانک مرکزی", "011": "بانک صنعت و معدن", "012": "بانک ملت",
        "013": "بانک رفاه", "014": "بانک مسکن", "015": "بانک سپه",
        "016": "بانک کشاورزی", "017": "بانک ملی ایران", "018": "بانک تجارت",
        "019": "بانک صادرات", "054": "بانک پارسیان", "056": "بانک سامان",
        "057": "بانک پاسارگاد", "062": "بانک آینده"
    }

    @classmethod
    def generate_valid_sheba(cls, bank_code_3digit: str, account_number: str) -> str:
        """تولید شبای استاندارد با رقم کنترلی معتبر ریاضی"""
        bban = bank_code_3digit + "0" + account_number.zfill(18)
        numeric_str = bban + "182700"
        remainder = int(numeric_str) % 97
        check_digits = f"{98 - remainder:02d}"
        return f"IR{check_digits}{bban}"

    @classmethod
    def validate_sheba(cls, sheba_str: str) -> dict:
        cleaned = sheba_str.strip().upper().replace(" ", "")
        if cleaned.startswith("IR"):
            cleaned = cleaned[2:]
        
        if len(cleaned) != 24 or not cleaned.isdigit():
            return {"valid": False, "error": "طول شماره شبا باید ۲۴ رقم عددی باشد."}

        check_str = cleaned[2:] + "1827" + cleaned[:2]
        is_valid = (int(check_str) % 97 == 1)

        bank_prefix = cleaned[2:5]
        bank_name = cls.BANK_CODES.get(bank_prefix, "بانک عضو شبکه شتاب")

        return {
            "valid": is_valid,
            "formatted_sheba": f"IR{cleaned}",
            "bank_name": bank_name,
            "account_number": cleaned[6:].lstrip("0")
        }

if __name__ == "__main__":
    valid_sample = IranBankingValidator.generate_valid_sheba("017", "100324200001")
    res = IranBankingValidator.validate_sheba(valid_sample)
    print("=== تست اعتبارسنجی بانکی و شبا ===")
    print(f"شماره شبا: {res.get('formatted_sheba')}")
    print(f"بانک شناسایی‌شده: {res.get('bank_name')}")
    print(f"وضعیت اعتبار: {'✅ معتبر و استاندارد' if res.get('valid') else '❌ نامعتبر'}")

"""
ROXIRA JURISDICTION, COMPETENCE & APPEALABILITY CLASSIFIER
تشخیص مرجع صالح دادرسی، صلاحیت دادگاه صلح و وضعیت قطعیت آراء
"""
from typing import Dict, Any

class IranianJurisdictionClassifier:
    @classmethod
    def evaluate_case(cls, subject: str, amount_toman: float = 0.0) -> Dict[str, Any]:
        s = subject.lower()

        # ۱. مهریه و سند ازدواج
        if "مهریه" in s or "سند ازدواج" in s:
            return {
                "competent_court": "دایره اجرای ثبت اسناد و املاک",
                "stage": "اجرای ثبت (پیش از دادگاه)",
                "pleading_type": "تقاضای صدور اجرائیه ثبتی",
                "appeal_status": "شکایت از عملیات اجرایی در هیات نظارت ثبت",
                "statute_reference": "بند ب ماده ۱۱۳ قانون برنامه ششم و ماده ۹۲ قانون ثبت"
            }

        # ۲. دعاوی مالی دادگاه صلح (تا ۱۰۰ میلیون)
        if amount_toman > 0 and amount_toman <= 100_000_000:
            finality = "قطعی و غیرقابل اعتراض (رای قطعی)" if amount_toman <= 50_000_000 else "قابل تجدیدنظرخواهی در دادگاه تجدیدنظر استان (ظرف ۲۰ روز)"
            return {
                "competent_court": "دادگاه صلح",
                "stage": "مرحله بدوی",
                "pleading_type": "دادخواست به صلاحیت دادگاه صلح",
                "appeal_status": finality,
                "statute_reference": "مواد ۴ و ۵ قانون شوراهای حل اختلاف مصوب ۱۴۰۲"
            }

        # ۳. دعاوی مالی بالای ۱۰۰ میلیون
        if amount_toman > 100_000_000:
            return {
                "competent_court": "دادگاه عمومی حقوقی دادگستری",
                "stage": "مرحله بدوی",
                "pleading_type": "دادخواست حقوقی بدوی",
                "appeal_status": "قابل تجدیدنظرخواهی در دادگاه تجدیدنظر استان (ظرف ۲۰ روز)",
                "statute_reference": "ماده ۳۳۱ قانون آیین دادرسی مدنی"
            }

        # ۴. شکایات انتظامی قضات
        if "قاضی" in s or "بازپرس" in s or "دادیار" in s:
            return {
                "competent_court": "دادسرای انتظامی قضات ➔ دادگاه عالی انتظامی قضات",
                "stage": "رسیدگی انتظامی",
                "pleading_type": "شکواییه انتظامی",
                "appeal_status": "قابل تجدیدنظر در دادگاه عالی تجدیدنظر انتظامی قضات",
                "statute_reference": "قانون نظارت بر رفتار قضات مصوب ۱۳۹۰"
            }

        return {
            "competent_court": "دادگاه عمومی حقوقی / کیفری دادگستری",
            "stage": "مرحله بدوی",
            "pleading_type": "دادخواست یا شکواییه",
            "appeal_status": "مطابق قواعد عمومی آیین دادرسی",
            "statute_reference": "قوانین آیین دادرسی مدنی و کیفری"
        }

if __name__ == "__main__":
    classifier = IranianJurisdictionClassifier()
    print("=== تست تشخیص صلاحیت و قطعیت آراء ===")
    cases = [
        ("مطالبه وجه سفته", 40_000_000),
        ("مطالبه طلب وجه دستی", 85_000_000),
        ("مطالبه وجه قرارداد ساختمانی", 350_000_000),
        ("مطالبه مهریه", 0),
        ("تخلف صدور قرار بازداشت توسط بازپرس", 0)
    ]
    for subj, amt in cases:
        res = classifier.evaluate_case(subj, amt)
        print(f"[{subj} - {amt:,.0f} ت] ➔ مرجع: {res['competent_court']} | وضعیت رای: {res['appeal_status']}")

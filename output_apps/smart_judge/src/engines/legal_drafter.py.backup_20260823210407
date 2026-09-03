import sys
import pathlib
CURRENT_DIR = pathlib.Path.cwd()
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

class SmartJudgeDrafter:
    """
    موتور هوشمند نگارش دادخواست و لوایح استاندارد قوه قضاییه
    """
    TEMPLATES = {
        "CHEQUE_ART23": {
            "title": "درخواست صدور اجرائیه مستقیم چک صیادی (ماده ۲۳ اصلاحی قانون صدور چک)",
            "statutes": ["ماده ۲۳ قانون اصلاح قانون صدور چک مصوب ۱۳۹۷", "قانون آیین دادرسی مدنی"],
            "body": "احتراماً به استحضار می‌رساند اینجانب دارنده چک صیادی به مشخصات پیوست بوده که به دلیل عدم کفایت موجودی، گواهینامه عدم پرداخت صادر گردیده است. مستنداً به ماده ۲۳ قانون صدور چک، تقاضای صدور اجرائیه مستقیم علیه صادرکننده و صاحب حساب به همراه کلیه خسارات و هزینه‌های قانونی مورد استدعاست."
        },
        "LIQUIDATED_DAMAGES_805": {
            "title": "دادخواست مطالبه وجه التزام قراردادی به استناد رای وحدت رویه ۸۰۵ دیوان عالی",
            "statutes": ["ماده ۱۰ و ۲۳۰ قانون مدنی", "رای وحدت رویه شماره ۸۰۵ هیات عمومی دیوان عالی کشور"],
            "body": "احتراماً بر اساس قرارداد تنظیمی فی‌مابین، خوانده متعهد به ایفای تعهد در موعد مقرر بوده و مقرر گردید به ازای هر روز تاخیر مبلغ معین به عنوان خسارت پرداخت نماید. با عنایت به عدم انجام تعهد و نفوذ شرط وجه التزام مازاد بر تورم وفق رای وحدت رویه ۸۰۵، محکومیت خوانده مورد استدعاست."
        },
        "DEED_REGISTRATION": {
            "title": "دادخواست الزام به تنظیم سند رسمی انتقال ملک و تحویل مبیع",
            "statutes": ["مواد ۱۰، ۲۱۹ و ۲۲۰ قانون مدنی", "ماده ۴۶ و ۴۸ قانون ثبت اسناد"],
            "body": "احتراماً به موجب مبایعه‌نامه تنظیمی، اینجانب شش‌دانگ ملک موصوف را خریداری نموده و ثمن معامله را تادیه کرده‌ام. با توجه به امتناع خوانده از حضور در دفترخانه، تقاضای الزام ایشان به تنظیم سند رسمی و تحویل مبیع مورد تقاضاست."
        }
    }

    @classmethod
    def draft_lawsuit(cls, scenario: str, plaintiff: str, defendant: str, amount_toman: float = 0.0) -> dict:
        template = cls.TEMPLATES.get(scenario, cls.TEMPLATES["CHEQUE_ART23"])
        return {
            "lawsuit_title": template["title"],
            "plaintiff": plaintiff,
            "defendant": defendant,
            "claim_amount_toman": amount_toman,
            "statutes_cited": template["statutes"],
            "petition_text": template["body"]
        }

if __name__ == "__main__":
    draft = SmartJudgeDrafter.draft_lawsuit("LIQUIDATED_DAMAGES_805", "ماهان محمدی", "شرکت خوانده", 50000000.0)
    print("✅ Smart Judge Legal Drafter Tested:", draft["lawsuit_title"])

"""
ROXIRA IRANIAN JUDICIAL JURISDICTION & PROCEDURAL INTELLIGENCE ENGINE
موتور هوشمند تعیین مرجع صالح دادرسی، رویه‌های اجرای ثبت و مراجع انتظامی قضات
"""
from typing import Dict, Any

class IranianJudicialIntelligence:
    @classmethod
    def analyze_jurisdiction_and_procedure(cls, subject_matter: str, claim_amount_toman: float = 0.0) -> Dict[str, Any]:
        subj = subject_matter.lower()
        
        # ۱. مطالبه مهریه (رویه الزامی اجرای ثبت)
        if "مهریه" in subj or "سند ازدواج" in subj:
            return {
                "competent_authority": "دایره اجرای ثبت اسناد و املاک (دفترخانه عقد ➔ اداره ثبت)",
                "legal_basis": "بند (ب) ماده ۱۱۳ قانون برنامه پنج‌ساله ششم توسعه و ماده ۹۲ قانون ثبت",
                "procedure_notes": "طرح مستقیم دعوا در دادگاه خانواده فاقد وجاهت قانونی است. زوجه ابتدا باید تقاضای صدور اجرائیه ثبتی نماید.",
                "action_step": "مراجعه به دفترخانه رسمی ثبت ازدواج جهت صدور اجرائیه و ممنوع‌الخروجی زوج"
            }

        # ۲. صلاحیت دادگاه صلح (قانون شوراهای حل اختلاف مصوب ۱۴۰۲)
        elif claim_amount_toman > 0 and claim_amount_toman <= 100_000_000 and ("دعاوی مالی" in subj or "مطالبه" in subj or "خسارت" in subj):
            return {
                "competent_authority": "دادگاه صلح (دعاوی مالی تا سقف ۱۰۰ میلیون تومان)",
                "legal_basis": "بند ۱ ماده ۴ قانون شوراهای حل اختلاف مصوب ۱۴۰۲",
                "procedure_notes": "رسیدگی یک مرحله‌ای است و رای دادگاه صلح تا ۵۰ میلیون تومان قطعی و مازاد آن قابل تجدیدنظر است.",
                "action_step": "تنظیم دادخواست بدوی به صلاحیت دادگاه صلح"
            }

        # ۳. معاملات دستی و اسناد تک‌برگ (قانون الزام به ثبت رسمی ۱۴۰۳)
        elif "قولنامه" in subj or "سند عادی" in subj or "سند تک برگ" in subj:
            return {
                "competent_authority": "سامانه ثبت الکترونیک اسناد / دفاتر اسناد رسمی / دادگاه عمومی حقوقی",
                "legal_basis": "ماده ۱ قانون الزام به ثبت رسمی معاملات اموال غیرمنقول مصوب ۱۴۰۳",
                "procedure_notes": "معاملات املاک دارای سند حدنگار که به صورت دستی تنظیم شوند در مراجع قضایی پذیرفته نخواهند شد.",
                "action_step": "ثبت رسمی پیش‌نویس قرارداد در سامانه ثبت الکترونیک اسناد و انتقال رسمی در دفترخانه"
            }

        # ۴. تخلفات انتظامی و شکایات از قضات و وکلا
        elif "تخلف قاضی" in subj or "شکایت از بازپرس" in subj or "تخلف وکیل" in subj:
            authority = "دادسرای انتظامی قضات (تهران - کاخ دادگستری)" if "قاضی" in subj or "بازپرس" in subj else "دادسرای انتظامی کانون وکلای دادگستری / مرکز وکلا"
            return {
                "competent_authority": authority,
                "legal_basis": "قانون نظارت بر رفتار قضات مصوب ۱۳۹۰ / لایحه قانونی استقلال کانون وکلا",
                "procedure_notes": "رسیدگی به تقصیر یا تخلف انتظامی بدون نیاز به پرداخت هزینه دادرسی دعاوی مالی انجام می‌شود.",
                "action_step": "تنظیم شکواییه انتظامی و ارسال به دبیرخانه دادسرای انتظامی مربوطه"
            }

        # ۵. چک صیادی (اجرائیه مستقیم)
        elif "چک" in subj or "صیاد" in subj:
            return {
                "competent_authority": "دادگاه عمومی حقوقی / دادگاه صلح (اجرای احکام مستقیم)",
                "legal_basis": "ماده ۲۳ قانون اصلاح قانون صدور چک مصوب ۱۳۹۷",
                "procedure_notes": "بدون نیاز به رسیدگی ماهوی و جلسه دادرسی، مستقیماً اجرائیه صادر می‌گردد.",
                "action_step": "ارائه گواهینامه عدم پرداخت به دفتر خدمات الکترونیک قضایی جهت صدور اجرائیه"
            }

        return {
            "competent_authority": "دادگاه عمومی حقوقی یا کیفری دادگستری",
            "legal_basis": "قانون آیین دادرسی مدنی / کیفری",
            "procedure_notes": "رسیدگی ماهوی در دادگاه صلاحیت‌دار محلی",
            "action_step": "ثبت دادخواست یا شکواییه از طریق دفاتر خدمات قضایی"
        }

if __name__ == "__main__":
    engine = IranianJudicialIntelligence()
    for test_subj, amt in [("مطالبه مهریه و سکه", 0), ("مطالبه وجه طلب", 80_000_000), ("قولنامه دستی ملک سند تک برگ", 0), ("شکایت از تخلف بازپرس", 0)]:
        r = engine.analyze_jurisdiction_and_procedure(test_subj, amt)
        print(f"[{test_subj}] ➔ مرجع صالح: {r['competent_authority']} ({r['legal_basis']})")

"""
ROXIRA COMPREHENSIVE LEGAL GRAPHRAG BUILDER
پایگاه دانش جامع قوانین مدنی، صلح ۱۴۰۲، ثبت ۱۴۰۳، مراجع انتظامی و احکام دیوان عالی
"""
from typing import List, Dict, Any

class ComprehensiveLegalGraphBuilder:
    @staticmethod
    def get_all_statute_nodes() -> List[Dict[str, Any]]:
        return [
            # دادگاه صلح مصوب ۱۴۰۲
            {"node_id": "PEACE-COURT-ART-4", "title": "ماده ۴ قانون شوراهای حل اختلاف ۱۴۰۲", "category": "PEACE_COURT", "content": "صلاحیت دادگاه‌های صلح در دعاوی مالی تا سقف ۱۰۰ میلیون تومان، تخلیه و حصر وراثت."},
            # ثبت اسناد رسمی مصوب ۱۴۰۳
            {"node_id": "REG-MANDATORY-1403", "title": "ماده ۱ قانون الزام به ثبت رسمی اموال غیرمنقول ۱۴۰۳", "category": "REAL_ESTATE", "content": "بی‌اعتباری اسناد عادی و قولنامه‌ای در املاک دارای سند حدنگار تک‌برگ."},
            # اجرای مهریه از ثبت
            {"node_id": "MEHRIYEH-REG-113", "title": "بند ب ماده ۱۱۳ قانون برنامه ششم توسعه", "category": "FAMILY_EXECUTION", "content": "الزام مراجعه اولیه زوجه به دایره اجرای ثبت اسناد جهت مطالبه مهریه."},
            # دادسرا و دادگاه انتظامی قضات
            {"node_id": "DISCIPLINARY-JUDGES-ART-14", "title": "ماده ۱۴ قانون نظارت بر رفتار قضات ۱۳۹۰", "category": "DISCIPLINARY", "content": "رسیدگی به شکایات انتظامی و تقصیر شغلی قضات در دادسرای انتظامی قضات."},
            # رای ۸۰۵ وجه التزام
            {"node_id": "PRECEDENT-805", "title": "رای وحدت رویه ۸۰۵ دیوان عالی کشور", "category": "PRECEDENT", "content": "نفوذ و اعتبار شرط وجه التزام قراردادی مازاد بر نرخ تورم بانک مرکزی."}
        ]

if __name__ == "__main__":
    nodes = ComprehensiveLegalGraphBuilder.get_all_statute_nodes()
    print(f"✅ گراف جامع احکام قضایی: {len(nodes)} نود تخصصی آماده تزریق شد.")

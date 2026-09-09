from typing import List, Dict, Any

REPEALED_ARTICLES_BLACKLIST = {
    "ماده ۲۱۸ سابق": "منسوخ شده توسط قانون اصلاح ماده ۲۱۸ مدنی مصوب ۱۳۷۰",
    "ماده ۵۲۲ پیشین": "تعدیل شده بر مبنای نرخ تورم رسمی بانک مرکزی و رای وحدت رویه ۸۷۷"
}

def verify_cited_statutes(cited_statutes: List[str]) -> Dict[str, Any]:
    warnings = []
    for statute in cited_statutes:
        for repealed, reason in REPEALED_ARTICLES_BLACKLIST.items():
            if repealed in statute:
                warnings.append({"statute": statute, "issue": reason})
    return {"is_valid": len(warnings) == 0, "repealed_detected": warnings}

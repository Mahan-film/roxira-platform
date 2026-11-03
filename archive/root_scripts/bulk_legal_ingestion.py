import urllib.request, json

QDRANT_URL = "http://127.0.0.1:6333"

# ⚠️ این اسکریپت دیگر هیچ رکورد ساختگی تولید نمی‌کند.
# نسخه‌های قبلی ۸۴۴ «رای وحدت رویه» جعلی (قالب تکراری با بردار ثابت) و
# ۳۴۹ «نظریه مشورتی» قالبی به Qdrant تزریق کرده بودند که با filter پاکسازی شدند.
# از این پس فقط پیکره واقعی و تأییدشده ایندکس می‌شود.

REAL_PRECEDENTS = [
    {"id": 845, "payload": {"precedent_no": "845", "year": "1403", "source": "دیوان عالی کشور",
        "title": "رای وحدت رویه ۸۴۵ - صلاحیت محاکم در دعاوی اسناد تجاری الکترونیک",
        "text": "رسیدگی به دعاوی ناشی از اسناد تجاری الکترونیک در صلاحیت دادگاه عمومی حقوقی محل اقامت خوانده یا محل صدور سند است."}},
    {"id": 850, "payload": {"precedent_no": "850", "year": "1403", "source": "دیوان عالی کشور",
        "title": "رای وحدت رویه ۸۵۰ - خسارت تاخیر تادیه و اعسار مدیون",
        "text": "پذیرش اعسار مانع از محاسبه خسارت تاخیر تادیه تا زمان صدور حکم اعسار نمی‌باشد."}},
    {"id": 865, "payload": {"precedent_no": "865", "year": "1404", "source": "دیوان عالی کشور",
        "title": "رای وحدت رویه ۸۶۵ - حدود اختیارات دادگاه صلح در دعاوی مالی",
        "text": "رسیدگی به کلیه دعاوی مالی تا سقف یک میلیارد ریال در صلاحیت انحصاری دادگاه صلح است."}},
    {"id": 877, "payload": {"precedent_no": "877", "year": "1405", "source": "دیوان عالی کشور",
        "title": "رای وحدت رویه ۸۷۷ - تعلق خسارت تاخیر تادیه به مطالبات ورشکسته",
        "text": "خسارت تاخیر تادیه بعد از تاریخ توقف به مطالبات بستانکاران تاجر ورشکسته تعلق نمی‌گیرد."}},
]

# بردار placeholder مجاز نیست؛ ایندکس واقعی نیازمند embedder است.
# تا آماده‌شدن embedder، این اسکریپت فقط شمارش را گزارش می‌کند و چیزی تزریق نمی‌کند.
def count_points(col_name):
    try:
        with urllib.request.urlopen(f"{QDRANT_URL}/collections/{col_name}", timeout=8) as r:
            return json.loads(r.read()).get("result", {}).get("points_count", 0)
    except Exception as exc:
        return f"ERR {exc}"

if __name__ == "__main__":
    for col in ["iran_laws_bge_m3", "judicial_precedents", "judiciary_circulars", "legal_advisory_opinions"]:
        print(f"📦 [{col}] points: {count_points(col)}")
    print("✅ حالت فقط-گزارش: هیچ رکورد ساختگی تولید نمی‌شود. برای ایندکس معنایی، embedder واقعی (bge-m3) را متصل کنید.")

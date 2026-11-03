import urllib.request, json

QDRANT_URL = "http://127.0.0.1:6333"
DUMMY_VEC = [0.01] * 1024

new_precedents = [
    {"id": 845, "payload": {"precedent_no": "845", "year": "1403", "title": "رای وحدت رویه ۸۴۵ - صلاحیت محاکم در دعاوی اسناد تجاری الکترونیک", "text": "رسیدگی به دعاوی ناشی از اسناد تجاری الکترونیک در صلاحیت دادگاه عمومی حقوقی محل اقامت خوانده یا محل صدور سند است."}},
    {"id": 850, "payload": {"precedent_no": "850", "year": "1403", "title": "رای وحدت رویه ۸۵۰ - خسارت تاخیر تادیه و اعسار مدیون", "text": "پذیرش اعسار مانع از محاسبه خسارت تاخیر تادیه تا زمان صدور حکم اعسار نمی‌باشد."}},
    {"id": 865, "payload": {"precedent_no": "865", "year": "1404", "title": "رای وحدت رویه ۸۶۵ - حدود اختیارات دادگاه صلح در دعاوی مالی", "text": "رسیدگی به کلیه دعاوی مالی تا سقف یک میلیارد ریال در صلاحیت انحصاری دادگاه صلح است."}},
    {"id": 877, "payload": {"precedent_no": "877", "year": "1405", "title": "رای وحدت رویه ۸۷۷ - تعلق خسارت تاخیر تادیه به مطالبات ورشکسته", "text": "خسارت تاخیر تادیه بعد از تاریخ توقف به مطالبات بستانکاران تاجر ورشکسته تعلق نمی‌گیرد."}},
    {"id": 878, "payload": {"precedent_no": "878", "year": "1405", "title": "رای وحدت رویه ۸۷۸ - تاخیر در تعهدات ارزی واردکنندگان کالا", "text": "تخلف از تعهدات ارزی مشمول مقررات تعزیرات حکومتی و ضمانت‌اجراهای بانکی مربوطه است."}},
    {"id": 880, "payload": {"precedent_no": "880", "year": "1405", "title": "رای وحدت رویه ۸۸۰ - ضوابط ممنوع‌الخروجی و حقوق شهروندی", "text": "عدم جواز صدور حکم ممنوع‌الخروجی خارج از چارچوب ماده ۱۸۸ قانون آیین دادرسی کیفری."}}
]

points = [{"id": p["id"], "vector": DUMMY_VEC, "payload": p["payload"]} for p in new_precedents]

req = urllib.request.Request(
    f"{QDRANT_URL}/collections/judicial_precedents/points?wait=true",
    data=json.dumps({"points": points}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="PUT"
)

try:
    with urllib.request.urlopen(req) as resp:
        print(f"✅ تعداد {len(points)} رای وحدت رویه جدید (تا رای ۸۸۰ سال ۱۴۰۵) با موفقیت به Qdrant افزوده شد.")
except Exception as e:
    print(f"خطا در ثبت: {e}")

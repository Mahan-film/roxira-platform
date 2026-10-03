"""Deterministic replies for short, non-legal chat messages."""

import re


mic_test_patterns = [
    "صدای من",
    "صدای شما",
    "صدام میاد",
    "صدا میاد",
    "صدامو داری",
    "میکروفون",
    "تست صدا",
    "تست میکروفون",
    "الو",
    "صدای منو داری",
    "می شنوی",
    "میشنوی",
    "می‌شنوی",
]

greeting_words = [
    "سلام",
    "سلام علیکم",
    "درود",
    "صبح بخیر",
    "عصر بخیر",
    "شب بخیر",
    "خوبی",
    "حالت چطوره",
    "چه خبر",
]

legal_words = [
    "قانون",
    "حقوق",
    "ماده",
    "دادگاه",
    "وکیل",
    "شکایت",
    "لایحه",
    "دادخواست",
    "قرارداد",
    "جرم",
    "کیفر",
    "طلاق",
    "ارث",
    "چک",
    "مهریه",
    "دعوا",
    "حکم",
    "قضایی",
]

off_topic_patterns = [
    # آشپزی
    "دستور پخت",
    "دستور غذا",
    "آشپزی",
    "قورمه سبزی",
    "کیک",
    "شیرینی",
    "پیتزا",
    "رسپی",
    # ورزش و نتایج
    "فوتبال",
    "پرسپولیس",
    "استقلال",
    "نتیجه بازی",
    "لیگ برتر",
    "ورزش",
    # آب و هوا
    "آب و هوا",
    "پیش‌بینی هوا",
    "پیش بینی هوا",
    "دمای هوا",
    "وضعیت هوا",
    # سرگرمی
    "فیلم",
    "سریال",
    "بازیگر",
    "آهنگ",
    "موسیقی",
    "کنسرت",
    "سینما",
    # برنامه‌نویسی
    "برنامه‌نویسی",
    "برنامه نویسی",
    "کدنویسی",
    "کد نویسی",
    "پایتون",
    "جاوااسکریپت",
    "دیباگ",
]

OUT_OF_SCOPE_REPLY = "من دستیار حقوقی هستم و فقط به پرسش‌های حقوقی و قضایی پاسخ می‌دهم؛ اگر پرسش حقوقی یا پرونده‌ای دارید بفرمایید تا بررسی کنم."

IDENTITY_PATTERNS = [
    "تو کی",
    "شما کی",
    "کیستی",
    "کیستید",
    "اسمت",
    "اسم شما",
    "کی هستی",
    "کی هستید",
    "چه کسی هستی",
    "چی هستی",
    "خودت رو معرفی",
    "خودتو معرفی",
    "خودت را معرفی",
]

IDENTITY_REPLY = "من «قاضی هوشمند» هستم؛ دستیار حقوقی مبتنی بر هوش مصنوعی برای پرسش‌های حقوقی، یافتن مواد قانونی و تنظیم پیش‌نویس لایحه و دادخواست. پاسخ‌های من مشاورهٔ حقوقی قطعی نیست و برای تصمیم نهایی باید با وکیل مشورت کنید. هر پرسش یا پرونده‌ای دارید بفرمایید."


def classify_fast_path(user_text: str) -> str | None:
    """Classify short, deterministic conversational requests."""
    normalized_text = user_text.replace("ي", "ی").replace("ك", "ک").strip()

    if any(pattern in normalized_text for pattern in IDENTITY_PATTERNS):
        return "identity"
    if any(pattern in normalized_text for pattern in mic_test_patterns):
        return "mic_check"

    has_legal_term = any(word in normalized_text for word in legal_words)
    if not has_legal_term and any(
        pattern in normalized_text for pattern in off_topic_patterns
    ):
        return "out_of_scope"

    is_greeting_only = (
        any(word in normalized_text for word in greeting_words)
        and len(re.findall(r"\S+", normalized_text)) <= 5
        and not any(word in normalized_text for word in legal_words)
    )
    return "greeting" if is_greeting_only else None

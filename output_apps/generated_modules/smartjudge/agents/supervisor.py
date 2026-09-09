import re

_CONVERSATIONAL_PREFIXES = (
    "سلام", "درود", "خسته نباشید", "وقت بخیر", "لطفاً", "لطفا", "ممنون", "تشکر",
    "می‌خواستم بدونم", "میخواستم بدونم", "سوال داشتم", "یه سوال", "یک سوال"
)

INFO_EXPLICIT_MARKERS = ("استعلام", "بررسی", "تحقیق", "جستجو", "منبع", "ماده", "قانون")
INFO_TOPIC_MARKERS = ("چیست", "کدام", "چگونه", "آیا", "مهلت", "شرط")
INFO_WEAK_MARKERS = ("میشه", "میتونم", "لطفا", "راهنمایی")

FORMAL_DISPUTE_MARKERS = (
    "دادخواست", "شکایت", "دعوا", "خواسته", "طرف دعوا", "خوانده", "شاکی",
    "لایحه", "شکواییه", "قرارداد", "مستاجر", "موجر", "مطالبه", "چک", "تخلیه", "فسخ"
)

def normalize_query(text: str) -> str:
    cleaned = (text or "").strip()
    for prefix in _CONVERSATIONAL_PREFIXES:
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip(" ،,:-")
    return cleaned

def classify_intent(text: str) -> str:
    text_clean = normalize_query(text)
    words = [w for w in re.split(r'\s+', text_clean) if len(w) > 1]
    
    explicit_info = any(m in text_clean for m in INFO_EXPLICIT_MARKERS)
    topic_info = any(m in text_clean for m in INFO_TOPIC_MARKERS)
    formal_hits = sum(1 for m in FORMAL_DISPUTE_MARKERS if m in text_clean)
    
    if (explicit_info or topic_info) and formal_hits == 0:
        return "RESEARCH_QA"
    if len(words) <= 15 and formal_hits == 0:
        return "RESEARCH_QA"
    return "FORMAL_DISPUTE"

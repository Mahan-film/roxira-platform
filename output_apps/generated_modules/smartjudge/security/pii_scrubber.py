import re
from typing import Dict, Tuple

_NATIONAL_ID_RE = re.compile(r'(?<!\d)\d{10}(?!\d)')
_PHONE_RE = re.compile(r'(?<!\d)(?:0|\+98)?9\d{9}(?!\d)')
_IBAN_RE = re.compile(r'IR\d{24}', re.IGNORECASE)
_CARD_RE = re.compile(r'(?<!\d)(?:\d{4}[-\s]?){3}\d{4}(?!\d)')
_PARTY_RE = re.compile(
    r'(?P<role>خواهان|خوانده|شاکی|مشتکی‌عنه|متهم|محکوم‌له|محکوم‌علیه|موکل|تجدیدنظرخواه|تجدیدنظرخوانده)\s*'
    r'(?P<title>آقای|خانم)?\s+(?P<name>[\u0600-\u06FF\s]{3,30}?)(?=\s+(?:فرزند|به\s+شماره|دارای|به\s+کدملی|ساکن|با\s+وکالت|و\s+|$))'
)

def mask_pii_entities(text: str) -> Tuple[str, Dict[str, str]]:
    mapping: Dict[str, str] = {}
    counters = {"nid": 0, "phone": 0, "iban": 0, "card": 0, "party": 0}

    def _sub_nid(m: re.Match) -> str:
        counters["nid"] += 1
        ph = f"[کدملی_{counters['nid']}]"
        mapping[ph] = m.group(0)
        return ph

    def _sub_phone(m: re.Match) -> str:
        counters["phone"] += 1
        ph = f"[شماره_همراه_{counters['phone']}]"
        mapping[ph] = m.group(0)
        return ph

    def _sub_iban(m: re.Match) -> str:
        counters["iban"] += 1
        ph = f"[شبا_{counters['iban']}]"
        mapping[ph] = m.group(0)
        return ph

    def _sub_card(m: re.Match) -> str:
        counters["card"] += 1
        ph = f"[شماره_کارت_{counters['card']}]"
        mapping[ph] = m.group(0)
        return ph

    def _sub_party(m: re.Match) -> str:
        counters["party"] += 1
        role = m.group('role')
        title = m.group('title') or ""
        name = m.group('name').strip()
        ph = f"[{role}_{counters['party']}]"
        mapping[ph] = name
        parts = [role, title, ph]
        return " ".join([p for p in parts if p])

    text = _NATIONAL_ID_RE.sub(_sub_nid, text)
    text = _PHONE_RE.sub(_sub_phone, text)
    text = _IBAN_RE.sub(_sub_iban, text)
    text = _CARD_RE.sub(_sub_card, text)
    text = _PARTY_RE.sub(_sub_party, text)
    return text, mapping

def unmask_pii_entities(text: str, mapping: Dict[str, str]) -> str:
    for placeholder, original in mapping.items():
        text = text.replace(placeholder, original)
    return text

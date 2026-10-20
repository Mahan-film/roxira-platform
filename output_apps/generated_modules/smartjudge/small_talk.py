"""Deterministic small-talk / greeting / meta-question detector (pure, no I/O).

Used by the live voice pipeline and the text chat fast path so that utterances such as
«سلام صدای منو میشنوید؟», "are you there", "thanks" or "bye" get a short natural reply
WITHOUT legal retrieval and WITHOUT citations (retrieval used to match the word «صدا»/«شنوایی»
and answer with an unrelated penal-code article).

``classify_small_talk(text)`` returns one of ``KINDS`` or ``None``. It only fires for short
utterances (<= ``MAX_TOKENS`` words) that contain no legal vocabulary, so a real legal
question that merely starts with a greeting still goes to retrieval.
"""

from __future__ import annotations

import re
from typing import Optional

MAX_TOKENS = 8

KINDS = (
    "mic_check", "presence", "identity", "capabilities",
    "thanks", "bye", "how_are_you", "greeting",
)

_DIGIT_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_DIACRITICS = re.compile("[ً-ٰٟـ]")
_PUNCT = re.compile(r"[؟?!.,،؛;:«»\"'()\[\]{}…\-–—_*/\\]+")

# Any of these means "this is probably a real legal question": never small talk.
_LEGAL_STEMS = (
    "قانون", "حقوق", "ماده", "دادگاه", "وکیل", "شکایت", "لایحه", "دادخواست", "قرارداد",
    "جرم", "کیفر", "مجازات", "طلاق", "ارث", "چک", "مهریه", "دعوا", "حکم", "قضایی", "قاضی",
    "اجاره", "ملک", "سند", "زندان", "جریمه", "دیه", "نفقه", "حضانت", "وحدت رویه", "رای ",
)
_LEGAL_EN = ("law", "court", "lawyer", "contract", "article", "sue", "divorce", "crime")


def normalize(text: str) -> str:
    """Lower-case, unify Arabic/Persian letters, drop diacritics/punctuation, collapse spaces."""
    s = str(text or "").translate(_DIGIT_TRANS)
    s = s.replace("ي", "ی").replace("ك", "ک").replace("ۀ", "ه").replace("ة", "ه")
    s = s.replace("‌", " ").replace("‏", " ").replace("‎", " ")
    s = _DIACRITICS.sub("", s).lower()
    s = _PUNCT.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def _has(padded: str, phrases) -> bool:
    return any((" " + p + " ") in padded for p in phrases)


_MIC_PHRASES = (
    "میشنوی", "می شنوی", "میشنوید", "می شنوید", "میشنوین", "می شنوین", "شنیدی", "شنیدید",
    "صدام میاد", "صدامو", "صدامو میشنوی", "میکروفون", "میکروفن", "تست", "الو", "الو الو",
    "صدا میاد", "صدا میرسه", "صدا می رسه", "صدا واضحه", "صدام واضحه", "صدام قطع",
    "can you hear me", "do you hear me", "can u hear me", "hear me", "mic check",
    "testing", "test", "hello can you hear",
)
_MIC_SOUND_CTX = ("شنو", "شنید", "میاد", "میرسه", "می رسه", "واضح", "قطع", "داری", "دارید", "هست")

_PRESENCE_PHRASES = (
    "اونجایی", "آنجایی", "اینجایی", "اینجایید", "اونجایید", "هستی", "هستید", "هنوز هستی",
    "هنوز اینجایی", "گوش میدی", "گوش می دی", "گوش میکنی", "گوش می کنی", "گوش میدید",
    "حضور داری", "حضور دارید", "زنده ای", "زنده ایی", "جواب میدی", "جواب نمیدی",
    "are you there", "you there", "are you listening", "still there", "anyone there",
    "are you here", "hello are you there",
)

_IDENTITY_PHRASES = (
    "تو کی", "شما کی", "کیستی", "کیستید", "اسمت چیه", "اسم شما چیه", "اسمت چیست", "نامت چیه",
    "نام شما", "کی هستی", "کی هستید", "چه کسی هستی", "چی هستی", "خودت رو معرفی",
    "خودتو معرفی", "خودت را معرفی", "who are you", "what is your name", "whats your name",
    "what are you", "introduce yourself",
)

_CAPABILITY_PHRASES = (
    "چیکار میکنی", "چیکار میتونی", "چه کاری بلدی", "چه کمکی", "چه کارهایی", "چه کار میکنی",
    "چکار میکنی", "چکار میتونی", "کاربردت", "کاربرد تو", "کارکرد تو", "چه کاری میتونی",
    "what can you do", "how can you help", "what do you do", "how do you work",
)

_THANKS_PHRASES = (
    "ممنون", "ممنونم", "مرسی", "مرسی از شما", "متشکرم", "متشکر", "تشکر", "سپاس", "سپاسگزارم",
    "دستت درد نکنه", "دست شما درد نکنه", "خیلی ممنون", "تشکر میکنم", "خسته نباشی",
    "thanks", "thank you", "thx", "thank u", "many thanks", "appreciate it",
)

_BYE_PHRASES = (
    "خداحافظ", "خدانگهدار", "خدا نگهدار", "بدرود", "فعلا", "تا بعد", "تا فردا", "شب خوش",
    "روز خوش", "قطع میکنم", "bye", "goodbye", "good bye", "see you", "see ya", "bye bye",
    "talk later", "good night",
)

_HOW_ARE_YOU_PHRASES = (
    "خوبی", "خوبید", "خوبین", "حالت چطوره", "حال شما چطوره", "حالتون چطوره", "حالت خوبه",
    "چطوری", "چطورید", "چطورین", "احوالت", "احوال شما", "چه خبر", "چه خبرا", "چخبر",
    "how are you", "how are u", "hows it going", "whats up", "how do you do",
)

_GREETING_PHRASES = (
    "سلام", "سلام علیکم", "علیک سلام", "درود", "درود بر شما", "صبح بخیر", "عصر بخیر",
    "شب بخیر", "ظهر بخیر", "وقت بخیر", "روز بخیر", "عرض ادب", "hi", "hello", "hey",
    "good morning", "good evening", "good afternoon", "salam", "dorood", "heyy", "hii",
    "hello there", "hi there",
)

# Phrases a user adds after a greeting that mean "I have a question" (still small talk).
_ASK_INTENT = ("یه سوال دارم", "یک سوال دارم", "سوال دارم", "یه سوالی داشتم", "کمک میخوام")


def _has_legal_term(norm: str) -> bool:
    padded = " " + norm + " "
    if any(stem in padded for stem in _LEGAL_STEMS):
        return True
    tokens = set(norm.split())
    return any(w in tokens for w in _LEGAL_EN)


def has_greeting(text: str) -> bool:
    return _has(" " + normalize(text) + " ", _GREETING_PHRASES)


def classify_small_talk(text: str) -> Optional[str]:
    """Return the small-talk kind of a short utterance, or ``None`` for a real question."""
    norm = normalize(text)
    if not norm:
        return None
    tokens = norm.split()
    if len(tokens) > MAX_TOKENS or _has_legal_term(norm):
        return None
    padded = " " + norm + " "

    # Identity / capability first: «کی هستی» must not read as presence («هستی»).
    if _has(padded, _IDENTITY_PHRASES):
        return "identity"
    if _has(padded, _CAPABILITY_PHRASES):
        return "capabilities"
    if _has(padded, _MIC_PHRASES) or ("صدا" in padded and any(c in padded for c in _MIC_SOUND_CTX)):
        return "mic_check"
    if _has(padded, _PRESENCE_PHRASES):
        return "presence"
    if _has(padded, _THANKS_PHRASES):
        return "thanks"
    if _has(padded, _BYE_PHRASES):
        return "bye"
    if _has(padded, _HOW_ARE_YOU_PHRASES):
        return "how_are_you"
    if _has(padded, _GREETING_PHRASES):
        return "greeting"
    return None


_REPLIES = {
    "greeting": "سلام، خوش آمدید. من قاضی هوشمند هستم؛ بفرمایید چه سؤال حقوقی دارید؟",
    "mic_check": "بله، صدای شما را واضح می‌شنوم. بفرمایید چه سؤالی دارید؟",
    "presence": "بله، من اینجا هستم و گوش می‌دهم. بفرمایید.",
    "identity": "من قاضی هوشمند هستم، دستیار هوش مصنوعی برای راهنمایی حقوقی؛ جای وکیل را نمی‌گیرم. بفرمایید چه سؤالی دارید؟",
    "capabilities": "می‌توانم به سؤال‌های حقوقی شما کوتاه و ساده پاسخ بدهم و اگر بخواهید جزئیات را به‌صورت متنی هم بدهم. بفرمایید.",
    "thanks": "خواهش می‌کنم. اگر سؤال دیگری دارید در خدمتم.",
    "bye": "خدانگهدار. هر زمان سؤال حقوقی داشتید در خدمتتان هستم.",
    "how_are_you": "ممنونم، حالم خوب است. بفرمایید چه سؤال حقوقی دارید؟",
}


def small_talk_reply(kind: str, text: str = "") -> str:
    """Short spoken reply for ``kind`` (always Persian; the voice is a Persian TTS)."""
    reply = _REPLIES.get(kind, _REPLIES["greeting"])
    if kind in ("mic_check", "presence", "how_are_you", "capabilities") and text and has_greeting(text):
        reply = "سلام! " + reply
    return reply


def small_talk_for(text: str) -> Optional[str]:
    """Convenience: the reply when ``text`` is small talk, else ``None``."""
    kind = classify_small_talk(text)
    return None if kind is None else small_talk_reply(kind, text)

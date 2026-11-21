"""Shape of the phone eval seed (#987 T248): the owner's 2026-11-21 call questions, text only."""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "data/eval/chat_golden/phone_owner_2026-11-21.json"


def _ecg():
    spec = importlib.util.spec_from_file_location("eval_chat_golden", ROOT / "scripts/eval_chat_golden.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_seed_is_valid_for_eval_chat_golden():
    ecg = _ecg()
    cases = ecg.load(SEED)
    assert len(cases) >= 6
    assert ecg.validate(cases) == []
    for c in cases:
        assert c["channel"] == "voice"
        assert c["wording"] in ("stt_fixed", "inferred")
        assert c["stt_heard"].strip()
        assert c["must_mention"], c["id"]
        # law-level key points only, none checked by a lawyer yet
        assert all(m.get("verify") == "TO-VERIFY" for m in c["must_mention"] + c["must_not_mention"])


def test_seed_holds_no_caller_data():
    raw = SEED.read_text(encoding="utf-8")
    assert not re.search(r"\d{7,}", raw.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")))
    for needle in ("sip_", "call-_", ".wav", "+98"):
        assert needle not in raw


def test_scoring_catches_the_real_non_answers():
    ecg = _ecg()
    cases = {c["id"]: c for c in ecg.load(SEED)}
    # the 2026-11-21 replies (shortened) must fail; an on-topic reply must pass
    bad = ("متأسفانه در داده‌هایی که در اختیار دارم، به رأی یا سابقه‌ای با عنوان «آرای عدی بستا سویه» "
           "برنخوردم.")
    assert not ecg.score_case(cases["phone-latest-unity-rulings"], bad)["pass"]
    good = "آخرین رأی وحدت رویه هیئت عمومی دیوان عالی کشور را با شماره و تاریخ آن می‌گویم."  # shape only, no real number
    assert ecg.score_case(cases["phone-latest-unity-rulings"], good)["pass"]
    clarify = "برای اینکه بدانم منظورتان کدام موضوع است، لطفاً کمی بیشتر توضیح بدهید."
    assert not ecg.score_case(cases["phone-fight-public-vs-private-place"], clarify)["pass"]


def test_voice_flag_asks_like_the_phone_line():
    ecg = _ecg()
    assert ecg.chat_payload("سؤال") == {"message": "سؤال", "tier": "FREE"}
    assert ecg.chat_payload("سؤال", voice=True) == {
        "message": "سؤال", "tier": "FREE", "is_voice_mode": True, "channel": "voice"}

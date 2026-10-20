"""Offline tests: small-talk detector, fast-path routing, live-voice routing. No network."""

import asyncio

import pytest

from output_apps.ecosystem_core.src.factory import smartjudge_live_voice as lv
from output_apps.generated_modules.smartjudge import chat_safety as cs
from output_apps.generated_modules.smartjudge import fast_path
from output_apps.generated_modules.smartjudge import small_talk as st


CASES = [
    ("سلام صدای منو میشنوید؟", "mic_check"),
    ("سلام، صدای من رو می‌شنوی؟", "mic_check"),
    ("الو؟ صدام میاد؟", "mic_check"),
    ("can you hear me?", "mic_check"),
    ("اونجایی؟", "presence"),
    ("are you there", "presence"),
    ("ممنون از شما", "thanks"),
    ("Thank you!", "thanks"),
    ("خداحافظ", "bye"),
    ("bye", "bye"),
    ("سلام خوبی؟", "how_are_you"),
    ("how are you", "how_are_you"),
    ("سلام", "greeting"),
    ("درود بر شما", "greeting"),
    ("Hello", "greeting"),
    ("سلام یه سوال دارم", "greeting"),
    ("تو کی هستی؟", "identity"),
    ("چیکار میتونی بکنی", "capabilities"),
]


@pytest.mark.parametrize("text,kind", CASES)
def test_classify_small_talk(text, kind):
    assert st.classify_small_talk(text) == kind


@pytest.mark.parametrize("text", [
    "مجازات سرقت چیست",
    "سلام چک برگشت خورده چه کنم",
    "سلام ماده 682 قانون مجازات اسلامی چیست",
    "برای طلاق توافقی چه مدارکی لازم است",
    "اگر شنوایی کسی را از دست بدهد دیه چقدر است",
    "من می‌خواهم از همسایه‌ام شکایت کنم چون سر و صدا می‌کند و خیلی اذیت می‌شوم هر شب",
    "",
    "   ",
])
def test_real_questions_are_not_small_talk(text):
    assert st.classify_small_talk(text) is None


def test_replies_are_short_and_citation_free():
    for kind in st.KINDS:
        reply = st.small_talk_reply(kind, "سلام")
        assert reply and len(reply.split()) <= 25
        assert "ماده" not in reply and "رأی" not in reply


def test_mic_check_reply_greets_back_only_when_greeted():
    assert st.small_talk_for("سلام صدای منو میشنوید؟").startswith("سلام")
    assert not st.small_talk_for("صدای منو میشنوی؟").startswith("سلام")
    assert st.small_talk_for("مجازات سرقت چیست") is None


# ---- text-chat fast path shares the detector --------------------------------------------------

def test_fast_path_routes_greeting_and_meta():
    assert fast_path.classify_fast_path("سلام صدای منو میشنوید؟") == "mic_check"
    assert fast_path.classify_fast_path("ممنون") == "small_talk"
    assert fast_path.classify_fast_path("خداحافظ") == "small_talk"
    assert fast_path.classify_fast_path("are you there") == "small_talk"
    assert fast_path.classify_fast_path("سلام") == "greeting"
    assert fast_path.classify_fast_path("مجازات سرقت چیست") is None


# ---- live voice routing ------------------------------------------------------------------------

def test_voice_small_talk_skips_retrieval_and_llm(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("retrieval must not run for small talk")

    monkeypatch.setattr(lv, "_voice_context_for", boom)
    monkeypatch.setattr(lv.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(AssertionError("LLM")))
    reply = asyncio.run(lv._analyze_legal_query_impl("سلام صدای منو میشنوید؟"))
    assert "صدای شما" in reply
    assert "ماده" not in reply


def test_voice_streaming_small_talk_emits_one_sentence(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key-not-real")
    sent = []

    async def on_sentence(s):
        sent.append(s)

    async def boom(*a, **k):
        raise AssertionError("retrieval must not run for small talk")

    monkeypatch.setattr(lv, "_voice_context_for", boom)
    reply = asyncio.run(lv.analyze_legal_query_streaming("ممنون", on_sentence))
    assert sent == [reply] and "خواهش" in reply


def test_low_relevance_context_is_dropped_and_prompt_forbids_citation():
    weak = [{"title": "ماده 682 - قانون مجازات", "score": 1, "match_level": "MEDIUM"}]
    placeholder = [{"title": "x", "match_level": "FALLBACK"}]
    assert lv.select_voice_context(weak, placeholder) == ""
    prompt = lv.build_voice_system_prompt("")
    assert "به هیچ ماده یا رأیی استناد نکنید" in prompt
    assert "روشن‌کننده" in prompt


def test_relevant_context_is_kept():
    strong = [{"title": "ماده 1 - x", "score": 5, "match_level": "HIGH"}]
    ctx = lv.select_voice_context(strong, [])
    assert "ماده 1" in ctx
    assert "مستندات پایگاه داده" in lv.build_voice_system_prompt(ctx)


def test_text_voice_prompt_has_low_relevance_instruction():
    assert "روشن‌کننده" in cs.VOICE_LOW_RELEVANCE_INSTRUCTION

"""Offline tests for #1381: voice answers trimmed at token limit without partial words."""

import asyncio
import json

import pytest


def test_trim_at_token_limit_persian_and_latin_marks():
    from output_apps.generated_modules.smartjudge import smartjudge_module as sj

    cut_fa = "طبق ماده ۱۰۸۲ قانون مدنی مهریه بر عهده زوج است. در صورت مطالبه زوجه بای"
    assert sj.trim_at_token_limit(cut_fa, "length") == "طبق ماده ۱۰۸۲ قانون مدنی مهریه بر عهده زوج است."

    cut_persian_stop = "آیا مهریه عندالمطالبه است؟ بله در عقد نکاح دائ"
    assert sj.trim_at_token_limit(cut_persian_stop, "max_tokens") == "آیا مهریه عندالمطالبه است؟"

    cut_urdu_stop = "این قرارداد معتبر است۔ اما شرط دوم باط"
    assert sj.trim_at_token_limit(cut_urdu_stop, "length") == "این قرارداد معتبر است۔"

    cut_latin = "Claim is valid! However article 10.5 appl"
    assert sj.trim_at_token_limit(cut_latin, "length") == "Claim is valid!"


def test_trim_at_token_limit_ignores_decimal_and_drops_partial_word_when_no_sentence_end():
    from output_apps.generated_modules.smartjudge import smartjudge_module as sj

    no_sentence_end = "طبق بند 1.5 آیین نامه جدید پرداخت خسارت تاخیر تاد"
    out = sj.trim_at_token_limit(no_sentence_end, "length")
    assert out == "طبق بند 1.5 آیین نامه جدید پرداخت خسارت تاخیر"
    assert not out.endswith("تاد")


def test_trim_at_token_limit_no_change_for_complete_answers():
    from output_apps.generated_modules.smartjudge import smartjudge_module as sj

    complete = "مهریه حق قانونی زوجه است و پس از عقد قابل مطالبه خواهد بود."
    assert sj.trim_at_token_limit(complete, "stop") == complete
    assert sj.trim_at_token_limit(complete, None) == complete
    assert sj.trim_at_token_limit(complete, "") == complete

    # Even without trailing punctuation, complete stop must not be altered.
    complete_no_punct = "بله امکان پذیر است"
    assert sj.trim_at_token_limit(complete_no_punct, "stop") == complete_no_punct


def test_consult_voice_stream_trims_both_reply_and_spoken_reply_on_length(monkeypatch):
    from output_apps.generated_modules.smartjudge import chat_auth, chat_fast
    from output_apps.generated_modules.smartjudge import smartjudge_module as sj

    async def _fake_stream(*args, **kwargs):
        return (
            chat_fast.StreamOutcome(
                text="مهریه حق قانونی زوجه است. در صورت عدم پرداخت می توان دادخواس",
                model="test-model",
                finish_reason="length",
            ),
            "ok",
        )

    async def _fake_kg(*args, **kwargs):
        return ([{"law": "قانون مدنی", "article": "1082", "text": "به مجرد عقد زن مالک مهر می شود.", "authority_tier": 1, "source_tier": 1}], [])

    async def _fake_guard(text, **kwargs):
        return {"text": text, "validated_articles": [{"law": "قانون مدنی", "article": "1082"}]}

    monkeypatch.setattr(sj, "_use_llm_router", lambda: False)
    monkeypatch.setattr(sj, "_llm_stream_answer", _fake_stream)
    monkeypatch.setattr(sj, "aquery_knowledge_graph", _fake_kg)
    monkeypatch.setattr(sj, "_guard_citations", _fake_guard)
    monkeypatch.setattr(sj, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(chat_auth, "incr", lambda *a, **kw: (1, 3600))
    monkeypatch.setattr(chat_auth, "decr", lambda *a, **kw: 0)

    user = chat_auth.CurrentUser(phone="09120000000", tier="FREE", authenticated=False)
    res = asyncio.run(sj.consult_voice({"message": "مهریه چیست؟"}, user=user))

    assert res["status"] == "SUCCESS"
    assert "دادخواس" not in res["reply"]
    assert "دادخواس" not in res["spoken_reply"]
    assert "مهریه حق قانونی زوجه است." in res["reply"]
    assert res["spoken_reply"].endswith("مهریه حق قانونی زوجه است.")


def test_consult_voice_stream_keeps_complete_answer_unchanged(monkeypatch):
    from output_apps.generated_modules.smartjudge import chat_auth, chat_fast
    from output_apps.generated_modules.smartjudge import smartjudge_module as sj

    full_text = "مهریه حق قانونی زوجه است. امکان مطالبه آن از طریق دادگاه وجود دارد."

    async def _fake_stream(*args, **kwargs):
        return (
            chat_fast.StreamOutcome(
                text=full_text,
                model="test-model",
                finish_reason="stop",
            ),
            "ok",
        )

    async def _fake_kg(*args, **kwargs):
        return ([{"law": "قانون مدنی", "article": "1082", "text": "به مجرد عقد زن مالک مهر می شود.", "authority_tier": 1, "source_tier": 1}], [])

    async def _fake_guard(text, **kwargs):
        return {"text": text, "validated_articles": [{"law": "قانون مدنی", "article": "1082"}]}

    monkeypatch.setattr(sj, "_use_llm_router", lambda: False)
    monkeypatch.setattr(sj, "_llm_stream_answer", _fake_stream)
    monkeypatch.setattr(sj, "aquery_knowledge_graph", _fake_kg)
    monkeypatch.setattr(sj, "_guard_citations", _fake_guard)
    monkeypatch.setattr(sj, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(chat_auth, "incr", lambda *a, **kw: (1, 3600))
    monkeypatch.setattr(chat_auth, "decr", lambda *a, **kw: 0)

    user = chat_auth.CurrentUser(phone="09120000000", tier="FREE", authenticated=False)
    res = asyncio.run(sj.consult_voice({"message": "مهریه چیست؟"}, user=user))

    assert res["status"] == "SUCCESS"
    assert full_text in res["reply"]
    assert res["spoken_reply"] == full_text


def test_consult_voice_router_trims_on_length(monkeypatch):
    from output_apps.generated_modules.smartjudge import chat_auth, llm_router
    from output_apps.generated_modules.smartjudge import smartjudge_module as sj

    async def _fake_complete(*args, **kwargs):
        return llm_router.LLMResult(
            content="چک صیادی باید در سامانه ثبت شود! در غیر این صورت اعتب",
            model="test-router-model",
            tier="cheap",
            raw={"choices": [{"finish_reason": "length"}]},
        )

    async def _fake_kg(*args, **kwargs):
        return ([{"law": "قانون صدور چک", "article": "21", "text": "ثبت چک صیادی الزامی است.", "authority_tier": 1, "source_tier": 1}], [])

    async def _fake_guard(text, **kwargs):
        return {"text": text, "validated_articles": [{"law": "قانون صدور چک", "article": "21"}]}

    monkeypatch.setattr(sj, "_use_llm_router", lambda: True)
    monkeypatch.setattr(sj._llm_router, "complete", _fake_complete)
    monkeypatch.setattr(sj, "aquery_knowledge_graph", _fake_kg)
    monkeypatch.setattr(sj, "_guard_citations", _fake_guard)
    monkeypatch.setattr(sj, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(chat_auth, "incr", lambda *a, **kw: (1, 3600))
    monkeypatch.setattr(chat_auth, "decr", lambda *a, **kw: 0)

    user = chat_auth.CurrentUser(phone="09120000000", tier="FREE", authenticated=False)
    res = asyncio.run(sj.consult_voice({"message": "چک صیادی چیست؟"}, user=user))

    assert res["status"] == "SUCCESS"
    assert "اعتب" not in res["reply"]
    assert "اعتب" not in res["spoken_reply"]
    assert res["spoken_reply"] == "چک صیادی باید در سامانه ثبت شود!"


def test_make_chat_opener_captures_finish_reason(monkeypatch):
    from output_apps.generated_modules.smartjudge import chat_fast
    from output_apps.generated_modules.smartjudge import smartjudge_module as sj

    sse_lines = [
        'data: {"choices": [{"delta": {"content": "جمله اول. "}}]}',
        'data: {"choices": [{"delta": {"content": "نیمه"}}]}',
        'data: {"choices": [{"delta": {}, "finish_reason": "length"}]}',
        "data: [DONE]",
    ]

    class _FakeResp:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def aiter_lines(self):
            for line in sse_lines:
                yield line

    class _FakeClient:
        def stream(self, *args, **kwargs):
            return _FakeResp()

    monkeypatch.setattr(sj, "_llm_http_client", lambda: _FakeClient())
    usage_out = {}
    opener = sj._make_chat_opener("key", [{"role": "user", "content": "hi"}], 200, 0.2, usage_out)
    outcome = asyncio.run(chat_fast.stream_with_fallback([("openai/gpt-4o-mini", 5.0)], opener))
    assert outcome.text == "جمله اول. نیمه"
    assert usage_out["finish_reason"] == "length"

"""Offline tests for the multi-key STT chain and key rotation (voice_stt.py, key_rotation.py).

No network: httpx is replaced by MockTransport, routed by host. No key value is real.
Nothing here runs at import time.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from output_apps.generated_modules.smartjudge import key_rotation, voice_stt
from output_apps.generated_modules.smartjudge.key_rotation import KeySlot

AUDIO = b"x" * 2000
WIDE_ORDER = "assemblyai,groq,mistral,openrouter,gemini"
_BASES = ("ASSEMBLYAI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY")


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for base in _BASES:
        for name in (base, f"{base}_2", f"{base}_3", f"{base}_4"):
            monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("ASSEMBLYAI_API_KEYS", raising=False)
    # the wide chain and hedging are opt-in (production default = openrouter,assemblyai, no hedge)
    monkeypatch.setenv("VOICE_STT_ORDER", WIDE_ORDER)
    monkeypatch.setenv("VOICE_STT_HEDGE", "1")
    monkeypatch.setattr(voice_stt, "ASSEMBLYAI_POLL_S", 0.01)
    key_rotation.COOLDOWNS.reset()
    yield
    key_rotation.COOLDOWNS.reset()


def _install(monkeypatch, handler):
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr(voice_stt.httpx, "AsyncClient", factory)


def _key_of(request: httpx.Request) -> str:
    auth = request.headers.get("authorization", "") or request.headers.get("x-goog-api-key", "")
    return auth.removeprefix("Bearer ")


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# key_rotation
# ---------------------------------------------------------------------------


def test_env_slots_reads_base_then_numbered_then_list_and_dedupes():
    env = {
        "GROQ_API_KEY": "a",
        "GROQ_API_KEY_3": "c",
        "GROQ_API_KEY_4": "a",  # same key pasted twice: kept once
        "GROQ_KEYS": " d , ,c",
    }
    slots = key_rotation.env_slots("GROQ_API_KEY", list_env="GROQ_KEYS", env=env)
    assert [(s.name, s.value) for s in slots] == [("GROQ_API_KEY", "a"), ("GROQ_API_KEY_3", "c"), ("GROQ_KEYS[1]", "d")]


def test_env_slots_inert_when_unset():
    assert key_rotation.env_slots("NOPE_API_KEY", list_env="NOPE_KEYS", env={}) == []


def test_key_slot_repr_never_shows_the_value():
    assert "s3cret" not in repr(KeySlot("X_API_KEY", "s3cret"))
    assert "s3cret" not in str([KeySlot("X_API_KEY", "s3cret")])


def test_cooldown_for_status():
    cfs = key_rotation.cooldown_for_status
    assert cfs(429) == key_rotation.COOLDOWN_RATE_LIMIT_S
    assert cfs(429, "120") == 120.0
    assert cfs(429, "99999") == key_rotation.MAX_RETRY_AFTER_S
    assert cfs(401) == key_rotation.COOLDOWN_AUTH_S
    assert cfs(503) == key_rotation.COOLDOWN_SERVER_ERROR_S
    assert cfs(400) == 0 and cfs(422) == 0


def test_cooling_slots_go_last_and_expire():
    cd = key_rotation.Cooldowns()
    slots = [KeySlot("K", "1"), KeySlot("K_2", "2"), KeySlot("K_3", "3")]
    cd.fail("p", "K", 10, "HTTP 429", now=100.0)
    assert [s.name for s in cd.order("p", slots, now=105.0)] == ["K_2", "K_3", "K"]
    assert [s.name for s in cd.order("p", slots, now=111.0)] == ["K", "K_2", "K_3"]
    assert cd.snapshot(now=105.0) == [{"provider": "p", "slot": "K", "seconds_left": 5.0, "reason": "HTTP 429"}]
    cd.ok("p", "K")
    assert cd.snapshot(now=105.0) == []


# ---------------------------------------------------------------------------
# chain across providers and keys
# ---------------------------------------------------------------------------


def test_no_keys_anywhere_goes_to_local():
    res = _run(voice_stt.transcribe(AUDIO, "m4a", local_fallback=lambda a, e, d: "محلی"))
    assert (res.text, res.provider) == ("محلی", "local-whisper")


def test_default_order_is_the_pre_change_production_chain(monkeypatch):
    monkeypatch.delenv("VOICE_STT_ORDER", raising=False)
    for base in _BASES:
        monkeypatch.setenv(base, f"k-{base}")
    providers = [a.provider for a in voice_stt.build_attempts()]
    assert list(dict.fromkeys(providers)) == ["openrouter", "assemblyai"]


def test_opt_in_wide_order_is_assembly_groq_mistral_openrouter_gemini(monkeypatch):
    for base in _BASES:
        monkeypatch.setenv(base, f"k-{base}")
    providers = [a.provider for a in voice_stt.build_attempts()]
    first_seen = list(dict.fromkeys(providers))
    assert first_seen == ["assemblyai", "groq", "mistral", "openrouter", "gemini"]


def test_order_override_and_unknown_names_ignored(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "g")
    monkeypatch.setenv("GEMINI_API_KEY", "m")
    monkeypatch.setenv("VOICE_STT_ORDER", "gemini, bogus ,groq")
    assert [a.provider for a in voice_stt.build_attempts()] == ["gemini", "groq"]


def test_groq_first_key_rate_limited_second_key_answers_and_cools_the_first(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "g1")
    monkeypatch.setenv("GROQ_API_KEY_2", "g2")
    seen = []

    def handler(request: httpx.Request):
        assert request.url.host == "api.groq.com"
        seen.append(_key_of(request))
        if _key_of(request) == "g1":
            return httpx.Response(429, headers={"retry-after": "90"}, json={"error": "rate"})
        return httpx.Response(200, json={"text": "سلام"})

    _install(monkeypatch, handler)
    res = _run(voice_stt.transcribe(AUDIO, "m4a", local_fallback=None))
    assert (res.text, res.provider) == ("سلام", "groq:whisper-large-v3")
    assert seen == ["g1", "g2"]
    assert key_rotation.COOLDOWNS.cooling("groq", "GROQ_API_KEY")

    # The next request starts on the healthy key.
    seen.clear()
    res = _run(voice_stt.transcribe(AUDIO, "m4a", local_fallback=None))
    assert seen == ["g2"]


def test_assembly_outage_falls_through_to_groq(monkeypatch):
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "a1")
    monkeypatch.setenv("ASSEMBLYAI_API_KEYS", "a2,a1")
    monkeypatch.setenv("GROQ_API_KEY", "g1")
    hosts = []

    def handler(request: httpx.Request):
        hosts.append((request.url.host, _key_of(request)))
        if request.url.host == "api.assemblyai.com":
            return httpx.Response(503)
        return httpx.Response(200, json={"text": "متن"})

    _install(monkeypatch, handler)
    res = _run(voice_stt.transcribe(AUDIO, "webm", local_fallback=None))
    assert res.text == "متن"
    assert hosts == [("api.assemblyai.com", "a1"), ("api.assemblyai.com", "a2"), ("api.groq.com", "g1")]


def test_assembly_success_with_polling(monkeypatch):
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "a1")
    polls = []

    def handler(request: httpx.Request):
        path = request.url.path
        if path == "/v2/upload":
            return httpx.Response(200, json={"upload_url": "https://cdn/x"})
        if path == "/v2/transcript":
            assert json.loads(request.content)["language_code"] == "fa"
            return httpx.Response(200, json={"id": "t1"})
        polls.append(1)
        status = "completed" if len(polls) > 1 else "processing"
        return httpx.Response(200, json={"status": status, "text": "دادخواست"})

    _install(monkeypatch, handler)
    res = _run(voice_stt.transcribe(AUDIO, "m4a", local_fallback=None))
    assert (res.text, res.provider) == ("دادخواست", "assemblyai")


def test_mistral_request_shape_has_no_language_hint(monkeypatch):
    monkeypatch.setenv("MISTRAL_API_KEY", "m1")
    bodies = []

    def handler(request: httpx.Request):
        assert request.url.host == "api.mistral.ai"
        bodies.append(request.content)
        return httpx.Response(200, json={"text": "ok"})

    _install(monkeypatch, handler)
    res = _run(voice_stt.transcribe(AUDIO, "m4a", local_fallback=None))
    assert res.provider == "mistral:voxtral-mini-latest"
    assert b'name="model"' in bodies[0] and b'name="language"' not in bodies[0]


def test_gemini_inline_audio_and_text_parse(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY_3", "gm3")
    seen = {}

    def handler(request: httpx.Request):
        seen["path"] = request.url.path
        seen["key"] = request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": " ماده "}, {"text": "۱۰"}]}}]})

    _install(monkeypatch, handler)
    res = _run(voice_stt.transcribe(AUDIO, "m4a", local_fallback=None))
    assert res.text == "ماده ۱۰" and res.provider == "gemini:gemini-flash-latest"
    assert seen["path"].endswith("/models/gemini-flash-latest:generateContent") and seen["key"] == "gm3"
    inline = seen["body"]["contents"][0]["parts"][1]["inline_data"]
    assert inline["mime_type"] == "audio/aac"


def test_openrouter_uses_passed_key_and_spare_env_slots(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "or1")  # same as the passed key: tried once
    monkeypatch.setenv("OPENROUTER_API_KEY_2", "or2")
    seen = []

    def handler(request: httpx.Request):
        seen.append((json.loads(request.content)["model"], _key_of(request)))
        return httpx.Response(503) if _key_of(request) == "or1" else httpx.Response(200, json={"text": "ok"})

    _install(monkeypatch, handler)
    res = _run(voice_stt.transcribe(AUDIO, "m4a", api_key="or1", local_fallback=None))
    assert res.text == "ok"
    assert seen == [("openai/whisper-large-v3", "or1"), ("openai/whisper-large-v3", "or2")]


def test_key_values_never_logged(monkeypatch, capsys):
    monkeypatch.setenv("GROQ_API_KEY", "SECRET-groq-1")
    monkeypatch.setenv("GEMINI_API_KEY", "SECRET-gem-1")

    def handler(request: httpx.Request):
        if request.url.host == "api.groq.com":
            return httpx.Response(401)
        raise httpx.ConnectError("boom")

    _install(monkeypatch, handler)
    res = _run(voice_stt.transcribe(AUDIO, "m4a", local_fallback=None))
    assert res.reachable is False
    err = capsys.readouterr().err
    assert "SECRET" not in err and "GROQ_API_KEY" in err
    assert "SECRET" not in json.dumps(key_rotation.COOLDOWNS.snapshot())


# ---------------------------------------------------------------------------
# hedging
# ---------------------------------------------------------------------------


def test_slow_billed_attempt_is_hedged_with_a_free_one(monkeypatch):
    monkeypatch.setattr(voice_stt, "HEDGE_AFTER_S", 0.05)
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "a1")
    monkeypatch.setenv("GROQ_API_KEY", "g1")
    cancelled = []

    async def handler(request: httpx.Request):
        if request.url.host == "api.assemblyai.com":
            try:
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                cancelled.append(1)
                raise
            return httpx.Response(200, json={"upload_url": "u"})
        return httpx.Response(200, json={"text": "سریع"})

    _install(monkeypatch, handler)
    res = _run(voice_stt.transcribe(AUDIO, "m4a", local_fallback=None))
    assert (res.text, res.provider) == ("سریع", "groq:whisper-large-v3")
    assert cancelled == [1]


def test_never_two_billed_attempts_in_flight(monkeypatch):
    monkeypatch.setattr(voice_stt, "HEDGE_AFTER_S", 0.02)
    monkeypatch.setenv("VOICE_STT_ORDER", "assemblyai,openrouter")
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "a1")
    in_flight = {"now": 0, "max": 0}

    async def handler(request: httpx.Request):
        in_flight["now"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["now"])
        try:
            if request.url.host == "api.assemblyai.com":
                await asyncio.sleep(0.2)
                return httpx.Response(503)
            return httpx.Response(200, json={"text": "پولی"})
        finally:
            in_flight["now"] -= 1

    _install(monkeypatch, handler)
    res = _run(voice_stt.transcribe(AUDIO, "m4a", api_key="or1", local_fallback=None))
    assert res.text == "پولی"
    assert in_flight["max"] == 1


def test_hedge_respects_the_remote_deadline(monkeypatch):
    monkeypatch.setattr(voice_stt, "HEDGE_AFTER_S", 0.05)
    monkeypatch.setenv("GROQ_API_KEY", "g1")
    monkeypatch.setenv("GROQ_API_KEY_2", "g2")

    async def handler(request: httpx.Request):
        await asyncio.sleep(30)
        return httpx.Response(200, json={"text": "late"})

    _install(monkeypatch, handler)
    loop_started = asyncio.new_event_loop()
    try:
        t0 = loop_started.time()
        res = loop_started.run_until_complete(
            voice_stt.transcribe(AUDIO, "m4a", local_fallback=None, budget_s=6.0)
        )
        elapsed = loop_started.time() - t0
    finally:
        loop_started.close()
    assert res.text == "" and res.reachable is False
    assert elapsed < 6.0


def test_cooling_keys_go_behind_every_healthy_provider(monkeypatch):
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "a1")
    monkeypatch.setenv("GROQ_API_KEY", "g1")
    key_rotation.COOLDOWNS.fail("assemblyai", "ASSEMBLYAI_API_KEY", 60, "HTTP 401")
    assert [(a.provider, a.slot.name) for a in voice_stt.build_attempts()] == [
        ("groq", "GROQ_API_KEY"),
        ("assemblyai", "ASSEMBLYAI_API_KEY"),
    ]


def test_hedging_is_off_unless_opted_in(monkeypatch):
    monkeypatch.delenv("VOICE_STT_HEDGE", raising=False)
    assert voice_stt.hedge_enabled() is False
    monkeypatch.setenv("VOICE_STT_HEDGE", "1")
    assert voice_stt.hedge_enabled() is True
    monkeypatch.setenv("VOICE_STT_HEDGE", "0")
    assert voice_stt.hedge_enabled() is False


def test_without_hedge_a_slow_attempt_is_not_overlapped(monkeypatch):
    monkeypatch.delenv("VOICE_STT_HEDGE", raising=False)
    monkeypatch.setattr(voice_stt, "HEDGE_AFTER_S", 0.02)
    monkeypatch.setenv("GROQ_API_KEY", "g1")
    monkeypatch.setenv("GROQ_API_KEY_2", "g2")
    in_flight = {"now": 0, "max": 0}

    async def handler(request: httpx.Request):
        in_flight["now"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["now"])
        try:
            await asyncio.sleep(0.15)
            return httpx.Response(200, json={"text": "ok"})
        finally:
            in_flight["now"] -= 1

    _install(monkeypatch, handler)
    res = _run(voice_stt.transcribe(AUDIO, "m4a", local_fallback=None))
    assert res.text == "ok" and in_flight["max"] == 1

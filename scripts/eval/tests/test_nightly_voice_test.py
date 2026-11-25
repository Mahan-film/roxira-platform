"""Offline unit tests for scripts/eval/nightly_voice_test.py (T296 R30)."""

from __future__ import annotations

import importlib.util
import io
import sys
import wave
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "scripts" / "eval" / "nightly_voice_test.py"


@pytest.fixture(scope="module")
def nvt():
    spec = importlib.util.spec_from_file_location("nightly_voice_test", MODULE_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    try:
        spec.loader.exec_module(mod)
        yield mod
    finally:
        sys.modules.pop(spec.name, None)


def _pricing() -> dict:
    return {
        "effective_date": "2026-11-24",
        "stt_per_min_usd": 0.006,
        "tts_per_min_usd": 0.015,
        "transport_per_min_usd": 0.010,
        "llm_per_call_usd": 0.002,
    }


def test_generate_synthetic_8khz_wav_format(nvt):
    wav_bytes = nvt.generate_synthetic_8khz_wav(duration_ms=500, leading_silence_ms=50)
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        assert wf.getnchannels() == 1
        assert wf.getsampwidth() == 2
        assert wf.getframerate() == 8000
        assert wf.getnframes() == 4000

    with pytest.raises(ValueError, match="8 kHz"):
        nvt.generate_synthetic_8khz_wav(sample_rate=16000)


def test_nightly_voice_test_reports_timings_cost_and_zero_persistence(nvt):
    seen_wav_rates: list[int] = []

    class HealthyProbe:
        def run_call(self, wav_bytes: bytes, case: dict) -> dict:
            with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
                seen_wav_rates.append(wf.getframerate())
            return {
                "stt_ms": 150.0,
                "rag_ms": 80.0,
                "llm_ms": 300.0,
                "tts_ms": 120.0,
                "tts_leading_silence_ms": 65.0,
                "barge_in_cancelled": True,
                "barge_in_cancel_ms": 140.0,
                "total_ms": 650.0,
                "recognized_entities": ["ماده 12", "قانون صدور چک"],
                "persisted_audio_bytes": 0,
                "persisted_transcript_chars": 0,
                "call_duration_s": 30.0,
            }

        def check_trunk(self) -> dict:
            return {"register_state": "Registered", "tls_cert_days_remaining": 45}

    cases = [
        {
            "id": "call-1",
            "consent_granted": False,
            "simulate_barge_in": True,
            "expected_entities": ["ماده ۱۲", "قانون صدور چک"],
        },
        {
            "id": "call-2",
            "consent_granted": True,
            "simulate_barge_in": True,
            "expected_entities": ["ماده 12"],
        },
    ]
    paged: list[dict] = []
    rep = nvt.run_nightly_voice_test(
        cases,
        HealthyProbe(),
        pricing_config=_pricing(),
        pager_fn=paged.append,
    )

    assert seen_wav_rates == [8000, 8000]
    assert rep["page_triggered"] is False
    assert rep["alerts"] == []
    assert paged == []
    assert rep["entity_error_rate"] == 0.0
    assert rep["barge_in_rate"] == 1.0
    assert rep["register_state"] == "Registered"
    assert rep["tls_cert_days_remaining"] == 45
    assert rep["consent_zero_persistence_ok"] is True
    assert rep["stage_timings_ms"]["total_ms"]["p50"] == 650.0
    assert rep["stage_timings_ms"]["tts_leading_silence_ms"]["p95"] == 65.0
    assert rep["stage_timings_ms"]["barge_in_cancel_ms"]["p95"] == 140.0
    # 0.5 min * (0.006 + 0.015 + 0.010) + 0.002 = 0.0175
    assert rep["cost_per_call_usd"] == 0.0175


def test_nightly_voice_test_pages_on_regressions_and_consent_leak(nvt):
    class RegressedProbe:
        def run_call(self, wav_bytes: bytes, case: dict) -> dict:
            return {
                "stt_ms": 900.0,
                "rag_ms": 400.0,
                "llm_ms": 1500.0,
                "tts_ms": 500.0,
                "tts_leading_silence_ms": 480.0,
                "barge_in_cancelled": False,
                "barge_in_cancel_ms": 620.0,
                "total_ms": 3300.0,
                "recognized_entities": [],
                "persisted_audio_bytes": 1024,
                "persisted_transcript_chars": 42,
                "call_duration_s": 10.0,
            }

        def check_trunk(self) -> dict:
            return {"register_state": "Unregistered", "tls_cert_days_remaining": 5}

    cases = [
        {
            "id": "declined-call",
            "consent_granted": False,
            "simulate_barge_in": True,
            "expected_entities": ["قانون کار"],
        }
    ]
    paged: list[dict] = []
    rep = nvt.run_nightly_voice_test(
        cases,
        RegressedProbe(),
        pricing_config=_pricing(),
        pager_fn=paged.append,
    )

    assert rep["page_triggered"] is True
    assert len(paged) == 1
    assert rep["consent_zero_persistence_ok"] is False
    alerts_blob = " | ".join(rep["alerts"])
    assert "total_ms p95" in alerts_blob
    assert "entity_error_rate" in alerts_blob
    assert "tts_leading_silence_ms" in alerts_blob
    assert "barge_in_cancel_ms" in alerts_blob
    assert "Unregistered" in alerts_blob
    assert "tls_cert_days_remaining" in alerts_blob
    assert "zero-persistence" in alerts_blob


def test_cli_dry_run_exits_zero(nvt):
    assert nvt.main(["--dry-run"]) == 0

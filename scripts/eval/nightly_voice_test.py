#!/usr/bin/env python3
"""Nightly voice pipeline test (T296 R30): synthetic 8 kHz audio, stage timings, and paging.

Measures:
- Stage timings (p50/p95) for stt_ms, rag_ms, llm_ms, tts_ms, total_ms
- TTS leading silence (ms) and barge-in cancel time (ms) + barge-in rate
- Entity error rate (normalized legal terms/articles)
- SIP trunk register state and TLS certificate days remaining
- Zero-persistence assertion when simulated caller declines recording
- Cost per call computed from caller-supplied effective-dated pricing config (no hardcoded rates)
- Regression detection with pager callback
"""

from __future__ import annotations

import argparse
import io
import json
import math
import re
import struct
import sys
import wave
from dataclasses import dataclass
from typing import Any, Callable, Protocol, Sequence

SAMPLE_RATE_HZ = 8000
_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_EXTRA = str.maketrans({"ي": "ی", "ك": "ک", "\u200c": " "})


def normalize_entity(text: Any) -> str:
    t = str(text or "").translate(_EXTRA).translate(_TRANS)
    return re.sub(r"\s+", " ", t).strip().lower()


def generate_synthetic_8khz_wav(
    duration_ms: int = 1000,
    *,
    sample_rate: int = SAMPLE_RATE_HZ,
    tone_hz: float = 440.0,
    leading_silence_ms: int = 80,
) -> bytes:
    """Generate deterministic 8 kHz 16-bit mono PCM WAV bytes for synthetic voice tests."""
    if sample_rate != SAMPLE_RATE_HZ:
        raise ValueError(f"expected 8 kHz audio (8000 Hz), got {sample_rate}")
    if duration_ms <= 0:
        raise ValueError("duration_ms must be positive")

    total_samples = int(sample_rate * duration_ms / 1000)
    silence_samples = min(total_samples, max(0, int(sample_rate * leading_silence_ms / 1000)))
    frames = bytearray()

    for idx in range(total_samples):
        if idx < silence_samples:
            sample = 0
        else:
            t = (idx - silence_samples) / sample_rate
            sample = int(12000 * math.sin(2.0 * math.pi * tone_hz * t))
        frames.extend(struct.pack("<h", sample))

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(bytes(frames))
    return buf.getvalue()


def percentile(values: Sequence[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(float(v) for v in values)
    idx = max(0, min(len(ordered) - 1, math.ceil((pct / 100.0) * len(ordered)) - 1))
    return round(ordered[idx], 3)


def compute_call_cost_usd(
    duration_s: float,
    pricing_config: dict[str, Any],
) -> float:
    """Compute per-call cost from an effective-dated pricing config (never hardcoded)."""
    if not isinstance(pricing_config, dict):
        raise ValueError("pricing_config must be a mapping")
    for key in ("effective_date", "stt_per_min_usd", "tts_per_min_usd", "transport_per_min_usd", "llm_per_call_usd"):
        if key not in pricing_config:
            raise ValueError(f"pricing_config missing required key {key!r}")

    minutes = max(0.0, float(duration_s)) / 60.0
    per_min = (
        float(pricing_config["stt_per_min_usd"])
        + float(pricing_config["tts_per_min_usd"])
        + float(pricing_config["transport_per_min_usd"])
    )
    total = minutes * per_min + float(pricing_config["llm_per_call_usd"])
    return round(total, 6)


class VoiceProbe(Protocol):
    def run_call(self, wav_bytes: bytes, case: dict[str, Any]) -> dict[str, Any]:
        ...

    def check_trunk(self) -> dict[str, Any]:
        ...


@dataclass(frozen=True)
class RegressionThresholds:
    max_p95_total_ms: float = 2500.0
    max_entity_error_rate: float = 0.10
    max_tts_leading_silence_ms: float = 350.0
    max_barge_in_cancel_ms: float = 400.0
    min_tls_cert_days: int = 14


def run_nightly_voice_test(
    cases: Sequence[dict[str, Any]],
    probe: VoiceProbe,
    *,
    pricing_config: dict[str, Any],
    thresholds: RegressionThresholds = RegressionThresholds(),
    pager_fn: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Execute synthetic 8 kHz voice suite, check trunk & consent, and page on regression."""
    if not cases:
        raise ValueError("cases must be non-empty")

    stage_samples: dict[str, list[float]] = {
        "stt_ms": [],
        "rag_ms": [],
        "llm_ms": [],
        "tts_ms": [],
        "tts_leading_silence_ms": [],
        "barge_in_cancel_ms": [],
        "total_ms": [],
    }
    total_entities = 0
    entity_errors = 0
    barge_in_attempts = 0
    barge_in_successes = 0
    costs: list[float] = []
    consent_violations: list[str] = []

    for case in cases:
        wav_bytes = generate_synthetic_8khz_wav(
            duration_ms=int(case.get("duration_ms", 1000)),
            leading_silence_ms=int(case.get("leading_silence_ms", 80)),
        )
        res = probe.run_call(wav_bytes, case)

        for stage in ("stt_ms", "rag_ms", "llm_ms", "tts_ms", "tts_leading_silence_ms", "total_ms"):
            if stage in res and res[stage] is not None:
                stage_samples[stage].append(float(res[stage]))

        if case.get("simulate_barge_in"):
            barge_in_attempts += 1
            if res.get("barge_in_cancelled"):
                barge_in_successes += 1
            if res.get("barge_in_cancel_ms") is not None:
                stage_samples["barge_in_cancel_ms"].append(float(res["barge_in_cancel_ms"]))

        expected_entities = [normalize_entity(e) for e in (case.get("expected_entities") or []) if normalize_entity(e)]
        got_entities = {normalize_entity(e) for e in (res.get("recognized_entities") or []) if normalize_entity(e)}
        total_entities += len(expected_entities)
        entity_errors += sum(1 for e in expected_entities if e not in got_entities)

        if case.get("consent_granted") is False:
            persisted_audio = int(res.get("persisted_audio_bytes") or 0)
            persisted_text = int(res.get("persisted_transcript_chars") or 0)
            if persisted_audio > 0 or persisted_text > 0:
                consent_violations.append(str(case.get("id") or "unknown"))

        costs.append(compute_call_cost_usd(float(res.get("call_duration_s", 10.0)), pricing_config))

    trunk = probe.check_trunk()
    register_state = str(trunk.get("register_state") or "Unknown")
    tls_days = trunk.get("tls_cert_days_remaining")

    stage_timings = {
        name: {"p50": percentile(vals, 50), "p95": percentile(vals, 95)}
        for name, vals in stage_samples.items()
    }
    entity_error_rate = round(entity_errors / total_entities, 4) if total_entities else 0.0
    barge_in_rate = round(barge_in_successes / barge_in_attempts, 4) if barge_in_attempts else 1.0
    avg_cost = round(sum(costs) / len(costs), 6) if costs else 0.0

    alerts: list[str] = []
    if stage_timings["total_ms"]["p95"] > thresholds.max_p95_total_ms:
        alerts.append(
            f"total_ms p95={stage_timings['total_ms']['p95']} > {thresholds.max_p95_total_ms}"
        )
    if entity_error_rate > thresholds.max_entity_error_rate:
        alerts.append(
            f"entity_error_rate={entity_error_rate} > {thresholds.max_entity_error_rate}"
        )
    if stage_timings["tts_leading_silence_ms"]["p95"] > thresholds.max_tts_leading_silence_ms:
        alerts.append(
            f"tts_leading_silence_ms p95={stage_timings['tts_leading_silence_ms']['p95']} "
            f"> {thresholds.max_tts_leading_silence_ms}"
        )
    if stage_timings["barge_in_cancel_ms"]["p95"] > thresholds.max_barge_in_cancel_ms:
        alerts.append(
            f"barge_in_cancel_ms p95={stage_timings['barge_in_cancel_ms']['p95']} "
            f"> {thresholds.max_barge_in_cancel_ms}"
        )
    if register_state.lower() != "registered":
        alerts.append(f"SIP trunk register_state={register_state!r} (expected Registered)")
    if tls_days is None or int(tls_days) < thresholds.min_tls_cert_days:
        alerts.append(f"SIP trunk tls_cert_days_remaining={tls_days} < {thresholds.min_tls_cert_days}")
    if consent_violations:
        alerts.append(f"zero-persistence violated on declined consent: {consent_violations}")

    report = {
        "mode": "nightly_voice_test",
        "sample_rate_hz": SAMPLE_RATE_HZ,
        "cases_run": len(cases),
        "stage_timings_ms": stage_timings,
        "entity_error_rate": entity_error_rate,
        "barge_in_rate": barge_in_rate,
        "register_state": register_state,
        "tls_cert_days_remaining": tls_days,
        "consent_zero_persistence_ok": not consent_violations,
        "cost_per_call_usd": avg_cost,
        "pricing_effective_date": pricing_config["effective_date"],
        "page_triggered": bool(alerts),
        "alerts": alerts,
    }
    if alerts and pager_fn is not None:
        pager_fn(report)
    return report


class _DryRunProbe:
    def run_call(self, wav_bytes: bytes, case: dict[str, Any]) -> dict[str, Any]:
        return {
            "stt_ms": 180.0,
            "rag_ms": 90.0,
            "llm_ms": 320.0,
            "tts_ms": 140.0,
            "tts_leading_silence_ms": 75.0,
            "barge_in_cancelled": bool(case.get("simulate_barge_in")),
            "barge_in_cancel_ms": 110.0 if case.get("simulate_barge_in") else None,
            "total_ms": 730.0,
            "recognized_entities": list(case.get("expected_entities") or []),
            "persisted_audio_bytes": 0,
            "persisted_transcript_chars": 0,
            "call_duration_s": 12.0,
        }

    def check_trunk(self) -> dict[str, Any]:
        return {"register_state": "Registered", "tls_cert_days_remaining": 60}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Nightly synthetic 8 kHz voice pipeline test (T296)")
    parser.add_argument("--dry-run", action="store_true", help="Run offline synthetic probe smoke test")
    args = parser.parse_args(argv)
    if not args.dry_run:
        print("live voice probe requires trunk/service configuration", file=sys.stderr)
        return 2

    sample_cases = [
        {
            "id": "voice-consent-decline",
            "consent_granted": False,
            "simulate_barge_in": True,
            "expected_entities": ["ماده 12", "قانون صدور چک"],
        }
    ]
    sample_pricing = {
        "effective_date": "2026-11-24",
        "stt_per_min_usd": 0.0,
        "tts_per_min_usd": 0.0,
        "transport_per_min_usd": 0.0,
        "llm_per_call_usd": 0.0,
    }
    rep = run_nightly_voice_test(sample_cases, _DryRunProbe(), pricing_config=sample_pricing)
    print(json.dumps(rep, ensure_ascii=False, indent=2))
    return 1 if rep["page_triggered"] else 0


if __name__ == "__main__":
    sys.exit(main())

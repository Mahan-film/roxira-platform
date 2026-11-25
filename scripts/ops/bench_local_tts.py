#!/usr/bin/env python3
"""Benchmark for local Persian TTS and spoken normaliser (T251).

Measures:
1. Normalisation latency & throughput (microseconds per call)
2. Local synthesis first-audio latency (ms) and p50/p90/p95/p99
3. Audio duration and Real-Time Factor (RTF)
Acceptance criterion: first audio <= 300 ms p95 on roxira-ci box.

Usage:
    python3 scripts/ops/bench_local_tts.py [--runs 30] [--out docs/ops/LOCAL_TTS_BENCHMARK.md]
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from output_apps.generated_modules.smartjudge.persian_spoken_normaliser import (
    normalize_persian_speech,
)
from output_apps.generated_modules.smartjudge.voice_tts import (
    LOCAL_TTS_ENABLED,
    local_sherpa_tts,
)

SAMPLE_PHRASES = [
    ("greeting_short", "سلام، به سامانه خوش آمدید."),
    ("clause_boundary", "با عنایت به مفاد ماده ۱۰ قانون مدنی،"),
    ("legal_statute", "مهلت تجدیدنظرخواهی بیست روز پس از ابلاغ است."),
    (
        "complex_legal",
        "طبق ماده ۱۲ ق.م. و دادنامه مورخ ۱۴۰۳/۰۸/۱۵، مبلغ ۵۰۰۰۰۰۰ ریال تعیین شد.",
    ),
]


def bench_normaliser(iterations: int = 200) -> Dict[str, float]:
    """Measure Persian spoken normaliser execution time."""
    test_text = (
        "طبق ماده ۱۰ ق.م. و دادنامه شماره ۴۵ مورخ ۱۴۰۳/۰۲/۱۵، "
        "مستاجر مکلف به پرداخت ۵۰۰۰۰۰۰۰ ریال با خسارت ۲.۵٪ گردید."
    )
    # Warmup
    for _ in range(20):
        normalize_persian_speech(test_text)

    times_us: List[float] = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        normalize_persian_speech(test_text)
        times_us.append((time.perf_counter() - t0) * 1_000_000.0)

    times_us.sort()
    return {
        "p50_us": statistics.median(times_us),
        "p95_us": times_us[int(len(times_us) * 0.95)],
        "p99_us": times_us[int(len(times_us) * 0.99)],
        "max_us": max(times_us),
        "iterations": iterations,
    }


def bench_tts(runs: int = 30) -> Dict[str, any]:
    """Measure local TTS first-audio latency across sample legal phrases."""
    results = {}
    all_latencies_ms: List[float] = []

    # Check if local sherpa-onnx is active
    os.environ["LOCAL_TTS_ENABLED"] = "1"
    is_available = False

    try:
        import sherpa_onnx  # noqa: F401

        model_path = os.environ.get("SHERPA_TTS_MODEL", "models/sherpa-fa/model.onnx")
        tokens_path = os.environ.get("SHERPA_TTS_TOKENS", "models/sherpa-fa/tokens.txt")
        if os.path.exists(model_path) and os.path.exists(tokens_path):
            is_available = True
    except ImportError:
        pass

    for label, phrase in SAMPLE_PHRASES:
        latencies: List[float] = []
        durations: List[float] = []
        normalized = normalize_persian_speech(phrase)

        if not is_available:
            results[label] = {
                "phrase": phrase,
                "normalized": normalized,
                "status": "NEEDS_BOX_RUN (sherpa-onnx model weights not mounted)",
            }
            continue

        # Warmup run
        local_sherpa_tts(normalized)

        for _ in range(runs):
            t0 = time.perf_counter()
            audio_bytes = local_sherpa_tts(normalized)
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            latencies.append(elapsed_ms)
            all_latencies_ms.append(elapsed_ms)

        latencies.sort()
        results[label] = {
            "phrase": phrase,
            "normalized": normalized,
            "p50_ms": statistics.median(latencies),
            "p90_ms": latencies[int(len(latencies) * 0.90)],
            "p95_ms": latencies[int(len(latencies) * 0.95)],
            "p99_ms": latencies[int(len(latencies) * 0.99)],
            "runs": runs,
            "status": "PASS" if latencies[int(len(latencies) * 0.95)] <= 300.0 else "FAIL",
        }

    overall_p95 = (
        all_latencies_ms[int(len(all_latencies_ms) * 0.95)]
        if all_latencies_ms
        else None
    )

    return {
        "is_available": is_available,
        "results": results,
        "overall_p95_ms": overall_p95,
        "target_ms": 300.0,
        "overall_status": (
            "PASS"
            if overall_p95 is not None and overall_p95 <= 300.0
            else ("NEEDS_BOX_RUN" if not is_available else "FAIL")
        ),
    }


def main():
    parser = argparse.ArgumentParser(description="Benchmark local Persian TTS & Normaliser")
    parser.add_argument("--runs", type=int, default=30, help="Number of benchmark runs")
    parser.add_argument("--out", type=str, default="docs/ops/LOCAL_TTS_BENCHMARK.md", help="Output report path")
    args = parser.parse_args()

    print("Running Persian Spoken Normaliser benchmark...")
    norm_res = bench_normaliser()
    print(f"Normaliser p50: {norm_res['p50_us']:.1f} us, p95: {norm_res['p95_us']:.1f} us")

    print(f"Running Local TTS benchmark ({args.runs} runs)...")
    tts_res = bench_tts(runs=args.runs)
    print(f"TTS Status: {tts_res['overall_status']}")
    if tts_res["overall_p95_ms"]:
        print(f"TTS Overall p95: {tts_res['overall_p95_ms']:.1f} ms (Target <= 300 ms)")

    # Write report
    report_lines = [
        "# Local Persian TTS & Spoken Normaliser Benchmark (T251)",
        "",
        f"- **Date**: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}",
        f"- **Normaliser p50**: {norm_res['p50_us']:.1f} µs ({norm_res['p50_us']/1000.0:.3f} ms)",
        f"- **Normaliser p95**: {norm_res['p95_us']:.1f} µs ({norm_res['p95_us']/1000.0:.3f} ms)",
        f"- **Target First Audio**: <= 300.0 ms p95",
        f"- **Overall Status**: {tts_res['overall_status']}",
        "",
        "## Spoken Normaliser Results",
        "",
        "| Metric | Latency |",
        "|---|---|",
        f"| p50 | {norm_res['p50_us']:.1f} µs |",
        f"| p95 | {norm_res['p95_us']:.1f} µs |",
        f"| p99 | {norm_res['p99_us']:.1f} µs |",
        f"| max | {norm_res['max_us']:.1f} µs |",
        "",
        "## Local Synthesis Results",
        "",
    ]

    if tts_res["is_available"]:
        report_lines.extend([
            "| Phrase | p50 (ms) | p90 (ms) | p95 (ms) | Status |",
            "|---|---|---|---|---|",
        ])
        for k, v in tts_res["results"].items():
            report_lines.append(
                f"| `{k}` | {v['p50_ms']:.1f} | {v['p90_ms']:.1f} | {v['p95_ms']:.1f} | {v['status']} |"
            )
    else:
        report_lines.extend([
            "> **Note**: Local sherpa-onnx / Piper weights not mounted on this runner.",
            "> Requires box execution on Linux laptop `roxira-ci` via `python3 scripts/ops/bench_local_tts.py`.",
            "",
            "### Sample Test Phrases & Normalized Forms",
            "",
            "| Key | Raw Phrase | Normalized Spoken Text |",
            "|---|---|---|",
        ])
        for k, v in tts_res["results"].items():
            report_lines.append(
                f"| `{k}` | {v['phrase']} | {v['normalized']} |"
            )

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines) + "\n")

    print(f"Report written to {args.out}")


if __name__ == "__main__":
    main()

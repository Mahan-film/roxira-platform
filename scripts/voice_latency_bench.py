#!/usr/bin/env python3
"""W7 voice latency bench (docs/W7_voice_latency.md).

Sends N synthetic Persian requests as TEXT (skipping the mic / STT stage) through
the same LLM + TTS pipeline functions the live `/api/v1/apps/judge/live-voice`
websocket uses (output_apps/ecosystem_core/src/factory/smartjudge_live_voice.py),
and prints p50/p95/min/max latency per stage.

Real run (owner-executed on the server; needs OPENROUTER_API_KEY + edge-tts,
see docs/STRATEGY.md §7 for how the app container gets its .env):

    docker exec --env-file .env -w /app roxira_app_prod \\
        python3 scripts/voice_latency_bench.py --n 20

    # also exercise the VOICE_STREAM_TTS sentence-streaming path:
    docker exec --env-file .env -w /app roxira_app_prod \\
        python3 scripts/voice_latency_bench.py --n 20 --stream

Offline/CI mode -- no OpenRouter key, no network, no edge-tts install required
(stubs the LLM/TTS provider calls with fast deterministic fakes):

    python3 scripts/voice_latency_bench.py --n 20 --offline
    python3 scripts/voice_latency_bench.py --n 20 --offline --stream

STT/mic latency is out of scope for this script by design (no audio input in
CI); production `stt_ms`/`end_to_end_ms` come from the VOICE_TIMING_LOG log
lines emitted by the live websocket path itself -- see docs/W7_voice_latency.md.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = (
    REPO_ROOT / "output_apps" / "ecosystem_core" / "src" / "factory" / "smartjudge_live_voice.py"
)

# A handful of realistic, short Persian legal questions -- cycled to reach --n.
SYNTHETIC_QUERIES = [
    "آیا فسخ قرارداد اجاره پیش از موعد بدون رضایت موجر امکان‌پذیر است؟",
    "مهلت اعتراض به رأی بدوی دادگاه حقوقی چند روز است؟",
    "مسئولیت مدنی ناشی از تصادف رانندگی بر عهده چه کسی است؟",
    "شرایط فسخ نکاح به دلیل عدم انفاق چیست؟",
    "نحوه محاسبه خسارت تأخیر تأدیه در قانون مدنی چگونه است؟",
    "آیا وصیت‌نامه عادی بدون شاهد اعتبار قانونی دارد؟",
    "مجازات کلاهبرداری در قانون مجازات اسلامی چیست؟",
    "شرایط اعسار از پرداخت مهریه چگونه اثبات می‌شود؟",
]


def load_voice_module():
    """Load smartjudge_live_voice.py by path (not by package import) so this
    script works whether or not the repo root happens to be on sys.path."""
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    spec = importlib.util.spec_from_file_location("smartjudge_live_voice_bench", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def install_offline_stubs(module) -> None:
    """Replace the network-calling pipeline functions with fast, deterministic
    stubs. No API key, no network call, no edge-tts install needed -- this is
    what lets CI collect and run this script with zero external dependencies."""

    async def _fake_llm(query_text: str) -> str:
        await asyncio.sleep(0.01)
        return "پاسخ آزمایشی مستند به ماده ۱۰ قانون مدنی و رأی وحدت رویه شماره ۷۳۰."

    async def _fake_llm_streaming(query_text: str, on_sentence) -> str:
        text = await _fake_llm(query_text)
        for sentence in module.split_persian_sentences(text):
            await on_sentence(sentence)
        return text

    async def _fake_tts(text: str) -> str:
        await asyncio.sleep(0.01)
        return "AAAA"  # tiny fake base64 payload; the bench never decodes it

    module.analyze_legal_query = _fake_llm
    module.analyze_legal_query_streaming = _fake_llm_streaming
    module.synthesize_speech_persian = _fake_tts


def percentile(values: list[float], pct: float) -> float:
    """Linear-interpolation percentile (same method as numpy's default)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    k = (len(ordered) - 1) * (pct / 100)
    f = int(k)
    c = min(f + 1, len(ordered) - 1)
    if f == c:
        return ordered[f]
    return ordered[f] + (ordered[c] - ordered[f]) * (k - f)


def summarize(name: str, samples_ms: list[float]) -> str:
    if not samples_ms:
        return f"{name}: no samples"
    return (
        f"{name:<10} p50={percentile(samples_ms, 50):7.1f}ms  "
        f"p95={percentile(samples_ms, 95):7.1f}ms  "
        f"min={min(samples_ms):7.1f}ms  max={max(samples_ms):7.1f}ms  n={len(samples_ms)}"
    )


async def run_bench(module, n: int, stream: bool) -> dict[str, list[float]]:
    llm_ms: list[float] = []
    tts_ms: list[float] = []
    total_ms: list[float] = []

    for i in range(n):
        query = SYNTHETIC_QUERIES[i % len(SYNTHETIC_QUERIES)]
        turn_start = time.monotonic()

        if stream:
            tts_samples: list[float] = []

            async def _on_sentence(sentence: str, _samples: list[float] = tts_samples) -> None:
                t0 = time.monotonic()
                await module.synthesize_speech_persian(sentence)
                _samples.append((time.monotonic() - t0) * 1000)

            t_llm0 = time.monotonic()
            await module.analyze_legal_query_streaming(query, _on_sentence)
            llm_ms.append((time.monotonic() - t_llm0) * 1000)
            tts_ms.extend(tts_samples)
        else:
            t_llm0 = time.monotonic()
            reply = await module.analyze_legal_query(query)
            llm_ms.append((time.monotonic() - t_llm0) * 1000)

            t_tts0 = time.monotonic()
            await module.synthesize_speech_persian(reply)
            tts_ms.append((time.monotonic() - t_tts0) * 1000)

        total_ms.append((time.monotonic() - turn_start) * 1000)

    return {"llm_ms": llm_ms, "tts_ms": tts_ms, "total_ms": total_ms}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--n", type=int, default=20, help="number of synthetic requests (default: 20)"
    )
    parser.add_argument(
        "--offline", action="store_true",
        help="stub the LLM/TTS providers; no keys or network needed",
    )
    parser.add_argument(
        "--stream", action="store_true",
        help="exercise the VOICE_STREAM_TTS sentence-streaming path",
    )
    args = parser.parse_args(argv)

    if args.n < 1:
        parser.error("--n must be >= 1")

    module = load_voice_module()
    if args.offline:
        install_offline_stubs(module)
    elif not module.os.environ.get("OPENROUTER_API_KEY"):
        print(
            "warning: OPENROUTER_API_KEY is not set and --offline was not passed; "
            "the LLM call below will fail. Pass --offline for a keyless dry run.",
            file=sys.stderr,
        )

    print(f"Voice latency bench: n={args.n} offline={args.offline} stream={args.stream}")
    results = asyncio.run(run_bench(module, args.n, args.stream))

    print(summarize("llm", results["llm_ms"]))
    print(summarize("tts", results["tts_ms"]))
    print(summarize("total", results["total_ms"]))
    print("(no mic/STT stage here -- see docs/W7_voice_latency.md for stt_ms from live traffic)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

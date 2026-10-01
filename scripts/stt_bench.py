#!/usr/bin/env python3
"""Persian STT benchmark: local vs remote Whisper by WER and latency.

This is the owner's measurement gate for enabling ``ROXIRA_STT_LOCAL`` on the
server (see docs/research/STT_PERSIAN_RESEARCH_2026-10.md and
docs/W15_stt_plan.md). It does NOT touch production state; it only reads a
folder of short Persian clips and reports, per engine, mean word error rate
(WER) against a reference transcript plus p50/p95 decode latency.

Sample folder layout -- one ``name.wav`` next to one ``name.txt`` (UTF-8
reference text):

    samples/
      greeting.wav
      greeting.txt
      legal_term.wav
      legal_term.txt
      ...

Usage:

    python3 scripts/stt_bench.py --dir SAMPLES --engines local,remote
    python3 scripts/stt_bench.py --dir SAMPLES --engines local,remote --out result.json

``--engines`` is a comma-separated list of known engines (``local``,
``remote``). An engine that needs something unavailable (``faster-whisper``
weights for local; ``OPENROUTER_API_KEY`` for remote) is skipped with a warning
on stderr, and the rest still run. The engine callables are injectable, so the
benchmark itself is testable without models, network, or keys:

    run_bench(samples, {"fake": lambda path: "..."} )
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from collections.abc import Callable
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# A transcribe callable takes a wav path and returns the transcript text.
Transcribe = Callable[[str], str]

_PERSIAN_DIGITS = str.maketrans(
    "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"
)

# Zero-width characters that must be removed (not replaced) before comparing:
# U+200C ZWNJ, U+200B ZWSP, U+200E LRM, U+200F RLM, U+FEFF BOM.
_ZERO_WIDTH = ("\u200c", "\u200b", "\u200e", "\u200f", "\ufeff")


class EngineUnavailable(RuntimeError):
    """Raised by an engine builder when its dependency/key is not present."""


def normalize_fa(text: str) -> str:
    """Normalise Persian text for WER comparison.

    Unifies Arabic/Persian letter variants (ي->ی, ك->ک), strips zero-width
    joiners and directional marks, converts Persian/Arabic-Indic digits to
    ASCII, and collapses all whitespace runs to single spaces. The result is
    intentionally lossy: it removes presentation differences that should never
    count as recognition errors.
    """
    if not text:
        return ""
    cleaned = text.strip().translate(_PERSIAN_DIGITS)
    cleaned = cleaned.replace("ي", "ی").replace("ك", "ک")
    for ch in _ZERO_WIDTH:
        cleaned = cleaned.replace(ch, "")
    return " ".join(cleaned.split())


def _edit_distance(ref_words: list[str], hyp_words: list[str]) -> int:
    """Levenshtein distance over word tokens (insertions/deletions/substitutions)."""
    if not ref_words:
        return len(hyp_words)
    if not hyp_words:
        return len(ref_words)
    previous = list(range(len(hyp_words) + 1))
    for i, ref_word in enumerate(ref_words, start=1):
        current = [i]
        for j, hyp_word in enumerate(hyp_words, start=1):
            substitution = 0 if ref_word == hyp_word else 1
            current.append(
                min(
                    previous[j] + 1,          # deletion
                    current[j - 1] + 1,       # insertion
                    previous[j - 1] + substitution,  # substitution
                )
            )
        previous = current
    return previous[-1]


def wer(reference: str, hypothesis: str) -> float:
    """Word error rate after Persian normalisation.

    ``(substitutions + deletions + insertions) / reference_word_count``. An
    empty reference is a special case: 0.0 if the hypothesis is also empty,
    else 1.0 (a spurious transcript for silence is a full error).
    """
    ref_words = normalize_fa(reference).split()
    hyp_words = normalize_fa(hypothesis).split()
    if not ref_words:
        return 0.0 if not hyp_words else 1.0
    return _edit_distance(ref_words, hyp_words) / len(ref_words)


def percentile(values: list[float], pct: float) -> float:
    """Linear-interpolation percentile (same method as numpy's default)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    k = (len(ordered) - 1) * (pct / 100)
    lower = int(k)
    upper = min(lower + 1, len(ordered) - 1)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (k - lower)


def load_samples(directory: str | Path) -> list[dict[str, str]]:
    """Return ``[{name, audio, reference}]`` for every ``name.wav``/``name.txt`` pair."""
    directory = Path(directory)
    samples: list[dict[str, str]] = []
    for audio in sorted(directory.glob("*.wav")):
        reference_path = audio.with_suffix(".txt")
        if not reference_path.is_file():
            print(
                f"warning: {audio.name} has no matching .txt reference; skipping",
                file=sys.stderr,
            )
            continue
        samples.append(
            {
                "name": audio.stem,
                "audio": str(audio),
                "reference": reference_path.read_text(encoding="utf-8"),
            }
        )
    return samples


def _ensure_repo_root_on_path() -> None:
    root = str(REPO_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)


def build_local_engine() -> Transcribe:
    """Adapter over the repo's local faster-whisper engine.

    Reuses ``stt_local_whisper.transcribe_local`` (the same function
    ``stt_engine.transcribe_audio_blob`` uses when ``ROXIRA_STT_LOCAL=1``) and
    the shared legal-vocabulary prompt from ``stt_engine``.
    """
    try:
        import faster_whisper  # noqa: F401
    except ImportError as exc:
        raise EngineUnavailable("faster-whisper is not installed") from exc

    _ensure_repo_root_on_path()
    from output_apps.ecosystem_core.src.factory.stt_engine import STT_PROMPT
    from output_apps.ecosystem_core.src.factory.stt_local_whisper import transcribe_local

    def transcribe(path: str) -> str:
        wav_bytes = Path(path).read_bytes()
        text, _min_logprob = transcribe_local(wav_bytes, STT_PROMPT)
        return text

    return transcribe


def build_remote_engine() -> Transcribe:
    """Adapter over the repo's remote OpenRouter Whisper path.

    Reuses ``stt_engine.transcribe_audio_blob``. The key is read from the
    environment (never hardcoded); when absent the engine is skipped.
    """
    if not os.environ.get("OPENROUTER_API_KEY", "").strip():
        raise EngineUnavailable("OPENROUTER_API_KEY is not set")

    _ensure_repo_root_on_path()
    from output_apps.ecosystem_core.src.factory.stt_engine import transcribe_audio_blob

    def transcribe(path: str) -> str:
        payload = base64.b64encode(Path(path).read_bytes()).decode("ascii")
        return transcribe_audio_blob(payload, "audio/wav")

    return transcribe


ENGINE_BUILDERS: dict[str, Callable[[], Transcribe]] = {
    "local": build_local_engine,
    "remote": build_remote_engine,
}


def resolve_engines(
    names: list[str], builders: dict[str, Callable[[], Transcribe]] | None = None
) -> dict[str, Transcribe]:
    """Build the requested engines, skipping unknown or unavailable ones.

    Unknown names and builders that raise :class:`EngineUnavailable` are
    reported on stderr and dropped, so one missing dependency/key never aborts
    the whole benchmark.
    """
    builders = ENGINE_BUILDERS if builders is None else builders
    engines: dict[str, Transcribe] = {}
    for name in names:
        builder = builders.get(name)
        if builder is None:
            print(f"warning: unknown engine {name!r}; skipping", file=sys.stderr)
            continue
        try:
            engines[name] = builder()
        except EngineUnavailable as exc:
            print(f"warning: skipping engine {name!r}: {exc}", file=sys.stderr)
            continue
    return engines


def run_bench(
    samples: list[dict[str, str]], engines: dict[str, Transcribe]
) -> dict[str, dict[str, object]]:
    """Run every engine over every sample; return per-engine WER/latency summary."""
    results: dict[str, dict[str, object]] = {}
    for name, transcribe in engines.items():
        rows: list[dict[str, object]] = []
        for sample in samples:
            start = time.perf_counter()
            hypothesis = transcribe(sample["audio"])
            latency_ms = (time.perf_counter() - start) * 1000
            rows.append(
                {
                    "name": sample["name"],
                    "wer": wer(sample["reference"], hypothesis),
                    "latency_ms": latency_ms,
                }
            )
        wers = [float(row["wer"]) for row in rows]
        latencies = [float(row["latency_ms"]) for row in rows]
        results[name] = {
            "n": len(rows),
            "mean_wer": sum(wers) / len(wers) if wers else 0.0,
            "p50_latency_ms": percentile(latencies, 50),
            "p95_latency_ms": percentile(latencies, 95),
            "samples": rows,
        }
    return results


def print_table(results: dict[str, dict[str, object]]) -> None:
    """Print the mean-WER / p50 / p95 summary table."""
    print(f"{'engine':<10} {'n':>3} {'mean_wer':>9} {'p50_ms':>9} {'p95_ms':>9}")
    for name, data in results.items():
        print(
            f"{name:<10} {data['n']:>3} {data['mean_wer']:>9.3f} "
            f"{data['p50_latency_ms']:>9.1f} {data['p95_latency_ms']:>9.1f}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--dir", required=True, help="folder of name.wav + name.txt pairs")
    parser.add_argument(
        "--engines",
        default="local,remote",
        help="comma-separated engines to run (default: local,remote)",
    )
    parser.add_argument("--out", default=None, help="write the JSON report to this file")
    args = parser.parse_args(argv)

    samples = load_samples(args.dir)
    if not samples:
        print(f"error: no *.wav + *.txt pairs found in {args.dir}", file=sys.stderr)
        return 2

    requested = [name.strip() for name in args.engines.split(",") if name.strip()]
    engines = resolve_engines(requested)
    if not engines:
        print("error: no runnable engines", file=sys.stderr)
        return 2

    results = run_bench(samples, engines)
    print_table(results)

    if args.out:
        Path(args.out).write_text(
            json.dumps({"engines": results}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Local LLM fallback benchmark for an OpenAI-compatible endpoint.

Measures whether a quantized local model served by ``llama-server`` (or any
OpenAI-compatible ``/chat/completions`` endpoint) is usable as an offline
fallback for **low-risk, non-customer-data** tasks before anyone relies on it
(see docs/research/NEXTGEN_ROADMAP_2026-10.md and
docs/research/nextgen/C_execution_delivery_substrate.md, section 4).

The script sends a fixed built-in set of 8 low-risk prompts (4 Persian, 4
English coding/lint explanations) and records, per prompt, the latency,
completion tokens, tokens/second and a trivial deterministic check
(expected substring or exact label). It reports mean/p50/p95 latency, mean
tokens/second and pass rate, plus the process RSS of the server when ``--pid``
is given.

It never touches production state and needs no secret: no key is sent unless
``--api-key-env`` names an environment variable that holds one.

Usage:

    python3 scripts/llm_fallback_bench.py \\
        --base-url http://127.0.0.1:8080/v1 --model NAME
    python3 scripts/llm_fallback_bench.py \\
        --base-url http://127.0.0.1:8080/v1 --model NAME --pid 12345 \\
        --out /tmp/llm_fallback_result.json

The HTTP transport is injectable (``run_bench(..., post=...)``), so the
benchmark is testable without a server or network.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

# post(url, payload, headers, timeout) -> parsed JSON response. Raises on
# transport/HTTP failure. Injectable for tests.
Post = Callable[[str, dict[str, Any], dict[str, str], float], dict[str, Any]]
Clock = Callable[[], float]

# 8 low-risk prompts. Each carries a deterministic check:
#   {"kind": "contains", "any": [..]}  -> pass if any substring appears
#   {"kind": "label", "expected": L, "labels": [..]} -> pass iff exactly the
#   expected label out of the allowed set appears in the response.
BUILTIN_PROMPTS: list[dict[str, Any]] = [
    {
        "id": "fa-summarize",
        "lang": "fa",
        "task": "summarise a sentence in one line",
        "max_tokens": 128,
        "messages": [
            {
                "role": "user",
                "content": (
                    "این متن را در یک خط خلاصه کن: "
                    "«دادگاه تجدیدنظر استان تهران رأی دادگاه بدوی را تأیید کرد.»"
                ),
            }
        ],
        "check": {"kind": "contains", "any": ["تأیید", "تایید"]},
    },
    {
        "id": "fa-typos",
        "lang": "fa",
        "task": "fix a Persian typo list",
        "max_tokens": 128,
        "messages": [
            {
                "role": "user",
                "content": (
                    "این فهرست را تصحیح کن و فقط کلمات درست را برگردان: "
                    "«فهرست، دادکاه، رای، پرونده»"
                ),
            }
        ],
        "check": {"kind": "contains", "any": ["دادگاه"]},
    },
    {
        "id": "fa-intent",
        "lang": "fa",
        "task": "classify intent into 5 labels",
        "max_tokens": 32,
        "messages": [
            {
                "role": "user",
                "content": (
                    "فقط یکی از این پنج برچسب را برگردان: "
                    "شکایت، استعلام، قرارداد، درخواست، سایر. "
                    "متن: «می‌خواهم از وضعیت پرونده مطلع شوم.»"
                ),
            }
        ],
        "check": {
            "kind": "label",
            "expected": "استعلام",
            "labels": ["شکایت", "استعلام", "قرارداد", "درخواست", "سایر"],
        },
    },
    {
        "id": "fa-date",
        "lang": "fa",
        "task": "extract a date",
        "max_tokens": 64,
        "messages": [
            {
                "role": "user",
                "content": (
                    "تاریخ را از این متن استخراج کن: "
                    "«رأی در تاریخ ۱۴۰۳/۰۵/۱۲ صادر شد.»"
                ),
            }
        ],
        "check": {"kind": "contains", "any": ["۱۴۰۳", "1403"]},
    },
    {
        "id": "en-lint",
        "lang": "en",
        "task": "explain a lint error",
        "max_tokens": 128,
        "messages": [
            {
                "role": "user",
                "content": (
                    "Explain this Python lint error in one sentence: "
                    "`E501 line too long (95 > 88 characters)`."
                ),
            }
        ],
        "check": {"kind": "contains", "any": ["line", "88"]},
    },
    {
        "id": "en-test",
        "lang": "en",
        "task": "explain a test assertion",
        "max_tokens": 128,
        "messages": [
            {
                "role": "user",
                "content": (
                    "What does this assertion check? "
                    '`assert result.status == "SUCCESS"` — one sentence.'
                ),
            }
        ],
        "check": {"kind": "contains", "any": ["status"]},
    },
    {
        "id": "en-regex",
        "lang": "en",
        "task": "explain a regex",
        "max_tokens": 128,
        "messages": [
            {
                "role": "user",
                "content": (
                    "Explain what this regex matches: "
                    "`^\\d{4}-\\d{2}-\\d{2}$` — one sentence."
                ),
            }
        ],
        "check": {"kind": "contains", "any": ["date", "year", "digits"]},
    },
    {
        "id": "en-typing",
        "lang": "en",
        "task": "explain a type error",
        "max_tokens": 128,
        "messages": [
            {
                "role": "user",
                "content": (
                    "Explain this mypy error in one sentence: "
                    '`error: Argument 1 has incompatible type "str"; '
                    'expected "int"`'
                ),
            }
        ],
        "check": {"kind": "contains", "any": ["type", "int"]},
    },
]


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


def evaluate_check(check: dict[str, Any] | None, text: str) -> bool | None:
    """Run a prompt's deterministic check; ``None`` when there is no check.

    ``contains`` passes when any expected substring appears (case-insensitive).
    ``label`` passes when exactly the expected label out of the allowed set
    appears, so a response that lists several labels fails.
    """
    if check is None:
        return None
    kind = check.get("kind")
    if kind == "contains":
        haystack = text.casefold()
        return any(str(needle).casefold() in haystack for needle in check.get("any", []))
    if kind == "label":
        labels = [str(label) for label in check.get("labels", [])]
        expected = str(check.get("expected", ""))
        found = [label for label in labels if label in text]
        return found == [expected]
    raise ValueError(f"unknown check kind: {kind!r}")


def extract_completion(data: dict[str, Any]) -> tuple[str, int | None]:
    """Return (content, completion_tokens) from an OpenAI-compatible response."""
    text = ""
    choices = data.get("choices") or []
    if isinstance(choices, list) and choices:
        first = choices[0] or {}
        message = first.get("message") or {}
        text = message.get("content") or ""
    tokens: int | None = None
    usage = data.get("usage")
    if isinstance(usage, dict):
        raw = usage.get("completion_tokens")
        if isinstance(raw, (int, float)):
            tokens = int(raw)
    return text, tokens


def default_post(
    url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float
) -> dict[str, Any]:
    """POST JSON to an OpenAI-compatible endpoint and return the parsed body."""
    with httpx.Client(timeout=timeout) as client:
        response = client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return response.json()


def read_rss_mb(pid: int) -> float | None:
    """Resident set size of ``pid`` in MiB, from ``/proc`` or ``ps``."""
    status = Path(f"/proc/{pid}/status")
    if status.is_file():
        for line in status.read_text(encoding="utf-8").splitlines():
            if line.startswith("VmRSS:"):
                parts = line.split()
                if len(parts) >= 2:
                    return int(parts[1]) / 1024.0
    try:
        completed = subprocess.run(
            ["ps", "-o", "rss=", "-p", str(pid)],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    value = completed.stdout.strip()
    if not value:
        return None
    try:
        return int(value) / 1024.0
    except ValueError:
        return None


def run_prompt(
    prompt: dict[str, Any],
    *,
    post: Post,
    url: str,
    model: str,
    api_key: str | None,
    timeout: float,
    clock: Clock,
) -> dict[str, Any]:
    """Run one prompt and return its measured row."""
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model,
        "messages": prompt["messages"],
        "temperature": 0,
        "max_tokens": prompt.get("max_tokens", 256),
    }
    check = prompt.get("check")
    row: dict[str, Any] = {
        "id": prompt["id"],
        "lang": prompt.get("lang", ""),
        "task": prompt.get("task", ""),
        "ok": False,
        "error": None,
        "latency_ms": 0.0,
        "completion_tokens": None,
        "tokens_per_sec": None,
        "response": "",
        "check_expected": check is not None,
        "check_passed": None,
    }
    started = clock()
    try:
        data = post(url, payload, headers, timeout)
    except Exception as exc:  # noqa: BLE001 - any transport/HTTP error is a failure
        row["latency_ms"] = (clock() - started) * 1000
        row["error"] = str(exc)
        return row
    row["latency_ms"] = (clock() - started) * 1000
    text, tokens = extract_completion(data)
    row["ok"] = True
    row["response"] = text
    row["completion_tokens"] = tokens
    if tokens is not None and row["latency_ms"] > 0:
        row["tokens_per_sec"] = tokens / (row["latency_ms"] / 1000)
    row["check_passed"] = evaluate_check(check, text)
    return row


def run_bench(
    prompts: list[dict[str, Any]],
    *,
    post: Post,
    base_url: str,
    model: str,
    api_key: str | None = None,
    timeout: float = 120.0,
    clock: Clock = time.perf_counter,
) -> list[dict[str, Any]]:
    """Run every prompt against one endpoint; return per-prompt rows."""
    url = base_url.rstrip("/") + "/chat/completions"
    return [
        run_prompt(
            prompt,
            post=post,
            url=url,
            model=model,
            api_key=api_key,
            timeout=timeout,
            clock=clock,
        )
        for prompt in prompts
    ]


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate latency, throughput and pass rate over the rows."""
    latencies = [float(row["latency_ms"]) for row in results]
    throughputs = [
        float(row["tokens_per_sec"])
        for row in results
        if row["tokens_per_sec"] is not None
    ]
    checked = [row for row in results if row["check_expected"]]
    passed = [row for row in checked if row["check_passed"] is True]
    return {
        "n": len(results),
        "failed": sum(1 for row in results if not row["ok"]),
        "checked": len(checked),
        "passed": len(passed),
        "pass_rate": (len(passed) / len(checked)) if checked else None,
        "mean_latency_ms": (sum(latencies) / len(latencies)) if latencies else 0.0,
        "p50_latency_ms": percentile(latencies, 50),
        "p95_latency_ms": percentile(latencies, 95),
        "mean_tokens_per_sec": (
            sum(throughputs) / len(throughputs) if throughputs else None
        ),
        "rss_mb": None,
    }


def print_table(summary: dict[str, Any], results: list[dict[str, Any]]) -> None:
    """Print the per-prompt table followed by the aggregate summary."""
    header = f"{'id':<14}{'lang':<5}{'ok':<4}{'ms':>9}{'tok':>6}{'tok/s':>8}{'check':>7}"
    print(header)
    for row in results:
        status = "yes" if row["ok"] else "no"
        tokens = "-" if row["completion_tokens"] is None else str(row["completion_tokens"])
        rate = (
            "-"
            if row["tokens_per_sec"] is None
            else f"{float(row['tokens_per_sec']):.1f}"
        )
        if row["check_passed"] is None:
            check = "-"
        else:
            check = "pass" if row["check_passed"] else "fail"
        print(
            f"{row['id']:<14}{row['lang']:<5}{status:<4}"
            f"{float(row['latency_ms']):>9.0f}{tokens:>6}{rate:>8}{check:>7}"
        )
    print()
    mean_rate = summary["mean_tokens_per_sec"]
    rate_text = "n/a" if mean_rate is None else f"{mean_rate:.1f}"
    pass_text = (
        "n/a" if summary["pass_rate"] is None else f"{summary['pass_rate']:.2f}"
    )
    print(
        f"n={summary['n']} failed={summary['failed']} "
        f"pass_rate={pass_text} ({summary['passed']}/{summary['checked']} checked)"
    )
    print(
        f"latency_ms mean={summary['mean_latency_ms']:.0f} "
        f"p50={summary['p50_latency_ms']:.0f} p95={summary['p95_latency_ms']:.0f} "
        f"mean_tokens_per_sec={rate_text}"
    )
    if summary["rss_mb"] is not None:
        print(f"server_rss_mb={summary['rss_mb']:.0f}")


def load_prompts_file(path: str | Path) -> list[dict[str, Any]] | None:
    """Load a custom prompt list from JSON; ``None`` on invalid input."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: cannot read prompts file {path}: {exc}", file=sys.stderr)
        return None
    if not isinstance(data, list) or not data:
        print("error: prompts file must be a non-empty JSON list", file=sys.stderr)
        return None
    for index, prompt in enumerate(data):
        if not isinstance(prompt, dict) or "id" not in prompt or "messages" not in prompt:
            print(
                f"error: prompt #{index} must have 'id' and 'messages'",
                file=sys.stderr,
            )
            return None
    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--base-url",
        required=True,
        help="OpenAI-compatible base URL, e.g. http://127.0.0.1:8080/v1",
    )
    parser.add_argument("--model", required=True, help="model name the server expects")
    parser.add_argument(
        "--prompts", default=None, help="optional JSON file replacing the built-in prompts"
    )
    parser.add_argument("--out", default=None, help="write the JSON report to this file")
    parser.add_argument(
        "--api-key-env",
        default=None,
        help="name of an environment variable holding an optional API key",
    )
    parser.add_argument(
        "--pid", type=int, default=None, help="server PID to sample RSS from"
    )
    parser.add_argument(
        "--timeout", type=float, default=120.0, help="per-request timeout in seconds"
    )
    args = parser.parse_args(argv)

    api_key: str | None = None
    if args.api_key_env:
        api_key = os.environ.get(args.api_key_env, "").strip() or None
        if api_key is None:
            print(
                f"warning: {args.api_key_env} is unset/empty; sending without an API key",
                file=sys.stderr,
            )

    prompts = BUILTIN_PROMPTS
    if args.prompts:
        loaded = load_prompts_file(args.prompts)
        if loaded is None:
            return 2
        prompts = loaded

    results = run_bench(
        prompts,
        post=default_post,
        base_url=args.base_url,
        model=args.model,
        api_key=api_key,
        timeout=args.timeout,
    )
    summary = summarize(results)
    if args.pid is not None:
        summary["rss_mb"] = read_rss_mb(args.pid)

    print_table(summary, results)

    if args.out:
        report = {
            "base_url": args.base_url,
            "model": args.model,
            "prompts_source": args.prompts or "builtin",
            "summary": summary,
            "results": results,
        }
        Path(args.out).write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ارزیابی «ردیف ارزان» (cheap tier): کیفیت در برابر هزینه — issue #104.

هدف: تصمیم مستند و مبتنی بر داده دربارهٔ این‌که چت وب‌سایت از کدام مدل
ارزان استفاده کند (docs/STRATEGY.md §3b، رول ``cheap`` در
``config/models.yaml``).

این اسکریپت همان مجموعهٔ ۳۰ پرسش *عمومی* حقوقی ایران با مادهٔ مورد انتظار را
که ``scripts/eval_legal_rag.py`` استفاده می‌کند می‌خواند
(``data/eval/legal_rag_eval.jsonl`` — هرگز دادهٔ مشتری نیست) و برای هر مدل
کاندید که با ``--models`` روی خط فرمان داده می‌شود، یک فراخوانی
``POST /api/v1/chat/completions`` با یک پرامپت سیستمی کوتاه فارسی می‌فرستد
(``max_tokens=800``) و ثبت می‌کند:

  * آیا پاسخ شمارهٔ مادهٔ مورد انتظار را دارد (regex، ارقام فارسی نرمال‌شده)،
  * تأخیر (latency)،
  * توکن‌های prompt/completion،
  * هزینه (از فیلد ``usage.cost`` پاسخ API؛ در نبودِ آن تخمین از
    ``config/models.yaml``).

سپس یک جدول Markdown با هر مدل در یک سطر چاپ می‌کند: نرخ اصابت ارجاع
(citation hit-rate)، میانهٔ تأخیر، و هزینهٔ هر ۱۰۰ پاسخ. در پایان ارزان‌ترین
مدلی را چاپ می‌کند که به ≥ ۹۰٪ نرخ اصابت بهترین مدل برسد.

اجرا (باید توسط مالک/owner به‌صورت دستی و با کلید محیطی انجام شود؛ هیچ
workflow خودکاری ندارد):

    export OPENROUTER_API_KEY=...
    python3 scripts/eval_cheap_tier.py \\
        --models vendor/model-a,vendor/model-b \\
        --n 30 --budget-usd 1.00

کلید فقط از ``OPENROUTER_API_KEY`` خوانده می‌شود و هیچ‌جا نوشته/لاگ نمی‌شود.
``--budget-usd`` fail-closed است: به‌محض این‌که هزینهٔ جاری از فیلد usage از
بودجه بگذرد، فراخوانی‌ها متوقف و با کد خروج غیرصفر بازمی‌گردد.

issue #119 — شکست بلند (fail loudly): خطاهای API هر مدل شمرده و ثبت می‌شوند
(با نخستین پیام خطا؛ کلید هرگز چاپ نمی‌شود)، سطر مدل با ``ERRORS n/N`` علامت
می‌خورد، پاسخ‌های خطادار از مبنای نرخ اصابت حذف می‌شوند و اگر نرخ خطای هر مدل
از ۲۰٪ بگذرد، با کد خروج ۲ و بنر خطا اجرا شکست می‌خورد. در هیچ اجرایی که خطا
دارد مدلی پیشنهاد نمی‌شود. اگر خطای گواهی SSL تشخیص داده شود، راهنمای
``export SSL_CERT_FILE=...`` چاپ می‌شود.

issue #133 — مدل‌های reasoning: مدل‌های استدلالی (مثل
deepseek/deepseek-v4-flash و v4.1-flash) با ``max_tokens`` کوچک کل بودجه را صرف
استدلال پنهان می‌کنند و محتوای خالی با ``finish_reason=length`` برمی‌گردانند.
پرچم ``--reasoning {off,low,default}`` (پیش‌فرض ``off``) فیلد ``reasoning`` را
فقط وقتی مقدار ``default`` نباشد می‌فرستد. پاسخ خالی با برچسب
``EMPTY (finish_reason=..)`` ثبت می‌شود (نه «unknown error») و در ستون ``empty``
جدول شمرده می‌شود. برای خطاهای HTTP، متن بدنهٔ پاسخ (۳۰۰ کاراکتر اول) چاپ
می‌شود و کلید هرگز در پیام خطا قرار نمی‌گیرد.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
# eval_legal_rag.py و data/eval هم‌روت با همین اسکریپت‌اند؛ هر دو مسیر را روی
# sys.path می‌گذاریم تا چه با اجرای مستقیم و چه با بارگذاری دینامیک در تست
# (spec_from_file_location) ایمپورت شوند.
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_legal_rag import _article_in_text, load_eval_set  # noqa: E402

OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_EVAL_PATH = ROOT / "data" / "eval" / "legal_rag_eval.jsonl"
DEFAULT_N = 30
DEFAULT_BUDGET_USD = 1.00
DEFAULT_MAX_TOKENS = 800
DEFAULT_CALL_TIMEOUT_S = 60.0
# issue #133: پیش‌فرض ``off`` است تا مدل‌های reasoning بودجه را صرف استدلال
# پنهان نکنند و پاسخ خالی برنگردانند.
DEFAULT_REASONING = "off"
REASONING_CHOICES = ("off", "low", "default")
# متن بدنهٔ خطای HTTP که در پیام خطا نگه داشته می‌شود (کلید هرگز بخشی از آن
# نیست؛ فقط بدنهٔ پاسخ سرور است).
HTTP_ERROR_BODY_LIMIT = 300
# آستانهٔ تصمیم issue #104: ارزان‌ترین مدلی که به این نسبت از نرخ اصابت بهترین
# مدل برسد پیشنهاد می‌شود.
BEST_HIT_RATE_RATIO = 0.9
# issue #119: اگر نرخ خطای API برای هر مدلی از این نسبت بگذرد، اجرا شکست
# تلقی می‌شود (fail loudly) و کد خروج ۲ برمی‌گردد.
MAX_ERROR_RATE = 0.20
SSL_CERT_HINT = "export SSL_CERT_FILE=$(python3 -c 'import certifi;print(certifi.where())')"

SYSTEM_PROMPT = (
    "شما یک دستیار حقوقی فارسی‌زبان هستید که فقط بر پایهٔ قوانین ایران پاسخ "
    "می‌دهد. پاسخ را کوتاه و مستند بده و شمارهٔ مادهٔ قانونی مربوط را صریح "
    "ذکر کن."
)


# ---------------------------------------------------------------------------
# Data shapes
# ---------------------------------------------------------------------------


@dataclass
class AnswerResult:
    question_id: str
    cited: bool
    latency_ms: float
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    error: str | None = None
    empty: bool = False


@dataclass
class ModelReport:
    model: str
    n: int
    n_cited: int
    hit_rate: float
    median_latency_ms: float
    cost_per_100_answers: float
    total_cost_usd: float
    n_errors: int = 0
    n_empty: int = 0
    first_error: str | None = None
    results: list[AnswerResult] = field(default_factory=list)

    @property
    def n_ok(self) -> int:
        return self.n - self.n_errors

    @property
    def error_rate(self) -> float:
        return self.n_errors / self.n if self.n else 0.0


# ---------------------------------------------------------------------------
# Answer grading
# ---------------------------------------------------------------------------


def answer_cites_article(answer: str | None, expected_article: int) -> bool:
    """آیا پاسخ مدل شمارهٔ مادهٔ مورد انتظار را (با نرمال‌سازی ارقام فارسی)
    دارد؟ از همان regex اسکریپت eval_legal_rag استفاده می‌کند تا معیار citation
    بین دو eval یکسان بماند."""
    if not answer:
        return False
    return _article_in_text(int(expected_article), answer)


def is_ssl_cert_error(message: str | None) -> bool:
    """آیا پیام خطا مربوط به عدم تأیید گواهی SSL است؟ (روی macOS بدون CA
    bundle شایع است؛ issue #119.)"""
    if not message:
        return False
    return "CERTIFICATE_VERIFY_FAILED" in message.upper()


# ---------------------------------------------------------------------------
# Model call (OpenRouter chat completions)
# ---------------------------------------------------------------------------


def http_error_body(exc: urllib.error.HTTPError, limit: int = HTTP_ERROR_BODY_LIMIT) -> str:
    """بدنهٔ پاسخ خطای HTTP را (حداکثر ``limit`` کاراکتر) برمی‌گرداند.

    این متن *بدنهٔ پاسخ سرور* است و هرگز شامل کلید API (که فقط در هدر درخواست
    بوده) نمی‌شود. در صورت عدم دسترسی به بدنه، رشتهٔ خالی برمی‌گردد."""
    try:
        raw = exc.read()
    except Exception:
        return ""
    if not raw:
        return ""
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
    return text[:limit]


def _reasoning_field(reasoning: str) -> dict[str, Any] | None:
    """فیلد ``reasoning`` درخواست OpenRouter برای حالت‌های issue #133.

    ``off`` -> ``{"enabled": false}``؛ ``low`` -> ``{"effort": "low"}``؛
    ``default`` -> ``None`` (فیلد اصلاً فرستاده نمی‌شود)."""
    if reasoning == "off":
        return {"enabled": False}
    if reasoning == "low":
        return {"effort": "low"}
    return None


def call_model(
    question: str,
    api_key: str,
    model: str,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    timeout: float = DEFAULT_CALL_TIMEOUT_S,
    reasoning: str = DEFAULT_REASONING,
) -> tuple[str | None, dict[str, Any]]:
    """POST به OpenRouter. در خطای شبکه/تجزیه هرگز استثنا نمی‌اندازد؛
    ``(None, {"error": ...})`` برمی‌گرداند تا یک فراخوانی بد کل اجرا را
    متوقف نکند."""
    request_body: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ],
        "temperature": 0,
        "max_tokens": max_tokens,
    }
    reasoning_field = _reasoning_field(reasoning)
    if reasoning_field is not None:
        request_body["reasoning"] = reasoning_field
    body = json.dumps(request_body).encode("utf-8")
    req = urllib.request.Request(OPENROUTER_CHAT_URL, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", "application/json")

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # HTTPError زیرکلاس URLError است، پس باید پیش‌تر گرفته شود. متن بدنهٔ
        # پاسخ را برای تشخیص (مثلاً 404 «ZDR violation») نگه می‌داریم.
        body_text = http_error_body(exc)
        error = f"HTTPError: {exc.code} {exc.reason}"
        if body_text:
            error = f"{error} — {body_text}"
        return None, {"error": error, "latency_ms": (time.time() - t0) * 1000.0}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        return None, {
            "error": f"{type(exc).__name__}: {exc}",
            "latency_ms": (time.time() - t0) * 1000.0,
        }

    latency_ms = (time.time() - t0) * 1000.0
    try:
        choice = payload["choices"][0]
        content = choice["message"]["content"]
        finish_reason = choice.get("finish_reason")
    except (KeyError, IndexError, TypeError):
        return None, {"error": f"no message content: {payload!r}", "latency_ms": latency_ms}

    usage_raw = payload.get("usage") or {}
    usage = {
        "model": payload.get("model", model),
        "prompt_tokens": usage_raw.get("prompt_tokens") or 0,
        "completion_tokens": usage_raw.get("completion_tokens") or 0,
        # OpenRouter هزینه را در credits گزارش می‌کند؛ ۱ credit == ۱ USD
        # (همان قرارداد llm_router.py و eval_coding_smoke.py).
        "cost_usd": float(usage_raw["cost"]) if usage_raw.get("cost") is not None else None,
        "latency_ms": latency_ms,
    }
    # issue #133: پاسخ خالی (None یا "") را با برچسب EMPTY ثبت می‌کنیم نه
    # «unknown error»؛ finish_reason معمولاً length است چون بودجه صرف استدلال
    # پنهان شده. usage واقعی (توکن/هزینه) حفظ می‌شود.
    if not content:
        usage["error"] = f"EMPTY (finish_reason={finish_reason})"
        usage["empty"] = True
        return None, usage
    return content, usage


def price_for_model(model_id: str) -> dict[str, float] | None:
    """قیمت ``price_per_1m`` یک مدل را از هر رولی در config/models.yaml پیدا
    می‌کند (برای تخمین هزینه وقتی پاسخ API فیلد ``usage.cost`` ندارد). هیچ شناسهٔ
    مدلی این‌جا hardcode نشده است."""
    try:
        from output_apps.generated_modules.smartjudge import model_registry
    except Exception:
        return None
    try:
        data = model_registry.load()
    except Exception:
        return None
    for role_data in data.get("roles", {}).values():
        for entry in role_data.get("models", []):
            if entry.get("id") == model_id and entry.get("price_per_1m"):
                return entry["price_per_1m"]
    return None


def estimate_cost_usd(usage: dict[str, Any], model_id: str) -> float:
    """هزینهٔ یک فراخوانی: اول ``usage.cost`` خود API، سپس تخمین از رجیستری،
    وگرنه صفر."""
    if usage.get("cost_usd") is not None:
        return float(usage["cost_usd"])
    price = price_for_model(model_id)
    if not price:
        return 0.0
    prompt_tokens = usage.get("prompt_tokens") or 0
    completion_tokens = usage.get("completion_tokens") or 0
    return (prompt_tokens / 1_000_000.0) * price.get("in", 0.0) + (
        completion_tokens / 1_000_000.0
    ) * price.get("out", 0.0)


# ---------------------------------------------------------------------------
# Eval run
# ---------------------------------------------------------------------------


def summarize_model(model: str, results: list[AnswerResult]) -> ModelReport:
    n = len(results)
    n_errors = sum(1 for r in results if r.error is not None)
    n_empty = sum(1 for r in results if r.empty)
    n_ok = n - n_errors
    n_cited = sum(1 for r in results if r.cited and r.error is None)
    latencies = [r.latency_ms for r in results if r.error is None]
    median_latency = statistics.median(latencies) if latencies else 0.0
    total_cost = sum(r.cost_usd for r in results)
    cost_per_100 = (total_cost / n * 100.0) if n else 0.0
    first_error = next((r.error for r in results if r.error is not None), None)
    # نرخ اصابت فقط روی پاسخ‌های موفق محاسبه می‌شود؛ خطاها از مخرج حذف
    # می‌شوند تا یک اجرای شکست‌خورده به‌صورت «۰٪ اصابت» گزارش نشود.
    return ModelReport(
        model=model,
        n=n,
        n_cited=n_cited,
        hit_rate=round(n_cited / n_ok, 4) if n_ok else 0.0,
        median_latency_ms=round(median_latency, 1),
        cost_per_100_answers=round(cost_per_100, 6),
        total_cost_usd=round(total_cost, 6),
        n_errors=n_errors,
        n_empty=n_empty,
        first_error=first_error,
        results=results,
    )


def run_eval(
    models: list[str],
    questions: list[dict[str, Any]],
    api_key: str,
    budget_usd: float = DEFAULT_BUDGET_USD,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    reasoning: str = DEFAULT_REASONING,
) -> tuple[list[ModelReport], float, bool]:
    """هر مدل را روی پرسش‌ها اجرا می‌کند. بودجهٔ ``budget_usd`` برای کل اجرا
    (همهٔ مدل‌ها) انباشته می‌شود؛ به‌محض عبور از بودجه اجرا متوقف و
    ``budget_exceeded=True`` برمی‌گردد (fail-closed)."""
    reports: list[ModelReport] = []
    spent = 0.0
    exceeded = False

    for model in models:
        results: list[AnswerResult] = []
        for row in questions:
            content, usage = call_model(
                row["question"], api_key, model, max_tokens=max_tokens, reasoning=reasoning
            )
            cost = estimate_cost_usd(usage, model)
            spent += cost

            if content is None:
                results.append(
                    AnswerResult(
                        question_id=row["id"],
                        cited=False,
                        latency_ms=usage.get("latency_ms") or 0.0,
                        prompt_tokens=usage.get("prompt_tokens") or 0,
                        completion_tokens=usage.get("completion_tokens") or 0,
                        cost_usd=cost,
                        error=usage.get("error", "unknown error"),
                        empty=bool(usage.get("empty")),
                    )
                )
            else:
                results.append(
                    AnswerResult(
                        question_id=row["id"],
                        cited=answer_cites_article(content, row["expected_article"]),
                        latency_ms=usage.get("latency_ms") or 0.0,
                        prompt_tokens=usage.get("prompt_tokens") or 0,
                        completion_tokens=usage.get("completion_tokens") or 0,
                        cost_usd=cost,
                    )
                )

            if spent > budget_usd:
                exceeded = True
                break

        reports.append(summarize_model(model, results))
        if exceeded:
            break

    return reports, round(spent, 6), exceeded


def cheapest_meeting_threshold(
    reports: list[ModelReport], ratio: float = BEST_HIT_RATE_RATIO
) -> ModelReport | None:
    """ارزان‌ترین مدلی (بر مبنای هزینهٔ هر ۱۰۰ پاسخ) که نرخ اصابتش ≥
    ``ratio`` برابر بهترین نرخ اصابت باشد. در اجرایی که هر خطای API دارد هیچ
    مدلی پیشنهاد نمی‌شود (issue #119)."""
    if not reports:
        return None
    if any(r.n_errors for r in reports):
        return None
    best_hit_rate = max(r.hit_rate for r in reports)
    eligible = [r for r in reports if r.hit_rate >= ratio * best_hit_rate]
    if not eligible:
        return None
    return min(eligible, key=lambda r: r.cost_per_100_answers)


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def render_markdown(
    reports: list[ModelReport],
    spent: float,
    budget_exceeded: bool,
    ratio: float = BEST_HIT_RATE_RATIO,
) -> str:
    lines: list[str] = []
    n = reports[0].n if reports else 0
    lines.append(f"## cheap-tier eval — Persian legal questions (n={n})")
    lines.append("")
    lines.append(
        "| model | citation hit-rate | median latency (ms) | "
        "cost / 100 answers (USD) | errors | empty |"
    )
    lines.append("| --- | ---: | ---: | ---: | ---: | ---: |")
    for r in reports:
        errors_cell = f"ERRORS {r.n_errors}/{r.n}" if r.n_errors else "—"
        empty_cell = str(r.n_empty) if r.n_empty else "—"
        lines.append(
            f"| `{r.model}` | {r.hit_rate:.1%} ({r.n_cited}/{r.n_ok}) | "
            f"{r.median_latency_ms:.0f} | ${r.cost_per_100_answers:.4f} | "
            f"{errors_cell} | {empty_cell} |"
        )
    lines.append("")
    lines.append(f"total run cost: ${spent:.4f}")
    if budget_exceeded:
        lines.append("**budget exceeded — run stopped early (fail-closed).**")
    if any(r.n_errors for r in reports):
        lines.append(
            "**API errors recorded — results are not reliable; no model is "
            "recommended.**"
        )
        for r in reports:
            if r.n_errors:
                lines.append(
                    f"- `{r.model}`: {r.n_errors}/{r.n} calls failed "
                    f"(first error: {r.first_error})"
                )
        best = None
    else:
        best = cheapest_meeting_threshold(reports, ratio)
    if best is None:
        lines.append("cheapest model reaching ≥ 90% of the best hit-rate: (none)")
    else:
        lines.append(
            f"cheapest model reaching ≥ {ratio:.0%} of the best hit-rate: "
            f"`{best.model}` (${best.cost_per_100_answers:.4f}/100 answers, "
            f"hit-rate {best.hit_rate:.1%})"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--models",
        required=True,
        help="comma-separated OpenRouter model ids to evaluate (never hardcoded)",
    )
    ap.add_argument(
        "--n", type=int, default=DEFAULT_N, help=f"questions to run (default: {DEFAULT_N})"
    )
    ap.add_argument(
        "--budget-usd",
        type=float,
        default=DEFAULT_BUDGET_USD,
        help="fail closed once the running cost from the API usage field exceeds this (USD)",
    )
    ap.add_argument("--eval-set", type=Path, default=DEFAULT_EVAL_PATH)
    ap.add_argument(
        "--max-tokens", type=int, default=DEFAULT_MAX_TOKENS, help="max_tokens per call (800)"
    )
    ap.add_argument(
        "--reasoning",
        choices=REASONING_CHOICES,
        default=DEFAULT_REASONING,
        help=(
            "reasoning-model handling: 'off' sends {\"enabled\": false} (default), "
            "'low' sends {\"effort\": \"low\"}, 'default' sends no reasoning field"
        ),
    )
    args = ap.parse_args(argv)

    if args.n < 1:
        ap.error("--n must be >= 1")

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    if not models:
        ap.error("--models must contain at least one model id")

    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        print(
            "error: OPENROUTER_API_KEY is not set (this eval never uses any other key).",
            file=sys.stderr,
        )
        return 2

    try:
        questions = load_eval_set(args.eval_set)[: args.n]
    except (OSError, ValueError) as exc:
        print(f"error: could not load eval set {args.eval_set}: {exc}", file=sys.stderr)
        return 2
    if not questions:
        print(f"error: no questions loaded from {args.eval_set}", file=sys.stderr)
        return 2

    reports, spent, exceeded = run_eval(
        models,
        questions,
        api_key,
        budget_usd=args.budget_usd,
        max_tokens=args.max_tokens,
        reasoning=args.reasoning,
    )
    print(render_markdown(reports, spent, exceeded))

    error_reports = [r for r in reports if r.n_errors]
    if error_reports:
        for r in error_reports:
            print(
                f"error: {r.model}: {r.n_errors}/{r.n} API calls failed; "
                f"first error: {r.first_error}",
                file=sys.stderr,
            )
        if any(is_ssl_cert_error(r.first_error) for r in error_reports):
            print(
                "hint: TLS certificate verification failed (common on macOS "
                f"python without a CA bundle). Try:\n  {SSL_CERT_HINT}",
                file=sys.stderr,
            )

    if exceeded:
        print(
            f"error: --budget-usd {args.budget_usd:.2f} exceeded "
            f"(spent ${spent:.4f}); stopped.",
            file=sys.stderr,
        )
        return 2

    if any(r.error_rate > MAX_ERROR_RATE for r in reports):
        print(
            f"error: API error rate over {MAX_ERROR_RATE:.0%} for at least one "
            "model — results are unreliable and no model is recommended "
            "(fail loudly).",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

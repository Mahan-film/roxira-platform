#!/usr/bin/env python3
"""W13 (builder cost control): a small, dependency-free JSONL cost ledger.

Design lives in docs/STRATEGY.md (W13 row) and docs/ops/AUTO_MERGE.md.

This module is intentionally generic: `agent-review.yml` and `agent-automerge.yml`
(and, in future, `agent-task.yml`) can all append rows here in a common shape and
`scripts/cost_report.py` aggregates across every source. It reuses the row shape
W5's product router (`output_apps/generated_modules/smartjudge/llm_router.py`,
`_usage_record`/`summarize_jsonl`) already writes -- `ts` (ISO8601), `cost_usd`,
`model` -- plus a `source` field so rows from different callers can be told apart
in one report. It does not import that module (heavier deps, e.g. redis/psycopg,
that this small ledger has no need for); it only agrees on the JSONL shape.

Every ephemeral GitHub Actions runner starts empty, so a ledger written to
`runner.temp` is a same-run sanity check only, not a cross-run daily budget --
see `check_daily_budget()` below and docs/ops/AUTO_MERGE.md for the real
enforcement boundary (the OpenRouter key's own `limit`/`limit_reset`).
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"

# Sources this ledger expects to see. Not enforced strictly -- an unknown source
# is kept as-is -- but used to label reports consistently.
SOURCE_PRODUCT = "product"
SOURCE_AGENT_TASK = "agent-task"
SOURCE_AGENT_REVIEW = "agent-review"

_SOURCE_LABELS_FA = {
    SOURCE_PRODUCT: "محصول",
    SOURCE_AGENT_TASK: "اجرای ایجنت",
    SOURCE_AGENT_REVIEW: "بازبینی ایجنت",
}


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def append_row(ledger_path: Path, source: str, record: dict[str, Any]) -> None:
    """Append one JSONL row. Never writes a secret value -- callers must not
    put API keys/tokens in `record`."""
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    row = {"ts": datetime.now(UTC).isoformat(), "source": source, **record}
    with open(ledger_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# Reading / aggregation
# ---------------------------------------------------------------------------


def read_rows(*ledger_paths: Path) -> list[dict[str, Any]]:
    """Read and concatenate rows from one or more JSONL files. Missing files
    and unparseable lines are skipped silently (a partial/rotated ledger
    should not crash a report)."""
    rows: list[dict[str, Any]] = []
    for path in ledger_paths:
        if path is None or not Path(path).exists():
            continue
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if isinstance(rec, dict):
                    rows.append(rec)
    return rows


def _day_of(row: dict[str, Any]) -> str:
    return str(row.get("ts") or "")[:10]


def spend_for_day(rows: list[dict[str, Any]], day: str, source: str | None = None) -> float:
    total = 0.0
    for row in rows:
        if _day_of(row) != day:
            continue
        if source is not None and row.get("source") != source:
            continue
        total += float(row.get("cost_usd") or 0.0)
    return round(total, 6)


def aggregate(rows: list[dict[str, Any]], since: date) -> list[dict[str, Any]]:
    """Group rows by (day, source, model), same shape as
    llm_router.summarize_jsonl so both can feed the same report renderer."""
    since_iso = since.isoformat()
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in rows:
        day = _day_of(row)
        if not day or day < since_iso:
            continue
        source = str(row.get("source") or "unknown")
        model = str(row.get("model") or "-")
        key = (day, source, model)
        agg = grouped.setdefault(
            key,
            {"day": day, "source": source, "model": model, "calls": 0, "cost_usd": 0.0},
        )
        agg["calls"] += 1
        agg["cost_usd"] = round(agg["cost_usd"] + float(row.get("cost_usd") or 0.0), 6)
    return sorted(grouped.values(), key=lambda r: (r["day"], -r["cost_usd"]))


# ---------------------------------------------------------------------------
# Report rendering (English / Persian)
# ---------------------------------------------------------------------------


def render_report(rows: list[dict[str, Any]], lang: str = "en") -> str:
    """Render an aggregated (already-grouped) row list as a plain-text table.
    `lang` is "en" or "fa" (Persian labels; numbers stay Latin-digit for
    unambiguous copy/paste into spreadsheets)."""
    if lang not in ("en", "fa"):
        raise ValueError(f"unsupported lang: {lang!r} (expected 'en' or 'fa')")

    if not rows:
        return "هیچ هزینه‌ای ثبت نشده است." if lang == "fa" else "No cost recorded."

    total = round(sum(r["cost_usd"] for r in rows), 6)
    lines: list[str] = []
    if lang == "fa":
        lines.append("گزارش هزینهٔ ساخت (روکسیرا)")
        lines.append("تاریخ | منبع | مدل | تعداد فراخوانی | هزینه (دلار)")
    else:
        lines.append("Builder cost report")
        lines.append("day | source | model | calls | cost_usd")
    lines.append("-" * 60)
    for r in rows:
        source_label = r["source"]
        if lang == "fa":
            source_label = _SOURCE_LABELS_FA.get(r["source"], r["source"])
        lines.append(
            f"{r['day']} | {source_label} | {r['model']} | {r['calls']} | {r['cost_usd']:.6f}"
        )
    lines.append("-" * 60)
    if lang == "fa":
        lines.append(f"مجموع: {total:.6f} دلار")
    else:
        lines.append(f"Total: ${total:.6f}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Daily $ budget guard via OpenRouter GET /api/v1/key
# ---------------------------------------------------------------------------


@dataclass
class BudgetCheck:
    allowed: bool
    message: str
    remaining_usd: float | None = None
    checked_via: str = "unchecked"


def openrouter_key_snapshot(api_key: str, timeout: float = 15.0) -> dict[str, Any] | None:
    """GET /api/v1/key. Returns the raw `data` object, or None on any failure
    (network/HTTP/parse) -- callers must fail closed on None per-context, this
    function itself never raises."""
    req = urllib.request.Request(OPENROUTER_KEY_URL)
    req.add_header("Authorization", f"Bearer {api_key}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return None
    data = payload.get("data") if isinstance(payload, dict) else None
    return data if isinstance(data, dict) else None


def check_daily_budget(api_key: str, daily_budget_usd: float) -> BudgetCheck:
    """Best-effort, cheap ($0-cost) daily budget guard for a workflow step.

    OpenRouter's GET /api/v1/key reports the *key's own* `limit_remaining`
    (dollars left before the key stops working) when the key was created with
    a `limit` and `limit_reset`. When the key's `limit_reset` is "daily", that
    remaining amount already IS the right per-day figure and this function can
    make a real allow/skip decision from it cheaply (no completion call, just
    this one read-only GET).

    When the key has no `limit`/`limit_reset` set (or the field is missing, or
    the read fails), this function does NOT block -- an unverifiable "daily"
    figure against a key with no reset is not a safe thing to enforce, and a
    false "over budget" would stop legitimate reviews. It returns `allowed=True`
    with a message documenting that the real cap is the key's own
    `limit`/`limit_reset`, matching docs/ops/AUTO_MERGE.md and
    docs/AGENTS_WORKFORCE.md #6 (the same convention agent-task already uses).
    """
    if daily_budget_usd <= 0:
        return BudgetCheck(allowed=True, message="no daily budget configured", checked_via="none")

    data = openrouter_key_snapshot(api_key)
    if data is None:
        return BudgetCheck(
            allowed=True,
            message=(
                "could not read OpenRouter GET /api/v1/key; proceeding without a same-run "
                "budget check. Enforcement relies on OPENROUTER_AGENT_KEY's own limit/limit_reset."
            ),
            checked_via="unreachable",
        )

    limit_reset = data.get("limit_reset")
    limit_remaining = data.get("limit_remaining")
    if limit_reset == "daily" and limit_remaining is not None:
        try:
            remaining = float(limit_remaining)
        except (TypeError, ValueError):
            remaining = None
        if remaining is not None:
            if remaining <= 0:
                return BudgetCheck(
                    allowed=False,
                    message=(
                        f"OpenRouter key daily limit exhausted (limit_remaining=${remaining:.4f}); "
                        "skipping until the key's daily reset."
                    ),
                    remaining_usd=remaining,
                    checked_via="limit_remaining",
                )
            return BudgetCheck(
                allowed=True,
                message=f"OpenRouter key daily budget OK (limit_remaining=${remaining:.4f}).",
                remaining_usd=remaining,
                checked_via="limit_remaining",
            )

    # No usable daily-scoped figure from the API. Document, don't block.
    return BudgetCheck(
        allowed=True,
        message=(
            "OpenRouter key has no daily-scoped limit_remaining (limit_reset="
            f"{limit_reset!r}). AGENT_DAILY_BUDGET_USD is documentation only here; "
            "set the key's own `limit` with `limit_reset: daily` for real enforcement "
            "(see docs/ops/AUTO_MERGE.md)."
        ),
        checked_via="documented-only",
    )

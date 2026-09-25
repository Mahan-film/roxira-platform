#!/usr/bin/env python3
"""W13: builder cost report -- aggregates JSONL cost rows from the product
router, agent-task runs and agent-review runs into a daily/weekly summary.

The heavy lifting (reading, grouping, Persian rendering) lives in
`output_apps/ecosystem_core/src/factory/cost_ledger.py` so it's unit tested
there (`src/factory/test_cost_ledger.py`); this script is just the CLI.

Row sources (all optional -- point this at whichever files exist):
  --product-log     W5's product router usage log (LLM_USAGE_LOG_PATH env var
                     in output_apps/generated_modules/smartjudge/llm_router.py).
                     Same JSONL shape (ts, cost_usd, model, ...), read directly
                     here rather than importing llm_router.py (which pulls in
                     redis/psycopg and other product-only deps this report has
                     no need for).
  --agent-ledger     agent_runner.py's AGENT_LEDGER_PATH (agent-task runs).
  --review-ledger    agent-review.yml's per-run ledger (see that workflow).

Each source file is tagged with its own `source` label if the file's own rows
don't already have one (the product router's rows predate this convention and
have no `source` field, so this script fills it in as "product" when reading
that file specifically).

Usage:
    python3 scripts/cost_report.py --agent-ledger /path/to/agent_ledger.jsonl \\
        --review-ledger /path/to/review_ledger.jsonl --days 7 --lang fa
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

_FACTORY_DIR = (
    Path(__file__).resolve().parent.parent
    / "output_apps"
    / "ecosystem_core"
    / "src"
    / "factory"
)
sys.path.insert(0, str(_FACTORY_DIR))
import cost_ledger  # noqa: E402


def _read_tagged(path: Path | None, default_source: str) -> list[dict]:
    if path is None:
        return []
    rows = cost_ledger.read_rows(path)
    for row in rows:
        row.setdefault("source", default_source)
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Roxira builder cost report")
    ap.add_argument("--product-log", type=Path, default=None)
    ap.add_argument("--agent-ledger", type=Path, default=None)
    ap.add_argument("--review-ledger", type=Path, default=None)
    ap.add_argument("--days", type=int, default=7, help="how many days back to include")
    ap.add_argument("--lang", choices=["en", "fa"], default="en")
    args = ap.parse_args(argv)

    rows: list[dict] = []
    rows += _read_tagged(args.product_log, cost_ledger.SOURCE_PRODUCT)
    rows += _read_tagged(args.agent_ledger, cost_ledger.SOURCE_AGENT_TASK)
    rows += _read_tagged(args.review_ledger, cost_ledger.SOURCE_AGENT_REVIEW)

    if not rows:
        if args.lang == "fa":
            msg = (
                "هیچ فایل هزینه‌ای پیدا یا خوانده نشد؛ حداقل یکی از "
                "--product-log/--agent-ledger/--review-ledger را بدهید."
            )
        else:
            msg = (
                "No cost files found/readable; pass at least one of "
                "--product-log/--agent-ledger/--review-ledger."
            )
        print(msg)
        return 0

    since = (datetime.now(UTC) - timedelta(days=args.days - 1)).date()
    aggregated = cost_ledger.aggregate(rows, since)
    print(cost_ledger.render_report(aggregated, lang=args.lang))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

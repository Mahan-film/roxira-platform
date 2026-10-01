"""`/report` CLI: reply with the Persian delivery report for a Factory issue.

Fetches the issue's comments with `gh api ... --paginate`, decodes the durable
run-ledger events from them (ledger_comments), renders the Persian delivery
report (delivery_report), and appends a Persian budget line (budget). The fetch
step is injectable so tests run offline; no code runs at import time.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from typing import Any, Callable

from . import budget
from .delivery_report import render_delivery_report_fa
from .ledger_comments import build_summary

NO_DATA_FA = "هنوز داده‌ای برای این اجرا ثبت نشده است — گزارشی موجود نیست."


def _decode_comment_pages(raw: str) -> list[dict[str, Any]]:
    """Parse the (possibly per-page concatenated) JSON output of `gh api`."""
    decoder = json.JSONDecoder()
    comments: list[dict[str, Any]] = []
    index, length = 0, len(raw)
    while index < length:
        while index < length and raw[index].isspace():
            index += 1
        if index >= length:
            break
        value, index = decoder.raw_decode(raw, index)
        if isinstance(value, list):
            comments.extend(item for item in value if isinstance(item, dict))
        elif isinstance(value, dict):
            comments.append(value)
    return comments


def fetch_comment_bodies(issue: int) -> list[str]:
    """Return the issue's comment bodies via the GitHub CLI (paginated)."""
    repository = os.environ["GITHUB_REPOSITORY"]
    result = subprocess.run(
        ["gh", "api", f"repos/{repository}/issues/{issue}/comments", "--paginate"],
        check=True,
        capture_output=True,
        text=True,
    )
    return [str(item.get("body", "")) for item in _decode_comment_pages(result.stdout)]


def build_report(comment_bodies: list[str]) -> str:
    """Render the Persian delivery report plus a budget line from ledger comments."""
    summary = build_summary(comment_bodies)
    if not summary:
        return NO_DATA_FA
    total = summary.get("total_cost_usd", 0) or 0
    budget_line = budget.render_fa(budget.evaluate(float(total)))
    return f"{render_delivery_report_fa(summary)}\n{budget_line}"


def main(
    argv: list[str] | None = None,
    fetch: Callable[[int], list[str]] = fetch_comment_bodies,
) -> int:
    """Print the Persian delivery report for the issue given by `--issue`."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--issue", type=int, required=True, help="parent issue number")
    args = parser.parse_args(argv)
    print(build_report(fetch(args.issue)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

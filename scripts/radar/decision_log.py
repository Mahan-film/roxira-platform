#!/usr/bin/env python3
"""Append-only radar decision log (issue #338).

The radar recommends a technology; a human decides. Every decision is appended
as one row to ``docs/radar/DECISIONS.md`` so the system can later see what was
tried. The file is append-only: this tool never edits or deletes an earlier row.

Usage::

    python3 scripts/radar/decision_log.py add \\
        --name "DBOS Transact" --url https://github.com/dbos-inc/dbos-transact-py \\
        --source github --verdict trial \\
        --reason "Postgres-backed durable workflow spike" [--owner NAME] [--date YYYY-MM-DD]

    python3 scripts/radar/decision_log.py list [--verdict adopt]
"""

from __future__ import annotations

import argparse
import datetime as _dt
import pathlib
import sys
from typing import List, Optional

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_LOG = REPO_ROOT / "docs" / "radar" / "DECISIONS.md"

SOURCES = ("github", "hackernews", "arxiv", "huggingface", "manual")
VERDICTS = ("adopt", "trial", "skip", "defer")
MIN_REASON_LEN = 15

COLUMNS = ("date", "name", "url", "source", "verdict", "reason", "owner")

TABLE_HEADER = (
    "| date | name | url | source | verdict | reason | owner |\n"
    "| --- | --- | --- | --- | --- | --- | --- |\n"
)

HEADER = """# Radar decision log

The radar recommends, a human decides. This file is **append-only**: new rows go
at the bottom and earlier rows are never edited or deleted, so the record of
what was tried stays intact.

Append one decision:

```bash
python3 scripts/radar/decision_log.py add \\
  --name "DBOS Transact" --url https://github.com/dbos-inc/dbos-transact-py \\
  --source github --verdict trial \\
  --reason "Postgres-backed durable workflow spike" --owner mac
```

List decisions (optionally by verdict):

```bash
python3 scripts/radar/decision_log.py list
python3 scripts/radar/decision_log.py list --verdict adopt
```
"""


class DecisionError(ValueError):
    """A decision row was rejected; nothing was written."""


def _clean(value: object) -> str:
    """Collapse whitespace/newlines and keep a row on one markdown line."""
    return " ".join(str(value or "").split()).replace("|", "/")


def _normalize_date(value: Optional[str]) -> str:
    text = (value or "").strip()
    if not text:
        return _dt.date.today().isoformat()
    try:
        return _dt.date.fromisoformat(text).isoformat()
    except ValueError as exc:
        raise DecisionError(f"date must be YYYY-MM-DD, got {value!r}") from exc


def _validate(
    name: str,
    url: str,
    source: str,
    verdict: str,
    reason: str,
) -> tuple[str, str]:
    name = _clean(name)
    url = str(url or "").strip()
    reason = _clean(reason)
    if not name:
        raise DecisionError("name is required")
    if not url:
        raise DecisionError("a primary-source URL is required")
    if not url.startswith("https://"):
        raise DecisionError(f"URL must start with https://, got {url!r}")
    if " " in url:
        raise DecisionError(f"URL must not contain spaces, got {url!r}")
    if source not in SOURCES:
        raise DecisionError(f"source must be one of {SOURCES}, got {source!r}")
    if verdict not in VERDICTS:
        raise DecisionError(f"verdict must be one of {VERDICTS}, got {verdict!r}")
    if len(reason) < MIN_REASON_LEN:
        raise DecisionError(
            f"reason must be at least {MIN_REASON_LEN} characters, got {len(reason)}"
        )
    return name, reason


def _new_file_text() -> str:
    return HEADER + "\n" + TABLE_HEADER


def _ensure_table(text: str) -> str:
    if "| date |" in text:
        return text
    if not text.endswith("\n"):
        text += "\n"
    return text + "\n" + TABLE_HEADER


def _parse_rows(text: str) -> List[dict]:
    rows: List[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) != len(COLUMNS):
            continue
        first = cells[0]
        if first == "date" or not first or set(first) <= {"-", " "}:
            continue
        rows.append(dict(zip(COLUMNS, cells)))
    return rows


def add_decision(
    path: pathlib.Path,
    name: str,
    url: str,
    source: str,
    verdict: str,
    reason: str,
    owner: Optional[str] = None,
    date: Optional[str] = None,
) -> dict:
    """Validate one decision and append it. Returns the row that was written."""
    name, reason = _validate(name, url, source, verdict, reason)
    owner = _clean(owner)
    date = _normalize_date(date)

    path = pathlib.Path(path)
    text = _new_file_text() if not path.exists() else path.read_text(encoding="utf-8")

    for existing in _parse_rows(text):
        if existing["url"] == url:
            raise DecisionError(f"duplicate URL already logged: {url}")

    text = _ensure_table(text)
    if not text.endswith("\n"):
        text += "\n"
    row = {
        "date": date,
        "name": name,
        "url": url,
        "source": source,
        "verdict": verdict,
        "reason": reason,
        "owner": owner,
    }
    line = "| " + " | ".join(row[column] for column in COLUMNS) + " |\n"

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + line, encoding="utf-8")
    return row


def list_decisions(path: pathlib.Path, verdict: Optional[str] = None) -> List[dict]:
    """Return the logged rows, optionally filtered to one verdict."""
    if verdict is not None and verdict not in VERDICTS:
        raise DecisionError(f"verdict must be one of {VERDICTS}, got {verdict!r}")
    path = pathlib.Path(path)
    if not path.exists():
        return []
    rows = _parse_rows(path.read_text(encoding="utf-8"))
    if verdict is not None:
        rows = [row for row in rows if row["verdict"] == verdict]
    return rows


def _render(rows: List[dict]) -> str:
    lines = ["| " + " | ".join(COLUMNS) + " |", "| " + " | ".join("---" for _ in COLUMNS) + " |"]
    lines.extend("| " + " | ".join(row[column] for column in COLUMNS) + " |" for row in rows)
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="decision_log",
        description="Append-only radar decision log (docs/radar/DECISIONS.md).",
    )
    parser.add_argument("--file", default=str(DEFAULT_LOG), help="Decision-log path.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    add = subparsers.add_parser("add", help="Append one decision row.")
    add.add_argument("--name", required=True)
    add.add_argument("--url", required=True)
    add.add_argument("--source", required=True, choices=SOURCES)
    add.add_argument("--verdict", required=True, choices=VERDICTS)
    add.add_argument("--reason", required=True)
    add.add_argument("--owner", default="")
    add.add_argument("--date", default=None)

    listing = subparsers.add_parser("list", help="Print decision rows.")
    listing.add_argument("--verdict", default=None, choices=VERDICTS)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "add":
            row = add_decision(
                pathlib.Path(args.file),
                name=args.name,
                url=args.url,
                source=args.source,
                verdict=args.verdict,
                reason=args.reason,
                owner=args.owner,
                date=args.date,
            )
            print(f"appended: {row['name']} [{row['verdict']}]")
            return 0
        rows = list_decisions(pathlib.Path(args.file), verdict=args.verdict)
    except DecisionError as exc:
        parser.error(str(exc))
        return 2  # pragma: no cover - argparse.error raises SystemExit
    print(_render(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())

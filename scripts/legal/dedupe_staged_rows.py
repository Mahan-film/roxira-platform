#!/usr/bin/env python3
"""Merge staged legal JSONL inputs, keeping the LAST row per (law, article, section).

`build_v4_on_server.sh` applies several staged files in a fixed order and needs the LATER
input to win when two files carry the same instrument: qavanin overrides nezamat, and
nezamat overrides the older ekhtebar rows. `ingest_pipeline.py` already upserts by a
deterministic point id keyed on (law_name, article_no, article_label); this helper makes the
override explicit and adds the ``section`` component that qavanin print versions carry
(parse_qavanin_print.py) so two numbering sequences in one law are not collapsed.

Rows are read in the order the files are given; a row whose normalised (law_name,
article_no, section) appears again later is dropped. The surviving rows keep their input
order. ``needs_review`` and every other payload field are preserved unchanged (flagged rows
are still ingested with the flag in the payload).

  dedupe_staged_rows.py --out /work/merged.jsonl FILE [FILE ...]

Stdlib only; the report is counts only, no law text is printed.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_ingest():
    existing = sys.modules.get("ingest_pipeline")
    if existing is not None:
        return existing
    path = ROOT / "scripts/legal/ingest_pipeline.py"
    spec = importlib.util.spec_from_file_location("ingest_pipeline", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ingest_pipeline"] = mod
    spec.loader.exec_module(mod)
    return mod


ip = _load_ingest()


def dedupe_key(row: dict) -> tuple[str, str, str]:
    """Later-input-wins key: normalised (law_name, article_no, section)."""
    return (
        ip.norm_name(str(row.get("law_name", ""))),
        ip.norm_name(str(row.get("article_no", ""))),
        ip.norm_name(str(row.get("section") or "")),
    )


def dedupe_rows(rows: list[dict]) -> list[dict]:
    """Keep only the LAST row per key; the output stays in input order."""
    last: dict[tuple[str, str, str], int] = {}
    for i, row in enumerate(rows):
        last[dedupe_key(row)] = i
    keep = set(last.values())
    return [row for i, row in enumerate(rows) if i in keep]


def merge(paths: list[Path]) -> tuple[list[dict], dict]:
    """Read the files in order, return (deduped rows, counts-only report)."""
    rows: list[dict] = []
    unparsable = 0
    for path in paths:
        part, bad = ip.load_rows(Path(path))
        rows += part
        unparsable += bad
    out = dedupe_rows(rows)
    report = {
        "files": [str(p) for p in paths],
        "rows_in": len(rows),
        "rows_out": len(out),
        "overridden": len(rows) - len(out),
        "needs_review_rows": sum(1 for r in out if r.get("needs_review")),
        "unparsable_lines": unparsable,
    }
    return out, report


def _write(path: Path, rows: list[dict]) -> None:
    if path.exists():
        raise SystemExit(f"refusing to overwrite {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument(
        "files", nargs="+", type=Path, help="staged JSONL inputs, lowest priority first"
    )
    args = ap.parse_args(argv)
    rows, report = merge(args.files)
    _write(args.out, rows)
    report["out"] = str(args.out)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

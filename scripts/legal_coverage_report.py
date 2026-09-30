"""Build the legal coverage manifest from data/legal/*.jsonl (W25-2, issue #139).

Reads every JSONL shard in a data directory (default ``data/legal``), aggregates
the rows per law, and writes two artifacts with identical numbers:

  * ``docs/LEGAL_COVERAGE_MANIFEST.md`` -- Persian headings, English table; the
    human-readable coverage page (consumed by the W25-3 public page).
  * ``data/legal/coverage_manifest.json`` -- the same figures, machine-readable.

Per law it reports: name, type, article (row) count, active/inactive counts,
newest ``amended_on`` and ``approval_date`` (Jalali, compared numerically), and
the distinct sources. A warning is emitted for bills whose name contains «لایحه»,
except for enacted laws that retain «لایحه» in their historical titles.

Usage:
    python3 scripts/legal_coverage_report.py
    python3 scripts/legal_coverage_report.py --data-dir data/legal
    python3 scripts/legal_coverage_report.py --md-out x.md --json-out y.json

Pure standard library; no network, no database, no secrets. Safe to run offline.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]

DEFAULT_DATA_DIR = ROOT / "data" / "legal"
DEFAULT_MD_OUT = ROOT / "docs" / "LEGAL_COVERAGE_MANIFEST.md"
DEFAULT_JSON_OUT = ROOT / "data" / "legal" / "coverage_manifest.json"

# Persian (U+06F0..U+06F9), Arabic-Indic (U+0660..U+0669) and ASCII digits.
_DIGIT_TABLE = str.maketrans(
    "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩",
    "01234567890123456789",
)

BILL_MARKER = "لایحه"
ENACTED_DESPITE_TITLE = (
    "لایحه اصلاحی قانون تجارت",
    "لایحه قانونی اصلاح قسمتی از قانون تجارت",
    "لایحه قانونی استقلال کانون وکلای دادگستری",
)


def load_records(data_dir: pathlib.Path) -> list[dict[str, Any]]:
    """Read every ``*.jsonl`` in *data_dir* (sorted) into a list of dicts.

    Blank lines are skipped; a malformed line raises ``ValueError`` naming the
    file and line so a bad shard is never silently dropped from the manifest.
    """
    records: list[dict[str, Any]] = []
    paths = sorted(data_dir.glob("*.jsonl"))
    if not paths:
        raise FileNotFoundError(f"no *.jsonl files found under {data_dir}")
    for path in paths:
        with path.open(encoding="utf-8") as handle:
            for lineno, raw in enumerate(handle, start=1):
                line = raw.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"{path}:{lineno}: invalid JSON: {exc}") from exc
                if isinstance(record, dict):
                    records.append(record)
    return records


def _date_sort_key(value: Any) -> tuple[int, ...] | None:
    """Numeric sort key for a Jalali date like ``"1379-01-21"``.

    Persian/Arabic-Indic digits are normalized first; a non-zero-padded or
    mixed part therefore still compares numerically rather than as a string.
    Returns ``None`` for empty/unparseable values so they sort last.
    """
    if value is None:
        return None
    text = str(value).translate(_DIGIT_TABLE)
    parts = re.findall(r"\d+", text)
    if not parts:
        return None
    return tuple(int(part) for part in parts)


def _newest(values: list[Any]) -> str | None:
    """Return the lexically-original newest non-empty date among *values*."""
    best: str | None = None
    best_key: tuple[int, ...] | None = None
    for value in values:
        key = _date_sort_key(value)
        if key is None:
            continue
        if best_key is None or key > best_key:
            best_key, best = key, str(value)
    return best


def build_manifest(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate raw JSONL rows into the canonical manifest structure.

    Grouping key is ``law_name`` (the human-facing law). ``law_id`` may be null
    for owner-supplied rows, so the first non-null id seen is kept for reference
    only. Rows whose ``law_name`` is empty are ignored.
    """
    groups: dict[str, dict[str, Any]] = {
        "laws": {},  # name -> mutable aggregate
        "all_amended": [],
        "all_approvals": [],
    }
    laws: dict[str, dict[str, Any]] = groups["laws"]

    for record in records:
        name = str(record.get("law_name") or "").strip()
        if not name:
            continue
        entry = laws.get(name)
        if entry is None:
            entry = {
                "name": name,
                "law_id": None,
                "types": set(),
                "articles": 0,
                "active": 0,
                "inactive": 0,
                "sources": set(),
                "source_urls": set(),
                "source_tiers": set(),
            }
            laws[name] = entry

        if entry["law_id"] is None and record.get("law_id"):
            entry["law_id"] = record["law_id"]
        if record.get("law_type"):
            entry["types"].add(str(record["law_type"]))
        entry["articles"] += 1
        if record.get("is_active") is True:
            entry["active"] += 1
        else:
            entry["inactive"] += 1
        if record.get("source"):
            entry["sources"].add(str(record["source"]))
        if record.get("source_url"):
            entry["source_urls"].add(str(record["source_url"]))
        entry["source_tiers"].add(str(record.get("source_tier") or "unknown"))

        amended = record.get("amended_on")
        approval = record.get("approval_date")
        if _date_sort_key(amended) is not None:
            entry.setdefault("_amended", []).append(amended)
            groups["all_amended"].append(amended)
        if _date_sort_key(approval) is not None:
            entry.setdefault("_approval", []).append(approval)
            groups["all_approvals"].append(approval)

    law_rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    for name, entry in laws.items():
        is_bill = BILL_MARKER in name and not any(
            enacted_name in name for enacted_name in ENACTED_DESPITE_TITLE
        )
        if any(commerce_law in name for commerce_law in ENACTED_DESPITE_TITLE[:2]):
            warnings.append(
                f"«{name}» قانون لازم‌الاجرا است (مصوب کمیسیون مشترک مجلسین)؛ "
                "مواد ۵۱ و ۵۳ تا ۷۱ آن طبق قانون ۱۴۰۳/۱۱/۱۵ نامعتبر اعلام شده "
                "و باید از پایگاه حذف شود."
            )
        row = {
            "name": name,
            "law_id": entry["law_id"],
            "types": sorted(entry["types"]),
            "type": ";".join(sorted(entry["types"])) or "UNKNOWN",
            "articles": entry["articles"],
            "active": entry["active"],
            "inactive": entry["inactive"],
            "newest_amended_on": _newest(entry.get("_amended", [])),
            "newest_approval_date": _newest(entry.get("_approval", [])),
            "sources": sorted(entry["sources"]),
            "source_urls": sorted(entry["source_urls"]),
            "source_tiers": sorted(entry["source_tiers"]),
            "is_bill": is_bill,
        }
        law_rows.append(row)
        if is_bill:
            warnings.append(
                f"نام «{name}» شامل «{BILL_MARKER}» است؛ لوایح قانون لازم‌الاجرا نیستند "
                "و نباید به‌عنوان قانون در حال اجرا استناد شوند."
            )
        if row["source_tiers"] != ["official"]:
            warnings.append(
                f"متن «{name}» از منبع غیررسمی است و باید با متن رسمی تطبیق داده شود."
            )

    # Largest law first, then alphabetical for a stable, reviewable order.
    law_rows.sort(key=lambda row: (-row["articles"], row["name"]))

    total_articles = sum(row["articles"] for row in law_rows)
    total_active = sum(row["active"] for row in law_rows)
    total_inactive = sum(row["inactive"] for row in law_rows)

    manifest: dict[str, Any] = {
        "totals": {
            "laws": len(law_rows),
            "articles": total_articles,
            "active": total_active,
            "inactive": total_inactive,
            "bills": sum(1 for row in law_rows if row["is_bill"]),
            "newest_amended_on": _newest(groups["all_amended"]),
            "newest_approval_date": _newest(groups["all_approvals"]),
        },
        "warnings": warnings,
        "laws": law_rows,
    }
    return manifest


def render_markdown(manifest: dict[str, Any]) -> str:
    """Render the manifest as the Persian-headed Markdown coverage page."""
    totals = manifest["totals"]
    lines: list[str] = []
    lines.append("# مانیفست پوشش حقوقی")
    lines.append("")
    lines.append(
        "این سند به‌صورت خودکار از فایل‌های `data/legal/*.jsonl` ساخته می‌شود "
        "(`scripts/legal_coverage_report.py`). شماره‌ها با "  # noqa: RUF001
        "`data/legal/coverage_manifest.json` یکسان است."
    )
    lines.append("")
    lines.append("## خلاصه")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("| --- | --- |")
    lines.append(f"| Laws | {totals['laws']} |")
    lines.append(f"| Articles (rows) | {totals['articles']} |")
    lines.append(f"| Active | {totals['active']} |")
    lines.append(f"| Inactive | {totals['inactive']} |")
    lines.append(f"| Bills (لوایح) | {totals['bills']} |")
    lines.append(f"| Newest amendment date | {totals['newest_amended_on'] or '-'} |")
    lines.append(f"| Newest approval date | {totals['newest_approval_date'] or '-'} |")
    lines.append("")

    if manifest["warnings"]:
        lines.append("## هشدارها")
        lines.append("")
        for warning in manifest["warnings"]:
            lines.append(f"> ⚠️ {warning}")
        lines.append("")

    lines.append("## پوشش به تفکیک قانون")
    lines.append("")
    lines.append(
        "| Law | Type | Articles | Active | Inactive | Latest amendment | Approval date | "
        "Source | Tier |"
    )
    lines.append("| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |")
    for row in manifest["laws"]:
        name = row["name"] + (" (لایحه)" if row["is_bill"] else "")
        sources = "; ".join(row["sources"]) or "-"
        tiers = "; ".join(row["source_tiers"]) or "-"
        lines.append(
            f"| {name} | {row['type']} | {row['articles']} | {row['active']} | "
            f"{row['inactive']} | {row['newest_amended_on'] or '-'} | "
            f"{row['newest_approval_date'] or '-'} | {sources} | {tiers} |"
        )
    lines.append("")
    lines.append(
        "> هیچ خروجی این سامانه مشاوره حقوقی نیست تا زمانی که وکیل رسمی ایرانی آن را بازبینی کند."
    )
    lines.append("")
    return "\n".join(lines)


def write_outputs(manifest: dict[str, Any], md_path: pathlib.Path, json_path: pathlib.Path) -> None:
    md_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(render_markdown(manifest), encoding="utf-8")
    json_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=pathlib.Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--md-out", type=pathlib.Path, default=DEFAULT_MD_OUT)
    parser.add_argument("--json-out", type=pathlib.Path, default=DEFAULT_JSON_OUT)
    parser.add_argument("--quiet", action="store_true", help="Do not print the human summary.")
    args = parser.parse_args(argv)

    try:
        records = load_records(args.data_dir)
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    manifest = build_manifest(records)
    write_outputs(manifest, args.md_out, args.json_out)

    if not args.quiet:
        totals = manifest["totals"]
        print(
            f"{totals['laws']} laws, {totals['articles']} articles "
            f"({totals['active']} active, {totals['inactive']} inactive, "
            f"{totals['bills']} bills)"
        )
        for warning in manifest["warnings"]:
            print(f"warning: {warning}")
        print(f"wrote {args.md_out}")
        print(f"wrote {args.json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

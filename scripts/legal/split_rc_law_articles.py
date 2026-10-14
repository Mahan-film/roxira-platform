#!/usr/bin/env python3
"""Split rc.majlis.ir relay law rows (source=="rcmajlis") into one row per article.

`iran_relay.py` stages ONE row per rc.majlis law, with the FULL text in `text`. A law holds many
articles, so this reader splits that text on the article headings (ماده N / ماده N مکرر, in Persian
or ASCII digits; sub-clauses stay inside their article) and writes one staged row per article in the
data/legal/phase1_canonical.jsonl schema.

  split_rc_law_articles.py IN.jsonl --out data/legal/staged/rc_laws_<date>.jsonl
  split_rc_law_articles.py IN.jsonl --dry-run      # counts per law; nothing is written

The cover letter before the first article is dropped. When a law repeats an article number, the
first occurrence wins and the rest are logged to stderr. Stdlib only; nothing writes to Qdrant.
"""
# ruff: noqa: RUF001, RUF002
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

_DIGITS = "0-9۰-۹٠-١٢٣٤٥٦٧٨٩"
_DIGIT_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
# A heading starts after a non-letter (so a mid-word match is impossible), then the article marker
# followed by a separator. The relay text is whitespace-collapsed, so headings are matched
# anywhere in the string, not only at line starts.
_ARTICLE_RE = re.compile(
    rf"(?<![\u0600-\u06FF])ماده\s*(?P<num>[{_DIGITS}]+)\s*(?P<mok>مکرر)?\s*(?P<sep>[-–—ـ:.]+)"
)
_SOURCE = "rcmajlis"


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def split_articles(text: str) -> list[dict]:
    """Return [{'no', 'label', 'body'}, ...]; everything before the first heading is dropped."""
    text = str(text or "")
    matches = list(_ARTICLE_RE.finditer(text))
    arts: list[dict] = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        num = int(m.group("num").translate(_DIGIT_TRANS))
        label, no = f"ماده {num}", str(num)
        if m.group("mok"):
            label, no = f"ماده {num} مکرر", f"{num}-mokarrar"
        arts.append({"no": no, "label": label, "body": text[m.end():end].strip()})
    return arts


def build_rows(relay: dict) -> tuple[list[dict], int]:
    """Map one rcmajlis relay row to its article rows; returns (rows, dropped_duplicates)."""
    law_name = _norm(relay.get("title"))
    date = relay.get("date")
    url = relay.get("url")
    rows: list[dict] = []
    seen: set[str] = set()
    dropped = 0
    for a in split_articles(relay.get("text")):
        if a["no"] in seen:
            print(f"  duplicate {a['label']} in {law_name!r}; keeping the first", file=sys.stderr)
            dropped += 1
            continue
        seen.add(a["no"])
        rows.append({
            "law_name": law_name,
            "law_type": "STATUTE",
            "article_no": a["no"],
            "article_label": a["label"],
            "approval_date": date,
            "status": "VALID",
            "is_active": True,
            "source_url": url,
            "source_tier": "official",
            "source": "rc.majlis.ir relay",
            "chunk_index": 0,
            "text": f"{a['label']} {law_name}: {a['body']}".rstrip(),
        })
    return rows, dropped


def load_rows(path: Path) -> list[dict]:
    rows: list[dict] = []
    with Path(path).open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                obj = json.loads(line)
                if isinstance(obj, dict):
                    rows.append(obj)
    return rows


_AMENDING_PREFIX = "قانون اصلاح "
# «ماده (۸) قانون ... اصلاح/حذف/الحاق»: which article of the base law an amendment item changes.
_AMENDED_REF_RE = re.compile(
    rf"ماده\s*\(?\s*(?P<num>[{_DIGITS}]+)\s*\)?\s*(?:مکرر\s*)?(?:قانون|به\s*قانون)?[^.]{{0,60}}?(?:اصلاح|حذف|الحاق|اضافه)"
)
_TO_LATIN = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def annotate_amendments(rows: list[dict]) -> int:
    """Mark base-law articles changed by an amending law in the same batch («قانون اصلاح <base>»).

    Amendment items are numbered on their own (item 6 may rewrite article 8 of the base law), so a base row keeps
    its original text but gets ``amended_on``/``amended_by`` and a note that points to the amending item; the model
    then cites the amended text. Returns the number of annotated base rows.
    """
    by_law: dict[str, dict[str, dict]] = {}
    for r in rows:
        by_law.setdefault(r["law_name"], {})[str(r["article_no"])] = r
    marked = 0
    for law, items in by_law.items():
        if not law.startswith(_AMENDING_PREFIX):
            continue
        base = by_law.get("قانون " + law[len(_AMENDING_PREFIX):]) or by_law.get(law[len(_AMENDING_PREFIX):])
        if not base:
            continue
        for item in items.values():
            body = item["text"].split(":", 1)[-1]
            for m in _AMENDED_REF_RE.finditer(body):
                target = base.get(m.group("num").translate(_TO_LATIN))
                if target is None:
                    continue
                refs = target.setdefault("amended_by", [])
                label = f"ماده {item['article_no']} {law}"
                if label in refs:
                    continue
                refs.append(label)
                target["amended_on"] = item.get("approval_date")
                if "[توجه:" not in target["text"]:
                    marked += 1
                    target["text"] += f" [توجه: این ماده یا تبصره‌های آن با {label} مصوب {item.get('approval_date')} اصلاح شده است؛ متن اصلاحی را مبنا قرار دهید.]"
                else:
                    target["text"] = target["text"][:-1] + f"؛ نیز {label}]"
    return marked


def cmd_split(args) -> int:
    per_law: list[tuple[str, int]] = []
    out: list[dict] = []
    for relay in load_rows(Path(args.input)):
        if relay.get("source") != _SOURCE:
            continue
        law_rows, _ = build_rows(relay)
        per_law.append((_norm(relay.get("title")), len(law_rows)))
        out.extend(law_rows)
    marked = annotate_amendments(out)
    if marked:
        print(f"annotated {marked} base-law articles changed by an amending law in this batch")
    if args.dry_run:
        for name, n in per_law:
            print(f"{n:5d}  {name}")
        print(f"total: {len(out)} articles from {len(per_law)} laws")
        return 0
    if not args.out:
        print("error: --out is required unless --dry-run", file=sys.stderr)
        return 2
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        for row in out:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote {len(out)} articles from {len(per_law)} laws -> {out_path}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("input", help="relay JSONL (one row per law, source=='rcmajlis')")
    ap.add_argument("--out", help="output JSONL, e.g. data/legal/staged/rc_laws_<date>.jsonl")
    ap.add_argument("--dry-run", action="store_true", help="count articles per law; write nothing")
    return cmd_split(ap.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())

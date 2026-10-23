#!/usr/bin/env python3
"""Split rc.majlis.ir relay law rows (source=="rcmajlis") into one row per article.

`iran_relay.py` stages ONE row per rc.majlis law, with the FULL text in `text`. A law holds many
articles, so this reader splits that text on the article headings (ماده N / ماده N مکرر, in Persian
or ASCII digits; sub-clauses stay inside their article) and writes one staged row per article in the
data/legal/phase1_canonical.jsonl schema.

  split_rc_law_articles.py IN.jsonl --out data/legal/staged/rc_laws_<date>.jsonl
  split_rc_law_articles.py IN.jsonl --dry-run      # counts per law; nothing is written
  split_rc_law_articles.py IN.jsonl --out ... --proposed   # staging_status=proposed (build_v7 input)

The cover letter before the first article is dropped. When a law repeats an article number, the
first occurrence wins and the rest are logged to stderr. Stdlib only; nothing writes to Qdrant.

Amending laws («قانون اصلاح قانون X»): each amendment item («ماده 16ـ ماده (۲۷) قانون به شرح زیر
اصلاح می شود:») quotes the new text of a base article under the base article's own heading
(«ماده ۲۷ـ ...»). Those quoted headings are not items of the amending law, so they are written as
«ماده 27 قانون X (اصلاحی 1392)» (year from the approval date) instead of «ماده 27 قانون اصلاح قانون
X»; the item row keeps its own number and points to the relabelled row.
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
    rf"(?<![\u0600-\u06FF])ماده\s*(?P<num>[{_DIGITS}]+)\s*"
    rf"(?:(?P<mok>مکرر)\s*(?P<mokn>[{_DIGITS}]+)?)?\s*(?P<sep>[-–—ـ:.]+)"
)
_SOURCE = "rcmajlis"
_AMENDING_PREFIX = "قانون اصلاح "
# Base articles an amendment item names: «ماده (۲۷)», «ماده ( ۹۵مکرر ۲)», «مواد (۸) و (۹)».
_ITEM_REF_RE = re.compile(rf"ماده\s*\(\s*(?P<num>[{_DIGITS}]+)")
_ITEM_REFS_LIST_RE = re.compile(rf"مواد\s*(?P<list>(?:\(\s*[{_DIGITS}]+\s*\)[\s،,و]*)+)")
_PAREN_NUM_RE = re.compile(rf"\(\s*(?P<num>[{_DIGITS}]+)")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _item_refs(body: str) -> set[int]:
    """Base-article numbers an amendment item's intro names (see ``_ITEM_REF_RE``)."""
    refs = {int(m.group("num").translate(_DIGIT_TRANS)) for m in _ITEM_REF_RE.finditer(body)}
    for m in _ITEM_REFS_LIST_RE.finditer(body):
        nums = _PAREN_NUM_RE.finditer(m.group("list"))
        refs |= {int(n.group("num").translate(_DIGIT_TRANS)) for n in nums}
    return refs


def split_articles(text: str, *, amending: bool = False) -> list[dict]:
    """Return [{'no', 'label', 'body', 'quoted'}, ...]; text before the first heading is dropped.

    With ``amending=True`` a heading is ``quoted`` (a base-law article quoted inside an amendment
    item) when it is a «مکرر» heading or a number the current item names, unless it is simply the
    next item number right after an item body that does not end with a colon. Otherwise it is the
    next item of the amending law. Without ``amending`` nothing is ``quoted``.
    """
    text = str(text or "")
    matches = list(_ARTICLE_RE.finditer(text))
    arts: list[dict] = []
    last_item, refs = 0, set()
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        num = int(m.group("num").translate(_DIGIT_TRANS))
        label, no = f"ماده {num}", str(num)
        if m.group("mok"):
            label, no = f"ماده {num} مکرر", f"{num}-mokarrar"
            if m.group("mokn"):
                n = int(m.group("mokn").translate(_DIGIT_TRANS))
                label, no = f"{label} {n}", f"{no}-{n}"
        body = text[m.end():end].strip()
        quoted = False
        if amending and i > 0:
            after_colon = text[matches[i - 1].end():m.start()].rstrip().rstrip("«\"").endswith(":")
            if num == last_item + 1 and not m.group("mok") and not after_colon:
                quoted = False
            else:
                quoted = bool(m.group("mok")) or num in refs or num <= last_item
        if not quoted:
            last_item = num
            refs = _item_refs(body)
        arts.append({"no": no, "label": label, "body": body, "quoted": quoted})
    return arts


def amending_base(law_name: str) -> str | None:
    """«قانون اصلاح قانون X» -> «قانون X»; None for a law that is not an amending law."""
    if not law_name.startswith(_AMENDING_PREFIX):
        return None
    rest = law_name[len(_AMENDING_PREFIX):].strip()
    if not rest:
        return None
    return rest if rest.startswith("قانون ") else "قانون " + rest


def amended_law_name(base: str, approval_date) -> str:
    """«قانون X» + «1392/06/12» -> «قانون X (اصلاحی 1392)» (the year of the amending law)."""
    m = re.search(r"\d{4}", str(approval_date or "").translate(_DIGIT_TRANS))
    return f"{base} (اصلاحی {m.group(0)})" if m else f"{base} (اصلاحی)"


def build_rows(relay: dict) -> tuple[list[dict], int]:
    """Map one rcmajlis relay row to its article rows; returns (rows, dropped_duplicates)."""
    law_name = _norm(relay.get("title"))
    date = relay.get("date")
    url = relay.get("url")
    base = amending_base(law_name)
    relabelled = amended_law_name(base, date) if base else None
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    dropped = 0
    item: dict | None = None
    for a in split_articles(relay.get("text"), amending=base is not None):
        name = relabelled if a["quoted"] else law_name
        if (name, a["no"]) in seen:
            print(f"  duplicate {a['label']} in {name!r}; keeping the first", file=sys.stderr)
            dropped += 1
            continue
        seen.add((name, a["no"]))
        row = {
            "law_name": name,
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
            "text": f"{a['label']} {name}: {a['body']}".rstrip(),
        }
        if a["quoted"] and item is not None:
            row["amending_item"] = f"{item['article_label']} {law_name}"
            row["amended_on"] = date
            item["text"] += f" [متن اصلاحی: {a['label']} {name}]"
        elif not a["quoted"]:
            item = row
        rows.append(row)
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
        base_name = amending_base(law)
        base = by_law.get(base_name) if base_name else None
        if not base:
            continue
        for item in items.values():
            body = item["text"].split(":", 1)[-1]
            rewritten = by_law.get(amended_law_name(base_name, item.get("approval_date")), {})
            for m in _AMENDED_REF_RE.finditer(body):
                num = m.group("num").translate(_TO_LATIN)
                target = base.get(num)
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
                    new_text = rewritten.get(num)
                    where = "متن اصلاحی"
                    if new_text:
                        where = f"«{new_text['article_label']} {new_text['law_name']}»"
                    target["text"] += f" [توجه: این ماده یا تبصره‌های آن با {label} مصوب {item.get('approval_date')} اصلاح شده است؛ {where} را مبنا قرار دهید.]"
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
    if args.proposed:
        for row in out:
            row["staging_status"] = "proposed"
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
    ap.add_argument(
        "--proposed",
        action="store_true",
        help="mark rows staging_status=proposed so build_v7.py selects them",
    )
    return cmd_split(ap.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())

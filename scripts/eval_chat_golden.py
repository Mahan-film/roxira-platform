#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Golden-set check for Smart Judge TEXT chat answers (QA 2026-10-09, B5/B6).

INTEGRATION EVAL: the default mode POSTs each question to a running Smart Judge
(/api/v1/apps/judge/chat), which calls LLMs. It is not part of unit CI.
Plugs into the data/eval/ harness next to scripts/eval_ruling_drafts.py.

    python3 scripts/eval_chat_golden.py --validate                 # offline: file shape only
    python3 scripts/eval_chat_golden.py --base-url http://127.0.0.1:8000
    python3 scripts/eval_chat_golden.py --offline-answers answers.json   # {id: reply}

Every fact marked TO-VERIFY is unreviewed by a lawyer. No secrets or model ids here.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SET = ROOT / "data" / "eval" / "chat_golden" / "golden_set.json"
_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").translate(_TRANS).replace("‌", " ")).strip()


def load(path: Path = DEFAULT_SET) -> list:
    return json.loads(path.read_text(encoding="utf-8"))["cases"]


def validate(cases: list) -> list:
    errs = []
    ids = set()
    for c in cases:
        if not c.get("id") or c["id"] in ids:
            errs.append(f"bad/duplicate id: {c.get('id')}")
        ids.add(c.get("id"))
        if not str(c.get("question") or "").strip():
            errs.append(f"{c.get('id')}: empty question")
        for m in c.get("must_mention", []):
            if not m.get("any_of"):
                errs.append(f"{c['id']}: must_mention without any_of")
        for m in c.get("must_not_mention", []):
            try:
                re.compile(m["pattern"])
            except Exception as exc:  # noqa: BLE001
                errs.append(f"{c['id']}: bad regex ({exc})")
    return errs


def score_case(case: dict, reply: str) -> dict:
    text = norm(reply)
    missing = [m["fact"] for m in case.get("must_mention", [])
               if not any(norm(a) in text for a in m["any_of"])]
    forbidden = [m["reason"] for m in case.get("must_not_mention", [])
                 if re.search(norm(m["pattern"]), text)]
    return {"id": case["id"], "pass": not missing and not forbidden,
            "missing": missing, "forbidden": forbidden}


def ask(base_url: str, question: str) -> str:
    req = urllib.request.Request(
        base_url.rstrip("/") + "/api/v1/apps/judge/chat",
        data=json.dumps({"message": question, "tier": "FREE"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:  # noqa: S310 - operator-supplied URL
        return str(json.loads(resp.read()).get("reply") or "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default=str(DEFAULT_SET))
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--base-url")
    ap.add_argument("--offline-answers")
    args = ap.parse_args()
    cases = load(Path(args.set))
    errs = validate(cases)
    if errs or args.validate:
        print("\n".join(errs) or f"OK: {len(cases)} cases valid")
        return 1 if errs else 0
    answers = json.loads(Path(args.offline_answers).read_text(encoding="utf-8")) if args.offline_answers else None
    if answers is None and not args.base_url:
        print("need --base-url or --offline-answers (or --validate)", file=sys.stderr)
        return 2
    results = [score_case(c, answers[c["id"]] if answers else ask(args.base_url, c["question"]))
               for c in cases if answers is None or c["id"] in answers]
    for r in results:
        print(("PASS " if r["pass"] else "FAIL ") + r["id"], r["missing"] or "", r["forbidden"] or "")
    print(f"{sum(r['pass'] for r in results)}/{len(results)} passed (facts are TO-VERIFY by a lawyer)")
    return 0 if all(r["pass"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())

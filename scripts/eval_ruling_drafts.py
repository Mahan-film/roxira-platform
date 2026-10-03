#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Eval harness for Smart Judge ruling drafts (issue #456).

No claim about draft quality is allowed without measurement. This script runs a
set of synthetic labelled cases (``data/eval/ruling_drafts/cases.jsonl``) through
a *generator* that turns a case into a draft ruling, then scores each draft:

  * citation validity  — every cited article exists and ``is_active`` in the
                          tracked corpus ``data/legal/dotic_articles_2026-09-22.jsonl``.
  * expected recall    — fraction of the case's expected articles that were cited.
  * refusal correctness — the draft refuses (``INSUFFICIENT_BASIS``) iff the case
                          is labelled ``must_refuse``.
  * banner present      — the explicit non-binding AI-draft banner is shown.
  * no forbidden words  — no «قوه قضائیه» used as a header, no "approved"/"final".

Modes
-----
``--mode offline`` uses a deterministic fake generator that simply returns the
case's expected articles, so the *harness itself* is testable with no model call.

``--mode live`` is a stub: with no ``--generator-module`` it raises a clear error
(the real model call is wired later). With a module path it loads that module and
calls ``generate(case, corpus) -> draft``. The live generator MUST route through
``output_apps/generated_modules/smartjudge/llm_router.py`` using the ``strong`` or
``cheap`` tier and MUST NEVER send customer/case data to the ``free`` tier
(``config/models.yaml`` roles; docs/STRATEGY.md §3b). No model id is hardcoded
here.

Usage::

    python3 scripts/eval_ruling_drafts.py --cases data/eval/ruling_drafts/cases.jsonl \\
        --mode offline --out /tmp/ruling_eval.json

The numbers this prints are internal evaluation only (docs/ops/RULING_EVAL.md).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CASES = ROOT / "data" / "eval" / "ruling_drafts" / "cases.jsonl"
DEFAULT_CORPUS = ROOT / "data" / "legal" / "dotic_articles_2026-09-22.jsonl"

BANNER_TEXT = "پیش‌نویس غیرالزام‌آور هوش مصنوعی"
REFUSAL_MARKER = "INSUFFICIENT_BASIS"
FORBIDDEN_HEADER = "قوه قضائیه"
FORBIDDEN_WORDS = ("approved", "final")
NAME_FIELDS = ("claimant", "respondent", "complainant", "accused")

# Thresholds required before any per-court claim (docs/ops/RULING_EVAL.md).
THRESHOLDS = {
    "citation_validity_rate": 1.0,
    "expected_recall_overall": 0.8,
    "must_refuse_correct_rate": 1.0,
}


# ─────────────────────────────────────────────────────────────────────────────
# Loading
# ─────────────────────────────────────────────────────────────────────────────

def load_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with Path(path).open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def load_cases(path: Path = DEFAULT_CASES) -> list[dict]:
    return load_jsonl(path)


def load_corpus(path: Path = DEFAULT_CORPUS) -> dict:
    """Return ``{"active": {(law_name, article_no): row}, "known": set(...)}``."""
    active: dict[tuple[str, str], dict] = {}
    known: set[tuple[str, str]] = set()
    for row in load_jsonl(path):
        key = (str(row.get("law_name", "")), str(row.get("article_no", "")))
        known.add(key)
        if row.get("is_active") is True:
            active[key] = row
    return {"active": active, "known": known}


# ─────────────────────────────────────────────────────────────────────────────
# Pure scoring (no model calls)
# ─────────────────────────────────────────────────────────────────────────────

def _key(entry: dict) -> tuple[str, str]:
    return (str(entry.get("law_name", "")), str(entry.get("article_no", "")))


def invalid_citations(cited_articles: list[dict], corpus: dict) -> list[dict]:
    """Cited articles that are absent or not active in the corpus."""
    active = corpus["active"]
    return [
        {"law_name": c.get("law_name"), "article_no": c.get("article_no")}
        for c in cited_articles
        if _key(c) not in active
    ]


def citation_is_valid(cited_articles: list[dict], corpus: dict) -> bool:
    return not invalid_citations(cited_articles, corpus)


def expected_recall(expected_articles: list[dict], cited_articles: list[dict]) -> float:
    """Fraction of expected articles cited; vacuously 1.0 when nothing is expected."""
    if not expected_articles:
        return 1.0
    cited = {_key(c) for c in cited_articles}
    hit = sum(1 for e in expected_articles if _key(e) in cited)
    return hit / len(expected_articles)


def refusal_correct(must_refuse: bool, refused: bool) -> bool:
    return bool(must_refuse) == bool(refused)


def refused_in(draft: dict) -> bool:
    if draft.get("insufficient_basis") is True:
        return True
    return REFUSAL_MARKER in str(draft.get("text", ""))


def banner_present(text: str) -> bool:
    return BANNER_TEXT in str(text or "")


def detect_forbidden(text: str) -> list[str]:
    """Flag «قوه قضائیه» used as a whole-line header and the words approved/final."""
    text = str(text or "")
    hits: list[str] = []
    for line in text.splitlines():
        if line.strip() == FORBIDDEN_HEADER:
            hits.append("header:" + FORBIDDEN_HEADER)
    lowered = text.lower()
    for word in FORBIDDEN_WORDS:
        if word.lower() in lowered:
            hits.append(word)
    return hits


def score_case(case: dict, draft: dict, corpus: dict) -> dict:
    cited = draft.get("cited_articles") or []
    expected = case.get("expected_articles") or []
    invalid = invalid_citations(cited, corpus)
    refused = refused_in(draft)
    text = draft.get("text", "")
    cited_keys = {_key(c) for c in cited}
    expected_hit = sum(1 for e in expected if _key(e) in cited_keys)
    forbidden = detect_forbidden(text)
    return {
        "id": case["id"],
        "court_type": case.get("court_type"),
        "must_refuse": bool(case.get("must_refuse")),
        "n_cited": len(cited),
        "citation_valid": not invalid,
        "invalid_citations": invalid,
        "expected_total": len(expected),
        "expected_hit": expected_hit,
        "expected_recall": expected_recall(expected, cited),
        "refused": refused,
        "refusal_correct": refusal_correct(case.get("must_refuse", False), refused),
        "banner_present": banner_present(text),
        "forbidden_words": forbidden,
        "no_forbidden_words": not forbidden,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Generators
# ─────────────────────────────────────────────────────────────────────────────

def offline_generator(case: dict, corpus: dict | None = None) -> dict:
    """Deterministic fake generator: returns the case's expected articles.

    This makes the harness itself testable without any model call.
    """
    if case.get("must_refuse"):
        text = "\n".join(
            [
                BANNER_TEXT,
                f"{REFUSAL_MARKER}: مبنای قانونی معتبری برای این موضوع در پیکرهٔ فعلی یافت نشد.",
            ]
        )
        return {"text": text, "cited_articles": [], "insufficient_basis": True}

    expected = case.get("expected_articles") or []
    lines = [BANNER_TEXT, "مستندات قانونی:"]
    for article in expected:
        lines.append(f"- ماده {article['article_no']} {article['law_name']}")
    lines.append("این پیش‌نویس غیرالزام‌آور است و پیش از هر استفاده باید توسط وکیل بازبینی شود.")
    cited = [
        {"law_name": article["law_name"], "article_no": str(article["article_no"])}
        for article in expected
    ]
    return {"text": "\n".join(lines), "cited_articles": cited, "insufficient_basis": False}


def load_generator_module(module_path: Path):
    """Load a live generator module exposing ``generate(case, corpus) -> draft``."""
    path = Path(module_path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"generator module not found: {path}")
    spec = importlib.util.spec_from_file_location("ruling_eval_generator", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load generator module from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    generate = getattr(module, "generate", None)
    if not callable(generate):
        raise AttributeError("generator module must define a callable generate(case, corpus)")
    return generate


# ─────────────────────────────────────────────────────────────────────────────
# Report
# ─────────────────────────────────────────────────────────────────────────────

def thresholds_met(overall: dict) -> dict:
    return {
        "citation_validity": overall["citation_validity_rate"]
        >= THRESHOLDS["citation_validity_rate"],
        "expected_recall": overall["expected_recall_overall"]
        >= THRESHOLDS["expected_recall_overall"],
        "must_refuse": overall["must_refuse_correct_rate"]
        >= THRESHOLDS["must_refuse_correct_rate"],
    }


def summarize(per_case: list[dict]) -> dict:
    n = len(per_case)
    if n == 0:
        return {
            "cases_total": 0,
            "citation_valid_cases": 0,
            "citation_validity_rate": 0.0,
            "expected_articles_total": 0,
            "expected_articles_hit": 0,
            "expected_recall_overall": 1.0,
            "refusal_correct_cases": 0,
            "refusal_correct_rate": 0.0,
            "must_refuse_cases": 0,
            "must_refuse_correct_cases": 0,
            "must_refuse_correct_rate": 1.0,
            "banner_present_cases": 0,
            "banner_present_rate": 0.0,
            "no_forbidden_words_cases": 0,
            "no_forbidden_words_rate": 0.0,
        }
    valid = sum(1 for c in per_case if c["citation_valid"])
    expected_total = sum(c["expected_total"] for c in per_case)
    expected_hit = sum(c["expected_hit"] for c in per_case)
    refusal_ok = sum(1 for c in per_case if c["refusal_correct"])
    must_total = sum(1 for c in per_case if c["must_refuse"])
    must_ok = sum(1 for c in per_case if c["must_refuse"] and c["refusal_correct"])
    banner = sum(1 for c in per_case if c["banner_present"])
    clean = sum(1 for c in per_case if c["no_forbidden_words"])
    return {
        "cases_total": n,
        "citation_valid_cases": valid,
        "citation_validity_rate": valid / n,
        "expected_articles_total": expected_total,
        "expected_articles_hit": expected_hit,
        "expected_recall_overall": (expected_hit / expected_total) if expected_total else 1.0,
        "refusal_correct_cases": refusal_ok,
        "refusal_correct_rate": refusal_ok / n,
        "must_refuse_cases": must_total,
        "must_refuse_correct_cases": must_ok,
        "must_refuse_correct_rate": (must_ok / must_total) if must_total else 1.0,
        "banner_present_cases": banner,
        "banner_present_rate": banner / n,
        "no_forbidden_words_cases": clean,
        "no_forbidden_words_rate": clean / n,
    }


def run_eval(cases: list[dict], corpus: dict, generate, run_mode: str) -> dict:
    per_case = [score_case(case, generate(case, corpus), corpus) for case in cases]
    return {
        "run_mode": run_mode,
        "cases_total": len(cases),
        "overall": summarize(per_case),
        "per_case": per_case,
    }


def format_table(report: dict) -> str:
    header = (
        f"{'id':<14}{'court':<10}{'cited':>7}{'cit_valid':>11}"
        f"{'recall':>8}{'refus_ok':>10}{'banner':>8}{'no_forbid':>11}"
    )
    lines = [header, "-" * len(header)]
    for c in report["per_case"]:
        lines.append(
            f"{c['id']:<14}{str(c['court_type']):<10}{c['n_cited']:>7}"
            f"{str(c['citation_valid']):>11}{c['expected_recall']:>8.2f}"
            f"{str(c['refusal_correct']):>10}{str(c['banner_present']):>8}"
            f"{str(c['no_forbidden_words']):>11}"
        )
    o = report["overall"]
    lines.append("")
    lines.append(
        f"cases={o['cases_total']} "
        f"citation_validity={o['citation_validity_rate']:.3f} "
        f"expected_recall={o['expected_recall_overall']:.3f} "
        f"refusal_correct={o['refusal_correct_rate']:.3f} "
        f"must_refuse={o['must_refuse_correct_rate']:.3f} "
        f"banner={o['banner_present_rate']:.3f} "
        f"no_forbidden={o['no_forbidden_words_rate']:.3f}"
    )
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", default=str(DEFAULT_CASES), help="JSONL labelled case file")
    parser.add_argument("--mode", choices=("offline", "live"), required=True)
    parser.add_argument(
        "--corpus", default=str(DEFAULT_CORPUS), help="tracked article corpus JSONL"
    )
    parser.add_argument("--out", default=None, help="write the full JSON report here")
    parser.add_argument(
        "--generator-module",
        default=None,
        help="live mode only: path to a module exposing generate(case, corpus)",
    )
    args = parser.parse_args(argv)

    cases = load_cases(Path(args.cases))
    corpus = load_corpus(Path(args.corpus))

    if args.mode == "offline":
        generate = offline_generator
    else:
        if not args.generator_module:
            parser.error(
                "live mode is not wired yet; pass --generator-module PATH exposing "
                "generate(case, corpus). The module must call the model through "
                "llm_router using the strong/cheap tier and never the free tier."
            )
        generate = load_generator_module(args.generator_module)

    report = run_eval(cases, corpus, generate, args.mode)
    report["thresholds"] = THRESHOLDS
    report["thresholds_met"] = thresholds_met(report["overall"])

    print(format_table(report))
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
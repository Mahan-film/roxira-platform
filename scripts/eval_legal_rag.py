#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ارزیاب بازیابی حقوقی (Legal RAG Eval) — W6.

این اسکریپت مجموعهٔ ۳۰ سوالی ``data/eval/legal_rag_eval.jsonl`` را روی تابع
بازیابی *زندهٔ* ``src.legal_intelligence.dual_retrieval.dual_retrieve`` و
لایهٔ Qdrant (``rag_retrieve`` در ``legal_graph/lightrag_engine.py``) اجرا
می‌کند و دو معیار گزارش می‌دهد:

  * ``hit@5``            — آیا نام قانون مورد انتظار در بین ۵ نتیجهٔ برگشتی است.
  * ``citation_accuracy`` — آیا شمارهٔ ماده مورد انتظار دقیقاً در بین نتایج آمده
                             (سخت‌گیرانه‌تر از hit@5).

این اسکریپت باید **داخل کانتینر** ``roxira_app_prod`` (یا هر محیطی با دسترسی
مستقیم به Postgres/Qdrant تولیدی) اجرا شود، چون هر دو منبع بازیابی به شبکهٔ
داخلی ``roxira_net`` نیاز دارند:

    docker exec -i roxira_app_prod python3 scripts/eval_legal_rag.py \\
        --collection iran_laws_bge_m3

برای مقایسهٔ کالکشن جدید پس از اصلاح تزریق:

    docker exec -i roxira_app_prod python3 scripts/eval_legal_rag.py \\
        --collection iran_laws_v2

خروجی JSON روی stdout چاپ می‌شود تا در ``docs/`` ضمیمه شود.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

EVAL_PATH = Path(__file__).resolve().parent.parent / "data" / "eval" / "legal_rag_eval.jsonl"


def load_eval_set(path: Path = EVAL_PATH) -> List[Dict[str, Any]]:
    rows = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _law_name_matches(expected: str, candidate: str) -> bool:
    """مقایسهٔ نرم نام قانون (فاصله/نیم‌فاصله/پرانتز نادیده گرفته می‌شود)."""
    def norm(s: str) -> str:
        return (
            (s or "")
            .replace("‌", " ")
            .replace("(", " ")
            .replace(")", " ")
            .replace("،", " ")
            .strip()
        )
    e = norm(expected)
    c = norm(candidate)
    if not e or not c:
        return False
    # اشتراک واژگان محتوایی کافی است (نام کامل قانون اغلب در title/summary می‌آید)
    e_tokens = {t for t in e.split() if len(t) > 2}
    c_tokens = {t for t in c.split() if len(t) > 2}
    if not e_tokens:
        return False
    overlap = e_tokens & c_tokens
    return len(overlap) >= max(1, len(e_tokens) - 2)


def _article_in_text(article_no: int, *texts: str) -> bool:
    import re

    target = str(article_no)
    for text in texts:
        if not text:
            continue
        for m in re.finditer(r"ماده\s*\(?\s*([0-9۰-۹]{1,4})", text):
            num = m.group(1).translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789"))
            if num.lstrip("0") == target.lstrip("0"):
                return True
        if f"ART-{article_no}" in text or f"ART_{article_no}" in text:
            return True
        if re.search(rf"\b{target}\b", text):
            # عدد خام؛ فقط وقتی در کنار «ماده» ظاهر شده باشد از حلقهٔ بالا گرفته می‌شود.
            pass
    return False


def _article_no_matches(expected_article: int, law: Dict[str, Any]) -> bool:
    """مسیر مستقیم (schema-tolerant): برخی لایه‌های بازیابی (Qdrant fallback در
    ``lightrag_engine._rank_payloads``) اکنون کلید ``article_no`` را مستقیماً
    برمی‌گردانند (نگاشت‌شده از payload چه با فیلد صریح ``article_no`` باشد چه
    با استخراج از متن «ماده N»). این تابع آن کلید را هم بررسی می‌کند تا eval
    وابسته به این نباشد که شمارهٔ ماده حتماً داخل ``title``/``summary`` هم
    تحت‌اللفظی تکرار شده باشد.
    """
    raw = law.get("article_no")
    if raw in (None, ""):
        return False
    match = re.match(r"\s*([0-9۰-۹]+)", str(raw))
    if not match:
        return False
    num = match.group(1).translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789"))
    return num.lstrip("0") == str(expected_article).lstrip("0")


async def retrieve_all(question: str, limit: int = 5, collection: str | None = None) -> Dict[str, Any]:
    """سه لایهٔ بازیابی را به‌ترتیب امتحان می‌کند و همه را برای ارزیابی برمی‌گرداند."""
    result: Dict[str, Any] = {"laws": [], "precedents": [], "sources": []}

    if collection:
        os.environ["LIGHTRAG_QDRANT_COLLECTION"] = collection

    # ۱) موتور دوسطحی LightRAG/Qdrant (همان مسیری که smartjudge_module.py صدا می‌زند)
    try:
        from output_apps.generated_modules.smartjudge.legal_graph.lightrag_engine import (
            rag_retrieve,
        )

        rag = await rag_retrieve(question, limit=limit)
        result["sources"].append({"layer": "lightrag_or_qdrant", "meta": {
            "source": rag.get("source"), "collection": rag.get("collection"),
        }})
        result["laws"].extend(rag.get("laws") or [])
    except Exception as exc:  # noqa: BLE001
        result["sources"].append({"layer": "lightrag_or_qdrant", "error": f"{type(exc).__name__}: {exc}"})

    # ۲) بازیابی دوسطحی SQL روی graph_nodes (Postgres)
    try:
        from src.legal_intelligence.dual_retrieval import dual_retrieve

        sql_laws, sql_precedents = await asyncio.to_thread(dual_retrieve, question, limit)
        result["sources"].append({"layer": "sql_dual_retrieve", "meta": {"n_laws": len(sql_laws)}})
        result["laws"].extend(sql_laws)
        result["precedents"].extend(sql_precedents)
    except Exception as exc:  # noqa: BLE001
        result["sources"].append({"layer": "sql_dual_retrieve", "error": f"{type(exc).__name__}: {exc}"})

    return result


async def run_eval(rows: List[Dict[str, Any]], collection: str | None, limit: int = 5) -> Dict[str, Any]:
    per_question = []
    hits = 0
    citation_hits = 0
    fallback_only = 0

    for row in rows:
        q = row["question"]
        expected_law = row["expected_law"]
        expected_article = row["expected_article"]

        t0 = time.time()
        retrieval = await retrieve_all(q, limit=limit, collection=collection)
        latency_ms = (time.time() - t0) * 1000.0

        laws = retrieval["laws"]
        all_match_levels = {str(l.get("match_level")) for l in laws if isinstance(l, dict)}
        is_fallback_only = laws and all_match_levels <= {"FALLBACK"}

        hit = any(
            isinstance(l, dict) and _law_name_matches(expected_law, f"{l.get('title', '')} {l.get('category', '')} {l.get('summary', '')}")
            for l in laws
        )
        cited = any(
            isinstance(l, dict) and (
                _article_no_matches(expected_article, l)
                or _article_in_text(
                    expected_article,
                    str(l.get("title", "")), str(l.get("summary", "")), str(l.get("node_id", "")),
                )
            )
            for l in laws
        )

        hits += int(hit)
        citation_hits += int(cited)
        fallback_only += int(bool(is_fallback_only))

        per_question.append({
            "id": row["id"],
            "domain": row.get("domain"),
            "question": q,
            "expected_law": expected_law,
            "expected_article": expected_article,
            "hit_at_5": hit,
            "citation_correct": cited,
            "fallback_only": bool(is_fallback_only),
            "n_laws_returned": len(laws),
            "match_levels": sorted(all_match_levels),
            "latency_ms": round(latency_ms, 1),
        })

    n = len(rows)
    summary = {
        "collection": collection or os.environ.get("LIGHTRAG_QDRANT_COLLECTION", "iran_laws_bge_m3"),
        "n_questions": n,
        "hit_at_5": round(hits / n, 3) if n else 0.0,
        "citation_accuracy": round(citation_hits / n, 3) if n else 0.0,
        "fallback_only_rate": round(fallback_only / n, 3) if n else 0.0,
    }
    return {"summary": summary, "per_question": per_question}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", default=None, help="نادیده گرفتن LIGHTRAG_QDRANT_COLLECTION برای این اجرا")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--eval-set", default=str(EVAL_PATH))
    parser.add_argument("--out", default=None, help="مسیر ذخیرهٔ JSON نتیجه (پیش‌فرض: فقط stdout)")
    args = parser.parse_args()

    rows = load_eval_set(Path(args.eval_set))
    report = asyncio.run(run_eval(rows, collection=args.collection, limit=args.limit))

    text = json.dumps(report, ensure_ascii=False, indent=2)
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())

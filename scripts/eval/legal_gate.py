#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Objective accuracy gate for Smart Judge legal answers (STRATEGY_GAP_2026-10-12 L1).

Question set: data/eval/chat_golden/legal_gate_2026-10-21.json (70 cases, 20 held out;
status text_verified = article text checked mechanically, needs_lawyer = waits for the lawyer; see
docs/legal/LAWYER_REVIEW_GATE_FA.md).

Modes (all checks are deterministic, no LLM judge):

  validate   offline: shape of the question file.
  retrieval  NO LLM, 0 USD. Is the expected article in the top-k of the served corpus?
             Reuses the retrieval path of scripts/eval_chat_golden.py (Qdrant search +
             source_filter). Recall is reported both strict (exact law name) and alias-aware
             (the same law under another of its names); the gate scores alias-aware. Needs
             Qdrant + the query embedder, so run it on the server:
               docker run ... python3 scripts/eval/legal_gate.py retrieval [--rerank]
  answer     calls the live chat endpoint; checks must_include, must_not_include, the cited
             article in statutory_basis and latency. PAID path: needs --confirm-spend, has a
             hard cost cap (default and maximum 0.05 USD) and reads the bearer token from the
             environment (ROXIRA_EVAL_TOKEN) only.
  capture    store a retrieval report (stdin, noisy output allowed) as the baseline file.
  compare    retrieval@5 (alias-aware) of a fresh run against a stored baseline; prints a
             warning when it drops by more than --warn-drop points. Never fails the caller
             (exit 0) unless --strict is given.

Reports: --json-out / --md-out write files; --json prints one marker line
(``LEGAL_GATE_JSON {...}``) on stdout so a caller can pull it out of noisy output.
No secrets or model ids are stored here; the token is read from the environment.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SET = ROOT / "data" / "eval" / "chat_golden" / "legal_gate_2026-10-21.json"
DEFAULT_BASELINE = ROOT / "data" / "eval" / "chat_golden" / "legal_gate_baseline.json"
MARKER = "LEGAL_GATE_JSON"
KS = (1, 3, 5, 10)
HARD_COST_CAP_USD = 0.05
CHAT_PATH = "/api/v1/apps/judge/chat"
# text_verified: checked mechanically against the staged article text (verified_by auto:article_text).
# needs_lawyer: depends on interpretation, validity or adjustable figures (needs_lawyer_reason).
# lawyer_verified: the lawyer answered (field lawyer_answer is required); lawyer_rejected: case dropped from scoring.
STATUSES = ("draft_needs_lawyer", "text_verified", "needs_lawyer", "lawyer_verified", "lawyer_rejected")


def _load_chat_golden():
    """scripts/eval_chat_golden.py is not a package; load it by path (stdlib-only imports)."""
    spec = importlib.util.spec_from_file_location("eval_chat_golden", ROOT / "scripts" / "eval_chat_golden.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_ECG = _load_chat_golden()
_EXTRA = str.maketrans({"ي": "ی", "ك": "ک", "­": "", "‏": "", "‎": ""})
_HARAKAT = re.compile("[ً-ْ]")


def norm(text: Any) -> str:
    """Digit / ZWNJ / Arabic-letter / soft-hyphen normalisation (extends eval_chat_golden.norm)."""
    t = str(text or "").translate(_EXTRA)
    t = _HARAKAT.sub("", t)
    return _ECG.norm(t).lower()


# --------------------------------------------------------------------------- law aliases
# Canonical law-name aliases, used only when comparing an expected law with a retrieved one.
# The retrieval engine keeps its own table (_LAW_NAME_ALIASES in
# output_apps/generated_modules/smartjudge/legal_graph/lightrag_engine.py), but importing it pulls
# in the whole retrieval stack and it aliases the replaced 1402 law unconditionally; this gate is
# offline/stdlib-only, so it mirrors just the pairs it needs. Matching is exact after
# normalisation (ZWNJ, ي/ك, Persian digits, parentheses) — never fuzzy.
def _law_key(name: Any) -> str:
    """Law-name key: norm() plus parenthesis stripping so '(اصلاحی ۱۳۹۷)' variants line up."""
    t = norm(name).replace("(", " ").replace(")", " ")
    return re.sub(r"\s+", " ", t).strip()


def _build_law_aliases() -> Dict[str, str]:
    pairs = (
        # Official title vs. short title of the same law (expected in the 70-case set).
        ("قانون آیین دادرسی دادگاه‌های عمومی و انقلاب در امور مدنی", "قانون آیین دادرسی مدنی"),
        # Base cheque law, its ۱۳۹۷ amendment and the corpus label are one law.
        ("قانون صدور چک", "قانون صدور چک (اصلاحی ۱۳۹۷)"),
        ("قانون اصلاح قانون صدور چک (۱۳۹۷)", "قانون صدور چک (اصلاحی ۱۳۹۷)"),
    )
    return {_law_key(a): _law_key(c) for a, c in pairs}


LAW_ALIASES: Dict[str, str] = _build_law_aliases()

# Replaced laws (not merely renamed): the successor may renumber articles, so the alias is
# accepted only when the retrieved article text carries the expected topic. lg-dsp-12 expects
# «قانون شوراهای حل اختلاف» while the corpus holds «قانون شوراهای حل اختلاف و دادگاه‌های صلح
# مصوب ۱۴۰۲» (the 1402 law replaced the old one). If the topic does not match, the case must be
# marked needs_review for the lawyer — never guessed (the hub re-captures the baseline).
_LAW_REPLACED_ALIASES: Tuple[Tuple[str, str], ...] = (
    (_law_key("قانون شوراهای حل اختلاف"),
     _law_key("قانون شوراهای حل اختلاف و دادگاه‌های صلح مصوب ۱۴۰۲")),
)


def canonical_law(name: Any) -> str:
    """Canonical key for a law name; unknown names normalise to themselves."""
    key = _law_key(name)
    return LAW_ALIASES.get(key, key)


def _topic_matches(case: dict, row: dict) -> bool:
    """Deterministic topic check: does the retrieved article text carry a must_include phrase?"""
    phrases = [norm(p) for p in case.get("must_include") or [] if norm(p)]
    if not phrases:
        return False
    text = norm(row.get("text") or row.get("summary") or "")
    return any(p in text for p in phrases)


def _replaced_law_match(case: dict, row: dict) -> bool:
    want = _law_key(case["expected_law"])
    got = _law_key(row.get("law_name") or row.get("title") or "")
    return any({want, got} == {old, new} and _topic_matches(case, row)
               for old, new in _LAW_REPLACED_ALIASES)


# --------------------------------------------------------------------------- cases
def load_cases(path: Path = DEFAULT_SET, split: str = "all") -> List[dict]:
    cases = json.loads(Path(path).read_text(encoding="utf-8"))["cases"]
    if split == "dev":
        return [c for c in cases if not c.get("held_out")]
    if split == "held_out":
        return [c for c in cases if c.get("held_out")]
    return cases


def validate(cases: Sequence[dict]) -> List[str]:
    errs: List[str] = []
    ids: set = set()
    for c in cases:
        cid = c.get("id")
        if not cid or cid in ids:
            errs.append(f"bad/duplicate id: {cid}")
        ids.add(cid)
        for key in ("question", "expected_law", "category", "difficulty", "status"):
            if not str(c.get(key) or "").strip():
                errs.append(f"{cid}: empty {key}")
        if not c.get("expected_articles"):
            errs.append(f"{cid}: no expected_articles")
        if not c.get("must_include"):
            errs.append(f"{cid}: no must_include")
        if not isinstance(c.get("held_out"), bool):
            errs.append(f"{cid}: held_out must be a bool")
        if c.get("status") not in STATUSES:
            errs.append(f"{cid}: unknown status {c.get('status')}")
        if c.get("status") == "lawyer_verified" and not str(c.get("lawyer_answer") or "").strip():
            errs.append(f"{cid}: lawyer_verified needs a lawyer_answer")
    return errs


# --------------------------------------------------------------------------- retrieval
def row_matches(case: dict, row: dict, *, alias_aware: bool = True) -> bool:
    """Expected law and one of the expected article numbers.

    alias_aware maps law-name aliases to one canonical name (and accepts a replaced law only when
    the article topic matches); strict compares the normalised names exactly.
    """
    row_law = row.get("law_name") or row.get("title") or ""
    if alias_aware:
        law_ok = (canonical_law(row_law) == canonical_law(case["expected_law"])
                  or _replaced_law_match(case, row))
    else:
        law_ok = norm(row_law) == norm(case["expected_law"])
    if not law_ok:
        return False
    no = str(row.get("article_no") or "").strip()
    return no in {str(a) for a in case["expected_articles"]}


def hit_rank(case: dict, rows: Iterable[dict], *, alias_aware: bool = True) -> Optional[int]:
    """1-based rank of the first matching row, None when absent."""
    for i, row in enumerate(rows, 1):
        if row_matches(case, row, alias_aware=alias_aware):
            return i
    return None


Retriever = Callable[[str, int], Tuple[List[dict], List[dict]]]


def engine_retriever(rerank: bool = False) -> Tuple[Retriever, Dict[str, str]]:
    """Real retriever: same Qdrant search + relevance filter as eval_chat_golden.run_retrieval.

    ``rerank=True`` turns the cross-encoder flag on for this process only (SMARTJUDGE_RERANKER=local,
    generous timeout so a slow CPU never silently falls back) and loads the model up front; if the
    model cannot load the run aborts instead of reporting un-reranked numbers as reranked ones.
    """
    import asyncio

    sys.path.insert(0, str(ROOT))
    os.environ["SMARTJUDGE_RERANKER"] = "local" if rerank else "off"
    if rerank:
        os.environ.setdefault("SMARTJUDGE_RERANKER_TIMEOUT_MS", "60000")
    from output_apps.generated_modules.smartjudge import source_filter
    from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng

    def retrieve(question: str, k: int) -> Tuple[List[dict], List[dict]]:
        rows = asyncio.run(eng.qdrant_fallback_laws(question, limit=k))
        return rows, source_filter.filter_relevant(rows)

    meta = {"collection": str(eng.QDRANT_FALLBACK_COLLECTION), "embedder": str(eng.QDRANT_EMBED_MODEL_NAME),
            "reranker": "off"}
    if rerank:
        from output_apps.generated_modules.smartjudge import reranker as rr

        if rr._load() is None:
            raise SystemExit("--rerank: reranker model failed to load (is sentence-transformers installed "
                             "and the model cached/downloadable?)")
        meta["reranker"] = os.getenv("SMARTJUDGE_RERANKER_MODEL", "").strip() or rr.DEFAULT_MODEL
        meta["reranker_top_n"] = str(rr.top_n())
    return retrieve, meta


def _rate(num: int, den: int) -> Optional[float]:
    return round(num / den, 4) if den else None


def _recall(ranks: Sequence[Optional[int]], ks: Sequence[int]) -> Dict[str, Optional[float]]:
    return {f"recall@{k}": _rate(sum(1 for r in ranks if r is not None and r <= k), len(ranks)) for k in ks}


def run_retrieval(cases: Sequence[dict], retriever: Retriever, ks: Sequence[int] = KS) -> List[dict]:
    depth = max(ks)
    out = []
    for c in cases:
        raw, kept = retriever(c["question"], depth)
        out.append({
            "id": c["id"], "category": c["category"], "law": c["expected_law"], "held_out": bool(c.get("held_out")),
            "difficulty": c.get("difficulty"),
            "rank_raw": hit_rank(c, raw), "rank_kept": hit_rank(c, kept),
            "rank_raw_strict": hit_rank(c, raw, alias_aware=False),
            "rank_kept_strict": hit_rank(c, kept, alias_aware=False),
            "got": [f"{r.get('law_name')}#{r.get('article_no')}" for r in kept[:5]],
        })
    return out


def _group(results: Sequence[dict], key: str, ks: Sequence[int]) -> Dict[str, dict]:
    groups: Dict[str, List[dict]] = defaultdict(list)
    for r in results:
        groups[str(r[key])].append(r)
    out = {}
    for k, v in sorted(groups.items()):
        strict = _recall([x["rank_kept_strict"] for x in v], ks)
        out[k] = {"n": len(v), **_recall([x["rank_kept"] for x in v], ks),
                  **{f"{name}_strict": val for name, val in strict.items()}}
    return out


def retrieval_report(results: Sequence[dict], meta: Optional[dict] = None, ks: Sequence[int] = KS) -> dict:
    def block(sub: Sequence[dict]) -> dict:
        return {"n": len(sub), "kept": _recall([r["rank_kept"] for r in sub], ks),
                "raw": _recall([r["rank_raw"] for r in sub], ks),
                "kept_strict": _recall([r["rank_kept_strict"] for r in sub], ks),
                "raw_strict": _recall([r["rank_raw_strict"] for r in sub], ks)}

    return {
        "mode": "retrieval", "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "meta": meta or {}, "ks": list(ks), "n": len(results),
        "summary": {"all": block(results), "dev": block([r for r in results if not r["held_out"]]),
                    "held_out": block([r for r in results if r["held_out"]])},
        "by_category": _group(results, "category", ks), "by_law": _group(results, "law", ks),
        "cases": list(results),
    }


# --------------------------------------------------------------------------- answer
def basis_cites(case: dict, basis: Iterable[Any]) -> bool:
    """True when statutory_basis lists the expected law + article (article_no or 'ماده N' in title)."""
    want_law = norm(case["expected_law"])
    wanted = {str(a) for a in case["expected_articles"]}
    for row in basis or []:
        if not isinstance(row, dict):
            continue
        name = norm(row.get("law_name") or "")
        title = norm(row.get("title") or "")
        if want_law not in (name, title) and want_law not in title:
            continue
        no = str(row.get("article_no") or "").strip()
        if no in wanted:
            return True
        m = re.search(r"(?:ماده|اصل)\s*(\d+)", title)
        if m and m.group(1) in wanted:
            return True
    return False


def score_answer(case: dict, resp: dict, latency_ms: float, max_latency_ms: float = 45000.0) -> dict:
    reply = norm(resp.get("reply") or "")
    missing = [p for p in case["must_include"] if norm(p) not in reply]
    forbidden = [p for p in case.get("must_not_include", []) if norm(p) and norm(p) in reply]
    cited = basis_cites(case, resp.get("statutory_basis"))
    in_time = latency_ms <= max_latency_ms
    return {
        "id": case["id"], "category": case["category"], "law": case["expected_law"],
        "held_out": bool(case.get("held_out")), "latency_ms": round(latency_ms, 1),
        "include_ok": not missing, "missing": missing,
        "exclude_ok": not forbidden, "forbidden": forbidden,
        "cited_ok": cited, "latency_ok": in_time,
        "pass": not missing and not forbidden and cited and in_time,
        "model": str(resp.get("model_assigned") or ""),
    }


def _is_gemini_pro(model: str) -> bool:
    m = model.lower()
    return "gemini" in m and "pro" in m


def http_chat(base_url: str, question: str, token: str, timeout: int = 90) -> Tuple[dict, float]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        base_url.rstrip("/") + CHAT_PATH, data=json.dumps({"message": question, "tier": "FREE"}).encode(),
        headers=headers, method="POST")
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read())
    return body, (time.time() - t0) * 1000


Chat = Callable[[str], Tuple[dict, float]]


def run_answer(cases: Sequence[dict], chat: Chat, *, max_cost_usd: float = HARD_COST_CAP_USD,
               est_cost_per_call: float = 0.003, max_latency_ms: float = 45000.0,
               sleep_s: float = 0.0) -> Tuple[List[dict], dict]:
    """Ask each case until the cost cap would be exceeded. Returns (results, run_info)."""
    cap = min(float(max_cost_usd), HARD_COST_CAP_USD)
    spent, results, skipped, aborted = 0.0, [], [], ""
    for c in cases:
        if spent + est_cost_per_call > cap + 1e-9:
            skipped.append(c["id"])
            continue
        try:
            resp, latency = chat(c["question"])
        except (urllib.error.URLError, OSError, ValueError) as exc:
            results.append({"id": c["id"], "category": c["category"], "law": c["expected_law"],
                            "held_out": bool(c.get("held_out")), "pass": False, "error": type(exc).__name__,
                            "include_ok": False, "exclude_ok": True, "cited_ok": False, "latency_ok": False,
                            "latency_ms": None, "missing": list(c["must_include"]), "forbidden": [], "model": ""})
            spent += est_cost_per_call  # count the attempt: it may have reached the model
            continue
        cost = resp.get("cost_usd")
        spent += float(cost) if isinstance(cost, (int, float)) else est_cost_per_call
        res = score_answer(c, resp, latency, max_latency_ms)
        results.append(res)
        if _is_gemini_pro(res["model"]):
            aborted = f"model {res['model']} is Gemini Pro (banned by owner policy); run stopped"
            break
        if sleep_s:
            time.sleep(sleep_s)
    info = {"cost_cap_usd": cap, "est_cost_per_call_usd": est_cost_per_call, "spent_usd_estimate": round(spent, 4),
            "asked": len(results), "skipped_for_cost": skipped, "aborted": aborted}
    return results, info


def _pass_rate(sub: Sequence[dict], key: str = "pass") -> Optional[float]:
    return _rate(sum(1 for r in sub if r.get(key)), len(sub))


def answer_report(results: Sequence[dict], info: Optional[dict] = None) -> dict:
    def grouped(key: str) -> Dict[str, dict]:
        g: Dict[str, List[dict]] = defaultdict(list)
        for r in results:
            g[str(r[key])].append(r)
        return {k: {"n": len(v), "pass": _pass_rate(v)} for k, v in sorted(g.items())}

    lat = sorted(r["latency_ms"] for r in results if r.get("latency_ms") is not None)

    def block(sub: Sequence[dict]) -> dict:
        return {"n": len(sub), "pass": _pass_rate(sub), "include_ok": _pass_rate(sub, "include_ok"),
                "exclude_ok": _pass_rate(sub, "exclude_ok"), "cited_ok": _pass_rate(sub, "cited_ok"),
                "latency_ok": _pass_rate(sub, "latency_ok")}

    return {
        "mode": "answer", "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "run": info or {}, "n": len(results),
        "latency_ms": {"p50": round(statistics.median(lat), 1) if lat else None,
                       "p95": round(lat[min(len(lat) - 1, math.ceil(0.95 * len(lat)) - 1)], 1) if lat else None},
        "summary": {"all": block(results), "dev": block([r for r in results if not r["held_out"]]),
                    "held_out": block([r for r in results if r["held_out"]])},
        "by_category": grouped("category"), "by_law": grouped("law"), "cases": list(results),
    }


# --------------------------------------------------------------------------- markdown
def _pct(x: Optional[float]) -> str:
    return "n/a" if x is None else f"{100 * x:.1f}%"


def render_markdown(report: dict) -> str:
    L: List[str] = []
    mode = report["mode"]
    L.append(f"# Legal gate report ({mode}) {report['generated']}")
    L.append("")
    L.append("Question set: expectations are text_verified against the article text, lawyer_verified "
             "(field lawyer_answer) or still needs_lawyer.")
    meta = report.get("meta") or {}
    if meta:
        L.append("")
        L.append("Run: " + ", ".join(f"{k}={v}" for k, v in meta.items()))
    if mode == "retrieval":
        ks = report["ks"]
        L += ["", "## Summary (after relevance filter: alias-aware, strict in parentheses, "
              "raw pre-filter in square brackets)", "",
              "| split | n | " + " | ".join(f"@{k}" for k in ks) + " |", "|---|---|" + "---|" * len(ks)]
        for name, b in report["summary"].items():
            cells = []
            for k in ks:
                aware = b.get("kept", {}).get(f"recall@{k}")
                strict = b.get("kept_strict", {}).get(f"recall@{k}")
                raw = b.get("raw", {}).get(f"recall@{k}")
                cells.append(f"{_pct(aware)} ({_pct(strict)}) [{_pct(raw)}]")
            L.append(f"| {name} | {b['n']} | " + " | ".join(cells) + " |")
        for title, key in (("By category", "by_category"), ("By law", "by_law")):
            L += ["", f"## {title} (alias-aware @5 / @10; strict in parentheses)", "",
                  "| group | n | @5 | @10 |", "|---|---|---|---|"]
            for g, b in report[key].items():
                L.append(f"| {g} | {b['n']} | {_pct(b.get('recall@5'))} ({_pct(b.get('recall@5_strict'))}) "
                         f"| {_pct(b.get('recall@10'))} ({_pct(b.get('recall@10_strict'))}) |")
        misses = [c for c in report["cases"] if c["rank_kept"] is None or c["rank_kept"] > 5]
        L += ["", f"## Cases without the expected article in the top 5 ({len(misses)})", ""]
        for c in misses:
            L.append(f"- {c['id']} ({c['category']}, rank_kept={c['rank_kept']}, rank_raw={c['rank_raw']}): "
                     + "; ".join(c["got"][:3]))
    else:
        run = report.get("run") or {}
        L += ["", f"Cost cap {run.get('cost_cap_usd')} USD, estimated spend {run.get('spent_usd_estimate')} USD, "
              f"asked {run.get('asked')}, skipped for cost {len(run.get('skipped_for_cost') or [])}."]
        if run.get("aborted"):
            L.append(f"ABORTED: {run['aborted']}")
        lat = report["latency_ms"]
        L += ["", f"Latency p50={lat['p50']} ms, p95={lat['p95']} ms.", "",
              "## Summary", "", "| split | n | pass | must_include | no forbidden | cited | latency |",
              "|---|---|---|---|---|---|---|"]
        for name, b in report["summary"].items():
            L.append(f"| {name} | {b['n']} | {_pct(b['pass'])} | {_pct(b['include_ok'])} | {_pct(b['exclude_ok'])} "
                     f"| {_pct(b['cited_ok'])} | {_pct(b['latency_ok'])} |")
        for title, key in (("By category", "by_category"), ("By law", "by_law")):
            L += ["", f"## {title}", "", "| group | n | pass |", "|---|---|---|"]
            for g, b in report[key].items():
                L.append(f"| {g} | {b['n']} | {_pct(b['pass'])} |")
        fails = [c for c in report["cases"] if not c["pass"]]
        L += ["", f"## Failing cases ({len(fails)})", ""]
        for c in fails:
            why = []
            if c.get("error"):
                why.append("error=" + c["error"])
            if c["missing"]:
                why.append("missing=" + ",".join(c["missing"]))
            if c["forbidden"]:
                why.append("forbidden=" + ",".join(c["forbidden"]))
            if not c["cited_ok"]:
                why.append("not cited")
            if not c["latency_ok"]:
                why.append(f"latency={c['latency_ms']}")
            L.append(f"- {c['id']}: " + "; ".join(why))
    return "\n".join(L) + "\n"


# --------------------------------------------------------------------------- baseline compare
def extract_report(text: str) -> dict:
    """Parse a report from raw JSON text or from noisy output holding a marker line."""
    for line in reversed(text.splitlines()):
        if line.startswith(MARKER + " "):
            return json.loads(line[len(MARKER) + 1:])
    return json.loads(text)


def _r5(report: dict) -> Optional[float]:
    return report["summary"]["all"]["kept"].get("recall@5")


def compare(baseline: Optional[dict], current: dict, warn_drop: float = 5.0) -> Tuple[List[str], bool]:
    """Report lines and a warn flag. Drop is measured in percentage points of retrieval@5."""
    cur = _r5(current)
    n = current["summary"]["all"]["n"]
    lines = [f"legal gate: retrieval@5 (alias-aware) = {_pct(cur)} on {n} questions "
             f"(dev {_pct(current['summary']['dev']['kept'].get('recall@5'))}, "
             f"held-out {_pct(current['summary']['held_out']['kept'].get('recall@5'))}); "
             f"questions are text_verified / lawyer_verified / needs_lawyer"]
    if baseline is None:
        lines.append("legal gate: no baseline file; capture one with: scripts/ops/deploy_local.sh eval-baseline")
        return lines, False
    base = _r5(baseline)
    if base is None or cur is None:
        lines.append("legal gate: baseline or current has no recall@5; cannot compare")
        return lines, False
    delta = 100 * (cur - base)
    lines.append(f"legal gate: baseline retrieval@5 = {_pct(base)} ({baseline.get('generated', '?')}); "
                 f"delta {delta:+.1f} points (warn when below -{warn_drop:g})")
    base_cases = {c["id"]: c for c in baseline.get("cases", [])}
    lost = [c["id"] for c in current.get("cases", [])
            if base_cases.get(c["id"], {}).get("rank_kept") and base_cases[c["id"]]["rank_kept"] <= 5
            and not (c["rank_kept"] and c["rank_kept"] <= 5)]
    if lost:
        lines.append("legal gate: questions that left the top 5: " + ", ".join(lost))
    bc, cc = baseline.get("meta", {}).get("collection"), current.get("meta", {}).get("collection")
    if bc and cc and bc != cc:
        lines.append(f"legal gate: note, collection changed {bc} -> {cc}; a drop may be a corpus change")
    warn = delta < -warn_drop
    if warn:
        lines.append(f"WARNING legal gate: retrieval@5 dropped {-delta:.1f} points (> {warn_drop:g}); "
                     "deploy is NOT blocked, inspect before the next change")
    return lines, warn


# --------------------------------------------------------------------------- CLI
def _write(path: Optional[str], text: str) -> None:
    if path:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


def _emit(report: dict, args: argparse.Namespace) -> None:
    _write(args.json_out, json.dumps(report, ensure_ascii=False, indent=1))
    _write(args.md_out, render_markdown(report))
    if args.json:
        print(f"{MARKER} {json.dumps(report, ensure_ascii=False, separators=(',', ':'))}")
    elif not args.md_out:
        print(render_markdown(report))


def cmd_retrieval(args: argparse.Namespace) -> int:
    cases = _select(args)
    retriever, meta = engine_retriever(rerank=bool(getattr(args, "rerank", False)))
    report = retrieval_report(run_retrieval(cases, retriever), meta)
    _emit(report, args)
    return 0


def _select(args: argparse.Namespace) -> List[dict]:
    cases = load_cases(Path(args.set), args.split)
    if getattr(args, "ids", None):
        wanted = set(args.ids.split(","))
        cases = [c for c in cases if c["id"] in wanted]
    if getattr(args, "limit", None):
        cases = cases[: args.limit]
    return cases


def cmd_answer(args: argparse.Namespace) -> int:
    if not args.confirm_spend:
        print("answer mode calls the live chat endpoint and may cost money; re-run with --confirm-spend",
              file=sys.stderr)
        return 2
    if args.max_cost_usd > HARD_COST_CAP_USD:
        print(f"--max-cost-usd above the hard cap {HARD_COST_CAP_USD}", file=sys.stderr)
        return 2
    token = os.environ.get("ROXIRA_EVAL_TOKEN", "")
    if not token:
        print("warning: ROXIRA_EVAL_TOKEN is not set; the chat endpoint requires a login token", file=sys.stderr)
    cases = _select(args)
    results, info = run_answer(cases, lambda q: http_chat(args.base_url, q, token), max_cost_usd=args.max_cost_usd,
                               est_cost_per_call=args.est_cost_per_call, max_latency_ms=args.max_latency_ms,
                               sleep_s=args.sleep)
    report = answer_report(results, info)
    _emit(report, args)
    return 1 if info["aborted"] else 0


def cmd_compare(args: argparse.Namespace) -> int:
    base_path = Path(args.baseline)
    baseline = json.loads(base_path.read_text(encoding="utf-8")) if base_path.is_file() else None
    raw = sys.stdin.read() if args.current == "-" else Path(args.current).read_text(encoding="utf-8")
    try:
        current = extract_report(raw)
    except (ValueError, KeyError):
        print("legal gate: could not read a retrieval report from the server output (gate skipped, deploy unaffected)")
        return 1 if args.strict else 0
    lines, warn = compare(baseline, current, args.warn_drop)
    print("\n".join(lines))
    return 1 if (warn and args.strict) else 0


def cmd_capture(args: argparse.Namespace) -> int:
    report = extract_report(sys.stdin.read())
    if report.get("mode") != "retrieval":
        print("not a retrieval report", file=sys.stderr)
        return 1
    _write(args.out, json.dumps(report, ensure_ascii=False, indent=1) + "\n")
    print(f"baseline written: {args.out} (retrieval@5 {_pct(_r5(report))} on {report['n']} questions)")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    cases = load_cases(Path(args.set))
    errs = validate(cases)
    held = sum(1 for c in cases if c.get("held_out"))
    print("\n".join(errs) or f"OK: {len(cases)} cases ({held} held out)")
    return 1 if errs else 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--set", default=str(DEFAULT_SET))
        p.add_argument("--split", choices=("all", "dev", "held_out"), default="all")
        p.add_argument("--ids", help="comma separated case ids")
        p.add_argument("--limit", type=int)
        p.add_argument("--json", action="store_true", help=f"print one '{MARKER} {{...}}' line")
        p.add_argument("--json-out")
        p.add_argument("--md-out")

    r = sub.add_parser("retrieval", help="no LLM, 0 USD")
    common(r)
    r.add_argument("--rerank", action="store_true",
                   help="enable the local cross-encoder reranker (SMARTJUDGE_RERANKER=local) for this run; "
                        "default is off, so the baseline numbers are unchanged")
    r.set_defaults(fn=cmd_retrieval)
    a = sub.add_parser("answer", help="PAID: live chat endpoint, capped")
    common(a)
    a.add_argument("--base-url", required=True)
    a.add_argument("--confirm-spend", action="store_true")
    a.add_argument("--max-cost-usd", type=float, default=HARD_COST_CAP_USD)
    a.add_argument("--est-cost-per-call", type=float, default=0.003)
    a.add_argument("--max-latency-ms", type=float, default=45000.0)
    a.add_argument("--sleep", type=float, default=0.0)
    a.set_defaults(fn=cmd_answer)
    c = sub.add_parser("compare", help="warn when retrieval@5 drops against a baseline")
    c.add_argument("--baseline", default=str(DEFAULT_BASELINE))
    c.add_argument("--current", default="-", help="report file or '-' for stdin")
    c.add_argument("--warn-drop", type=float, default=5.0, help="percentage points")
    c.add_argument("--strict", action="store_true")
    c.set_defaults(fn=cmd_compare)
    k = sub.add_parser("capture", help="write the baseline file from a retrieval report on stdin")
    k.add_argument("--out", default=str(DEFAULT_BASELINE))
    k.set_defaults(fn=cmd_capture)
    v = sub.add_parser("validate", help="offline shape check")
    v.add_argument("--set", default=str(DEFAULT_SET))
    v.set_defaults(fn=cmd_validate)
    return ap


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())

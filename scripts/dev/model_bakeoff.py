#!/usr/bin/env python3
"""Cheap, reproducible model bake-off over the repo's synthetic legal eval set.

Owner-run only. Sends ONLY cases from data/eval/ to OpenRouter (OpenAI-compatible
endpoint) using OPENROUTER_API_KEY from the environment. Never prints the key,
headers or prompts. See docs/ops/MODEL_BAKEOFF.md.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVAL_DIR = ROOT / "data" / "eval"
DEFAULT_EVAL = EVAL_DIR / "legal_rag_eval.jsonl"
CANDIDATES = ROOT / "config" / "bakeoff_candidates.json"
CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
MODELS_URL = "https://openrouter.ai/api/v1/models"
STATE_DIR = Path.home() / ".local" / "state" / "roxira"
MAX_TOKENS = 400
RETRIES = 2
SYSTEM = (
    "You are a careful Iranian legal assistant. Answer briefly in Persian and "
    "cite the exact law name and article number (e.g. ماده 336)."
)
_SLEEP = 1.0


class BakeoffError(Exception):
    pass


def _inside(path: Path, base: Path) -> bool:
    try:
        path.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def check_eval_path(path: Path) -> Path:
    """Hard rule: only files under data/eval/ may be read and sent."""
    if not _inside(path, EVAL_DIR):
        raise BakeoffError("refused: eval set must live under data/eval/")
    return path.resolve()


def _scorer():
    """Load the existing scorer functions without running anything."""
    path = ROOT / "scripts" / "eval_legal_rag.py"
    spec = importlib.util.spec_from_file_location("eval_legal_rag", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # module top level is import-only (stdlib)
    return mod._law_name_matches, mod._article_in_text


def load_cases(path: Path) -> list[dict]:
    rows = []
    for line in check_eval_path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def load_candidates(path: Path = CANDIDATES) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["candidates"]


def est_cost(cand: dict, in_tokens: int, out_tokens: int) -> float:
    p = cand.get("price_per_1m") or {"in": 1.0, "out": 4.0}
    return (in_tokens * p["in"] + out_tokens * p["out"]) / 1e6


def est_tokens(text: str) -> int:
    return max(1, len(text) // 3)  # conservative for Persian


def _ssl_context() -> ssl.SSLContext:
    """Use certifi's CA bundle when installed (system Python on macOS often lacks one)."""
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def _http_post(url: str, headers: dict, body: dict, timeout: float = 120) -> dict:
    req = urllib.request.Request(url, json.dumps(body).encode(), headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as r:
        return json.loads(r.read())


def _http_get(url: str, headers: dict, timeout: float = 60) -> dict:
    with urllib.request.urlopen(
        urllib.request.Request(url, headers=headers), timeout=timeout, context=_ssl_context()
    ) as r:
        return json.loads(r.read())


def _headers() -> dict:
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        raise BakeoffError("OPENROUTER_API_KEY is not set")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def call_model(post, model: str, question: str) -> tuple[str, int, int]:
    body = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "temperature": 0,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}],
    }
    last = "error"
    for attempt in range(RETRIES + 1):
        try:
            data = post(CHAT_URL, _headers(), body)
            usage = data.get("usage") or {}
            text = data["choices"][0]["message"]["content"] or ""
            tin = int(usage.get("prompt_tokens", est_tokens(SYSTEM + question)))
            tout = int(usage.get("completion_tokens", est_tokens(text)))
            return text, tin, tout
        except BakeoffError:
            raise
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
        except Exception as e:
            last = type(e).__name__
        if attempt < RETRIES:
            time.sleep(_SLEEP * (2**attempt))
    raise RuntimeError(last)


def plan(cands: list[dict], cases: list[dict]) -> list[dict]:
    out = []
    for c in cands:
        usd = sum(est_cost(c, est_tokens(SYSTEM + r["question"]), MAX_TOKENS) for r in cases)
        out.append({"model": c["id"], "cases": len(cases), "max_est_usd": round(usd, 4)})
    return out


def run(cands, cases, post, max_usd: float, concurrency: int = 2) -> dict:
    law_ok, art_ok = _scorer()
    lock = threading.Lock()
    state = {"spent": 0.0, "stopped": False}
    results = {c["id"]: [] for c in cands}

    def work(c, row):
        if row.get("sensitive") and c["id"].endswith(":free"):
            return c["id"], {"id": row["id"], "skipped": "sensitive_on_free"}
        reserve = est_cost(c, est_tokens(SYSTEM + row["question"]), MAX_TOKENS)
        with lock:
            if state["stopped"] or state["spent"] + reserve > max_usd:
                state["stopped"] = True
                return c["id"], {"id": row["id"], "skipped": "budget"}
            state["spent"] += reserve  # reserve worst case, reconcile below
        t0 = time.time()
        try:
            text, tin, tout = call_model(post, c["id"], row["question"])
        except RuntimeError as e:
            with lock:
                state["spent"] -= reserve
            return c["id"], {"id": row["id"], "error": str(e)}
        actual = est_cost(c, tin, tout)
        with lock:
            state["spent"] += actual - reserve
        cited = bool(art_ok(row["expected_article"], text))
        law = bool(law_ok(row["expected_law"], text))
        return c["id"], {
            "id": row["id"],
            "citation_valid": cited,
            "pass": cited and law,
            "latency_s": round(time.time() - t0, 2),
            "usd": actual,
        }

    jobs = [(c, r) for c in cands for r in cases]
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        for mid, res in ex.map(lambda j: work(*j), jobs):
            results[mid].append(res)
    return {
        "spent_usd": round(state["spent"], 5),
        "budget_stopped": state["stopped"],
        "results": results,
    }


def summarize(report: dict) -> list[dict]:
    rows = []
    for mid, rs in report["results"].items():
        done = [r for r in rs if "pass" in r]
        n = len(done)
        rows.append(
            {
                "model": mid,
                "answered": n,
                "total": len(rs),
                "pass_rate": round(sum(r["pass"] for r in done) / n, 3) if n else None,
                "citation_validity": (
                    round(sum(r["citation_valid"] for r in done) / n, 3) if n else None
                ),
                "avg_latency_s": round(sum(r["latency_s"] for r in done) / n, 2) if n else None,
                "est_usd": round(sum(r["usd"] for r in done), 5),
            }
        )
    return rows


def _fmt(v):
    return "n/a" if v is None else v


def markdown(rows: list[dict], report: dict, date: str) -> str:
    out = [
        f"# Model bake-off {date}",
        "",
        f"Estimated spend: ${report['spent_usd']} (budget stopped: {report['budget_stopped']}). "
        "Candidate ids are unverified placeholders unless confirmed with --list-verify.",
        "",
        "| model | answered/total | pass rate | citation validity | avg latency (s) | est. USD |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        out.append(
            f"| {r['model']} | {r['answered']}/{r['total']} | {_fmt(r['pass_rate'])} | "
            f"{_fmt(r['citation_validity'])} | {_fmt(r['avg_latency_s'])} | {r['est_usd']} |"
        )
    return "\n".join(out) + "\n"


def list_verify(get, cands) -> list[tuple[str, bool]]:
    data = get(MODELS_URL, {})
    live = {m.get("id") for m in data.get("data", [])}
    return [(c["id"], c["id"] in live) for c in cands]


def main(argv=None, post=_http_post, get=_http_get) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--candidates", default=str(CANDIDATES))
    ap.add_argument("--eval-set", default=str(DEFAULT_EVAL))
    ap.add_argument("--models", help="comma-separated subset of candidate ids")
    ap.add_argument("--limit", type=int, default=0, help="only first N cases")
    ap.add_argument("--max-usd", type=float, default=0.50)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list-verify", action="store_true")
    ap.add_argument("--md-out", default=None)
    ap.add_argument("--state-dir", default=str(STATE_DIR))
    a = ap.parse_args(argv)
    try:
        cands = load_candidates(Path(a.candidates))
        if a.models:
            want = set(a.models.split(","))
            cands = [c for c in cands if c["id"] in want]
        if a.list_verify:
            for mid, ok in list_verify(get, cands):
                print(f"{'FOUND  ' if ok else 'MISSING'} {mid}")
            return 0
        cases = load_cases(Path(a.eval_set))
        if a.limit:
            cases = cases[: a.limit]
        state_dir = Path(a.state_dir).expanduser()
        if _inside(state_dir, ROOT):
            raise BakeoffError("refused: state dir must be outside the repo")
        p = plan(cands, cases)
        if a.dry_run:
            for r in p:
                print(f"{r['model']}: {r['cases']} cases, max est ${r['max_est_usd']}")
            total = round(sum(r["max_est_usd"] for r in p), 4)
            print(f"total max est ${total} (cap ${a.max_usd}); no network used")
            return 0
        report = run(cands, cases, post, a.max_usd)
    except BakeoffError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    date = dt.date.today().isoformat()
    rows = summarize(report)
    text = markdown(rows, report, date)
    md = Path(a.md_out) if a.md_out else ROOT / "docs" / "research" / f"BAKEOFF_{date}.md"
    md.write_text(text, encoding="utf-8")
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / f"bakeoff_{date}.json").write_text(
        json.dumps({"summary": rows, **report}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

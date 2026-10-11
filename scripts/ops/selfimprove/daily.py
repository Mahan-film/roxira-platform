#!/usr/bin/env python3
"""Daily self-improvement run: golden eval, mine anonymised questions, report, e-mail, optional issues.

Measures and proposes only; never changes production code, config or data.
Usage: daily.py [--dry-run] [--no-llm] [--no-golden] [--no-db]
Env (names only): see deploy/selfimprove/selfimprove.env.example
"""
import argparse
import hashlib
import json
import os
import socket
import sys
import time
import urllib.request

import analysis as an
import budget
import common
import llm
import logstats
import mc_shim as mc
import report

GOLDEN_MAX = int(os.environ.get("SELFIMPROVE_GOLDEN_MAX", "20") or 20)
EST_CHAT_USD = float(os.environ.get("SELFIMPROVE_EST_USD_PER_CHAT", "0.004") or 0.004)
BASE_URL = os.environ.get("SELFIMPROVE_BASE_URL", "http://127.0.0.1:8000")


def run_golden(ledger: budget.Ledger, day: str) -> dict:
    import eval_chat_golden as ecg
    cases = ecg.load()
    if not cases:
        return {"reason": "no cases"}
    start = int(day.replace("-", "")) % len(cases)  # rotate so every case is covered over time
    picked = [cases[(start + i) % len(cases)] for i in range(min(GOLDEN_MAX, len(cases)))]
    results, skipped = [], 0
    for c in picked:
        try:
            ledger.charge(EST_CHAT_USD, "golden-chat:" + c["id"])
        except budget.BudgetExceeded:
            skipped += 1
            continue
        try:
            results.append(ecg.score_case(c, ecg.ask(BASE_URL, c["question"])))
        except Exception as exc:  # noqa: BLE001
            results.append({"id": c["id"], "pass": False, "missing": [f"request failed: {type(exc).__name__}"], "forbidden": []})
    return {"run": len(results), "passed": sum(r["pass"] for r in results),
            "failed": [r for r in results if not r["pass"]], "skipped_budget": skipped}


def fetch_turns() -> list:
    code = (common.read_text(os.path.join(common.HERE, "anonymise.py")) + "\n"
            + common.read_text(os.path.join(common.HERE, "db_extract.py")))
    r = common.docker_exec_stdin(code, timeout=180)
    for line in r.stdout.splitlines():
        if line.startswith("SI_TURNS "):
            return json.loads(line[9:])
    print("db extract failed: " + mc.scrub(r.stderr[-200:]))
    return []


def suggest(ledger: budget.Ledger, missing: list) -> dict:
    """LLM only on anonymised keyword labels (never question text)."""
    out = {}
    for c in missing[:4]:
        text = llm.ask(ledger, "Iranian law topic keywords (Persian): " + ", ".join(c["terms"]) +
                       ". Name up to 2 Iranian laws or article ranges likely covering this topic, one line, "
                       "Persian, no explanation. If unsure say unknown.", "topic-label:" + c["label"][:30],
                       system="You suggest candidate Iranian legal sources by topic keywords. Be brief.")
        if text:
            out[c["label"]] = " ".join(text.split())[:200]
    return out


def open_issues(items: list, state_path: str, dry: bool) -> int:
    token, repo = os.environ.get("GH_ISSUES_TOKEN", ""), os.environ.get("SELFIMPROVE_GH_REPO", "")
    if os.environ.get("SELFIMPROVE_GH_ISSUES") != "1" or not token or not repo:
        return 0
    state = mc.load_state(state_path)
    seen = set(state.get("issues", []))
    n = 0
    for title, body in items[:5]:
        h = hashlib.sha1(title.encode()).hexdigest()[:12]
        if h in seen:
            continue
        if not dry:
            req = urllib.request.Request(f"https://api.github.com/repos/{repo}/issues", method="POST",
                                         data=json.dumps({"title": title, "body": body, "labels": ["self-improvement"]}).encode(),
                                         headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
            try:
                urllib.request.urlopen(req, timeout=30).read()  # noqa: S310
            except Exception:  # noqa: BLE001
                continue
        seen.add(h)
        n += 1
    if not dry:
        mc.save_state(state_path, {"issues": sorted(seen)})
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    for f in ("--dry-run", "--no-llm", "--no-golden", "--no-db"):
        ap.add_argument(f, action="store_true")
    a = ap.parse_args()
    day = budget.today()
    ledger = budget.Ledger(common.LEDGER, budget.cap_from_env())
    golden = {"reason": "disabled"} if a.no_golden else run_golden(ledger, day)
    turns = [] if a.no_db else fetch_turns()
    ana = an.analyse(turns)
    logs = logstats.parse(common.docker_logs("24h", timeout=300))
    sugg = {} if a.no_llm else suggest(ledger, ana["missing"])
    text = report.render(day, golden, ana, logs, sugg, ledger.spent(), ledger.cap)
    if not a.dry_run:
        os.makedirs(common.REPORT_DIR, exist_ok=True)
        with open(os.path.join(common.REPORT_DIR, day + ".md"), "w", encoding="utf-8") as fh:
            fh.write(text)
    else:
        print(text)
    if not mc.silenced():
        mc.send_email(f"[Roxira] Smart Judge daily improvement report {day}", text, dry_run=a.dry_run)
    n = open_issues(report.actionable_items(ana, golden), os.path.join(common.STATE_DIR, "daily_state.json"), a.dry_run)
    print(f"report {day} done; issues opened: {n}; spent {ledger.spent():.4f} USD; host {socket.gethostname()}; t={int(time.time())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Hourly self-improvement check: retrieval recall + latency/error stats + regression alert.

No LLM, read-only. Appends one record to metrics.jsonl; e-mails only on change (monitor_common).
Usage: hourly.py [--dry-run] [--no-probe]
"""
import argparse
import json
import sys
import time

import common
import logstats
import metrics
import mc_shim as mc


def run_probe() -> dict:
    ecg_src = common.read_text(common.os.path.join(common.REPO, "scripts", "eval_chat_golden.py"))
    set_json = common.read_text(common.os.path.join(common.REPO, "data", "eval", "chat_golden", "retrieval_golden.json"))
    code = ("import types, sys\n"
            "ecg = types.ModuleType('ecg'); ecg.__file__ = '/app/scripts/eval_chat_golden.py'\n"
            f"exec(compile({ecg_src!r}, 'ecg', 'exec'), ecg.__dict__)\n"
            f"SET_JSON = {set_json!r}\n"
            + common.read_text(common.os.path.join(common.HERE, "retrieval_probe.py")))
    r = common.docker_exec_stdin(code, timeout=600)
    for line in r.stdout.splitlines():
        if line.startswith("SI_RESULT "):
            cases = json.loads(line[10:])["cases"]
            scored = [c for c in cases if not c["gap"]]
            hits = sum(c["hit"] for c in scored)
            errs = sum(1 for c in scored if c["err"])
            return {"recall": hits / len(scored) if scored else None, "scored": len(scored), "hits": hits,
                    "probe_errors": errs, "failed": [c["id"] for c in scored if not c["hit"]],
                    "probe_p95_ms": metrics.percentile([c["ms"] for c in cases], 95)}
    return {"probe_failed": True}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-probe", action="store_true")
    args = ap.parse_args()
    now = time.time()
    rec = {"ts": int(now)}
    rec.update(logstats.parse(common.docker_logs("1h")))
    rec.update({"probe_failed": True} if args.no_probe else run_probe())
    history = metrics.read_jsonl(common.METRICS)
    results = metrics.detect_regressions(rec, history, now)
    if rec.get("probe_failed") or rec.get("probe_errors"):
        results["retrieval_probe"] = (False, "retrieval probe failed or errored (Qdrant/embedder down?)")
    else:
        results["retrieval_probe"] = (True, "probe ok")
    if not args.dry_run:
        metrics.append_jsonl(common.METRICS, rec)
    state_path = common.os.path.join(common.STATE_DIR, "hourly_state.json")
    state = mc.load_state(state_path)
    checks, alerts = mc.evaluate(state.get("checks", {}), results, now)
    if not args.dry_run:
        mc.save_state(state_path, {"checks": checks})
    print(json.dumps({k: v for k, v in rec.items()}, ensure_ascii=False, sort_keys=True))
    if not mc.silenced():
        # "STILL FAILING" repeats are muted: the open failure is listed once per digest.
        mc.queue_alerts(alerts, "self-improvement", dry_run=args.dry_run)
    return 1 if any(not ok for ok, _ in results.values()) else 0


if __name__ == "__main__":
    sys.exit(main())

"""Metric history (JSONL), percentiles and regression detection. Stdlib only."""
import json
import math
import os
import statistics

WEEK_S = 7 * 86400
MIN_BASELINE = 6        # samples needed before any regression alert
MIN_LOG_SAMPLES = 5     # chats in the current hour needed to judge p95
P95_REGRESSION = 1.30   # alert when p95 > 130 % of the 7-day median
RECALL_EPS = 1e-9


def percentile(values, pct):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    return vals[max(0, math.ceil(pct / 100 * len(vals)) - 1)]


def append_jsonl(path: str, record: dict) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def read_jsonl(path: str) -> list:
    rows = []
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        pass
    return rows


def _baseline(history, key, now):
    vals = [r[key] for r in history
            if isinstance(r.get(key), (int, float)) and now - r.get("ts", 0) <= WEEK_S and r.get("ts", 0) < now]
    return (statistics.median(vals), len(vals)) if vals else (None, 0)


def detect_regressions(current: dict, history: list, now: float) -> dict:
    """Return {check: (ok, detail)} for monitor_common.evaluate().

    recall: current < median of the last 7 days (needs MIN_BASELINE samples).
    p95_total_ms: current > 1.3 x the 7-day median p95 (needs MIN_LOG_SAMPLES chats now).
    """
    out = {}
    rc = current.get("recall")
    if isinstance(rc, (int, float)):
        base, n = _baseline(history, "recall", now)
        if base is None or n < MIN_BASELINE:
            out["retrieval_recall"] = (True, f"recall {rc:.3f}, baseline not ready ({n} samples)")
        else:
            ok = rc >= base - RECALL_EPS
            out["retrieval_recall"] = (ok, f"recall {rc:.3f} vs 7d median {base:.3f}")
    p95 = current.get("total_ms_p95")
    if isinstance(p95, (int, float)) and current.get("chats", 0) >= MIN_LOG_SAMPLES:
        base, n = _baseline(history, "total_ms_p95", now)
        if base is None or n < MIN_BASELINE or base <= 0:
            out["chat_p95"] = (True, f"p95 {p95:.0f} ms, baseline not ready ({n} samples)")
        else:
            ok = p95 <= base * P95_REGRESSION
            out["chat_p95"] = (ok, f"p95 {p95:.0f} ms vs 7d median {base:.0f} ms (limit +30%)")
    return out

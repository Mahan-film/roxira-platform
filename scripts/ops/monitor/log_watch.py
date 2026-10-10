#!/usr/bin/env python3
"""Scan recent container logs for 5xx, client errors and chat latency.

Stdlib only. Never emits phone numbers, tokens or message text.

Logs are streamed line by line from `docker logs` and folded into counters on the fly,
so memory does not grow with the number of lines. A wall-clock deadline kills a slow
`docker logs` and the partial counts are reported.

Usage: log_watch.py [--minutes N] [--daily] [--dry-run] [--state PATH]
Env (names only): MONITOR_LOG_MINUTES, MONITOR_5XX_MAX, MONITOR_CLIENT_ERR_MAX,
MONITOR_P95_MAX_S, MONITOR_APP_CONTAINER, MONITOR_NGINX_CONTAINER,
MONITOR_LOG_STATE_FILE, plus the e-mail variables of synthetic_check.py.
"""

from __future__ import annotations

import argparse
import collections
import math
import os
import re
import socket
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import monitor_common as mc  # noqa: E402

SHORT_DEADLINE_S = 60  # overall budget for the 10-minute check (both containers)
DAILY_DEADLINE_S = 300  # overall budget for the --daily summary (both containers)

_REQ = re.compile(r'"(?P<m>[A-Z]+) (?P<path>\S+) HTTP/[\d.]+" (?P<code>\d{3})')
_TIMING = re.compile(r"\[CHAT-TIMING\].*?\btotal_ms=(?P<ms>\d+(?:\.\d+)?)")
_CLIENT = re.compile(r"\[CLIENT-ERROR\]\s*(?P<rest>.*)")
_KIND = re.compile(r"(?:^|\s)kind=(?P<kind>\S+)")
_KIND_OK = re.compile(r"[A-Za-z0-9_.-]{1,40}")
_ID = re.compile(r"/(?:\d+|[0-9a-fA-F-]{16,})(?=/|$)")


def percentile(values, pct):
    if not values:
        return None
    ordered = sorted(values)
    idx = max(0, math.ceil(pct / 100 * len(ordered)) - 1)
    return ordered[idx]


def client_kind(rest: str) -> str:
    """Error kind of a [CLIENT-ERROR] line: the `kind=` value only, else "unknown".

    Free text (message=..., phone=..., etc.) is never used. The value must be one token of
    at most 40 chars from [A-Za-z0-9_.-] and must survive scrub() unchanged.
    """
    m = _KIND.search(rest)
    if not m:
        return "unknown"
    kind = m["kind"]
    if _KIND_OK.fullmatch(kind) and mc.scrub(kind, 40) == kind:
        return kind
    return "unknown"


class LogCounters:
    """Incremental log counters: feed() one line at a time, result() when done."""

    def __init__(self):
        self.api_5xx = 0
        self.client_errors = 0
        self.timings_s: list[float] = []
        self.top_5xx: collections.Counter = collections.Counter()
        self.top_client: collections.Counter = collections.Counter()

    def feed(self, line: str) -> None:
        m = _REQ.search(line)
        if m and m["code"].startswith("5"):
            path = m["path"].split("?", 1)[0]
            if path.startswith("/api/"):
                self.api_5xx += 1
                self.top_5xx[f"{m['m']} {_ID.sub('/:id', path)} {m['code']}"] += 1
        t = _TIMING.search(line)
        if t:
            self.timings_s.append(float(t["ms"]) / 1000)
        c = _CLIENT.search(line)
        if c:
            self.client_errors += 1
            self.top_client[client_kind(c["rest"])] += 1

    def result(self) -> dict:
        return {"api_5xx": self.api_5xx, "client_errors": self.client_errors,
                "timings_s": list(self.timings_s), "top_5xx": collections.Counter(self.top_5xx),
                "top_client": collections.Counter(self.top_client)}


def parse_lines(lines):
    """Parse log lines into counters. Pure function (unit-tested)."""
    acc = LogCounters()
    for line in lines:
        acc.feed(line)
    return acc.result()


def merge(a, b):
    return {"api_5xx": max(a["api_5xx"], b["api_5xx"]),  # same request is seen by nginx and app
            "client_errors": a["client_errors"] + b["client_errors"],
            "timings_s": a["timings_s"] + b["timings_s"],
            "top_5xx": a["top_5xx"] + b["top_5xx"],
            "top_client": a["top_client"] + b["top_client"]}


def stream_container(container: str, minutes: int, deadline_s: float):
    """Stream `docker logs` for one container into counters.

    Returns (stats, partial). partial is True when the deadline killed docker logs; the
    stats then cover only the lines read before the kill. Raises RuntimeError on a
    non-zero exit that was not caused by the deadline.
    """
    proc = subprocess.Popen(["docker", "logs", "--since", f"{minutes}m", container],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, errors="replace")
    expired = threading.Event()

    def _expire():
        expired.set()
        try:
            proc.kill()
        except OSError:
            pass

    timer = threading.Timer(max(0.01, deadline_s), _expire)
    timer.daemon = True
    acc = LogCounters()
    timer.start()
    try:
        for line in proc.stdout:
            acc.feed(line)
        rc = proc.wait()
    except BaseException:
        proc.kill()
        proc.wait()
        raise
    finally:
        timer.cancel()
        proc.stdout.close()
    partial = rc != 0 and expired.is_set()
    if rc != 0 and not partial:
        raise RuntimeError(f"docker logs {container} failed (rc={rc})")
    return acc.result(), partial


def verdicts(stats, max_5xx, max_client, max_p95):
    p95 = percentile(stats["timings_s"], 95)
    return {
        "logs:api-5xx": (stats["api_5xx"] <= max_5xx, f"{stats['api_5xx']} 5xx on /api/ (max {max_5xx})"),
        "logs:client-errors": (stats["client_errors"] <= max_client,
                               f"{stats['client_errors']} client errors (max {max_client})"),
        "logs:chat-p95": (p95 is None or p95 <= max_p95,
                          "no chat samples" if p95 is None else f"p95 {p95:.1f}s (max {max_p95:.0f}s)"),
    }


def summary_text(stats, minutes):
    p50, p95 = percentile(stats["timings_s"], 50), percentile(stats["timings_s"], 95)
    fmt = lambda v: "n/a" if v is None else f"{v:.1f}s"  # noqa: E731
    label = f"{minutes // 60} h" if minutes >= 120 else f"{minutes} min"
    lines = [f"Window: last {label}",
             f"Chat requests timed: {len(stats['timings_s'])}  p50={fmt(p50)}  p95={fmt(p95)}",
             f"5xx on /api/: {stats['api_5xx']}",
             f"[CLIENT-ERROR] lines: {stats['client_errors']}", "", "Top 5xx:"]
    lines += [f"  {n:4d}  {k}" for k, n in stats["top_5xx"].most_common(5)] or ["  none"]
    lines += ["", "Top client errors:"]
    lines += [f"  {n:4d}  {k}" for k, n in stats["top_client"].most_common(5)] or ["  none"]
    return "\n".join(lines) + "\n"


def collect(minutes, deadline_s):
    """Both containers under one overall deadline. Returns (stats, partial)."""
    app = os.environ.get("MONITOR_APP_CONTAINER", "roxira_app_prod")
    nginx = os.environ.get("MONITOR_NGINX_CONTAINER", "roxira_nginx_prod")
    end = time.monotonic() + deadline_s
    a, pa = stream_container(app, minutes, end - time.monotonic())
    b, pb = stream_container(nginx, minutes, end - time.monotonic())
    return merge(a, b), (pa or pb)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--minutes", type=int, default=int(os.environ.get("MONITOR_LOG_MINUTES", "10")))
    ap.add_argument("--daily", action="store_true", help="send the 24 h summary e-mail")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--state")
    args = ap.parse_args(argv)
    host = socket.gethostname()

    if args.daily:
        try:
            stats, partial = collect(24 * 60, DAILY_DEADLINE_S)
        except (RuntimeError, OSError) as exc:
            body = f"log collection failed: {type(exc).__name__}\n"
        else:
            body = summary_text(stats, 24 * 60)
            if partial:
                body += (f"\nPARTIAL: {DAILY_DEADLINE_S}s deadline reached; "
                         "counts cover only the lines read before it.\n")
        mc.send_email("[Roxira daily] production summary", body + f"\nhost: {host}\n", dry_run=args.dry_run)
        return 0

    state_path = args.state or os.environ.get("MONITOR_LOG_STATE_FILE", "/var/lib/roxira-monitor/log_state.json")
    try:
        stats, partial = collect(args.minutes, SHORT_DEADLINE_S)
        results = verdicts(stats, int(os.environ.get("MONITOR_5XX_MAX", "3")),
                           int(os.environ.get("MONITOR_CLIENT_ERR_MAX", "10")),
                           float(os.environ.get("MONITOR_P95_MAX_S", "40")))
    except (RuntimeError, OSError) as exc:
        results = {"logs:collect": (False, f"cannot read docker logs: {type(exc).__name__}")}
        stats = None
    else:
        results["logs:collect"] = ((False, f"partial read: {SHORT_DEADLINE_S}s deadline reached")
                                   if partial else (True, "ok"))

    state = mc.load_state(state_path)
    checks, alerts = mc.evaluate(state.get("checks", {}), results, time.time())
    for key, (ok, detail) in sorted(results.items()):
        print(f"{'OK  ' if ok else 'FAIL'} {key}: {detail}")
    if alerts:
        subject, body = mc.format_alerts(alerts, host, "logs")
        if stats and any(a[0] != "RECOVERED" for a in alerts):
            body += "\n" + summary_text(stats, args.minutes)
        if mc.silenced() and not args.dry_run:
            print("alerts silenced:", subject)
        else:
            mc.send_email(subject, body, dry_run=args.dry_run)
    if not args.dry_run:
        mc.save_state(state_path, {"checks": checks, "last_run": time.time()})
    return 1 if any(not v[0] for v in results.values()) else 0


if __name__ == "__main__":
    sys.exit(main())

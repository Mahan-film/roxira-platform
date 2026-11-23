#!/usr/bin/env python3
"""Wall-time watchdog for one JIT job (R20-8, #1024). Used by jit_launcher.sh (user `runner`).

    jit_watchdog.py [--max-wall SECONDS] [--control-file F] [--on-timeout "docker kill NAME"]
                    [--grace S] -- CMD ARGS...

Runs CMD in its own session and polls it. When CMD is still running after the max wall time it runs
the optional --on-timeout command (the light slot needs `docker kill`: killing the docker client
would leave the container, and the job, running), then sends SIGTERM to the process group and
SIGKILL after --grace seconds. Exit code: the command's own, or 124 on timeout (as coreutils
timeout). Stdlib only. It never prints the command line or environment (the JIT config travels in
the environment).

Default max wall time: DEFAULT_MAX_WALL_S = 1110 s = the longest real job among the last 20
completed runs on 2026-11-23 (739 s, "M1 gate (Playwright)", on a JIT runner) + 50%.
Override order: --max-wall, env JIT_MAX_WALL_S, --control-file content, default.
"""
from __future__ import annotations

import argparse
import os
import shlex
import signal
import subprocess
import sys
import time

DEFAULT_MAX_WALL_S = 1110
MIN_MAX_WALL_S = 60  # a typo (e.g. 5) must not kill every job at once
EXIT_TIMEOUT = 124


def resolve_max_wall(cli=None, env=None, control_value=None, default=DEFAULT_MAX_WALL_S) -> int:
    """First valid positive integer of: CLI, env, control-file text, default.
    Values below MIN_MAX_WALL_S are clamped up; garbage falls through to the next source."""
    for raw in (cli, env, control_value):
        if raw is None:
            continue
        try:
            v = int(str(raw).strip())
        except ValueError:
            continue
        if v > 0:
            return max(v, MIN_MAX_WALL_S)
    return default


def read_control(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read(32)
    except OSError:
        return None


def expired(started: float, now: float, max_wall: float) -> bool:
    """True once the job has run strictly longer than max_wall."""
    return (now - started) > max_wall


def _signal_group(proc, sig) -> None:
    try:
        os.killpg(proc.pid, sig)
    except (ProcessLookupError, PermissionError):
        pass


def run(cmd, max_wall, on_timeout=None, grace=10.0, poll=1.0, clock=time.monotonic, sleep=time.sleep) -> int:
    proc = subprocess.Popen(cmd, start_new_session=True)
    started = clock()
    while True:
        rc = proc.poll()
        if rc is not None:
            return rc
        if expired(started, clock(), max_wall):
            break
        sleep(poll)
    print(f"jit-watchdog: max wall time {int(max_wall)}s exceeded, killing the job", file=sys.stderr, flush=True)
    if on_timeout:
        try:
            subprocess.run(shlex.split(on_timeout), timeout=30, check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except (OSError, subprocess.SubprocessError):
            pass
    _signal_group(proc, signal.SIGTERM)
    end = clock() + grace
    while proc.poll() is None and clock() < end:
        sleep(0.2)
    if proc.poll() is None:
        _signal_group(proc, signal.SIGKILL)
        proc.wait()
    return EXIT_TIMEOUT


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Kill a JIT job that exceeds a max wall time.")
    ap.add_argument("--max-wall", default=None)
    ap.add_argument("--control-file", default=None)
    ap.add_argument("--on-timeout", default=None)
    ap.add_argument("--grace", type=float, default=10.0)
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args(argv)
    cmd = a.cmd[1:] if a.cmd[:1] == ["--"] else a.cmd
    if not cmd:
        ap.error("no command")
    ctl = read_control(a.control_file) if a.control_file else None
    return run(cmd, resolve_max_wall(a.max_wall, os.environ.get("JIT_MAX_WALL_S"), ctl), a.on_timeout, a.grace)


if __name__ == "__main__":
    sys.exit(main())

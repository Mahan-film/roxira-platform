#!/usr/bin/env python3
"""Run a command with the repo's .env loaded, for host cron jobs.

Containers get .env through docker compose; host-side jobs (cron) do not.
Usage: python3 scripts/ops/with_env.py python3 scripts/run_periodic_crawler.py
Existing environment variables win over .env values. Never prints values.
"""
import os
import pathlib
import sys

env_file = pathlib.Path(__file__).resolve().parents[2] / ".env"
if env_file.is_file():
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.removeprefix("export ").partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)

if len(sys.argv) < 2:
    sys.exit("usage: with_env.py <command> [args...]")
os.execvp(sys.argv[1], sys.argv[1:])

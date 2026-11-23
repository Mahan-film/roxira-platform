#!/usr/bin/env python3
"""Alert when `main` moves without a merged PR (direct push). #1049, ported from #1005's check_main_push.sh.

Runs next to the merge gate (same config file, state dir, kill switch, `gh api` + optional proxy). Each
tick compares the last seen main SHA with the current one; every commit in between must belong to a
merged PR (the gate squash-merges, so its commits do). Otherwise one Telegram alert is sent through the
repo's notify helper (scripts/ops/notify/notify.py: NOTIFY_BOT_TOKEN / NOTIFY_CHAT_ID from the
environment only, nothing in code). Python stdlib only.

Dry-run is the default (dry_run = true in the config, or --dry-run): it does everything except the Telegram
send, and keeps its pointer in `last_main_sha.dryrun` so the live pointer is untouched.
Exit codes: 0 ok / nothing to do, 1 direct push found or GitHub failed.
"""
from __future__ import annotations

import argparse
import fcntl
import logging
import os
import sys
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).parent))

import merge_gate as mg  # noqa: E402

log = logging.getLogger("check_main_push")
STATE_FILE = "last_main_sha"
MAX_LIST = 10


load_notify = mg.load_notify  # shared with the gate (same notify.py lookup)


def is_direct(api, repo: str, sha: str) -> bool:
    pulls = api("GET", f"repos/{repo}/commits/{sha}/pulls") or []
    return not any(p.get("merged_at") for p in pulls)


def check(cfg: dict, api, state_dir: Path, dry: bool, send: Callable[[str], bool]) -> int:
    repo, base = cfg["repo"], cfg["base"]
    head = api("GET", f"repos/{repo}/commits/{base}")["sha"]
    # Dry-run keeps its own state file so it exercises compare + alert text for real without touching the
    # live pointer (the first live run initialises it at go-live).
    state = state_dir / (STATE_FILE + (".dryrun" if dry else ""))
    if not state.exists():
        log.info("initialising state at %s", head[:8])
        state.write_text(head + "\n")
        return 0
    last = state.read_text().strip()
    if last == head:
        log.info("%s unchanged at %s", base, head[:8])
        return 0
    try:
        cmp = api("GET", f"repos/{repo}/compare/{last}...{head}")
        direct = [c["sha"] for c in cmp.get("commits", []) if is_direct(api, repo, c["sha"])]
        reason = "without a merged PR"
    except mg.GhError as e:
        # Unknown old SHA usually means a force-push rewrote main: that must not pass silently.
        log.error("compare failed: %s", e)
        direct, reason = [head], "(history rewritten or compare failed)"
    state.write_text(head + "\n")  # never re-alert on the same commits (dry-run: own file)
    if not direct:
        log.info("OK: %s..%s all came from merged PRs", last[:8], head[:8])
        return 0
    shown = " ".join(s[:8] for s in direct[:MAX_LIST]) + (" ..." if len(direct) > MAX_LIST else "")
    text = f"[ALERT] Direct push to {repo}:{base} {reason}: {shown}"
    log.error(text)
    if dry:
        log.info("dry-run: Telegram alert not sent")
    else:
        send(text)
    return 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Alert on direct pushes to main")
    ap.add_argument("--config", default=os.environ.get("MERGE_GATE_CONFIG"))
    ap.add_argument("--dry-run", action="store_true", help="log only (also forced by dry_run = true in config)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)
    cfg = mg.load_config(args.config)
    sd = Path(cfg["state_dir"])
    sd.mkdir(parents=True, exist_ok=True)
    if (sd / "KILL").exists() or Path(cfg.get("kill_switch", "/nonexistent")).exists():
        log.warning("kill switch present, doing nothing")
        return 0
    lock = open(sd / "lock_main_push", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log.warning("another run holds the lock, exiting")
        return 0
    dry = args.dry_run or bool(cfg["dry_run"])
    if cfg["proxy"]:  # same proxy convention as gh; urllib (Telegram) honours it too
        for k in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
            os.environ[k] = cfg["proxy"]
    try:
        return check(cfg, mg.GhApi(cfg["proxy"]), sd, dry, load_notify())
    except mg.GhError as e:
        log.error("check failed: %s", e)
        return 1


if __name__ == "__main__":
    sys.exit(main())

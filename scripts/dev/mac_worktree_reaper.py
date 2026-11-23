#!/usr/bin/env python3
"""Mac worktree reaper: frees internal disk by removing worktrees that are provably safe to lose.

Runs from launchd every 15 minutes (scripts/dev/install_mac_reaper.sh). Dry run unless --apply.
A worktree is removed only when ALL hold: it is not the main checkout, not locked, not any
process's current directory, clean (no changes, no untracked files), its HEAD is contained in a
remote branch (so the commits live on GitHub), and it has had no git activity for the idle time
of the current pressure tier. `git worktree remove` is run without --force; nothing is rm -rf'd.
Tiers on free space of the internal disk: below 25 GB idle 24 h, below 15 GB idle 4 h,
below 8 GB idle 1 h. Stops as soon as free space is back above TARGET_GB. Logs counts only.
"""

import argparse
import os
import shutil
import subprocess
import sys
import time

REPO = os.environ.get("ROXIRA_REPO", os.path.expanduser("~/Developer/roxira-platform"))
TARGET_GB = float(os.environ.get("REAPER_TARGET_GB", "30"))
LOG = os.path.expanduser("~/Library/Logs/roxira-reaper.log")


def run(args, cwd=None):
    """Run a command without a shell and return its stripped stdout ('' on any failure)."""
    try:
        r = subprocess.run(args, capture_output=True, text=True, cwd=cwd, check=False)
    except OSError:
        return ""
    return r.stdout.strip()


def log(msg):
    line = time.strftime("%F %T ") + msg
    print(line)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def free_gb(path="/"):
    return shutil.disk_usage(path).free / 1e9


def idle_hours_for(free):
    if free < 8:
        return 1
    if free < 15:
        return 4
    if free < 25:
        return 24
    return None


def worktrees():
    out = run(["git", "worktree", "list", "--porcelain"], REPO)
    for blk in out.split("\n\n"):
        d = {}
        for line in blk.splitlines():
            k, _, v = line.partition(" ")
            d[k] = v or True
        if "worktree" in d:
            yield d


def live_cwds():
    out = run(["lsof", "-d", "cwd", "-Fn"])
    return [line[1:] for line in out.splitlines() if line.startswith("n")]


def activity_age_h(path):
    gd = run(["git", "rev-parse", "--absolute-git-dir"], path)
    times = [os.path.getmtime(f) for f in (gd + "/logs/HEAD", gd + "/HEAD") if os.path.exists(f)]
    ct = run(["git", "log", "-1", "--format=%ct"], path)
    if ct.isdigit():
        times.append(int(ct))
    return (time.time() - max(times or [0])) / 3600


def is_safe(wt, idle_h, cwds, keep):
    p = wt["worktree"]
    rp = os.path.realpath(p)
    if rp == os.path.realpath(REPO) or not os.path.isdir(p):
        return False, "main/missing"
    if "locked" in wt:
        return False, "locked"
    if any(rp in k for k in keep):
        return False, "keep-list"
    if any(c == p or c.startswith(p + "/") or os.path.realpath(c).startswith(rp) for c in cwds):
        return False, "in-use"
    if run(["git", "status", "--porcelain"], p):
        return False, "dirty"
    if not run(["git", "branch", "-r", "--contains", "HEAD"], p):
        return False, "not-on-remote"
    if activity_age_h(p) < idle_h:
        return False, "recent"
    return True, "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--force-tier", type=float, help="pretend free GB (tests)")
    a = ap.parse_args()
    free = a.force_tier if a.force_tier is not None else free_gb()
    idle = idle_hours_for(free)
    if idle is None:
        log(f"ok: {free:.0f} GB free")
        return 0
    run(["git", "fetch", "-q", "origin"], REPO)
    keep = [os.path.realpath(x) for x in os.environ.get("REAPER_KEEP", "").split(":") if x]
    cwds = live_cwds()
    removed = skipped = 0
    reasons = {}
    for wt in list(worktrees()):
        if a.force_tier is None and free_gb() >= TARGET_GB:
            break
        ok, why = is_safe(wt, idle, cwds, keep)
        if not ok:
            skipped += 1
            reasons[why] = reasons.get(why, 0) + 1
            continue
        if not a.apply:
            removed += 1
            continue
        r = subprocess.run(
            ["git", "worktree", "remove", wt["worktree"]],
            capture_output=True,
            text=True,
            cwd=REPO,
            check=False,
        )
        if r.returncode == 0:
            removed += 1
        else:
            reasons["remove-refused"] = reasons.get("remove-refused", 0) + 1
    if a.apply:
        run(["git", "worktree", "prune"], REPO)
    mode = "APPLY" if a.apply else "DRY"
    log(f"{mode} free={free:.0f}GB idle>={idle}h removed={removed} skipped={skipped} {reasons}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

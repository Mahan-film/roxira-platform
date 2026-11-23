#!/usr/bin/env python3
"""Mac worktree reaper: frees internal disk by removing worktrees that are provably safe to lose.

Runs from launchd every 15 minutes (scripts/dev/install_mac_reaper.sh). Dry run unless --apply.
A worktree is removed only when ALL hold: it is not the main checkout, not locked, not any
process's current directory, clean (no changes, no untracked files), its HEAD is contained in a
remote branch (so the commits live on GitHub), and it has had no git activity for the idle time of
the current pressure tier. `git worktree remove` is run without --force; nothing is rm -rf'd.
Tiers on free space of the internal disk: below 25 GB idle 24 h, below 15 GB idle 4 h, below 8 GB idle 1 h.
Stops as soon as free space is back above TARGET_GB. Logs counts only (no paths with secrets).
"""
import argparse, os, shutil, subprocess, sys, time

REPO = os.environ.get("ROXIRA_REPO", os.path.expanduser("~/Developer/roxira-platform"))
TARGET_GB = float(os.environ.get("REAPER_TARGET_GB", "30"))
LOG = os.path.expanduser("~/Library/Logs/roxira-reaper.log")


def sh(cmd, cwd=None):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd)
    return r.stdout.strip()


def log(msg):
    line = time.strftime("%F %T ") + msg
    print(line)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def free_gb(path="/"):
    return shutil.disk_usage(path).free / 1e9


def idle_hours_for(free):
    if free < 8: return 1
    if free < 15: return 4
    if free < 25: return 24
    return None


def worktrees():
    out = sh("git worktree list --porcelain", REPO)
    for blk in out.split("\n\n"):
        d = {}
        for line in blk.splitlines():
            k, _, v = line.partition(" ")
            d[k] = v or True
        if "worktree" in d:
            yield d


def live_cwds():
    return [p for p in sh("lsof -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'").splitlines() if p]


def activity_age_h(path):
    gd = sh("git rev-parse --absolute-git-dir", path)
    times = []
    for f in (gd + "/logs/HEAD", gd + "/HEAD"):
        if os.path.exists(f):
            times.append(os.path.getmtime(f))
    ct = sh("git log -1 --format=%ct", path)
    if ct.isdigit():
        times.append(int(ct))
    return (time.time() - max(times or [0])) / 3600


def safe(wt, idle_h, cwds, keep):
    p = wt["worktree"]
    if os.path.realpath(p) == os.path.realpath(REPO) or not os.path.isdir(p):
        return False, "main/missing"
    if "locked" in wt: return False, "locked"
    rp = os.path.realpath(p)
    if any(rp in k for k in keep): return False, "keep-list"
    if any(c == p or c.startswith(p + "/") or os.path.realpath(c).startswith(rp) for c in cwds):
        return False, "in-use"
    if sh("git status --porcelain", p): return False, "dirty"
    if not sh("git branch -r --contains HEAD 2>/dev/null | head -1", p): return False, "not-on-remote"
    if activity_age_h(p) < idle_h: return False, "recent"
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
    sh("git fetch -q origin", REPO)
    keep = [x for x in os.environ.get("REAPER_KEEP", "").split(":") if x]
    cwds = live_cwds()
    removed = skipped = 0
    reasons = {}
    for wt in list(worktrees()):
        if a.force_tier is None and free_gb() >= TARGET_GB:
            break
        ok, why = safe(wt, idle, cwds, [os.path.realpath(k) for k in keep])
        if not ok:
            skipped += 1; reasons[why] = reasons.get(why, 0) + 1
            continue
        if a.apply:
            r = subprocess.run(["git", "worktree", "remove", wt["worktree"]], capture_output=True, text=True, cwd=REPO)
            if r.returncode == 0: removed += 1
            else: reasons["remove-refused"] = reasons.get("remove-refused", 0) + 1
        else:
            removed += 1
    if a.apply:
        subprocess.run(["git", "worktree", "prune"], cwd=REPO)
    log(f"{'APPLY' if a.apply else 'DRY'} free={free:.0f}GB idle>={idle}h removed={removed} skipped={skipped} reasons={reasons}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

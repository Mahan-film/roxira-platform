#!/usr/bin/env python3
"""Local backup-set retention selection (pure logic, no deletion).

Sets are directories named YYYYMMDDTHHMMSSZ (UTC), written hourly by server_backup.sh.
Keep rule: the newest `hourly` sets, plus the newest set of each of the `daily` most recent
UTC days that have a set. The newest set is always kept (even with hourly=0, daily=0).

CLI: retention.py DIR --hourly N --daily M   -> prints the set names to DELETE, one per line.
server_backup.sh does the removal; this file never touches the disk beyond listing DIR.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SET_RE = re.compile(r"^20\d{6}T\d{6}Z$")


def select_delete(names: list[str], hourly: int, daily: int) -> list[str]:
    """Return the names to delete (oldest first). Names not matching SET_RE are ignored."""
    sets = sorted((n for n in names if SET_RE.match(n)), reverse=True)  # newest first
    if not sets:
        return []
    hourly = max(int(hourly), 1)  # never delete the newest set
    daily = max(int(daily), 0)
    keep = set(sets[:hourly])
    seen_days: list[str] = []
    for n in sets:  # newest first, so the first hit per day is that day's newest set
        day = n[:8]
        if day in seen_days:
            continue
        seen_days.append(day)
        if len(seen_days) <= daily:
            keep.add(n)
    return sorted(n for n in sets if n not in keep)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("sets_dir")
    ap.add_argument("--hourly", type=int, default=6)
    ap.add_argument("--daily", type=int, default=3)
    a = ap.parse_args(argv)
    d = Path(a.sets_dir)
    if not d.is_dir():
        return 0
    names = [p.name for p in d.iterdir() if p.is_dir() and not p.is_symlink()]
    for n in select_delete(names, a.hourly, a.daily):
        print(n)
    return 0


if __name__ == "__main__":
    sys.exit(main())

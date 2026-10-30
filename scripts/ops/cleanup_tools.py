#!/usr/bin/env python3
"""Pure selection logic for cleanup_2d.sh (no docker, no deletion).

  old-images --min-age-days N --prefix rxtest- [--now ISO] --in-use FILE  < "ID<TAB>repo:tag<TAB>CreatedAt" lines
      prints the image ids that are safe to remove with a plain `docker rmi` (never -f):
      repository starts with the prefix, tag is not "prev", older than N days, and the id/reference is not
      used by any container (running or stopped), listed one per line in FILE.
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timedelta, timezone

CREATED_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: ([+-]\d{4}))?")


def parse_created(text: str) -> datetime | None:
    m = CREATED_RE.match(text.strip())
    if not m:
        return None
    dt = datetime.strptime(f"{m[1]} {m[2]}", "%Y-%m-%d %H:%M:%S")
    off = m[3] or "+0000"
    delta = timedelta(hours=int(off[1:3]), minutes=int(off[3:5]))
    return (dt - delta if off[0] == "+" else dt + delta).replace(tzinfo=timezone.utc)


def select_old_images(lines, now: datetime, min_age_days: float, prefix: str, in_use: set[str]) -> list[str]:
    out, limit = [], timedelta(days=min_age_days)
    for line in lines:
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 3:
            continue
        iid, ref, created = parts[0], parts[1], parts[2]
        repo, _, tag = ref.rpartition(":")
        if not repo.split("/")[-1].startswith(prefix) or tag == "prev":
            continue
        if iid in in_use or ref in in_use or any(iid.startswith(u) or u.startswith(iid) for u in in_use if len(u) >= 12):
            continue
        ts = parse_created(created)
        if ts is None or now - ts <= limit:
            continue
        if iid not in out:
            out.append(iid)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    o = sub.add_parser("old-images")
    o.add_argument("--min-age-days", type=float, default=2)
    o.add_argument("--prefix", default="rxtest-")
    o.add_argument("--now")
    o.add_argument("--in-use", required=True)
    a = ap.parse_args(argv)
    now = datetime.fromisoformat(a.now.replace("Z", "+00:00")) if a.now else datetime.now(timezone.utc)
    with open(a.in_use) as fh:
        in_use = {x.strip() for x in fh if x.strip()}
    for iid in select_old_images(sys.stdin, now, a.min_age_days, a.prefix, in_use):
        print(iid)
    return 0


if __name__ == "__main__":
    sys.exit(main())

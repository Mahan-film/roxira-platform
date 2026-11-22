#!/usr/bin/env python3
"""Print the next free migration id: max(newest id on origin/main, every id in an open PR) + 1000.

stdout is only the 13-digit id, so a script can use it: id="$(python3 scripts/dev/next_migration_id.py)".
Warnings go to stderr. When GitHub cannot be asked, the id is computed from origin/main alone and a
WARNING says so (exit 0); with --require-open-prs (CI) that is an error (exit 1). Open PRs include
this branch's own PR, so a second call after you added a migration gives the id after yours.
Limits: the newest 200 open PRs, and gh lists at most 100 files per PR.

Usage: python3 scripts/dev/next_migration_id.py [--base origin/main] [--dir DIR] [--require-open-prs]
           [--repo DIR]
Exit 0 = printed an id, 1 = open PRs required but unavailable, 2 = usage/git error.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_migration_ids as cmi  # noqa: E402

STEP = 1000


def next_id(
    base: str, mig_dir: str, cwd: str | None = None, require_open_prs: bool = False
) -> tuple[str | None, str, str]:
    """(id or None, warning, source) where source says which ids were counted."""
    ids = set(cmi.base_ids(base, mig_dir, cwd))
    source = base
    warning = ""
    entries, why = cmi.open_pr_entries(cwd)
    if entries is None:
        warning = f"open PRs not checked ({why}); the id counts {base} only and may collide"
        if require_open_prs:
            return None, warning, source
    else:
        ids.update(mid for _n, mid, _p in entries)
        source = f"{base} and {len({n for n, _m, _p in entries})} open PR(s) with migrations"
    newest = max(ids) if ids else "0" * 13
    return str(int(newest) + STEP), warning, source


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--dir", default=cmi.MIGRATION_DIR)
    ap.add_argument("--require-open-prs", action="store_true",
                    help="fail instead of warning when open PRs cannot be listed "
                         "(default: on when GITHUB_ACTIONS=true)")
    ap.add_argument("--repo", default=None, help="repo directory (default: cwd)")
    a = ap.parse_args()
    require = a.require_open_prs or os.environ.get("GITHUB_ACTIONS") == "true"
    try:
        nid, warning, _source = next_id(a.base, a.dir, a.repo, require)
    except (RuntimeError, subprocess.SubprocessError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    if warning:
        print(f"WARNING: {warning}", file=sys.stderr)
    if nid is None:
        return 1
    print(nid)
    return 0


if __name__ == "__main__":
    sys.exit(main())

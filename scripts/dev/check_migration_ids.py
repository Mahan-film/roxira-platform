#!/usr/bin/env python3
"""Fail when a migration added on this branch has a bad id (T170). Stdlib only.

Migrations live in output_apps/enterprise_hub/migrations/<13-digit id>-<Name>.ts and the class is
named <Name><id> (true for every migration on main). Checks, for files ADDED since the merge base
with origin/main:
  1. the id is strictly greater than the newest id on origin/main;
  2. no two added files share an id (and none reuses an id already on origin/main);
  3. the class name and `name = '...'` end with the file id.
--open-prs (needs gh and network, skipped cleanly otherwise) also fails when an added id is used
by a migration file in another open PR.

Usage: python3 scripts/dev/check_migration_ids.py [--base origin/main] [--dir DIR] [--open-prs]
Exit 0 = ok, 1 = problem, 2 = usage/git error.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys

MIGRATION_DIR = "output_apps/enterprise_hub/migrations"
FILE_RE = re.compile(r"^(\d{13})-([A-Za-z0-9_]+)\.ts$")


def git(*args: str, cwd: str | None = None, check: bool = True) -> str:
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {p.stderr.strip()}")
    return p.stdout


def split(path: str) -> tuple[str, str] | None:
    m = FILE_RE.match(path.rsplit("/", 1)[-1])
    return (m.group(1), m.group(2)) if m else None


def added_files(base: str, mig_dir: str, cwd: str | None = None) -> list[str]:
    """Migration files added relative to the merge base (committed or staged/working tree)."""
    mb = git("merge-base", base, "HEAD", cwd=cwd).strip()
    out = git("diff", "--name-status", "--no-renames", "--diff-filter=A", mb, "--", mig_dir, cwd=cwd)
    files = [ln.split("\t", 1)[1] for ln in out.splitlines() if "\t" in ln]
    return sorted(f for f in files if split(f))


def base_ids(base: str, mig_dir: str, cwd: str | None = None) -> set[str]:
    out = git("ls-tree", "--name-only", base, mig_dir.rstrip("/") + "/", cwd=cwd)
    return {s[0] for s in map(split, out.splitlines()) if s}


def open_pr_ids(cwd: str | None, own_branch: str) -> tuple[dict[str, list[str]] | None, str]:
    """id -> ['PR #n (path)'] over other open PRs, or (None, reason) when it cannot be asked."""
    if not shutil.which("gh"):
        return None, "gh not installed"
    try:
        p = subprocess.run(
            ["gh", "pr", "list", "--state", "open", "--limit", "200",
             "--json", "number,headRefName,files"],
            cwd=cwd, capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.SubprocessError) as e:
        return None, f"gh failed: {e}"
    if p.returncode != 0:
        return None, "gh failed: " + (p.stderr.strip().splitlines() or ["?"])[-1]
    seen: dict[str, list[str]] = {}
    for pr in json.loads(p.stdout or "[]"):
        if pr.get("headRefName") == own_branch:
            continue
        for f in pr.get("files") or []:
            path = f.get("path", "")
            s = split(path)
            if s and path.startswith(MIGRATION_DIR + "/"):
                seen.setdefault(s[0], []).append(f"PR #{pr['number']} ({path})")
    return seen, ""


def check(base: str, mig_dir: str, open_prs: bool, cwd: str | None = None) -> list[str]:
    added = added_files(base, mig_dir, cwd)
    if not added:
        print("no migration files added; nothing to check")
        return []
    existing = base_ids(base, mig_dir, cwd)
    newest = max(existing) if existing else "0" * 13
    nxt = str(int(newest) + 1000)
    problems: list[str] = []
    by_id: dict[str, list[str]] = {}
    for f in added:
        by_id.setdefault(split(f)[0], []).append(f)  # type: ignore[index]
    for mid, files in sorted(by_id.items()):
        if len(files) > 1:
            problems.append(f"duplicate id {mid} in {', '.join(files)}: every migration needs its own id")
    for f in added:
        mid, name = split(f)  # type: ignore[misc]
        if mid <= newest:
            problems.append(
                f"{f}: id {mid} is not above the newest id on {base} ({newest}). "
                f"Rename the file, the class and `name` to use an id above it, e.g. {nxt}."
            )
        elif mid in existing:
            problems.append(f"{f}: id {mid} is already used on {base}")
        try:
            text = open(f"{cwd}/{f}" if cwd else f, encoding="utf-8").read()
        except OSError:
            continue
        cls = re.search(r"export\s+class\s+(\w+)", text)
        nm = re.search(r"\bname\s*=\s*['\"](\w+)['\"]", text)
        if cls and not cls.group(1).endswith(mid):
            problems.append(f"{f}: class {cls.group(1)} must end with the file id (use {name}{mid})")
        if nm and not nm.group(1).endswith(mid):
            problems.append(f"{f}: name = '{nm.group(1)}' must end with the file id {mid}")
    if open_prs:
        own = git("rev-parse", "--abbrev-ref", "HEAD", cwd=cwd, check=False).strip()
        theirs, why = open_pr_ids(cwd, own)
        if theirs is None:
            print(f"--open-prs skipped: {why}")
        else:
            for f in added:
                mid = split(f)[0]  # type: ignore[index]
                for other in theirs.get(mid, []):
                    problems.append(f"{f}: id {mid} is also used by {other}; one of the two must change")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--dir", default=MIGRATION_DIR)
    ap.add_argument("--open-prs", action="store_true")
    ap.add_argument("--repo", default=None, help="repo directory (default: cwd)")
    a = ap.parse_args()
    try:
        problems = check(a.base, a.dir, a.open_prs, a.repo)
    except (RuntimeError, subprocess.SubprocessError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    for p in problems:
        print(f"ERROR {p}")
    if problems:
        print(f"migration id check FAILED ({len(problems)} problem(s))")
        return 1
    print("migration id check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

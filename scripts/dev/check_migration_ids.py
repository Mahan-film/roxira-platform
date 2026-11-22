#!/usr/bin/env python3
"""Fail when a migration added on this branch has a bad id (T170). Stdlib only.

Migrations live in output_apps/enterprise_hub/migrations/<13-digit id>-<Name>.ts and the class is
named <Name><id> (true for every migration on main). Checks, for files ADDED since the merge base
with origin/main:
  1. the id is strictly greater than the newest id on origin/main;
  2. no two added files share an id (and none reuses an id already on origin/main);
  3. the class name and `name = '...'` end with the file id.
--open-prs (needs gh and network) also fails when an added id is used by a migration file in another
open PR, unless it is the same path with the same content (a stacked PR carrying its parent's file:
the blob SHA is compared, so two different files that share a name and an id still fail). The PR
being checked is left out by NUMBER (GITHUB_REF refs/pull/N/merge, a merge-queue ref
gh-readonly-queue/.../pr-N-<sha>, or --own-pr; locally `gh pr view` names it), never by branch name:
fork PRs reuse names such as patch-1. When GitHub cannot be asked, the open-PR check is skipped
with a WARNING on stderr, unless --require-open-prs is given (CI sets it): then that is a failure.
Lookup limits are failures, not silent: `gh pr list` returns at most --pr-limit PRs (reaching the
limit counts as "cannot be asked") and at most 100 files per PR (a PR with more files, or whose
changedFiles is above the listed files, is read again with `gh api --paginate`).
A PR checked now can still collide with a PR that appears later; the merge_group run re-checks
against the then-open PRs, so the gate job must be a required check (see ci.yml migration-gate).

Usage: python3 scripts/dev/check_migration_ids.py [--base origin/main] [--dir DIR]
           [--open-prs [--require-open-prs] [--own-pr N] [--pr-limit N]]
Exit 0 = ok, 1 = problem, 2 = usage/git error.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

MIGRATION_DIR = "output_apps/enterprise_hub/migrations"
FILE_RE = re.compile(r"^(\d{13})-([A-Za-z0-9_]+)\.ts$")
PR_LIMIT = 300  # `gh pr list` stops here; reaching it means some open PRs were not listed
FILES_CAP = 100  # `gh pr list --json files` returns at most this many files per PR
# One tab-separated line per migration file of a PR: path, blob sha (removed files are skipped).
API_FILES_JQ = (
    '.[] | select(.status != "removed") | select(.filename | startswith("'
    + MIGRATION_DIR + '/")) | [.filename, .sha] | @tsv'
)


def git(*args: str, cwd: str | None = None, check: bool = True) -> str:
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {p.stderr.strip()}")
    return p.stdout


def split(path: str) -> tuple[str, str] | None:
    m = FILE_RE.match(path.rsplit("/", 1)[-1])
    return (m.group(1), m.group(2)) if m else None


def added_files(base: str, mig_dir: str, cwd: str | None = None) -> list[str]:
    """Migration files added, renamed or copied relative to the merge base (committed or staged/working tree)."""
    mb = git("merge-base", base, "HEAD", cwd=cwd).strip()
    # A (added), R and C (renamed/copied: lanes renumber migrations this way). The destination
    # path is the last tab-separated column.
    out = git("diff", "--name-status", "-M", "-C", "--diff-filter=ARC", mb, "--", mig_dir, cwd=cwd)
    files = [ln.split("\t")[-1] for ln in out.splitlines() if "\t" in ln]
    return sorted(f for f in files if split(f))


def base_ids(base: str, mig_dir: str, cwd: str | None = None) -> set[str]:
    out = git("ls-tree", "--name-only", base, mig_dir.rstrip("/") + "/", cwd=cwd)
    return {s[0] for s in map(split, out.splitlines()) if s}


def run_gh(args: list[str], cwd: str | None) -> tuple[str | None, str]:
    """(stdout, "") or (None, reason). A missing gh, a timeout or a non-zero exit is a reason."""
    if not shutil.which("gh"):
        return None, "gh not installed"
    try:
        p = subprocess.run(["gh", *args], cwd=cwd, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        return None, f"gh failed: {e}"
    if p.returncode != 0:
        return None, "gh failed: " + (p.stderr.strip().splitlines() or ["?"])[-1]
    return p.stdout, ""


def pr_migration_files(cwd: str | None, number: int) -> tuple[dict[str, str] | None, str]:
    """path -> blob sha for every migration file of one PR, all pages, or (None, reason)."""
    out, why = run_gh(
        ["api", "--paginate", f"repos/{{owner}}/{{repo}}/pulls/{number}/files?per_page=100",
         "--jq", API_FILES_JQ], cwd)
    if out is None:
        return None, why
    files: dict[str, str] = {}
    for line in out.splitlines():
        path, _, sha = line.partition("\t")
        if split(path) and sha:
            files[path] = sha
    return files, ""


def open_pr_entries(
    cwd: str | None, own_pr: int | None = None, limit: int = PR_LIMIT
) -> tuple[list[tuple[int, str, str]] | None, str]:
    """(PR number, id, path) for every migration file in the open PRs, or (None, reason).

    PR number `own_pr` is left out. Reaching `limit` PRs, or any failed or unusable gh output,
    counts as "cannot be asked" so the caller can decide between a warning and a failure. A PR
    whose file list may be cut off (100 files, or changedFiles above what was listed) is read
    again, in full, with `gh api --paginate`.
    """
    out, why = run_gh(
        ["pr", "list", "--state", "open", "--limit", str(limit),
         "--json", "number,changedFiles,files"], cwd)
    if out is None:
        return None, why
    try:
        prs = json.loads(out or "[]")
        if len(prs) >= limit:
            return None, f"{len(prs)} open PRs reached the lookup limit ({limit}); some are not listed"
        entries: list[tuple[int, str, str]] = []
        for pr in prs:
            number = int(pr["number"])
            if own_pr is not None and number == own_pr:
                continue
            files = pr.get("files") or []
            changed = pr.get("changedFiles")
            if len(files) >= FILES_CAP or (isinstance(changed, int) and changed > len(files)):
                full, why = pr_migration_files(cwd, number)
                if full is None:
                    return None, f"PR #{number} has more files than gh lists and the full list failed: {why}"
                entries.extend((number, split(path)[0], path) for path in full)  # type: ignore[index]
                continue
            for f in files:
                path = f.get("path", "")
                s = split(path)
                if s and path.startswith(MIGRATION_DIR + "/"):
                    entries.append((number, s[0], path))
    except (ValueError, TypeError, KeyError, AttributeError) as e:
        return None, f"gh returned unusable output: {e}"
    return entries, ""


def open_pr_ids(
    cwd: str | None, own_pr: int | None, limit: int = PR_LIMIT
) -> tuple[dict[str, list[tuple[int, str]]] | None, str]:
    """id -> [(PR number, path)] over the other open PRs, or (None, reason) when it cannot be asked."""
    entries, why = open_pr_entries(cwd, own_pr, limit)
    if entries is None:
        return None, why
    seen: dict[str, list[tuple[int, str]]] = {}
    for number, mid, path in entries:
        seen.setdefault(mid, []).append((number, path))
    return seen, ""


def own_pr_number(env: dict[str, str] | None = None) -> int | None:
    """This run's PR number from GITHUB_REF: refs/pull/N/merge, or a merge-queue branch ref."""
    ref = (env if env is not None else os.environ).get("GITHUB_REF", "")
    m = re.fullmatch(r"refs/pull/(\d+)/(?:merge|head)", ref) or re.fullmatch(
        r"refs/heads/gh-readonly-queue/.+/pr-(\d+)-[0-9a-f]+", ref)
    return int(m.group(1)) if m else None


def local_pr_number(cwd: str | None = None) -> int | None:
    """Local run: the open PR of the current branch (gh resolves it, fork-aware), else None."""
    out, _why = run_gh(["pr", "view", "--json", "number", "--jq", ".number"], cwd)
    try:
        return int(out.strip()) if out else None
    except ValueError:
        return None


def local_sha(path: str, cwd: str | None = None) -> str | None:
    """Git blob sha of the file on disk (what `gh api .../files` calls `sha` for the other PR)."""
    p = subprocess.run(["git", "hash-object", "--", path], cwd=cwd, capture_output=True, text=True)
    return p.stdout.strip() or None if p.returncode == 0 else None


def check(
    base: str,
    mig_dir: str,
    open_prs: bool,
    cwd: str | None = None,
    require_open_prs: bool = False,
    own_pr: int | None = None,
    pr_limit: int = PR_LIMIT,
) -> list[str]:
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
                f"Rename the file, the class and `name` to use an id above it, e.g. {nxt}. "
                f"`python3 scripts/dev/next_migration_id.py` also counts the open PRs."
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
        if own_pr is None and os.environ.get("GITHUB_ACTIONS") != "true":
            own_pr = local_pr_number(cwd)
        theirs, why = open_pr_ids(cwd, own_pr, pr_limit)
        if theirs is None:
            if require_open_prs:
                problems.append(f"open-PR id check could not run ({why}); CI requires it")
            else:
                print(f"WARNING: --open-prs check skipped: {why}", file=sys.stderr)
        else:
            blobs: dict[int, dict[str, str] | None] = {}
            for f in added:
                mid = split(f)[0]  # type: ignore[index]
                for number, path in theirs.get(mid, []):
                    if path != f:
                        problems.append(
                            f"{f}: id {mid} is also used by PR #{number} ({path}); one of the two must change")
                        continue
                    # Same path: allowed only as a stacked PR carrying the identical file.
                    if number not in blobs:
                        blobs[number] = pr_migration_files(cwd, number)[0]
                    theirs_sha = (blobs[number] or {}).get(path)
                    mine = local_sha(f, cwd)
                    if theirs_sha is None or mine is None:
                        msg = f"{f}: cannot compare its content with PR #{number}"
                        if require_open_prs:
                            problems.append(msg + "; CI requires it")
                        else:
                            print(f"WARNING: {msg}", file=sys.stderr)
                    elif theirs_sha != mine:
                        problems.append(
                            f"{f}: PR #{number} has a file with the same name and id but different content; "
                            f"a stacked PR must carry the identical file, otherwise one of the two must change")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--dir", default=MIGRATION_DIR)
    ap.add_argument("--open-prs", action="store_true")
    ap.add_argument("--require-open-prs", action="store_true",
                    help="fail instead of warning when open PRs cannot be listed "
                         "(default: on when GITHUB_ACTIONS=true)")
    ap.add_argument("--own-pr", type=int, default=None,
                    help="number of this PR, left out of the lookup (default: from GITHUB_REF, "
                         "else `gh pr view` for the current branch)")
    ap.add_argument("--pr-limit", type=int, default=PR_LIMIT,
                    help="open PRs to list; reaching it counts as 'cannot be asked'")
    ap.add_argument("--repo", default=None, help="repo directory (default: cwd)")
    a = ap.parse_args()
    require = a.require_open_prs or os.environ.get("GITHUB_ACTIONS") == "true"
    try:
        own_pr = a.own_pr if a.own_pr is not None else own_pr_number()
        problems = check(a.base, a.dir, a.open_prs, a.repo, require, own_pr, a.pr_limit)
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

#!/usr/bin/env python3
"""Classify a PR on the autonomy ladder and print a merge verdict.

Usage: scripts/dev/merge_check.py <pr-number> [--repo OWNER/REPO]
Verdicts: AUTO_MERGE_OK (exit 0), OWNER_REVIEW(Ln) (exit 10), BLOCK(reasons) (exit 20).
Data comes from the ``gh`` CLI via an injectable runner; no shell, no tokens printed.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[2] / "config" / "autonomy_ladder.json"
EXIT = {"AUTO_MERGE_OK": 0, "OWNER_REVIEW": 10, "BLOCK": 20}
_TOKEN = re.compile(r"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})")

Runner = Callable[[list[str]], str]


def gh_run(args: list[str]) -> str:
    """Run ``gh`` (argv list, no shell) and return stdout."""
    proc = subprocess.run(["gh", *args], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(_TOKEN.sub("***", proc.stderr.strip())[:300])
    return proc.stdout


def load_config(path: Path = CONFIG) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _match(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, p) for p in patterns)


def file_level(path: str, cfg: dict) -> int:
    for lvl in (4, 3, 2):
        if _match(path, cfg["levels"][f"L{lvl}"]):
            return lvl
    if Path(path).name in cfg["manifest_names"]:
        return 3
    if _match(path, cfg["docs_patterns"]) and path.endswith((".md", ".txt")):
        return 0
    return 1


def split_diff(diff: str) -> dict[str, dict]:
    """Per-file info from a unified diff: added/removed lines, deleted/new flags."""
    files: dict[str, dict] = {}
    cur: dict | None = None
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            m = re.match(r"diff --git a/(.*) b/(.*)$", line)
            name = m.group(2) if m else line
            cur = {"added": [], "removed": [], "deleted": False, "new": False}
            files[name] = cur
        elif cur is None:
            continue
        elif line.startswith("deleted file mode"):
            cur["deleted"] = True
        elif line.startswith("new file mode"):
            cur["new"] = True
        elif line.startswith("+") and not line.startswith("+++"):
            cur["added"].append(line[1:])
        elif line.startswith("-") and not line.startswith("---"):
            cur["removed"].append(line[1:])
    return files


def tamper_signals(path: str, d: dict, cfg: dict) -> list[str]:
    """Test-tampering signals in a (non-deleted) test file; each needs owner review."""
    out: list[str] = []
    tamper = [re.compile(x) for x in cfg.get("test_tamper_regexes", [])]
    for line in d["added"]:
        hit = next((rx.pattern for rx in tamper if rx.search(line)), None)
        if hit:
            out.append(f"test tampering signal in {path}: added line matches {hit!r}")
    assert_re = re.compile(r"\bassert\s")
    n_add = sum(bool(assert_re.search(x)) for x in d["added"])
    n_rem = sum(bool(assert_re.search(x)) for x in d["removed"])
    slack = cfg.get("max_assert_net_removal", 2)
    if n_rem - n_add > slack:
        out.append(f"assertions removed in {path}: -{n_rem} / +{n_add} (net > {slack})")
    return out


def evaluate(pr: dict, diff: str, cfg: dict) -> tuple[str, str, list[str]]:
    """Return (verdict, level_label, reasons). Pure; no I/O."""
    info = split_diff(diff)
    paths = sorted(set(info) | {f["path"] for f in pr.get("files", [])})
    labels = {lb["name"] if isinstance(lb, dict) else lb for lb in pr.get("labels", [])}
    level = max((file_level(p, cfg) for p in paths), default=0)
    block: list[str] = []
    review: list[str] = []
    test_re = re.compile(cfg["test_function_regex"])
    empty = {"added": [], "removed": [], "deleted": False, "new": False}

    if labels & set(cfg["reviewer_fail_labels"]):
        block.append("reviewer verdict is fail")
    code_changed = False
    new_test = False
    for p in paths:
        d = info.get(p, empty)
        if _match(p, cfg["test_patterns"]):
            if d["deleted"]:
                block.append(f"test file deleted: {p}")
            else:
                if len(d["removed"]) > len(d["added"]):
                    block.append(f"test file reduced: {p}")
                n_add = sum(bool(test_re.search(x)) for x in d["added"])
                n_rem = sum(bool(test_re.search(x)) for x in d["removed"])
                if n_rem > n_add:
                    block.append(f"net deletion of test functions: {p}")
                review.extend(tamper_signals(p, d, cfg))
                if d["new"] or n_add > n_rem:
                    new_test = True
        elif _match(p, cfg["code_patterns"]) and file_level(p, cfg) >= 1:
            code_changed = True
        if Path(p).name in cfg["manifest_names"]:
            review.append(f"dependency manifest/lockfile changed: {p}")
    if code_changed and not new_test:
        review.append("code changed without a new or extended test")
    total = pr.get("additions", 0) + pr.get("deletions", 0)
    if not total:
        total = sum(len(d["added"]) + len(d["removed"]) for d in info.values())
    if total > cfg["max_changed_lines_auto"]:
        review.append(f"{total} changed lines > {cfg['max_changed_lines_auto']}")
    if level == 2 and cfg["hub_approved_label"] not in labels:
        review.append(f"L2 path needs label {cfg['hub_approved_label']}")
    if level >= 3:
        review.append(f"L{level} path needs owner reading")

    label = f"L{level}"
    if block:
        return "BLOCK", label, block
    if review or level >= 3:
        return "OWNER_REVIEW", label, review
    return "AUTO_MERGE_OK", label, []


def fetch(pr_number: int, repo: str | None, gh: Runner) -> tuple[dict, str]:
    scope = ["--repo", repo] if repo else []
    fields = "number,state,isDraft,headRefOid,labels,files,additions,deletions"
    pr = json.loads(gh(["pr", "view", str(pr_number), *scope, "--json", fields]))
    diff = gh(["pr", "diff", str(pr_number), *scope])
    return pr, diff


def check(
    pr_number: int,
    gh: Runner = gh_run,
    repo: str | None = None,
    cfg: dict | None = None,
) -> tuple[str, int, dict]:
    cfg = cfg or load_config()
    pr, diff = fetch(pr_number, repo, gh)
    if pr.get("state", "OPEN") != "OPEN" or pr.get("isDraft"):
        return "BLOCK(PR is not open or is a draft)", 20, pr
    verdict, level, reasons = evaluate(pr, diff, cfg)
    if verdict == "AUTO_MERGE_OK":
        text = f"AUTO_MERGE_OK ({level})"
    elif verdict == "OWNER_REVIEW":
        text = f"OWNER_REVIEW({level}): " + "; ".join(reasons)
    else:
        text = "BLOCK(" + "; ".join(reasons) + ")"
    return text, EXIT[verdict], pr


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pr", type=int)
    ap.add_argument("--repo")
    args = ap.parse_args(argv)
    try:
        text, code, pr = check(args.pr, repo=args.repo)
    except (RuntimeError, ValueError, OSError) as exc:
        print(f"BLOCK(could not fetch PR data: {exc})")
        return 20
    print(text)
    print(f"head_sha={pr.get('headRefOid', '')}")
    return code


if __name__ == "__main__":
    sys.exit(main())

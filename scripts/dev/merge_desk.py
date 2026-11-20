#!/usr/bin/env python3
"""Merge desk for private Free repos (replaces GitHub auto-merge & merge queue).

Runs on the CI box (or Mac) every 10 minutes via systemd timer:
  - Lists open non-draft PRs.
  - Never merges PRs labelled `needs-human` or `[needs owner]` (or titled `[needs owner]`).
  - Requires latest review-desk comment on the current head SHA to have `Verdict: no blocker`.
  - Requires at least one status check and all checks green (SUCCESS / NEUTRAL / SKIPPED).
  - If behind main (`mergeStateStatus == "BEHIND"`), rebases via `gh pr update-branch --rebase`
    (unless `--no-rebase`) and skips merging this cycle so CI re-runs on the new head.
  - Merges at most ONE PR per invocation via `gh pr merge <N> --squash`.
  - Sends a single Telegram line per merge when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

BLOCKED_LABELS = {"needs-human", "[needs owner]", "needs-owner"}
GREEN_CONCLUSIONS = {"SUCCESS", "NEUTRAL", "SKIPPED"}
PR_JSON_FIELDS = (
    "number,title,isDraft,headRefOid,headRefName,baseRefName,"
    "mergeable,mergeStateStatus,labels,statusCheckRollup,comments"
)


@dataclass
class Decision:
    number: int
    action: str  # "merge" | "rebase" | "skip"
    reason: str


def _has_blocked_label_or_title(pr: dict[str, Any]) -> bool:
    title = (pr.get("title") or "").lower()
    if "[needs owner]" in title:
        return True
    for lbl in pr.get("labels") or []:
        name = (lbl.get("name") or "").strip().lower()
        if name in BLOCKED_LABELS:
            return True
    return False


def latest_head_verdict(comments: list[dict[str, Any]], head_oid: str) -> str:
    """Return 'no blocker', 'blocker', 'stale', or 'none' for the current head."""
    short = (head_oid or "")[:7]
    if not short:
        return "none"
    verdict_comments: list[tuple[bool, str]] = []
    for c in comments or []:
        body = c.get("body") or ""
        verdict: str | None = None
        for line in body.splitlines():
            m = re.match(r"^\s*\*{0,2}Verdict:\*{0,2}\s*(.+?)\s*$", line, re.IGNORECASE)
            if m:
                val = m.group(1).strip().lower()
                if val.startswith("no blocker"):
                    verdict = "no blocker"
                elif val.startswith("blocker"):
                    verdict = "blocker"
        if verdict is not None:
            verdict_comments.append((short in body, verdict))
    if not verdict_comments:
        return "none"
    for matches_head, verdict in reversed(verdict_comments):
        if matches_head:
            return verdict
    return "stale"


def checks_are_green(rollup: list[dict[str, Any]] | None) -> tuple[bool, str]:
    """Return (ok, reason) for statusCheckRollup entries."""
    if not rollup:
        return False, "no status checks reported"
    for item in rollup:
        typename = item.get("__typename", "")
        name = item.get("name") or item.get("context") or "unknown"
        if typename == "StatusContext":
            state = (item.get("state") or "").upper()
            if state != "SUCCESS":
                return False, f"status '{name}' is {state or 'UNKNOWN'}"
        else:
            status = (item.get("status") or "").upper()
            conclusion = (item.get("conclusion") or "").upper()
            if status and status != "COMPLETED":
                return False, f"check '{name}' is {status}"
            if conclusion not in GREEN_CONCLUSIONS:
                return False, f"check '{name}' conclusion is {conclusion or 'NONE'}"
    return True, "all checks green"


def evaluate_pr(pr: dict[str, Any], *, allow_rebase: bool = True) -> Decision:
    num = int(pr["number"])
    if pr.get("isDraft"):
        return Decision(num, "skip", "draft PR")
    if _has_blocked_label_or_title(pr):
        return Decision(num, "skip", "labelled needs-human or [needs owner]")
    mergeable = (pr.get("mergeable") or "").upper()
    if mergeable == "CONFLICTING":
        return Decision(num, "skip", "mergeable=CONFLICTING")
    verdict = latest_head_verdict(pr.get("comments") or [], pr.get("headRefOid") or "")
    if verdict != "no blocker":
        return Decision(num, "skip", f"review verdict={verdict}")
    ok, check_reason = checks_are_green(pr.get("statusCheckRollup"))
    if not ok:
        return Decision(num, "skip", check_reason)
    state = (pr.get("mergeStateStatus") or "").upper()
    if state == "BEHIND":
        if allow_rebase:
            return Decision(num, "rebase", "behind base branch; rebase and re-run CI")
        return Decision(num, "skip", "behind base branch (--no-rebase)")
    if mergeable != "MERGEABLE":
        return Decision(num, "skip", f"mergeable={mergeable or 'UNKNOWN'}")
    return Decision(num, "merge", "review no blocker + checks green + MERGEABLE")


def send_telegram(text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return 200 <= resp.status < 300
    except Exception:
        # Never print token or full URL on error.
        print("[merge-desk] warning: Telegram notification failed", file=sys.stderr)
        return False


def _run_gh(args: list[str], repo: str | None = None) -> subprocess.CompletedProcess[str]:
    cmd = ["gh", *args]
    if repo:
        cmd.extend(["-R", repo])
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def run_once(
    *,
    repo: str | None = None,
    dry_run: bool = False,
    allow_rebase: bool = True,
    runner: Callable[[list[str], str | None], subprocess.CompletedProcess[str]] = _run_gh,
    notifier: Callable[[str], bool] = send_telegram,
) -> int:
    res = runner(["pr", "list", "--state", "open", "--limit", "50", "--json", PR_JSON_FIELDS], repo)
    if res.returncode != 0:
        print(f"[merge-desk] gh pr list failed: {res.stderr.strip()}", file=sys.stderr)
        return 1
    prs: list[dict[str, Any]] = json.loads(res.stdout or "[]")
    # Oldest PR first so queues drain in FIFO order.
    prs.sort(key=lambda p: int(p["number"]))

    for pr in prs:
        dec = evaluate_pr(pr, allow_rebase=allow_rebase)
        print(f"[merge-desk] PR #{dec.number}: {dec.action} ({dec.reason})")
        if dec.action == "skip":
            continue
        if dec.action == "rebase":
            if dry_run:
                print(f"[merge-desk] DRY-RUN: would run `gh pr update-branch {dec.number} --rebase`")
                continue
            upd = runner(["pr", "update-branch", str(dec.number), "--rebase"], repo)
            if upd.returncode != 0:
                print(
                    f"[merge-desk] PR #{dec.number} rebase failed: {upd.stderr.strip()}",
                    file=sys.stderr,
                )
            # Wait for CI to re-run on the updated head; move on to next PR or finish.
            continue
        if dec.action == "merge":
            title = (pr.get("title") or "").strip()
            short_sha = (pr.get("headRefOid") or "")[:8]
            if dry_run:
                print(f"[merge-desk] DRY-RUN: would merge PR #{dec.number} ({short_sha}) {title}")
                return 0
            m = runner(["pr", "merge", str(dec.number), "--squash"], repo)
            if m.returncode != 0:
                print(
                    f"[merge-desk] PR #{dec.number} merge failed: {m.stderr.strip()}",
                    file=sys.stderr,
                )
                return 1
            msg = f"Merged PR #{dec.number} ({short_sha}): {title}"
            print(f"[merge-desk] {msg}")
            notifier(msg)
            # One PR at a time.
            return 0

    print("[merge-desk] no eligible PRs to merge")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Merge desk: merge at most one ready PR per run.")
    parser.add_argument("--repo", default=None, help="GitHub repo (owner/name); defaults to cwd repo.")
    parser.add_argument("--dry-run", action="store_true", help="Evaluate and print without merging or rebasing.")
    parser.add_argument("--no-rebase", action="store_true", help="Skip behind-main PRs instead of rebasing them.")
    args = parser.parse_args(argv)
    return run_once(repo=args.repo, dry_run=args.dry_run, allow_rebase=not args.no_rebase)


if __name__ == "__main__":
    raise SystemExit(main())

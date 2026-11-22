#!/usr/bin/env python3
"""The only documented way for a hub to merge a PR (issue #1282, T333).

    python3 scripts/dev/hub_merge.py <pr>                     # dry run (default): list refusals
    python3 scripts/dev/hub_merge.py <pr> --apply             # squash-merge, head SHA guard
    python3 scripts/dev/hub_merge.py <pr> --apply --owner-sentence "go: merge #123 (migration)"
    python3 scripts/dev/hub_merge.py --disarm-held [--apply]  # disable auto-merge on held PRs

Why it exists: four to six PRs were merged while a blocker verdict newer than the head commit
existed (#1074 #1175 #1197 #1199; #1197 reached production). The box gate
(scripts/ops/ci_box/merge_gate) and the review desk look only at the LATEST desk comment, which is
the same hole. This tool reads every comment.

It refuses, and prints every reason it finds, when:
  closed     the PR is not open, or its base is not main, or it has merge conflicts
  draft      the PR is a draft
  hold       label needs-human / do-not-merge, or `[needs owner]` in the title
  held       the PR number is in the Held list of docs/STATE.md on main (read through the API,
             lesson 36); a missing Held list also refuses (fail closed)
  blocker    ANY issue comment or PR review body, from anyone, created or edited at or after the
             head COMMIT date, has a line `Verdict: blocker` (desk or hub re-review). A later
             "no blocker" does not clear it: push a new commit, or merge by hand on the owner's
             sentence in chat
  desk       no `Cross-family review ... @ <40-hex head sha>` comment by the review-desk login
             whose last verdict line is `no blocker` (the latest one for THIS head decides)
  checks     any check-run at the head (every job, not only required ones; latest run per name)
             failed, was cancelled or is pending, or there are no check-runs at all
  protected  a protected path is touched (migrations, auth, payment/billing, Dockerfile.prod,
             deploy scripts, workflows, production compose, nginx) and --owner-sentence is missing

The owner sentence is posted on the PR (only with --apply), then the PR is squash-merged with
`sha=<head>`, so a push after the evaluation makes GitHub refuse. It never enables auto-merge and
never uses an admin merge. Dry run is the default: nothing is written unless --apply.
Exit codes: 0 ok, 1 refused, 2 error.

Rule code is reused from scripts/ops/ci_box/merge_gate/merge_gate.py (glob matching, desk header
and verdict regexes, the GhApi wrapper, default holds and protected globs). Python stdlib only;
talks to GitHub through `gh`. Tests: scripts/dev/tests/test_hub_merge.py (offline, recorded
fixtures).
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

_MG_PATH = Path(__file__).resolve().parents[1] / "ops" / "ci_box" / "merge_gate" / "merge_gate.py"
_spec = importlib.util.spec_from_file_location("merge_gate", _MG_PATH)
mg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mg)

GhError = mg.GhError
GREEN = mg.GREEN
REPO = mg.DEFAULTS["repo"]
BASE = mg.DEFAULTS["base"]
DESK_AUTHORS = list(mg.DEFAULTS["review_comment_authors"])
HOLD_LABELS = list(mg.DEFAULTS["block_labels"])
HOLD_TITLE_MARKERS = list(mg.DEFAULTS["block_title_markers"])

# The box gate's list plus the hub-only paths of AGENTS.md 4a (auth, payment, billing,
# Dockerfile.prod,
# nginx). Over-matching only costs an owner sentence; under-matching ships to production (main
# autodeploys).
PROTECTED_GLOBS = [
    *mg.DEFAULTS["protected_globs"],
    "**/auth/**",
    "**/*auth*.ts",
    "**/*auth*.py",
    "**/payment/**",
    "**/payments/**",
    "**/*payment*.ts",
    "**/*payment*.py",
    "**/billing/**",
    "**/*billing*",
    "**/Dockerfile.prod",
    "scripts/ops/deploy*",
    "scripts/ops/deploy*/**",
    "**/deploy*.sh",
    "docker-compose.prod*.yml",
    "docker-compose*.prod.yml",
    "nginx/**",
    "**/nginx/**",
    "**/*nginx*.conf",
]

STATE_PATH = "docs/STATE.md"
MIN_SENTENCE = 10
_HELD_NUM_RE = re.compile(r"(?<!row )#(\d+)")


# ---- pure helpers (unit-tested) ------------------------------------------------------------------
def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def verdicts(body: str) -> list[str]:
    """All verdict values ("blocker" / "no blocker") of a body, one per `Verdict: ...` line, in
    order."""
    out = []
    for line in (body or "").splitlines():
        m = mg.VERDICT_RE.match(line)
        if m:
            out.append(m.group(1).lower())
    return out


def blockers_newer_than(items: list[dict], head_date: str) -> list[dict]:
    """Items (issue comments, review bodies) at or after head_date that carry a blocker verdict
    line.

    Each item needs: id, author, body, times (list of ISO timestamps: created / edited / submitted).
    "Newer" is the latest of the item's timestamps >= the head COMMIT date, so an old comment
    edited into
    a blocker after the push counts. Ties count as newer. An item without a parseable time counts
    as newer.
    """
    cutoff = parse_ts(head_date)
    hits = []
    for it in items:
        if "blocker" not in verdicts(it.get("body", "")):
            continue
        try:
            newer = max(parse_ts(t) for t in it["times"] if t) >= cutoff
        except (ValueError, KeyError):
            newer = True
        if newer:
            hits.append(it)
    return hits


def desk_status(comments: list[dict], head: str, authors: list[str]) -> tuple[bool, str]:
    """(clean, why). The latest desk comment that names EXACTLY this head decides; its last verdict
    must be
    `no blocker`. Desk comments for other heads are ignored here (the blocker scan still sees
    them)."""
    head = head.lower()
    named = []
    for c in comments:
        body = (c.get("body") or "").lstrip()
        if not body.startswith("Cross-family review"):
            continue
        if (c.get("user") or {}).get("login") not in authors:
            continue
        m = mg.REVIEW_HEADER_RE.match(body.splitlines()[0])
        if m and m.group("sha").lower() == head:
            named.append(c)
    if not named:
        return False, f"no review-desk comment names the exact head {head}"
    named.sort(key=lambda c: (parse_ts(c["created_at"]), c.get("id", 0)))
    vs = verdicts(named[-1]["body"])
    if not vs:
        return False, f"latest desk comment for head {head[:7]} has no Verdict line"
    if vs[-1] != "no blocker":
        return False, f"latest desk comment for head {head[:7]} says Verdict: {vs[-1]}"
    return True, "desk: no blocker at the exact head"


def checks_problems(runs: list[dict]) -> tuple[list[str], list[str]]:
    """(failed, pending) over ALL check-runs at the head (job level), latest run per name by id."""
    latest: dict[str, dict] = {}
    for r in runs:
        name = r.get("name")
        if name and (name not in latest or r.get("id", 0) > latest[name].get("id", 0)):
            latest[name] = r
    failed, pending = [], []
    for name, r in sorted(latest.items()):
        if r.get("status") != "completed":
            pending.append(f"{name} ({r.get('status')})")
        elif r.get("conclusion") not in GREEN:
            failed.append(f"{name} ({r.get('conclusion')})")
    return failed, pending


def held_numbers(state_text: str) -> set[int] | None:
    """PR/issue numbers in the `- Held ...` bullet of STATE.md; None when there is no such bullet.

    Only the first sentence of the bullet counts (the same bullet continues with "Box hub PRs: ..."
    which
    are not held). A number written as `row #N` is an issue row, not a PR, and is skipped.
    """
    lines = state_text.splitlines()
    for i, line in enumerate(lines):
        if re.match(r"^\s*-\s+Held\b", line, re.IGNORECASE):
            block = [line]
            for nxt in lines[i + 1 :]:
                if nxt.startswith((" ", "\t")) and nxt.strip():
                    block.append(nxt.strip())
                else:
                    break
            text = " ".join(block)
            first = re.split(r"\.\s+(?=[A-Z])", text, maxsplit=1)[0]
            return {int(x) for x in _HELD_NUM_RE.findall(first)}
    return None


def hold_reasons(pr: dict, held: set[int] | None) -> list[tuple[str, str]]:
    out = []
    labels = {lb["name"] for lb in pr.get("labels", [])}
    hit = sorted(labels & set(HOLD_LABELS))
    if hit:
        out.append(("hold", "label " + ", ".join(hit)))
    title = (pr.get("title") or "").lower()
    for marker in HOLD_TITLE_MARKERS:
        if marker.lower() in title:
            out.append(("hold", f"title contains {marker}"))
    if held is None:
        out.append(
            (
                "held",
                f"no Held list found in {STATE_PATH} on {BASE} (cannot prove the PR is not held)",
            )
        )
    elif pr["number"] in held:
        out.append(("held", f"#{pr['number']} is in the Held list of {STATE_PATH}"))
    return out


# ---- GitHub access -------------------------------------------------------------------------------
def gh_cli(args: list[str]) -> str:
    """Run `gh <args>` (argv list, no shell); used only for disarming auto-merge (GraphQL under the
    hood)."""
    proc = subprocess.run(["gh", *args], capture_output=True, text=True, check=False, timeout=90)
    if proc.returncode != 0:
        raise GhError((proc.stderr or proc.stdout).strip()[:300])
    return proc.stdout


class Hub:
    def __init__(
        self, api, repo: str = REPO, runner=gh_cli, state_text: str | None = None, desk_authors=None
    ):
        self.api, self.repo, self.runner = api, repo, runner
        self._state_text = state_text
        self.desk_authors = desk_authors or DESK_AUTHORS

    def p(self, suffix: str) -> str:
        return f"repos/{self.repo}/{suffix}"

    def held(self) -> set[int] | None:
        text = self._state_text
        if text is None:
            doc = self.api("GET", self.p(f"contents/{STATE_PATH}?ref={BASE}"))
            text = base64.b64decode(doc["content"]).decode("utf-8", "replace")
        return held_numbers(text)

    def evaluate(self, n: int) -> dict:
        """Read-only. Returns {pr, head, reasons: [(code, text)], protected: [paths]}."""
        pr = self.api("GET", self.p(f"pulls/{n}"))
        head = pr["head"]["sha"]
        reasons: list[tuple[str, str]] = []
        if pr.get("state") != "open":
            reasons.append(("closed", f"PR is {pr.get('state')}, not open"))
        if pr.get("draft"):
            reasons.append(("draft", "PR is a draft"))
        if pr["base"]["ref"] != BASE:
            reasons.append(("closed", f"base branch is {pr['base']['ref']}, not {BASE}"))
        if pr.get("mergeable_state") == "dirty":
            reasons.append(("closed", "merge conflicts with the base branch"))
        reasons += hold_reasons(pr, self.held())

        head_date = self.api("GET", self.p(f"commits/{head}"))["commit"]["committer"]["date"]
        comments = self.api("GET", self.p(f"issues/{n}/comments?per_page=100"), paginate=True)
        reviews = self.api("GET", self.p(f"pulls/{n}/reviews?per_page=100"), paginate=True)
        items = [
            {
                "id": c["id"],
                "author": (c.get("user") or {}).get("login"),
                "body": c.get("body") or "",
                "times": [c.get("created_at"), c.get("updated_at")],
                "kind": "comment",
            }
            for c in comments
        ] + [
            {
                "id": r["id"],
                "author": (r.get("user") or {}).get("login"),
                "body": r.get("body") or "",
                "times": [r.get("submitted_at")],
                "kind": "review",
            }
            for r in reviews
        ]
        for it in blockers_newer_than(items, head_date):
            reasons.append(
                (
                    "blocker",
                    f"{it['kind']} {it['id']} by {it['author']} says Verdict: blocker and is not "
                    f"older than the head commit ({head_date}); a later no-blocker does not "
                    "clear it",
                )
            )
        clean, why = desk_status(comments, head, self.desk_authors)
        if not clean:
            reasons.append(("desk", why))

        pages = self.api("GET", self.p(f"commits/{head}/check-runs?per_page=100"), paginate=True)
        runs: list[dict] = []
        for item in pages:
            if isinstance(item, dict):
                runs.extend(item.get("check_runs", [item]))
        if not runs:
            reasons.append(("checks", f"no check-runs at head {head[:7]}"))
        failed, pending = checks_problems(runs)
        if failed:
            reasons.append(("checks", "failed check-runs: " + ", ".join(failed)))
        if pending:
            reasons.append(("checks", "pending check-runs: " + ", ".join(pending)))

        files = self.api("GET", self.p(f"pulls/{n}/files?per_page=100"), paginate=True)
        prot = mg.protected_hits(files, PROTECTED_GLOBS)
        return {"pr": pr, "head": head, "reasons": reasons, "protected": prot}

    def apply(self, res: dict, sentence: str | None) -> str:
        """Post the owner sentence (if protected paths) and squash-merge at the head SHA. Raises
        GhError."""
        n, head = res["pr"]["number"], res["head"]
        if res["protected"]:
            body = (
                "Owner approval for protected paths, relayed by hub_merge.py "
                f'at head {head[:7]}: "{sentence}"'
            )
            self.api("POST", self.p(f"issues/{n}/comments"), {"body": body})
        out = self.api("PUT", self.p(f"pulls/{n}/merge"), {"sha": head, "merge_method": "squash"})
        return str((out or {}).get("sha", ""))[:7]

    def held_armed(self, only: int | None = None) -> list[dict]:
        """Open PRs that are held (list, label or title) and have auto-merge armed."""
        held = self.held()
        if held is None:
            raise GhError(f"no Held list found in {STATE_PATH}; refusing to guess")
        prs = self.api("GET", self.p("pulls?state=open&per_page=100"), paginate=True)
        out = []
        for pr in prs:
            if only is not None and pr["number"] != only:
                continue
            if pr.get("auto_merge") and hold_reasons(pr, held):
                out.append(pr)
        return out

    def disarm(self, pr: dict) -> None:
        self.runner(["pr", "merge", str(pr["number"]), "-R", self.repo, "--disable-auto"])


def check_sentence(s: str | None) -> str | None:
    if s is None:
        return None
    s = s.strip()
    if "\n" in s or "\r" in s:
        raise ValueError("--owner-sentence must be a single line")
    if len(s) < MIN_SENTENCE:
        raise ValueError(f"--owner-sentence is too short (min {MIN_SENTENCE} characters)")
    return s


def main(
    argv: list[str] | None = None, api=None, runner=gh_cli, state_text: str | None = None
) -> int:
    ap = argparse.ArgumentParser(description="Hub merge guard (dry run unless --apply)")
    ap.add_argument("pr", nargs="?", type=int, help="PR number")
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--apply", action="store_true", help="really merge / disarm (default: dry run)")
    ap.add_argument(
        "--owner-sentence", help="the owner's sentence from chat, required for protected paths"
    )
    ap.add_argument("--disarm-held", action="store_true", help="disable auto-merge on held PRs")
    args = ap.parse_args(argv)
    hub = Hub(api or mg.GhApi(), args.repo, runner, state_text)
    try:
        if args.disarm_held:
            armed = hub.held_armed(args.pr)
            for pr in armed:
                if args.apply:
                    hub.disarm(pr)
                print(
                    f"{'disarmed' if args.apply else 'DRY RUN: would disarm'} "
                    f"auto-merge on held #{pr['number']}"
                )
            if not armed:
                print("no held PR has auto-merge armed")
            return 0
        if args.pr is None:
            ap.error("a PR number is required (or --disarm-held)")
        sentence = check_sentence(args.owner_sentence)
        res = hub.evaluate(args.pr)
        reasons = list(res["reasons"])
        if res["protected"] and not sentence:
            shown = ", ".join(res["protected"][:5])
            reasons.append(
                ("protected", f"touches protected paths ({shown}) and --owner-sentence is missing")
            )
        n, head = args.pr, res["head"]
        if reasons:
            print(f"REFUSE #{n} at head {head[:7]}:")
            for code, text in reasons:
                print(f"  [{code}] {text}")
            if res["pr"].get("auto_merge"):
                print(
                    "  note: auto-merge is armed on this PR; "
                    "run with --disarm-held --apply to switch it off"
                )
            return 1
        if not args.apply:
            print(
                f"DRY RUN: #{n} at head {head[:7]} passes every rule; "
                "would squash-merge (add --apply)"
            )
            return 0
        sha = hub.apply(res, sentence)
        print(f"merged #{n} (squash) at head {head[:7]}, commit {sha}")
        return 0
    except (GhError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

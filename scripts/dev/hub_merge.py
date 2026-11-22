#!/usr/bin/env python3
"""The only documented way for a hub to merge a PR (issue #1282, T333).

    python3 scripts/dev/hub_merge.py <pr>                     # dry run (default): list refusals
    python3 scripts/dev/hub_merge.py <pr> --apply             # ENQUEUE (merge queue), head guard
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
             push cutoff (the earlier of the head COMMIT date and the first check-run at the head),
             or citing the head SHA at any time, has a verdict line that says blocker in any
             prefixed form (`- Verdict: blocker`, `## Verdict: blocker`, `Hub verdict: blocker`,
             `Verdict - blocker`, ...; anything not negated by no/not/non fails closed). A later
             "no blocker" does not clear it: push a new commit, or merge by hand on the owner's
             sentence in chat. Also: a CHANGES_REQUESTED review at or after the cutoff or on the
             head
  human      the latest `BLOCKER:` / `UNBLOCK:` comment from a trusted human decides (a `BLOCKER:`
             from anyone not marked as an outsider counts; an `UNBLOCK:` only from an owner,
             member or collaborator), at any time
  desk       no `Cross-family review ... @ <40-hex head sha>` comment by the review-desk login
             whose last verdict line is `no blocker` (the latest one for THIS head decides)
  checks     any check-run at the head (every job, not only required ones; latest run per suite
             and name) failed, was cancelled or is pending; any required check name of the box gate
             is missing; a legacy commit status at the head is failing or pending; or there are no
             check-runs at all
  protected  a protected path is touched (migrations, auth, payment/billing, Dockerfile.prod,
             deploy scripts, workflows, production compose, nginx) and --owner-sentence is missing

main is protected by a merge queue (ruleset type merge_queue, method SQUASH). --apply therefore
never merges: it ENQUEUES. The owner sentence is posted on the PR (only with --apply), the head SHA
is read again from GitHub immediately before the call (a moved head refuses), and the GraphQL
`enqueuePullRequest` mutation is sent with `expectedHeadOid=<head>` so a push in between makes
GitHub refuse. The queue then runs the merge-group CI and squashes. There is no `PUT /pulls/N/merge`
call anywhere (it would bypass the queue and its CI), no auto-merge arming and no admin merge. A PR
that is already in the queue is reported as such and exits 0. Output says "enqueued", never
"merged". Dry run is the default: nothing is written unless --apply.
Exit codes: 0 ok (enqueued, or already in the queue), 1 refused, 2 error.

Rule code is reused from scripts/ops/ci_box/merge_gate/merge_gate.py (glob matching, desk header
and verdict regexes, the GhApi wrapper, default holds and protected globs). Python stdlib only;
talks to GitHub through `gh`. Tests: scripts/dev/tests/test_hub_merge.py (offline, recorded
fixtures).
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
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
    "**/docker-compose*prod*.yml",
    "nginx/**",
    "**/nginx/**",
    "**/nginx*/**",
    "**/*nginx*.conf",
    "**/*htpasswd*",
    # Everything that ships to a server or runs the gate: systemd/launchd units, Actions
    # (workflows, local actions, CODEOWNERS), this guard and the box gate itself.
    "deploy/**",
    ".github/**",
    "scripts/dev/hub_merge.py",
    "scripts/ops/ci_box/**",
]

STATE_PATH = "docs/STATE.md"
MIN_SENTENCE = 10
REQUIRED_CHECKS = list(mg.DEFAULTS["required_checks"])
APPROVER_IDS = set(mg.DEFAULTS["approver_ids"]) | set(mg.DEFAULTS["owner_approver_ids"])
TRUSTED_ASSOC = {"OWNER", "MEMBER", "COLLABORATOR"}
OUTSIDER_ASSOC = {"NONE", "CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "MANNEQUIN"}
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


# Loose scan used ONLY for blockers (fail closed): a line that starts, after list / heading /
# quote / code marks and at most four plain words, with the word "verdict" ("- Verdict: blocker",
# "## Verdict: blocker", "> Verdict: blocker", "Hub re-review verdict: blocker",
# "Verdict (re-review): blocker", "Verdict - blocker"). The strict VERDICT_RE stays for the clean
# desk verdict.
_LOOSE_VERDICT_RE = re.compile(
    r"^[\s>*#\-\d.`_|]*(?:[\w()/'-]+[ \t]+){0,4}verdict\b(?P<rest>.*)$", re.IGNORECASE
)
_BLOCKER_RE = re.compile(r"blockers?", re.IGNORECASE)
_NEGATION_RE = re.compile(
    r"\b(?:no|not|non|zero|0|without|none)(?:[\s-]+(?:a|an|new|remaining|open|more|other|further|"
    r"real|longer))*[\s-]*$",
    re.IGNORECASE,
)
_HEX_RE = re.compile(r"\b[0-9a-fA-F]{7,40}\b")


def loose_blocker_lines(body: str) -> list[str]:
    """Lines of a body that are a verdict line carrying a `blocker` that is not negated.

    Any blocker word on the line not directly preceded by no/not/non/zero/0/without/none counts, so
    "Verdict: blocker (no blockers in tests)" is a hit and "Verdict: no-blocker" is not.
    """
    out = []
    for line in (body or "").splitlines():
        m = _LOOSE_VERDICT_RE.match(line)
        if not m:
            continue
        rest = m.group("rest")
        if any(not _NEGATION_RE.search(rest[: b.start()]) for b in _BLOCKER_RE.finditer(rest)):
            out.append(line.strip())
    return out


def cites_head(body: str, head: str) -> bool:
    """True when the body names the head commit (any 7+ hex prefix of the full head SHA)."""
    head = (head or "").lower()
    return bool(head) and any(head.startswith(t.lower()) for t in _HEX_RE.findall(body or ""))


def blockers_newer_than(items: list[dict], head_date: str, head: str | None = None) -> list[dict]:
    """Items (issue comments, review bodies) at or after head_date that carry a blocker verdict
    line, or that cite the head SHA with one at any time.

    Each item needs: id, author, body, times (list of ISO timestamps: created / edited / submitted).
    "Newer" is the latest of the item's timestamps >= the cutoff, so an old comment edited into a
    blocker after the push counts. Ties count as newer. An item without a parseable time counts as
    newer.
    """
    cutoff = parse_ts(head_date)
    hits = []
    for it in items:
        if not loose_blocker_lines(it.get("body", "")):
            continue
        try:
            newer = max(parse_ts(t) for t in it["times"] if t) >= cutoff
        except (ValueError, KeyError):
            newer = True
        if newer or (head and cites_head(it.get("body", ""), head)):
            hits.append(it)
    return hits


def push_cutoff(head_date: str, runs: list[dict]) -> str:
    """The earlier of the head COMMIT date and the first check-run at the head.

    A commit made on a machine whose clock is ahead (or with GIT_COMMITTER_DATE in the future) would
    otherwise hide a blocker posted after the push but before that date.
    """
    best = parse_ts(head_date)
    for r in runs:
        for key in ("created_at", "started_at"):
            try:
                t = parse_ts(r[key])
            except (KeyError, TypeError, ValueError):
                continue
            if t < best:
                best = t
    return best.isoformat().replace("+00:00", "Z")


def human_hold(comments: list[dict], approver_ids: set | None = None) -> str:
    """Non-empty reason when the latest `BLOCKER:` / `UNBLOCK:` comment from a trusted human is a
    BLOCKER (rule 4b of the box gate, at any time).

    A `BLOCKER:` from anyone not marked as an outsider counts (fail closed); an `UNBLOCK:` clears it
    only from an owner, member or collaborator (or an allowlisted numeric id).
    """
    ids = approver_ids or set()
    blocked = ""
    for c in sorted(comments, key=lambda c: (c.get("created_at") or "", c.get("id", 0))):
        user = c.get("user") or {}
        assoc = (c.get("author_association") or "").upper()
        trusted = assoc in TRUSTED_ASSOC or user.get("id") in ids
        body = (c.get("body") or "").lstrip().upper()
        if body.startswith("BLOCKER:") and (trusted or assoc not in OUTSIDER_ASSOC):
            blocked = f"comment {c.get('id')} by {user.get('login')}"
        elif body.startswith("UNBLOCK:") and trusted:
            blocked = ""
    return blocked


def changes_requested(reviews: list[dict], cutoff: str, head: str) -> list[dict]:
    """Reviews in state CHANGES_REQUESTED submitted at or after the cutoff or on the head commit."""
    t0 = parse_ts(cutoff)
    out = []
    for r in reviews:
        if (r.get("state") or "").upper() != "CHANGES_REQUESTED":
            continue
        try:
            newer = parse_ts(r["submitted_at"]) >= t0
        except (KeyError, TypeError, ValueError):
            newer = True
        if newer or (r.get("commit_id") or "").lower() == head.lower():
            out.append(r)
    return out


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


def _suite(r: dict):
    return (r.get("check_suite") or {}).get("id") or (r.get("app") or {}).get("id")


def checks_problems(runs: list[dict]) -> tuple[list[str], list[str]]:
    """(failed, pending) over ALL check-runs at the head (job level).

    The latest run is kept per (check suite, name): only a rerun inside the same suite supersedes an
    earlier run, so a failed `build` of one workflow is not hidden by a green `build` of another.
    """
    latest: dict[tuple, dict] = {}
    for r in runs:
        name = r.get("name")
        key = (_suite(r), name)
        if name and (key not in latest or r.get("id", 0) > latest[key].get("id", 0)):
            latest[key] = r
    failed, pending = [], []
    for (_, name), r in sorted(latest.items(), key=lambda kv: (str(kv[0][0]), kv[0][1])):
        if r.get("status") != "completed":
            pending.append(f"{name} ({r.get('status')})")
        elif r.get("conclusion") not in GREEN:
            failed.append(f"{name} ({r.get('conclusion')})")
    return failed, pending


def missing_required(runs: list[dict], required: list[str]) -> list[str]:
    """Required check names (box gate DEFAULTS) with no check-run at the head."""
    have = {r.get("name") for r in runs}
    return [n for n in required if n not in have]


def status_problems(combined: dict | None) -> tuple[list[str], list[str]]:
    """(failed, pending) from the combined legacy commit status at the head. No statuses is fine."""
    failed, pending = [], []
    for s in (combined or {}).get("statuses") or []:
        label = f"{s.get('context')} ({s.get('state')})"
        if s.get("state") in ("failure", "error"):
            failed.append(label)
        elif s.get("state") != "success":
            pending.append(label)
    if (combined or {}).get("total_count") and not (failed or pending):
        if combined.get("state") not in (None, "success"):
            (failed if combined["state"] in ("failure", "error") else pending).append(
                f"combined status ({combined['state']})"
            )
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


class HeadMoved(Exception):
    """The PR head (or open state) changed between the evaluation and the enqueue call."""


_QUEUE_QUERY = (
    "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name)"
    "{pullRequest(number:$number){id state isDraft headRefOid isInMergeQueue "
    "mergeQueueEntry{state position}}}}"
)
_ENQUEUE_MUTATION = (
    "mutation($pullRequestId:ID!,$expectedHeadOid:GitObjectID!){enqueuePullRequest("
    "input:{pullRequestId:$pullRequestId,expectedHeadOid:$expectedHeadOid})"
    "{mergeQueueEntry{state position}}}"
)


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
        pages = self.api("GET", self.p(f"commits/{head}/check-runs?per_page=100"), paginate=True)
        runs: list[dict] = []
        for item in pages:
            if isinstance(item, dict):
                runs.extend(item.get("check_runs", [item]))
        cutoff = push_cutoff(head_date, runs)
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
        for it in blockers_newer_than(items, cutoff, head):
            reasons.append(
                (
                    "blocker",
                    f"{it['kind']} {it['id']} by {it['author']} says Verdict: blocker and is not "
                    f"older than the push cutoff ({cutoff}) or cites the head; a later no-blocker "
                    "does not clear it",
                )
            )
        for r in changes_requested(reviews, cutoff, head):
            reasons.append(
                (
                    "blocker",
                    f"review {r.get('id')} by {(r.get('user') or {}).get('login')} is "
                    f"CHANGES_REQUESTED at or after the push cutoff ({cutoff})",
                )
            )
        hold = human_hold(comments, APPROVER_IDS)
        if hold:
            reasons.append(("blocker", f"unresolved `BLOCKER:` {hold} (no later `UNBLOCK:`)"))
        clean, why = desk_status(comments, head, self.desk_authors)
        if not clean:
            reasons.append(("desk", why))

        if not runs:
            reasons.append(("checks", f"no check-runs at head {head[:7]}"))
        failed, pending = checks_problems(runs)
        combined = self.api("GET", self.p(f"commits/{head}/status?per_page=100"))
        s_failed, s_pending = status_problems(combined)
        failed, pending = failed + s_failed, pending + s_pending
        if failed:
            reasons.append(("checks", "failed check-runs: " + ", ".join(failed)))
        if pending:
            reasons.append(("checks", "pending check-runs: " + ", ".join(pending)))
        missing = missing_required(runs, REQUIRED_CHECKS)
        if missing and runs:
            reasons.append(("checks", "required checks missing at the head: " + ", ".join(missing)))

        files = self.api("GET", self.p(f"pulls/{n}/files?per_page=100"), paginate=True)
        prot = mg.protected_hits(files, PROTECTED_GLOBS)
        return {"pr": pr, "head": head, "reasons": reasons, "protected": prot}

    def graphql(self, query: str, **variables: str) -> dict:
        """Run one GraphQL document through `gh api graphql`; returns its `data` object."""
        args = ["api", "graphql", "-f", f"query={query}"]
        for k, v in variables.items():
            args += ["-f", f"{k}={v}"]
        try:
            doc = json.loads(self.runner(args) or "")
        except (TypeError, ValueError) as e:
            raise GhError("GitHub returned no JSON for a GraphQL call") from e
        if not isinstance(doc, dict) or doc.get("errors") or not isinstance(doc.get("data"), dict):
            raise GhError(f"GraphQL error: {str((doc or {}).get('errors') or doc)[:300]}")
        return doc["data"]

    def queue_state(self, n: int) -> dict:
        """Fresh read (GraphQL) of the PR node id, head oid, state, draft flag and queue entry."""
        owner, name = self.repo.split("/", 1)
        data = self.graphql(_QUEUE_QUERY, owner=owner, name=name, number=str(n))
        pr = ((data.get("repository") or {}).get("pullRequest")) or {}
        if not pr.get("id"):
            raise GhError(f"GraphQL did not return PR #{n}")
        return pr

    def apply(self, res: dict, sentence: str | None) -> str:
        """Post the owner sentence (if protected paths), re-check the head, and ENQUEUE the PR.

        Returns a status line ("enqueued ..." or "already in the merge queue ..."). Raises
        HeadMoved when the head or state changed since the evaluation, GhError on any GitHub
        refusal. Never merges directly.
        """
        n, head = res["pr"]["number"], res["head"]
        if res["protected"]:
            body = (
                "Owner approval for protected paths, relayed by hub_merge.py "
                f'at head {head[:7]}: "{sentence}"'
            )
            self.api("POST", self.p(f"issues/{n}/comments"), {"body": body})
        # Immediately before the call: the head must still be the evaluated one.
        cur = self.queue_state(n)
        if (cur.get("headRefOid") or "").lower() != head.lower():
            raise HeadMoved(
                f"head moved: evaluated {head[:7]}, GitHub now has "
                f"{(cur.get('headRefOid') or '?')[:7]}; re-run to evaluate the new head"
            )
        if cur.get("state") != "OPEN" or cur.get("isDraft"):
            raise HeadMoved(f"PR is no longer an open, non-draft PR (state {cur.get('state')})")
        entry = cur.get("mergeQueueEntry")
        if cur.get("isInMergeQueue") or entry:
            pos = (entry or {}).get("position")
            return f"already in the merge queue (position {pos}), nothing to do"
        out = self.graphql(_ENQUEUE_MUTATION, pullRequestId=cur["id"], expectedHeadOid=head)
        got = ((out.get("enqueuePullRequest") or {}).get("mergeQueueEntry")) or {}
        if not got:
            raise GhError("enqueuePullRequest returned no merge queue entry")
        return f"enqueued (queue position {got.get('position')}, state {got.get('state')})"

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
    ap.add_argument(
        "--apply", action="store_true", help="really enqueue / disarm (default: dry run)"
    )
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
                "would enqueue in the merge queue (add --apply)"
            )
            return 0
        status = hub.apply(res, sentence)
        print(f"#{n} at head {head[:7]}: {status}")
        return 0
    except HeadMoved as e:
        print(f"REFUSE #{args.pr}: {e}")
        return 1
    except (GhError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

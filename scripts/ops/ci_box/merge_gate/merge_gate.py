#!/usr/bin/env python3
"""Polling merge gate: replaces GitHub merge queue + auto-merge on a private Free repo (R20-2, #1018).

Runs every few minutes from a systemd --user timer on the CI box (no inbound webhooks). Python stdlib
only; all GitHub access goes through the `gh` CLI (`gh api`), optionally via a local HTTP proxy.

A PR is merged (squash, guarded by its head SHA) only when ALL hold:
  1. label `merge-queue` is present (or auto-merge was requested, for the transition);
  2. not a draft, base branch is the configured base;
  3. every required check is green on the exact head SHA;
  4. a review-desk comment for that exact head SHA says `Verdict: no blocker`, or a human APPROVED
     review on that head from an allowlisted numeric user id, or a hub/owner comment line
     `DESK-OVERRIDE #<PR> <head sha>: <reason>` (id in approver_ids | owner_approver_ids,
     exact head);
  4b. no hold: label `needs-human` / `do-not-merge` (block_labels), no `[needs owner]` in the title, and
     no unresolved `BLOCKER:` comment from an allowlisted human (numeric id; cleared by a later
     `UNBLOCK:`), and no unresolved hub/owner `Verdict: blocker` line posted after the head commit
     (cleared by a later `UNBLOCK:`, or a later OWNER-OK / DESK-OVERRIDE for the exact head);
  5. protected paths (decision B7: migrations, payment, auth, Dockerfile.prod, deploy scripts, workflows and
     the gate itself; `protected_globs`) are untouched, unless an owner wrote `OWNER-OK #<PR> <head sha7>` in a
     PR comment (author numeric id in `owner_approver_ids`, bound to the exact head). Such a PR is class
     OWNER: the gate never merges it without that sentence, it only reports it once per head;
  6. the PR merges cleanly into the CURRENT base (GitHub `mergeable` true, not conflicting; unknown = wait one
     tick). Decision B7-2: `require_up_to_date = false` by default, so a green head that is merely behind merges.
     (`require_up_to_date = true` keeps the old behaviour: update-branch, wait for CI.)
One merge per tick, and none while the main CI run of the previous gate merge is still pending (decision B7-2:
main CI must be able to catch a bad combination before the next PR lands). If that main CI run FAILS the gate
pauses itself (file `PAUSE` in the state dir) and sends one Telegram alert. With `auto_resume`
(default on) the gate removes PAUSE by itself once the newest completed main CI push run is green on
the current main HEAD (one Telegram notice; never while KILL exists; dry-run only logs). `rm` it to
resume by hand. The remaining PRs are re-evaluated against the new main on every tick.
Review desk dispatch: a PR that passed every other rule, has all required checks green on its head
and has no desk verdict for that head gets a `review-desk.yml` run dispatched (at most one per tick,
never while a desk run is queued or running: the workflow's concurrency group keeps only one pending
run). If no verdict appears `desk_retry_minutes` after a dispatch the same head is dispatched again,
at most `desk_max_dispatches_per_head` times in all. This is the only write done in dry-run.
State + lock + kill switch live in the state dir. Dry-run logs only (its dedupe lives in `state.dryrun.json`).
"""
from __future__ import annotations

import argparse
import fcntl
import json
import logging
import os
import re
import importlib.util
import subprocess
import sys
import tempfile
import time
import tomllib
from pathlib import Path
from typing import Callable

log = logging.getLogger("merge_gate")

DEFAULTS = {
    "repo": "Mahan-film/roxira-platform",
    "base": "main",
    "label": "merge-queue",
    "dry_run": True,
    "allow_auto_merge_flag": True,
    "proxy": "",
    "state_dir": "~/.local/state/roxira-merge-gate",
    "required_checks": [
        "Detect changes",
        "Secret scan (new commits only)",
        "Semgrep CE (new findings)",
        "Agent guards (money, tenant scope, model ids, secrets)",
        "Pytest (unit)",
        "Compose config",
        "Frontend lint + build",
        "Backend (tsc + jest + Postgres specs)",
        "Frontend gate",
    ],
    # Decision B7: a PR touching any of these is never merged without an owner sentence (see OWNER_OK_RE).
    # Globs: `*` = part of one path segment, `**` = any depth. The list in the live toml REPLACES this one.
    "protected_globs": [
        # migrations
        "migrations/**",
        "**/migrations/**",
        # payment, billing, auth
        "**/payment/**",
        "**/payments/**",
        "**/*payment*",
        "**/zibal*",
        "**/billing/**",
        "**/auth/**",
        "**/*auth/**",
        "**/auth_*/**",
        "**/auth.*",
        # production image, compose, deploy scripts and units (main autodeploys)
        "Dockerfile.prod",
        "**/Dockerfile.prod",
        "docker-compose.prod.yml",
        "scripts/ops/deploy*.sh",
        "scripts/ops/*deploy*.sh",
        "scripts/ops/autodeploy/**",
        "deploy/**",
        # workflows and the gate itself (its code, config example, tests, spec)
        ".github/workflows/**",
        "scripts/ops/ci_box/merge_gate/**",
        "scripts/ci/merge_gate*.py",
        "src/ops/test_*merge_gate*.py",
        "docs/ops/MERGE_GATE_SPEC.md",
        # B1 core is hub-only (decision 2026-11-25)
        "**/country_packs/**",
        "output_apps/enterprise_hub/modules/tax_compliance/**",
        "output_apps/generated_modules/smartjudge/**",
        "output_apps/nginx_config/**",
    ],
    "review_comment_authors": ["github-actions[bot]"],
    # Numeric user ids of the review-desk accounts. When non-empty they REPLACE the login check
    # (logins can be renamed, ids cannot). Real ids live in the box config only, never in git.
    "review_comment_author_ids": [],
    "block_labels": ["needs-human", "do-not-merge"],
    "block_title_markers": ["[needs owner]"],
    # Rule 6 (decision B7-2). false = like the old ruleset (strict up-to-date off): a green head merges even when
    # behind, as long as it merges cleanly into the current base. true = the PR must contain the tip of the base
    # (update-branch + CI cycle per PR; starved the gate in the dry-run: 80 of 90 merged PRs were behind).
    "require_up_to_date": False,
    # Main CI guard: workflow whose push-to-base run must pass after each gate merge, and how long to wait for
    # that run to appear (a docs-only merge is paths-ignored by ci.yml and never gets one).
    "main_ci_workflow": "ci.yml",
    "main_ci_grace_seconds": 300,
    # Remove PAUSE by itself once the newest completed main CI push run is green on main HEAD.
    "auto_resume": True,
    # How a ready PR reaches the base. "github" = GitHub's native merge queue: the gate only
    # ENQUEUES (GraphQL enqueuePullRequest, bound to the head SHA), up to max_enqueue_per_tick
    # per tick, and does not wait for the main push CI of each merge (the queue validates every
    # group). Guard: nothing is enqueued while PAUSE exists or the newest completed main CI push
    # run is red. "legacy" = one squash merge per tick via REST, then wait for that main CI run.
    "queue_mode": "legacy",
    "max_enqueue_per_tick": 5,
    # Review desk dispatch (see module docstring). Acts even when dry_run = true.
    "dispatch_review_desk": True,
    "review_desk_workflow": "review-desk.yml",
    # Re-dispatch a head when no verdict appeared this long after its last dispatch, up to the cap.
    "desk_retry_minutes": 90,
    "desk_max_dispatches_per_head": 2,
    "approver_ids": [],
    "owner_approver_ids": [],
}
GREEN = {"success", "skipped", "neutral"}
REVIEW_HEADER_RE = re.compile(
    r"^Cross-family review\b(?:\s*\([^)]*\))?\s*(?:@|of)\s*(?P<sha>[0-9a-fA-F]{7,40})"
)
VERDICT_RE = re.compile(r"^\s*\**\s*verdict\s*\**\s*:\s*\**\s*(no blocker|blocker)", re.IGNORECASE)

# Owner approval marker (decision B7): a line that starts with `OWNER-OK #<PR number> <head sha, 7-40 hex>`.
OWNER_OK_RE = re.compile(
    r"^OWNER-OK\s+#(?P<n>\d+)\s+(?P<sha>[0-9a-fA-F]{7,40})\s*$", re.MULTILINE | re.IGNORECASE
)
# Hub/owner override of the review desk (rule 4): line `DESK-OVERRIDE #<PR> <head sha>: <reason>`.
# `[ \t]` keeps the reason on the same line.
DESK_OVERRIDE_RE = re.compile(
    r"^DESK-OVERRIDE[ \t]+#(?P<n>\d+)[ \t]+(?P<sha>[0-9a-fA-F]{7,40})[ \t]*:[ \t]*\S",
    re.MULTILINE | re.IGNORECASE,
)
# A hub/owner comment line `Verdict: blocker` (markdown bold allowed) holds the PR (rule 4b).
HUB_BLOCKER_RE = re.compile(r"(?im)^\s*\**\s*verdict\s*\**\s*:\s*\**\s*blocker\b")
# GitHub lists at most 3000 files per PR; at that size the list may be cut, so it cannot prove "no protected path".
PR_FILES_CAP = 3000

# OWNER = "owner sentence required": never merged, reported once per head, waits for the marker.
MERGE, BEHIND, WAIT, REFUSE, SKIP, OWNER = "merge", "behind", "wait", "refuse", "skip", "owner"


class GhError(RuntimeError):
    pass


def load_config(path: str | None) -> dict:
    cfg = dict(DEFAULTS)
    if path:
        with open(path, "rb") as fh:
            cfg.update(tomllib.load(fh))
    cfg["state_dir"] = os.path.expanduser(cfg["state_dir"])
    return cfg


def glob_to_regex(glob: str) -> re.Pattern:
    out, i = "", 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif glob.startswith("**", i):
            out += ".*"
            i += 2
        elif glob[i] == "*":
            out += "[^/]*"
            i += 1
        elif glob[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(glob[i])
            i += 1
    return re.compile("^" + out + "$")


def protected_hits(files: list[dict], globs: list[str]) -> list[str]:
    pats = [glob_to_regex(g) for g in globs]
    hits = []
    for f in files:
        for name in (f.get("filename"), f.get("previous_filename")):
            if name and any(p.match(name) for p in pats):
                hits.append(name)
                break
    return hits


def json_pages(text: str) -> list:
    """Split `gh api --paginate` output (JSON documents back to back) into a list of pages."""
    dec = json.JSONDecoder()
    pages: list = []
    i, n = 0, len(text)
    while i < n:
        while i < n and text[i].isspace():
            i += 1
        if i >= n:
            break
        doc, i = dec.raw_decode(text, i)
        pages.append(doc)
    return pages


class GhApi:
    """Thin wrapper over `gh api`. Raises GhError on failure."""

    def __init__(self, proxy: str = ""):
        self.env = dict(os.environ)
        if proxy:
            for k in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
                self.env[k] = proxy

    def __call__(self, method: str, path: str, fields: dict | None = None, paginate: bool = False):
        cmd = ["gh", "api", "-X", method, path]
        if paginate:
            # No --slurp: it needs gh >= 2.48 and Ubuntu 26.04 ships 2.46. Pages are split below.
            cmd += ["--paginate"]
        for k, v in (fields or {}).items():
            cmd += ["-f", f"{k}={v}"]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, env=self.env, timeout=90)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise GhError(str(e)) from e
        if r.returncode != 0:
            raise GhError((r.stderr or r.stdout).strip()[:500])
        out = r.stdout.strip()
        if not paginate:
            return json.loads(out) if out else None
        flat: list = []
        for page in json_pages(out):
            flat.extend(page if isinstance(page, list) else [page])
        return flat


class State:
    """state.json (live) or state.dryrun.json (dry-run). Separate files: a "would comment" mark made in dry-run must
    not suppress the real comment for the same head at go-live. Both are saved every tick."""

    def __init__(self, directory: str, dry: bool = False):
        self.path = Path(directory) / ("state.dryrun.json" if dry else "state.json")
        self.data: dict = {"commented": [], "merged": {}, "dispatched": [], "dispatch_log": {},
                           "last_merge": None}
        if self.path.exists():
            try:
                self.data.update(json.loads(self.path.read_text()))
            except (OSError, ValueError):
                log.warning("state file unreadable, starting fresh")

    def seen(self, key: str) -> bool:
        return key in self.data["commented"]

    def mark(self, key: str) -> None:
        self.data["commented"] = (self.data["commented"] + [key])[-500:]

    def dispatched(self, key: str) -> bool:
        return key in self.data["dispatched"]

    def mark_dispatched(self, key: str) -> None:
        self.data["dispatched"] = (self.data["dispatched"] + [key])[-500:]

    def dispatch_entry(self, key: str) -> dict | None:
        """{"count": n, "at": epoch} of the review desk dispatches for `<pr>:<head>`, or None."""
        return self.data.setdefault("dispatch_log", {}).get(key)

    def record_dispatch(self, key: str, at: float, count: int) -> None:
        dlog = self.data.setdefault("dispatch_log", {})
        dlog.pop(key, None)
        dlog[key] = {"count": count, "at": at}
        while len(dlog) > 500:  # oldest first (insertion order)
            dlog.pop(next(iter(dlog)))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent)
        with os.fdopen(fd, "w") as fh:
            json.dump(self.data, fh)
        os.replace(tmp, self.path)


def load_notify() -> Callable[[str], bool]:
    """Return notify.send. Looks next to this file (installed copy), then in the repo tree."""
    here = Path(__file__).resolve()
    candidates = [Path(os.environ.get("NOTIFY_PY", "")), here.parent / "notify.py",
                  here.parents[2] / "notify" / "notify.py"]
    for path in candidates:
        if path.is_file():
            spec = importlib.util.spec_from_file_location("roxira_notify", path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod.send
    log.warning("notify.py not found: alerts go to the log only")
    return lambda text: False


QUEUED_QUERY = "query($id: ID!) { node(id: $id) { ... on PullRequest { isInMergeQueue } } }"
ENQUEUE_MUTATION = (
    "mutation($id: ID!, $oid: GitObjectID!) { enqueuePullRequest(input: "
    "{pullRequestId: $id, expectedHeadOid: $oid}) { mergeQueueEntry { id } } }"
)
FAILED_RUN = {"failure", "timed_out", "startup_failure"}


class Gate:
    def __init__(self, cfg: dict, api, state: State, dry_run: bool, notify: Callable[[str], bool] | None = None,
                 now: Callable[[], float] = time.time):
        self.cfg, self.api, self.state, self.dry = cfg, api, state, dry_run
        self.repo = cfg["repo"]
        self.notify, self.now = notify, now
        self.pause_file = Path(cfg.get("state_dir", ".")) / "PAUSE"

    def p(self, suffix: str) -> str:
        return f"repos/{self.repo}/{suffix}"

    # ---- individual rules -------------------------------------------------
    def checks_status(self, sha: str) -> tuple[str, str]:
        pages = self.api("GET", self.p(f"commits/{sha}/check-runs?per_page=100"), paginate=True)
        flat: list[dict] = []
        for item in pages:
            if isinstance(item, dict):
                flat.extend(item.get("check_runs", [item]))
        latest: dict[str, dict] = {}
        for r in flat:
            n = r.get("name")
            if n and (n not in latest or r.get("id", 0) > latest[n].get("id", 0)):
                latest[n] = r
        pending, failed = [], []
        for name in self.cfg["required_checks"]:
            r = latest.get(name)
            if r is None or r.get("status") != "completed":
                pending.append(name)
            elif r.get("conclusion") not in GREEN:
                failed.append(f"{name} ({r.get('conclusion')})")
        if failed:
            return REFUSE, "required checks failed: " + ", ".join(failed)
        if pending:
            return WAIT, "required checks not finished: " + ", ".join(pending)
        return MERGE, ""

    def is_review_author(self, comment: dict) -> bool:
        user = comment.get("user") or {}
        ids = set(self.cfg.get("review_comment_author_ids") or [])
        if ids:
            return user.get("id") in ids
        return user.get("login") in set(self.cfg["review_comment_authors"])

    def hold_reason(self, pr: dict, labels: set[str]) -> str:
        """Explicit human holds: labels, title marker, unresolved BLOCKER: comment (allowlisted id).

        A hub `Verdict: blocker` hold is cleared by a later UNBLOCK:, a later DESK-OVERRIDE, or a
        later OWNER-OK from an owner id for the exact head: the owner outranks the hub."""
        hit = sorted(labels & set(self.cfg["block_labels"]))
        if hit:
            return "label " + ", ".join(f"`{x}`" for x in hit)
        title = (pr.get("title") or "").lower()
        for m in self.cfg["block_title_markers"]:
            if m.lower() in title:
                return f"title contains `{m}`"
        humans = set(self.cfg["approver_ids"]) | set(self.cfg["owner_approver_ids"])
        if not humans:
            return ""
        owners = set(self.cfg["owner_approver_ids"])
        n, head = pr["number"], (pr.get("head") or {}).get("sha", "")
        head_date: str | None = None  # fetched lazily, only once a hub `Verdict: blocker` shows up
        state, verdict = "", ""
        for c in self.api("GET", self.p(f"issues/{n}/comments?per_page=100"), paginate=True):
            uid = (c.get("user") or {}).get("id")
            if uid not in humans:
                continue  # bot desk comments are rule 4's business, not a hold
            raw = c.get("body") or ""
            body = raw.lstrip().upper()
            if body.startswith("BLOCKER:"):
                state = "blocked"
            elif body.startswith("UNBLOCK:"):
                state = verdict = ""
            if HUB_BLOCKER_RE.search(raw):
                if head_date is None:
                    head_date = self.head_commit_date(head)
                created = c.get("created_at") or ""
                # fail closed: an unknown head date or comment time counts as "after the head"
                if not head_date or not created or created > head_date:
                    verdict = "blocked"
            elif verdict and (
                (uid in owners and self.marker_for(OWNER_OK_RE, raw, n, head))
                or self.marker_for(DESK_OVERRIDE_RE, raw, n, head)
            ):
                verdict = ""
        if state:
            return "unresolved `BLOCKER:` comment from an allowlisted user"
        if verdict:
            return ("unresolved hub/owner `Verdict: blocker` on this head "
                    "(clear: `UNBLOCK:` or DESK-OVERRIDE)")
        return ""

    def head_commit_date(self, sha: str) -> str:
        """Committer date (ISO 8601 UTC) of the head commit, "" when unknown."""
        if not sha:
            return ""
        res = self.api("GET", self.p(f"commits/{sha}"))
        commit = (res.get("commit") or {}) if isinstance(res, dict) else {}
        return str((commit.get("committer") or {}).get("date") or "")

    @staticmethod
    def marker_for(regex: re.Pattern, body: str, n: int, head: str) -> bool:
        """True when `body` has a regex line naming PR `n` and a prefix of `head` (7-40 hex)."""
        head = head.lower()
        return any(
            int(m.group("n")) == n and head and head.startswith(m.group("sha").lower())
            for m in regex.finditer(body)
        )

    def review_ok(self, n: int, head: str) -> tuple[bool, str]:
        head = head.lower()
        comments = self.api("GET", self.p(f"issues/{n}/comments?per_page=100"), paginate=True)
        if self.latest_desk_verdict(comments, head) == "no blocker":
            return True, "review desk: no blocker"
        humans = set(self.cfg["approver_ids"]) | set(self.cfg["owner_approver_ids"])
        for c in comments:
            uid = (c.get("user") or {}).get("id")
            if uid in humans and self.marker_for(DESK_OVERRIDE_RE, c.get("body") or "", n, head):
                return True, f"DESK-OVERRIDE from user id {uid}"
        ids = set(self.cfg["approver_ids"])
        if ids:
            reviews = self.api("GET", self.p(f"pulls/{n}/reviews?per_page=100"), paginate=True)
            latest: dict[int, dict] = {}
            for r in reviews:
                uid = (r.get("user") or {}).get("id")
                if uid in ids and r.get("state") in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
                    latest[uid] = r
            for uid, r in latest.items():
                if r["state"] == "APPROVED" and (r.get("commit_id") or "").lower() == head:
                    return True, f"human approval from user id {uid}"
        return False, f"no review-desk 'Verdict: no blocker' (or allowlisted approval) for head {head[:7]}"

    def latest_desk_verdict(self, comments: list[dict], head: str) -> str | None:
        """Verdict ("no blocker" or "blocker") of the latest desk comment on `head`, else None."""
        revs = [
            c
            for c in comments
            if (c.get("body") or "").lstrip().startswith("Cross-family review")
            and self.is_review_author(c)
        ]
        if not revs:
            return None
        body = revs[-1]["body"].lstrip()
        m = REVIEW_HEADER_RE.match(body.splitlines()[0])
        if not m or not head.lower().startswith(m.group("sha").lower()):
            return None
        verdict = None
        for ln in body.splitlines():
            v = VERDICT_RE.match(ln)
            if v:
                verdict = v.group(1).lower()
        return verdict

    def owner_ok(self, n: int, head: str) -> bool:
        """True when an owner (numeric id in `owner_approver_ids`) wrote `OWNER-OK #<n> <sha>` for this exact head.

        Fails closed: no owner ids configured = never true. The marker names the head, so any later push voids it.
        """
        owners = set(self.cfg["owner_approver_ids"])
        if not owners:
            return False
        head = head.lower()
        for c in self.api("GET", self.p(f"issues/{n}/comments?per_page=100"), paginate=True):
            if (c.get("user") or {}).get("id") not in owners:
                continue
            for m in OWNER_OK_RE.finditer(c.get("body") or ""):
                if int(m.group("n")) == n and head.startswith(m.group("sha").lower()):
                    return True
        return False

    # ---- one PR -----------------------------------------------------------
    def evaluate(self, pr: dict) -> tuple[str, str, str]:
        """Return (status, code, reason). code is a stable key used to comment once per head SHA."""
        n, head = pr["number"], pr["head"]["sha"]
        labels = {lb["name"] for lb in pr.get("labels", [])}
        wanted = self.cfg["label"] in labels or (self.cfg["allow_auto_merge_flag"] and pr.get("auto_merge"))
        if not wanted:
            return SKIP, "", "no merge-queue label"
        if pr.get("draft"):
            return SKIP, "", "draft"
        if pr["base"]["ref"] != self.cfg["base"]:
            return REFUSE, "base", f"base branch is {pr['base']['ref']}, not {self.cfg['base']}"
        if pr.get("mergeable_state") == "dirty" or pr.get("mergeable") is False:
            return REFUSE, "conflict", "merge conflicts with the base branch"
        if ("mergeable" in pr and pr["mergeable"] is None) or pr.get("mergeable_state") == "unknown":
            return WAIT, "mergeable-unknown", "GitHub has not computed mergeability against the current base yet"
        hold = self.hold_reason(pr, labels)
        if hold:
            return REFUSE, "hold", f"on hold: {hold}"
        files = self.api("GET", self.p(f"pulls/{n}/files?per_page=100"), paginate=True)
        hits = protected_hits(files, self.cfg["protected_globs"])
        if len(files) >= PR_FILES_CAP:
            hits = hits or [f"file list may be truncated at {PR_FILES_CAP}"]
        if hits and not self.owner_ok(n, head):
            return OWNER, "owner", (
                "owner sentence required: touches protected paths ("
                + ", ".join(hits[:5])
                + f"). Not merged by the gate; waits for an owner comment line starting `OWNER-OK #{n} {head[:7]}`"
            )
        ok, why = self.review_ok(n, head)
        if not ok:
            return REFUSE, "review", why
        status, why = self.checks_status(head)
        if status != MERGE:
            return status, "checks", why
        if not self.cfg.get("require_up_to_date", True):
            return MERGE, "", "all gates passed (merges cleanly into current base; up-to-date not required)"
        cmp = self.api("GET", self.p(f"compare/{self.cfg['base']}...{head}"))
        if cmp.get("behind_by", 0) > 0:
            return BEHIND, "behind", f"behind {self.cfg['base']} by {cmp['behind_by']} commits"
        return MERGE, "", "all gates passed"

    def comment(self, n: int, head: str, code: str, text: str) -> None:
        key = f"{n}:{head}:{code}"
        if self.state.seen(key):
            return
        if self.dry:
            log.info("[dry-run] would comment on #%s: %s", n, text)
            self.state.mark(key)  # state.dryrun.json: one line per head and reason, not one per tick
            return
        try:
            self.api("POST", self.p(f"issues/{n}/comments"), {"body": f"merge-gate: {text} (head {head[:7]})"})
            self.state.mark(key)
        except GhError as e:
            log.error("comment on #%s failed: %s", n, e)

    # ---- one tick ---------------------------------------------------------
    def wants(self, brief: dict) -> bool:
        names = {lb["name"] for lb in brief.get("labels", [])}
        return self.cfg["label"] in names or bool(self.cfg["allow_auto_merge_flag"] and brief.get("auto_merge"))

    def tick(self) -> str | None:
        prs = self.api("GET", self.p("pulls?state=open&per_page=100"), paginate=True)
        prs.sort(key=lambda p: p["number"])
        to_merge, to_update, to_review = None, None, None
        ready: list[dict] = []
        self.auto_resume()
        guard_ok, guard_why = self.main_guard()
        if not guard_ok:
            log.warning("merges held: %s", guard_why)
        for brief in prs:
            if not self.wants(brief):
                continue
            try:
                pr = self.api("GET", self.p(f"pulls/{brief['number']}"))
                status, code, why = self.evaluate(pr)
            except GhError as e:
                log.error("#%s evaluation failed: %s", brief["number"], e)
                continue
            n, head = pr["number"], pr["head"]["sha"]
            log.info("#%s %s: %s", n, status, why)
            if status in (REFUSE, OWNER):
                self.comment(n, head, code, f"not merged: {why}")
            elif status == MERGE:
                ready.append(pr)
                to_merge = to_merge or pr
            elif status == BEHIND and to_update is None:
                to_update = pr
            if code == "review" and to_review is None:
                try:
                    if self.desk_eligible(pr):
                        to_review = pr
                except GhError as e:
                    log.error("#%s desk eligibility check failed: %s", n, e)
        if to_review:
            self.dispatch_review(to_review)
        if self.queue_github():
            return self.enqueue_ready(ready, guard_ok, guard_why)
        if to_merge and not guard_ok:
            log.info("[hold] would merge #%s but %s", to_merge["number"], guard_why)
            return None
        if to_merge:
            return self.merge(to_merge)
        if to_update:
            self.update_branch(to_update)
        return None

    # ---- GitHub merge queue mode ------------------------------------------------
    def queue_github(self) -> bool:
        return str(self.cfg.get("queue_mode", "legacy")).lower() == "github"

    def node_id(self, pr: dict) -> str:
        """GraphQL node id: from the object, else REST pulls/<n>; "" when unknown (never guessed)."""
        nid = pr.get("node_id")
        if not nid:
            full = self.api("GET", self.p(f"pulls/{pr['number']}"))
            nid = (full or {}).get("node_id") if isinstance(full, dict) else None
        return str(nid or "")

    def in_merge_queue(self, pr: dict, nid: str) -> bool:
        """True when the PR already sits in the merge queue (GraphQL isInMergeQueue)."""
        res = self.api("POST", "graphql", {"query": QUEUED_QUERY, "id": nid})
        data = (res or {}).get("data") if isinstance(res, dict) else None
        node = (data or {}).get("node") or {}
        return bool(node.get("isInMergeQueue"))

    def enqueue_ready(self, ready: list[dict], guard_ok: bool, guard_why: str) -> str | None:
        """Enqueue up to max_enqueue_per_tick ready PRs (oldest first); queued ones are skipped."""
        if not ready:
            return None
        ok, why = (True, "") if not guard_ok else self.main_red_guard()
        if not guard_ok:
            ok, why = False, guard_why
        if not ok:
            names = ", ".join(f"#{p['number']}" for p in ready)
            log.info("[hold] would enqueue %s but %s", names, why)
            return None
        budget = max(0, int(self.cfg.get("max_enqueue_per_tick", 5)))
        done: list[str] = []
        for pr in ready:
            if len(done) >= budget:
                break
            try:
                nid = self.node_id(pr)
                if not nid:
                    log.error("#%s has no GraphQL node id, skipped (not guessed)", pr["number"])
                    continue
                pr["node_id"] = nid
                if self.in_merge_queue(pr, nid):
                    log.info("#%s already in the merge queue, skipped", pr["number"])
                    continue
            except GhError as e:
                log.error("#%s merge queue state unreadable: %s", pr["number"], e)
                continue
            if self.enqueue(pr):
                done.append(str(pr["number"]))
        return ",".join(done) or None

    def enqueue(self, pr: dict) -> bool:
        n, head = pr["number"], pr["head"]["sha"]
        if self.dry:
            log.info("[dry-run] would enqueue #%s at %s", n, head[:7])
            return False
        try:
            fields = {"query": ENQUEUE_MUTATION, "id": pr["node_id"], "oid": head}
            self.api("POST", "graphql", fields)
        except GhError as e:
            log.error("enqueue of #%s refused by GitHub: %s", n, e)
            self.comment(n, head, "merge-error", f"enqueue was refused by GitHub: {e}")
            return False
        self.state.data["merged"][str(n)] = head
        self.comment(n, head, "enqueued", f"added to the merge queue at {head[:7]}")
        log.info("enqueued #%s", n)
        return True

    def main_red_guard(self) -> tuple[bool, str]:
        """False while the newest completed main CI run is red AND is for the current base HEAD.

        A red run for an older sha (a newer run still pending) does not hold. An unreadable run
        list or HEAD holds (fail closed). One alert per red run."""
        base, wf = self.cfg["base"], self.cfg["main_ci_workflow"]
        try:
            q = f"branch={base}&event=push&status=completed&per_page=20"
            res = self.api("GET", self.p(f"actions/workflows/{wf}/runs?{q}"))
            ref = self.api("GET", self.p(f"commits/{base}"))
        except GhError as e:
            return False, f"cannot read main CI: {e}"
        runs = [r for r in ((res or {}).get("workflow_runs", []) if isinstance(res, dict) else [])
                if r.get("status") == "completed"]
        if not runs:
            return True, ""
        newest = max(runs, key=lambda r: (r.get("created_at") or "", r.get("id") or 0))
        if newest.get("conclusion") not in FAILED_RUN:
            return True, ""
        main_sha = str((ref or {}).get("sha") or "") if isinstance(ref, dict) else ""
        if not main_sha:
            return False, "cannot read the main HEAD"
        if str(newest.get("head_sha") or "") != main_sha:
            log.info("newest completed main CI run is red but for an older sha %s: not holding",
                     str(newest.get("head_sha") or "")[:7])
            return True, ""
        key = f"main-red:{newest.get('id')}"
        if not self.state.seen(key):
            self.state.mark(key)
            sha7 = str(newest.get("head_sha") or "")[:7]
            self.alert(f"[ALERT] merge gate holds the queue: newest main CI run is "
                       f"{newest.get('conclusion')} at {sha7}. No enqueue until main is green.")
        return False, f"newest main CI run is {newest.get('conclusion')}"

    # ---- main CI guard (decision B7-2) -------------------------------------
    def killed(self) -> bool:
        sd = Path(self.cfg.get("state_dir", "."))
        return (sd / "KILL").exists() or Path(self.cfg.get("kill_switch", "/nonexistent")).exists()

    def auto_resume(self) -> bool:
        """Remove PAUSE when the newest completed main CI push run is green on the main HEAD.

        Never while a KILL file exists; dry-run only logs. Any API error keeps the gate paused."""
        if not self.cfg.get("auto_resume", True) or not self.pause_file.exists():
            return False
        if self.killed():
            log.info("auto-resume skipped: kill switch present")
            return False
        base, wf = self.cfg["base"], self.cfg["main_ci_workflow"]
        try:
            q = f"branch={base}&event=push&status=completed&per_page=20"
            res = self.api("GET", self.p(f"actions/workflows/{wf}/runs?{q}"))
            ref = self.api("GET", self.p(f"commits/{base}"))
        except GhError as e:
            log.warning("auto-resume check failed, gate stays paused: %s", e)
            return False
        runs = (res or {}).get("workflow_runs", []) if isinstance(res, dict) else []
        done = [r for r in runs if r.get("status") == "completed"]
        if not done:
            return False
        newest = max(done, key=lambda r: (r.get("created_at") or "", r.get("id") or 0))
        main_sha = str((ref or {}).get("sha") or "") if isinstance(ref, dict) else ""
        run_sha = str(newest.get("head_sha") or "")
        if not main_sha or run_sha != main_sha or newest.get("conclusion") != "success":
            log.info("gate stays paused: newest main CI run %s at %s, main HEAD %s",
                     newest.get("conclusion"), run_sha[:7], main_sha[:7])
            return False
        if self.dry:
            log.info("[dry-run] would resume the gate: main green at %s (PAUSE kept)", main_sha[:7])
            return False
        try:
            self.pause_file.unlink()
        except FileNotFoundError:
            pass
        text = f"merge gate resumed: main green at {main_sha[:7]}"
        log.warning(text)
        if self.notify is not None:
            try:
                self.notify(text)
            except Exception as e:  # a notice failure must not stop the tick
                log.error("resume notice send failed: %s", e)
        return True

    def alert(self, text: str) -> None:
        log.error(text)
        if self.dry or self.notify is None:
            return
        try:
            self.notify(text)
        except Exception as e:  # an alert path failure must not stop the tick
            log.error("alert send failed: %s", e)

    def main_guard(self) -> tuple[bool, str]:
        """(ok to merge, why not). Pauses the gate (sticky PAUSE file + one alert) when main CI failed on a gate merge."""
        if self.pause_file.exists():
            return False, f"gate paused ({self.pause_file.name} present): main CI failed after a gate merge"
        lm = self.state.data.get("last_merge")
        if self.queue_github() or not lm or lm.get("done"):
            return True, ""
        sha, n = lm["sha"], lm["pr"]
        wf = self.cfg["main_ci_workflow"]
        try:
            res = self.api("GET", self.p(f"actions/workflows/{wf}/runs?branch={self.cfg['base']}&event=push&head_sha={sha}"))
        except GhError as e:
            return False, f"cannot read main CI for the last gate merge: {e}"
        runs = (res or {}).get("workflow_runs", []) if isinstance(res, dict) else []
        if not runs:
            if self.now() - lm["at"] < self.cfg["main_ci_grace_seconds"]:
                return False, f"main CI for #{n} ({sha[:7]}) has not started yet"
            log.info("no main CI run for #%s (%s): paths-ignored push, treated as passed", n, sha[:7])
            lm["done"] = True
            return True, ""
        if any(r.get("status") != "completed" for r in runs):
            return False, f"main CI for #{n} ({sha[:7]}) is still running"
        bad = sorted({str(r.get("conclusion")) for r in runs} & FAILED_RUN)
        if bad:
            lm["done"] = True
            if not self.dry:
                self.pause_file.parent.mkdir(parents=True, exist_ok=True)
                self.pause_file.write_text(f"main CI {', '.join(bad)} after gate merge of #{n} ({sha[:7]})\n")
            self.alert(
                f"[ALERT] merge gate PAUSED: main CI {', '.join(bad)} after the gate merged #{n} ({sha[:7]}). "
                f"No more gate merges until main CI is green on the main HEAD again"
                f"{' (auto-resume)' if self.cfg.get('auto_resume', True) else ''} "
                f"or someone removes {self.pause_file}. Fix or revert main first."
            )
            return False, "main CI failed after a gate merge, gate paused"
        lm["done"] = True
        return True, ""

    # ---- review desk dispatch ------------------------------------------------
    def desk_eligible(self, pr: dict) -> bool:
        """May this PR (code `review`: no "no blocker" for its head) get a review desk run now?

        Only when dispatch is on, every required check is green on the head, the desk has posted no
        verdict for this head, and the head was dispatched fewer than `desk_max_dispatches_per_head`
        times, the last one at least `desk_retry_minutes` ago."""
        if not self.cfg.get("dispatch_review_desk"):
            return False
        n, head = pr["number"], pr["head"]["sha"]
        key = f"{n}:{head}"
        entry = self.state.dispatch_entry(key)
        if entry is None and self.state.dispatched(key):
            # dispatched by an older gate version (no time recorded): count it once, from now
            self.state.record_dispatch(key, self.now(), 1)
            return False
        if entry is not None:
            if entry.get("count", 0) >= int(self.cfg.get("desk_max_dispatches_per_head", 2)):
                return False
            wait = 60 * float(self.cfg.get("desk_retry_minutes", 90))
            if self.now() - float(entry.get("at", 0)) < wait:
                return False
        comments = self.api("GET", self.p(f"issues/{n}/comments?per_page=100"), paginate=True)
        if self.latest_desk_verdict(comments, head) is not None:
            return False  # the desk already judged this head (blocker): a rerun would repeat it
        status, why = self.checks_status(head)
        if status != MERGE:
            log.info("#%s: no review desk run while checks are not green (%s)", n, why)
            return False
        return True

    def dispatch_review(self, pr: dict) -> None:
        if not self.cfg.get("dispatch_review_desk"):
            return
        n, head = pr["number"], pr["head"]["sha"]
        key = f"{n}:{head}"
        wf = self.cfg["review_desk_workflow"]
        try:
            res = self.api("GET", self.p(f"actions/workflows/{wf}/runs?per_page=20"))
            active = [r for r in (res or {}).get("workflow_runs", []) if r.get("status") != "completed"]
            if active:
                log.info("review desk busy (%s run active): #%s waits for the next tick", len(active), n)
                return
            self.api("POST", self.p(f"actions/workflows/{wf}/dispatches"),
                     {"ref": self.cfg["base"], "inputs[pr]": str(n)})
        except GhError as e:
            log.error("review desk dispatch for #%s failed: %s", n, e)
            return
        entry = self.state.dispatch_entry(key) or {}
        count = int(entry.get("count", 0)) + 1
        self.state.record_dispatch(key, self.now(), count)
        self.state.mark_dispatched(key)
        log.info("dispatched review desk for #%s at %s (dispatch %s)%s", n, head[:7], count,
                 " (dry-run: the only write)" if self.dry else "")

    def merge(self, pr: dict) -> str | None:
        n, head = pr["number"], pr["head"]["sha"]
        if self.dry:
            log.info("[dry-run] would squash-merge #%s at %s", n, head[:7])
            return None
        try:
            res = self.api("PUT", self.p(f"pulls/{n}/merge"), {"sha": head, "merge_method": "squash"})
        except GhError as e:
            log.error("merge of #%s refused by GitHub: %s", n, e)
            self.comment(n, head, "merge-error", f"merge was refused by GitHub: {e}")
            return None
        self.state.data["merged"][str(n)] = head
        self.state.data["last_merge"] = {"pr": n, "sha": str((res or {}).get("sha", "")), "at": self.now(), "done": False}
        sha = str((res or {}).get("sha", ""))[:7]
        self.comment(n, head, "merged", f"merged (squash) at {head[:7]}, commit {sha}")
        log.info("merged #%s", n)
        return str(n)

    def update_branch(self, pr: dict) -> None:
        n, head = pr["number"], pr["head"]["sha"]
        if self.dry:
            log.info("[dry-run] would update branch of #%s", n)
            return
        try:
            self.api("PUT", self.p(f"pulls/{n}/update-branch"), {"expected_head_sha": head})
            log.info("updated branch of #%s; waiting for checks", n)
        except GhError as e:
            log.error("update-branch #%s failed: %s", n, e)
            self.comment(n, head, "update-failed", f"could not update branch: {e}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Polling merge gate")
    ap.add_argument("--config", default=os.environ.get("MERGE_GATE_CONFIG"))
    ap.add_argument("--dry-run", action="store_true", help="log only (also forced by dry_run = true in config)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)
    cfg = load_config(args.config)
    sd = Path(cfg["state_dir"])
    sd.mkdir(parents=True, exist_ok=True)
    if (sd / "KILL").exists() or Path(cfg.get("kill_switch", "/nonexistent")).exists():
        log.warning("kill switch present, doing nothing")
        return 0
    lock = open(sd / "lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log.warning("another run holds the lock, exiting")
        return 0
    dry = args.dry_run or bool(cfg["dry_run"])
    log.info("tick start (dry_run=%s)", dry)
    if cfg["proxy"]:  # urllib (Telegram) honours the same proxy as gh
        for k in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
            os.environ[k] = cfg["proxy"]
    state = State(str(sd), dry)
    try:
        Gate(cfg, GhApi(cfg["proxy"]), state, dry, load_notify()).tick()
    except GhError as e:
        log.error("tick failed: %s", e)
        return 1
    finally:
        state.save()
    return 0


if __name__ == "__main__":
    sys.exit(main())

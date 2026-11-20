#!/usr/bin/env python3
"""Polling merge gate: replaces GitHub merge queue + auto-merge on a private Free repo (R20-2, #1018).

Runs every few minutes from a systemd --user timer on the CI box (no inbound webhooks). Python stdlib
only; all GitHub access goes through the `gh` CLI (`gh api`), optionally via a local HTTP proxy.

A PR is merged (squash, guarded by its head SHA) only when ALL hold:
  1. label `merge-queue` is present (or auto-merge was requested, for the transition);
  2. not a draft, base branch is the configured base;
  3. every required check is green on the exact head SHA;
  4. a review-desk comment for that exact head SHA says `Verdict: no blocker`, or a human APPROVED
     review on that head from an allowlisted numeric user id;
  5. protected paths (migrations, workflows, deploy scripts, prod compose) are untouched, unless the
     label `owner-approved` was added by an allowlisted user (checked through the timeline API);
  6. the branch is up to date with the base (else the branch is updated and the PR waits a tick).
One merge per tick. State + lock + kill switch live in the state dir. Dry-run logs only.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

log = logging.getLogger("merge_gate")

DEFAULTS = {
    "repo": "Mahan-film/roxira-platform",
    "base": "main",
    "label": "merge-queue",
    "owner_label": "owner-approved",
    "dry_run": True,
    "allow_auto_merge_flag": True,
    "proxy": "",
    "state_dir": "~/.local/state/roxira-merge-gate",
    "required_checks": [
        "Detect changes",
        "Secret scan (new commits only)",
        "Agent guards (money, tenant scope, model ids, secrets)",
        "Pytest (unit)",
        "Compose config",
        "Frontend lint + build",
        "Backend (tsc + jest + Postgres specs)",
        "Frontend gate",
    ],
    "protected_globs": [
        "migrations/**",
        "**/migrations/**",
        ".github/workflows/**",
        "scripts/ops/deploy*.sh",
        "docker-compose.prod.yml",
    ],
    "review_comment_authors": ["github-actions[bot]"],
    "approver_ids": [],
    "owner_approver_ids": [],
}
GREEN = {"success", "skipped", "neutral"}
REVIEW_HEADER_RE = re.compile(
    r"^Cross-family review\b(?:\s*\([^)]*\))?\s*(?:@|of)\s*(?P<sha>[0-9a-fA-F]{7,40})"
)
VERDICT_RE = re.compile(r"^\s*\**\s*verdict\s*\**\s*:\s*\**\s*(no blocker|blocker)", re.IGNORECASE)

MERGE, BEHIND, WAIT, REFUSE, SKIP = "merge", "behind", "wait", "refuse", "skip"


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
            cmd += ["--paginate", "--slurp"]
        for k, v in (fields or {}).items():
            cmd += ["-f", f"{k}={v}"]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, env=self.env, timeout=90)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise GhError(str(e)) from e
        if r.returncode != 0:
            raise GhError((r.stderr or r.stdout).strip()[:500])
        out = r.stdout.strip()
        data = json.loads(out) if out else None
        if paginate and isinstance(data, list):
            flat: list = []
            for page in data:
                flat.extend(page if isinstance(page, list) else [page])
            return flat
        return data


class State:
    def __init__(self, directory: str):
        self.path = Path(directory) / "state.json"
        self.data: dict = {"commented": [], "merged": {}}
        if self.path.exists():
            try:
                self.data.update(json.loads(self.path.read_text()))
            except (OSError, ValueError):
                log.warning("state file unreadable, starting fresh")

    def seen(self, key: str) -> bool:
        return key in self.data["commented"]

    def mark(self, key: str) -> None:
        self.data["commented"] = (self.data["commented"] + [key])[-500:]

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent)
        with os.fdopen(fd, "w") as fh:
            json.dump(self.data, fh)
        os.replace(tmp, self.path)


class Gate:
    def __init__(self, cfg: dict, api, state: State, dry_run: bool):
        self.cfg, self.api, self.state, self.dry = cfg, api, state, dry_run
        self.repo = cfg["repo"]

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

    def review_ok(self, n: int, head: str) -> tuple[bool, str]:
        head = head.lower()
        comments = self.api("GET", self.p(f"issues/{n}/comments?per_page=100"), paginate=True)
        authors = set(self.cfg["review_comment_authors"])
        revs = [
            c
            for c in comments
            if (c.get("body") or "").lstrip().startswith("Cross-family review")
            and (c.get("user") or {}).get("login") in authors
        ]
        if revs:
            body = revs[-1]["body"].lstrip()
            m = REVIEW_HEADER_RE.match(body.splitlines()[0])
            verdict = None
            for ln in body.splitlines():
                v = VERDICT_RE.match(ln)
                if v:
                    verdict = v.group(1).lower()
            if m and head.startswith(m.group("sha").lower()) and verdict == "no blocker":
                return True, "review desk: no blocker"
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

    def owner_approved(self, n: int, labels: set[str]) -> bool:
        if self.cfg["owner_label"] not in labels:
            return False
        events = self.api("GET", self.p(f"issues/{n}/timeline?per_page=100"), paginate=True)
        last = None
        for e in events:
            if e.get("event") == "labeled" and (e.get("label") or {}).get("name") == self.cfg["owner_label"]:
                last = e
        actor = ((last or {}).get("actor") or {}).get("id")
        return actor is not None and actor in set(self.cfg["owner_approver_ids"])

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
        if pr.get("mergeable_state") == "dirty":
            return REFUSE, "conflict", "merge conflicts with the base branch"
        files = self.api("GET", self.p(f"pulls/{n}/files?per_page=100"), paginate=True)
        hits = protected_hits(files, self.cfg["protected_globs"])
        if hits and not self.owner_approved(n, labels):
            return REFUSE, "protected", (
                "touches protected paths ("
                + ", ".join(hits[:5])
                + ") and has no `"
                + self.cfg["owner_label"]
                + "` label added by an allowlisted user"
            )
        ok, why = self.review_ok(n, head)
        if not ok:
            return REFUSE, "review", why
        status, why = self.checks_status(head)
        if status != MERGE:
            return status, "checks", why
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
        to_merge, to_update = None, None
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
            if status == REFUSE:
                self.comment(n, head, code, f"not merged: {why}")
            elif status == MERGE and to_merge is None:
                to_merge = pr
            elif status == BEHIND and to_update is None:
                to_update = pr
        if to_merge:
            return self.merge(to_merge)
        if to_update:
            self.update_branch(to_update)
        return None

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
    state = State(str(sd))
    try:
        Gate(cfg, GhApi(cfg["proxy"]), state, dry).tick()
    except GhError as e:
        log.error("tick failed: %s", e)
        return 1
    finally:
        if not dry:
            state.save()
    return 0


if __name__ == "__main__":
    sys.exit(main())

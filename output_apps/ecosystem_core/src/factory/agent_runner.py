#!/usr/bin/env python3
"""W10 phase 2 execution engine: turns one GitHub issue labelled `agent` into a PR.

Design lives in docs/AGENTS_WORKFORCE.md (sections 2-3) and docs/STRATEGY.md (W10 row).
The short version:

  - Never pushes to `main`. Every task runs in its own git worktree, created
    *outside* this repo checkout, on branch ``agent/<issue>-<slug>`` cut from
    ``origin/main``.
  - A cheap coding agent (OpenCode headless, OpenRouter DeepSeek tier) does the
    work inside that worktree with a prompt built from the issue plus the repo
    rules in AGENTS.md.
  - The diff is gated: it must touch at least one file, must not touch the
    denylist (compose files, CI config, nginx/systemd config, .env*, auth or
    payment modules), and must pass ``py_compile`` (and ``ruff`` if installed).
  - On success: commit, push the branch over HTTPS with a fine-grained PAT,
    open a PR via the GitHub REST API, comment the PR link on the issue, label
    the issue ``agent-pr-open``.
  - On any failure: comment on the issue explaining why, and stop. Nothing is
    pushed.
  - A kill switch (``AGENT_ENABLED``, default off), a daily $ budget tracked in
    a JSONL ledger outside the repo, and a concurrency cap (lock files) gate
    every run.

Env vars (documented in docs/AGENTS_WORKFORCE.md #6):
    AGENT_ENABLED            "1"/"true"/"yes" to allow real runs. Default: off.
    AGENT_DAILY_BUDGET_USD   Default 2.0.
    AGENT_MAX_CONCURRENT     Default 2.
    AGENT_LEDGER_PATH        Default /opt/roxira_platform_reports/agent_ledger.jsonl
    AGENT_LOCK_DIR           Default <ledger dir>/locks
    AGENT_WORKTREES_ROOT     Default /opt/roxira_platform_agent_worktrees
    AGENT_TASK_TIMEOUT_SECS  Default 900 (opencode run timeout)
    AGENT_OPENCODE_MODEL     Default openrouter/deepseek/deepseek-v4.1-flash
    GITHUB_AGENT_TOKEN       Fine-grained PAT: contents + pull requests + issues,
                             read/write, this repo only. Required for any GitHub
                             call. Never logged, never defaulted.
    GITHUB_REPO              Default mahan-films/roxira-platform
    OPENROUTER_API_KEY       Required by `opencode run` itself and used (via
                             GET /api/v1/key) to measure spend before/after a task.

CLI:
    python3 agent_runner.py             # process one task, if any is eligible
    python3 agent_runner.py --dry-run   # everything up to the opencode call,
                                         # no GitHub token required, prints the plan
    python3 agent_runner.py --issue 42  # target one specific issue number
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_REPO = "mahan-films/roxira-platform"
DEFAULT_MODEL = "openrouter/deepseek/deepseek-v4.1-flash"
DEFAULT_DAILY_BUDGET_USD = 2.0
DEFAULT_MAX_CONCURRENT = 2
DEFAULT_TASK_TIMEOUT_SECS = 900
DEFAULT_LEDGER_PATH = "/opt/roxira_platform_reports/agent_ledger.jsonl"
DEFAULT_WORKTREES_ROOT = "/opt/roxira_platform_agent_worktrees"
AGENT_LABEL = "agent"
DONE_LABEL = "agent-pr-open"

# Paths a cheap agent must never touch. Matched with fnmatch against the
# repo-relative, forward-slash path of every changed file.
DENYLIST_PATTERNS: tuple[str, ...] = (
    "docker-compose*.yml",
    "docker-compose*.yaml",
    ".github/*",
    ".github/**",
    "*nginx*.conf",
    "**/nginx*.conf",
    "*.service",
    "**/*.service",
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
)
# Substring checks on the lowercased path, for things a glob pattern names
# badly (auth/payment code can live anywhere in the tree).
DENYLIST_KEYWORDS: tuple[str, ...] = ("zibal", "/payment", "/auth", "_auth", "auth_", "systemd")


@dataclass
class RunnerConfig:
    repo: str = DEFAULT_REPO
    model: str = DEFAULT_MODEL
    daily_budget_usd: float = DEFAULT_DAILY_BUDGET_USD
    max_concurrent: int = DEFAULT_MAX_CONCURRENT
    task_timeout_secs: int = DEFAULT_TASK_TIMEOUT_SECS
    ledger_path: Path = field(default_factory=lambda: Path(DEFAULT_LEDGER_PATH))
    lock_dir: Path | None = None
    worktrees_root: Path = field(default_factory=lambda: Path(DEFAULT_WORKTREES_ROOT))
    github_token: str = ""
    openrouter_key: str = ""

    def __post_init__(self) -> None:
        if self.lock_dir is None:
            self.lock_dir = self.ledger_path.parent / "locks"

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> RunnerConfig:
        env = os.environ if env is None else env
        return cls(
            repo=env.get("GITHUB_REPO", DEFAULT_REPO).strip(),
            model=env.get("AGENT_OPENCODE_MODEL", DEFAULT_MODEL).strip(),
            daily_budget_usd=_env_float(env, "AGENT_DAILY_BUDGET_USD", DEFAULT_DAILY_BUDGET_USD),
            max_concurrent=_env_int(env, "AGENT_MAX_CONCURRENT", DEFAULT_MAX_CONCURRENT),
            task_timeout_secs=_env_int(
                env, "AGENT_TASK_TIMEOUT_SECS", DEFAULT_TASK_TIMEOUT_SECS
            ),
            ledger_path=Path(env.get("AGENT_LEDGER_PATH", DEFAULT_LEDGER_PATH).strip()),
            lock_dir=Path(env["AGENT_LOCK_DIR"].strip()) if env.get("AGENT_LOCK_DIR") else None,
            worktrees_root=Path(
                env.get("AGENT_WORKTREES_ROOT", DEFAULT_WORKTREES_ROOT).strip()
            ),
            github_token=env.get("GITHUB_AGENT_TOKEN", "").strip(),
            openrouter_key=env.get("OPENROUTER_API_KEY", "").strip(),
        )


def _env_float(env: dict[str, str], key: str, default: float) -> float:
    try:
        return float(env[key])
    except (KeyError, ValueError):
        return default


def _env_int(env: dict[str, str], key: str, default: int) -> int:
    try:
        return int(env[key])
    except (KeyError, ValueError):
        return default


def is_enabled(env: dict[str, str] | None = None) -> bool:
    """Kill switch. Default OFF: an unset/empty/garbage value never enables runs."""
    env = os.environ if env is None else env
    return env.get("AGENT_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------------
# Slug / branch naming
# ---------------------------------------------------------------------------

_SLUG_STRIP_RE = re.compile(r"[^a-z0-9]+")


def slugify(text: str, max_len: int = 40) -> str:
    """Lowercase, ASCII, hyphenated slug for use in a git branch name.

    Non-ASCII (e.g. Persian issue titles) collapses to nothing gracefully
    rather than raising, so a Farsi-only title still yields a usable (if
    short) branch name instead of crashing the runner.
    """
    ascii_text = text.encode("ascii", "ignore").decode("ascii")
    slug = _SLUG_STRIP_RE.sub("-", ascii_text.lower()).strip("-")
    slug = slug[:max_len].strip("-")
    return slug or "task"


def branch_name(issue_number: int, title: str) -> str:
    return f"agent/{issue_number}-{slugify(title)}"


# ---------------------------------------------------------------------------
# Denylist
# ---------------------------------------------------------------------------


def denylist_violations(changed_files: list[str]) -> list[str]:
    """Return the subset of changed_files that must never be touched by an agent."""
    hits: list[str] = []
    for raw in changed_files:
        path = raw.strip().replace("\\", "/").lstrip("/")
        if not path:
            continue
        lower = path.lower()
        if any(kw in lower for kw in DENYLIST_KEYWORDS):
            hits.append(raw)
            continue
        matched = any(
            fnmatch.fnmatch(path, pat) or fnmatch.fnmatch(lower, pat) for pat in DENYLIST_PATTERNS
        )
        if matched:
            hits.append(raw)
    return hits


# ---------------------------------------------------------------------------
# Budget ledger (JSONL, outside the repo)
# ---------------------------------------------------------------------------


def _today_str() -> str:
    return datetime.now(UTC).date().isoformat()


def append_ledger(ledger_path: Path, record: dict[str, Any]) -> None:
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    row = {"ts": datetime.now(UTC).isoformat(), **record}
    with open(ledger_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def today_spend_usd(ledger_path: Path, today: str | None = None) -> float:
    """Sum cost_usd of every ledger row whose ts falls on `today` (UTC date, ISO)."""
    if not ledger_path.exists():
        return 0.0
    today = today or _today_str()
    total = 0.0
    with open(ledger_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if str(rec.get("ts", ""))[:10] == today:
                total += float(rec.get("cost_usd") or 0.0)
    return round(total, 6)


def budget_remaining_usd(
    ledger_path: Path, daily_budget_usd: float, today: str | None = None
) -> float:
    return round(daily_budget_usd - today_spend_usd(ledger_path, today), 6)


def over_budget(ledger_path: Path, daily_budget_usd: float, today: str | None = None) -> bool:
    return today_spend_usd(ledger_path, today) >= daily_budget_usd


# ---------------------------------------------------------------------------
# Concurrency lock (one file per active task under lock_dir)
# ---------------------------------------------------------------------------

_STALE_LOCK_SECS = 3600 * 3  # a lock older than this is assumed to be from a crashed run


def _active_lock_files(lock_dir: Path, stale_after_secs: int = _STALE_LOCK_SECS) -> list[Path]:
    if not lock_dir.exists():
        return []
    now = time.time()
    active = []
    for p in lock_dir.glob("*.lock"):
        try:
            age = now - p.stat().st_mtime
        except OSError:
            continue
        if age > stale_after_secs:
            try:
                p.unlink()
            except OSError:
                pass
            continue
        active.append(p)
    return active


def acquire_lock(lock_dir: Path, issue_number: int, max_concurrent: int) -> Path | None:
    """Best-effort concurrency cap. Returns the lock path on success, else None.

    Uses O_CREAT|O_EXCL so two processes racing for the same issue can't both
    win, and refuses a new lock once `max_concurrent` others are already held.
    """
    lock_dir.mkdir(parents=True, exist_ok=True)
    active = _active_lock_files(lock_dir)
    lock_path = lock_dir / f"{issue_number}.lock"
    if lock_path in active:
        return None  # this issue is already being worked
    if len(active) >= max_concurrent:
        return None
    try:
        fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
    except FileExistsError:
        return None
    return lock_path


def release_lock(lock_path: Path | None) -> None:
    if lock_path is None:
        return
    try:
        lock_path.unlink()
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------


def build_prompt(issue: dict[str, Any], agents_md: str = "") -> str:
    title = issue.get("title", "").strip()
    number = issue.get("number")
    body = (issue.get("body") or "").strip()
    rules = [
        "You are a cheap, sandboxed coding agent working on one small GitHub issue.",
        f"Issue #{number}: {title}",
        "",
        "Rules, non-negotiable:",
        "- Make the smallest change that resolves the issue. Do not refactor unrelated code.",
        "- Never run `git push`, `git commit --amend -f`, or touch branch `main` directly.",
        "  Your worktree is already on an isolated branch; just leave your changes committed"
        " or uncommitted there, the wrapper handles commit/push.",
        "- Never edit: docker-compose*.yml, anything under .github/, nginx or systemd config,"
        " any .env* file, or any authentication/payment (Zibal) module. If the issue asks for"
        " that, stop and explain why in your final message instead of doing it.",
        "- Never hardcode a secret, API key, or password. Read secrets from the environment"
        " only, same as the rest of this repo (see CLAUDE.md).",
        "- Follow AGENTS.md for this repo's architecture and coding rules.",
        "- Add or update tests for behavior you change when the repo has a test suite for that"
        " area.",
    ]
    if agents_md:
        rules.append("")
        rules.append("--- AGENTS.md (repo engineering standard) ---")
        rules.append(agents_md.strip())
    if body:
        rules.append("")
        rules.append("--- Issue body ---")
        rules.append(body)
    return "\n".join(rules)


# ---------------------------------------------------------------------------
# Subprocess helpers (git, opencode, py_compile, ruff)
# ---------------------------------------------------------------------------


def run_cmd(
    args: list[str],
    cwd: str | Path | None = None,
    timeout: int | None = None,
    env: dict | None = None,
) -> subprocess.CompletedProcess:
    return subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=env,
    )


def create_worktree(
    worktrees_root: Path, repo_dir: Path, branch: str, base_ref: str = "origin/main"
) -> Path:
    worktrees_root.mkdir(parents=True, exist_ok=True)
    path = worktrees_root / branch.replace("/", "__")
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    res = run_cmd(
        ["git", "worktree", "add", "-B", branch, str(path), base_ref], cwd=repo_dir, timeout=120
    )
    if res.returncode != 0:
        raise RuntimeError(f"git worktree add failed: {res.stderr.strip()}")
    return path


def remove_worktree(repo_dir: Path, path: Path, branch: str) -> None:
    run_cmd(["git", "worktree", "remove", "--force", str(path)], cwd=repo_dir, timeout=60)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    run_cmd(["git", "branch", "-D", branch], cwd=repo_dir, timeout=30)


def changed_files(worktree_path: Path, base_ref: str = "origin/main") -> list[str]:
    res = run_cmd(["git", "status", "--porcelain"], cwd=worktree_path, timeout=30)
    files = []
    for line in res.stdout.splitlines():
        line = line.rstrip("\n")
        if len(line) > 3:
            files.append(line[3:].strip())
    return files


def run_opencode(
    worktree_path: Path,
    prompt: str,
    model: str,
    timeout_secs: int,
    env: dict[str, str],
) -> subprocess.CompletedProcess:
    """Run OpenCode headless in the worktree. `opencode run [message] --model ... --format json`."""
    args = [
        "opencode",
        "run",
        prompt,
        "--model",
        model,
        "--format",
        "json",
    ]
    return run_cmd(args, cwd=worktree_path, timeout=timeout_secs, env=env)


def run_quality_checks(worktree_path: Path, py_files: list[str]) -> tuple[bool, str]:
    """py_compile every changed .py file, then ruff if it's on PATH. Returns (ok, message)."""
    if not py_files:
        return True, "no Python files changed"
    messages: list[str] = []
    for f in py_files:
        res = run_cmd([sys.executable, "-m", "py_compile", f], cwd=worktree_path, timeout=60)
        if res.returncode != 0:
            return False, f"py_compile failed for {f}:\n{res.stderr.strip()}"
    messages.append(f"py_compile OK ({len(py_files)} file(s))")

    if shutil.which("ruff"):
        res = run_cmd(["ruff", "check", *py_files], cwd=worktree_path, timeout=60)
        if res.returncode != 0:
            return False, f"ruff check failed:\n{res.stdout.strip()}\n{res.stderr.strip()}"
        messages.append("ruff check OK")
    else:
        messages.append("ruff not installed, skipped")
    return True, "; ".join(messages)


# ---------------------------------------------------------------------------
# GitHub REST (stdlib urllib — no new dependency; `requests` is not declared
# anywhere in pyproject.toml/ci/requirements-test.txt for this repo)
# ---------------------------------------------------------------------------


class GitHubError(RuntimeError):
    pass


def _gh_request(
    method: str,
    url: str,
    token: str,
    payload: dict[str, Any] | None = None,
    timeout: int = 30,
) -> Any:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise GitHubError(f"GitHub API {method} {url} -> {exc.code}: {detail}") from None


def list_agent_issues(token: str, repo: str) -> list[dict[str, Any]]:
    url = f"https://api.github.com/repos/{repo}/issues?labels={AGENT_LABEL}&state=open&per_page=50"
    result = _gh_request("GET", url, token)
    # Exclude issues already claimed (an open PR exists) and pull requests
    # (the issues endpoint also returns PRs).
    eligible = []
    for issue in result:
        if "pull_request" in issue:
            continue
        labels = {lb.get("name") for lb in issue.get("labels", [])}
        if DONE_LABEL not in labels:
            eligible.append(issue)
    return eligible


def comment_on_issue(token: str, repo: str, number: int, body: str) -> None:
    url = f"https://api.github.com/repos/{repo}/issues/{number}/comments"
    _gh_request("POST", url, token, {"body": body})


def add_labels(token: str, repo: str, number: int, labels: list[str]) -> None:
    url = f"https://api.github.com/repos/{repo}/issues/{number}/labels"
    _gh_request("POST", url, token, {"labels": labels})


def create_pull_request(
    token: str, repo: str, title: str, head: str, base: str, body: str
) -> dict[str, Any]:
    url = f"https://api.github.com/repos/{repo}/pulls"
    payload = {"title": title, "head": head, "base": base, "body": body}
    return _gh_request("POST", url, token, payload)


def push_branch(worktree_path: Path, branch: str, token: str, repo: str) -> None:
    """Push over HTTPS using the token, never printing it. Raises with the token scrubbed."""
    push_url = f"https://x-access-token:{token}@github.com/{repo}.git"
    res = run_cmd(
        ["git", "push", push_url, f"HEAD:refs/heads/{branch}"], cwd=worktree_path, timeout=120
    )
    if res.returncode != 0:
        raise RuntimeError(f"git push failed: {_scrub_token(res.stderr, token)}")


def _scrub_token(text: str, token: str) -> str:
    return text.replace(token, "***") if token else text


def openrouter_key_usage(api_key: str, timeout: int = 15) -> float | None:
    """GET /api/v1/key usage in USD. Returns None on any failure (spend tracking
    then falls back to 0.0 for that task rather than blocking the pipeline)."""
    req = urllib.request.Request("https://openrouter.ai/api/v1/key")
    req.add_header("Authorization", f"Bearer {api_key}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return float(data.get("data", {}).get("usage") or 0.0)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def read_agents_md(repo_dir: Path) -> str:
    path = repo_dir / "AGENTS.md"
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def process_one_issue(
    issue: dict[str, Any],
    cfg: RunnerConfig,
    repo_dir: Path,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Run the full worktree -> agent -> checks -> PR pipeline for one issue.

    Returns a result dict with at least a `status` key, always used as the
    ledger record's `status` field. Never raises for expected failure modes
    (denylist hit, no changes, checks failed) — those are reported via a
    GitHub comment and a normal ("skipped"/"failed") return.
    """
    number = issue["number"]
    title = issue.get("title", "")
    branch = branch_name(number, title)
    agents_md = read_agents_md(repo_dir)
    prompt = build_prompt(issue, agents_md)

    plan = {
        "issue": number,
        "title": title,
        "branch": branch,
        "model": cfg.model,
        "prompt_preview": prompt[:400],
    }
    if dry_run:
        return {"status": "dry-run", **plan}

    lock_path = acquire_lock(cfg.lock_dir, number, cfg.max_concurrent)
    if lock_path is None:
        return {"status": "skipped", "reason": "concurrency limit or already running", **plan}

    worktree_path: Path | None = None
    try:
        worktree_path = create_worktree(cfg.worktrees_root, repo_dir, branch)

        spend_before = openrouter_key_usage(cfg.openrouter_key) if cfg.openrouter_key else None
        env = os.environ.copy()
        env["OPENROUTER_API_KEY"] = cfg.openrouter_key
        # The opencode process's own exit code isn't authoritative (it can exit 0
        # having refused the task); what matters is whether files changed, checked
        # below. Its raw output is still useful for debugging a stuck task.
        _opencode_result = run_opencode(
            worktree_path, prompt, cfg.model, cfg.task_timeout_secs, env
        )
        spend_after = openrouter_key_usage(cfg.openrouter_key) if cfg.openrouter_key else None
        cost_usd = 0.0
        if spend_before is not None and spend_after is not None:
            cost_usd = max(0.0, round(spend_after - spend_before, 6))

        files = changed_files(worktree_path)
        if not files:
            no_changes_msg = "Agent run made no changes. Stopping without a PR."
            comment_on_issue(cfg.github_token, cfg.repo, number, no_changes_msg)
            append_ledger(
                cfg.ledger_path, {"issue": number, "cost_usd": cost_usd, "status": "no-changes"}
            )
            return {"status": "no-changes", "cost_usd": cost_usd, **plan}

        violations = denylist_violations(files)
        if violations:
            comment_on_issue(
                cfg.github_token,
                cfg.repo,
                number,
                "Agent run touched files on the denylist, so no PR was opened:\n"
                + "\n".join(f"- `{f}`" for f in violations),
            )
            append_ledger(
                cfg.ledger_path,
                {
                    "issue": number,
                    "cost_usd": cost_usd,
                    "status": "denylist-blocked",
                    "files": violations,
                },
            )
            return {
                "status": "denylist-blocked",
                "violations": violations,
                "cost_usd": cost_usd,
                **plan,
            }

        py_files = [f for f in files if f.endswith(".py")]
        ok, check_msg = run_quality_checks(worktree_path, py_files)
        if not ok:
            comment_on_issue(
                cfg.github_token,
                cfg.repo,
                number,
                f"Agent run failed checks, no PR opened:\n\n```\n{check_msg}\n```",
            )
            append_ledger(
                cfg.ledger_path, {"issue": number, "cost_usd": cost_usd, "status": "checks-failed"}
            )
            return {"status": "checks-failed", "detail": check_msg, "cost_usd": cost_usd, **plan}

        run_cmd(["git", "add", "-A"], cwd=worktree_path, timeout=30)
        commit_res = run_cmd(
            ["git", "commit", "-m", f"agent: {title} (#{number})"], cwd=worktree_path, timeout=30
        )
        commit_output = commit_res.stdout + commit_res.stderr
        if commit_res.returncode != 0 and "nothing to commit" not in commit_output:
            raise RuntimeError(f"git commit failed: {commit_res.stderr.strip()}")

        push_branch(worktree_path, branch, cfg.github_token, cfg.repo)
        pr_body = (
            f"Resolves #{number}.\n\n{check_msg}\n\n---\nOpened automatically by agent_runner.py "
            f"(model `{cfg.model}`). Never auto-merged; review required."
        )
        pr = create_pull_request(
            cfg.github_token,
            cfg.repo,
            title=f"agent: {title} (#{number})",
            head=branch,
            base="main",
            body=pr_body,
        )
        pr_url = pr.get("html_url", "")
        comment_on_issue(cfg.github_token, cfg.repo, number, f"Opened {pr_url}")
        add_labels(cfg.github_token, cfg.repo, number, [DONE_LABEL])
        append_ledger(
            cfg.ledger_path,
            {"issue": number, "cost_usd": cost_usd, "status": "pr-opened", "pr_url": pr_url},
        )
        return {"status": "pr-opened", "pr_url": pr_url, "cost_usd": cost_usd, **plan}
    finally:
        if worktree_path is not None:
            remove_worktree(repo_dir, worktree_path, branch)
        release_lock(lock_path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="W10 phase 2 cheap-agent task runner")
    ap.add_argument(
        "--dry-run", action="store_true", help="plan only, no GitHub token required, no push"
    )
    ap.add_argument("--issue", type=int, default=None, help="target one specific issue number")
    ap.add_argument("--repo-dir", type=Path, default=Path(__file__).resolve().parents[4])
    args = ap.parse_args(argv)

    cfg = RunnerConfig.from_env()

    if not args.dry_run and not is_enabled():
        print(
            "AGENT_ENABLED is off; refusing to run (set AGENT_ENABLED=1 to enable). See --dry-run."
        )
        return 0

    if not args.dry_run and over_budget(cfg.ledger_path, cfg.daily_budget_usd):
        print(
            f"Daily agent budget exhausted: spent "
            f"{today_spend_usd(cfg.ledger_path):.2f} of {cfg.daily_budget_usd:.2f} USD today."
        )
        return 0

    if not args.dry_run and not cfg.github_token:
        print("GITHUB_AGENT_TOKEN is not set; cannot list or act on issues.")
        return 1

    if args.dry_run and not cfg.github_token:
        if args.issue is None:
            print("Dry run with no GITHUB_AGENT_TOKEN: pass --issue N to preview a specific issue.")
            print(json.dumps({"status": "dry-run", "config": _cfg_summary(cfg)}, indent=2))
            return 0
        issue = {"number": args.issue, "title": f"(unknown title, issue #{args.issue})", "body": ""}
        result = process_one_issue(issue, cfg, args.repo_dir, dry_run=True)
        print(json.dumps(result, indent=2))
        return 0

    issues = list_agent_issues(cfg.github_token, cfg.repo)
    if args.issue is not None:
        issues = [i for i in issues if i["number"] == args.issue]
    if not issues:
        print("No eligible open issues labelled 'agent'.")
        return 0

    result = process_one_issue(issues[0], cfg, args.repo_dir, dry_run=args.dry_run)
    print(json.dumps(result, indent=2, default=str))
    return 0 if result.get("status") in {"pr-opened", "dry-run", "no-changes", "skipped"} else 1


def _cfg_summary(cfg: RunnerConfig) -> dict[str, Any]:
    return {
        "repo": cfg.repo,
        "model": cfg.model,
        "daily_budget_usd": cfg.daily_budget_usd,
        "max_concurrent": cfg.max_concurrent,
        "ledger_path": str(cfg.ledger_path),
        "worktrees_root": str(cfg.worktrees_root),
        "has_github_token": bool(cfg.github_token),
        "has_openrouter_key": bool(cfg.openrouter_key),
    }


if __name__ == "__main__":
    raise SystemExit(main())

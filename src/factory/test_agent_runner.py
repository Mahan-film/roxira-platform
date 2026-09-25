"""Unit tests for output_apps/ecosystem_core/src/factory/agent_runner.py (W10 phase 2).

Pure logic only: budget ledger, concurrency lock, denylist, slug/branch naming,
prompt building, and RunnerConfig parsing, plus the process_one_issue
orchestration with git/opencode/GitHub all mocked. No real subprocess, no real
network call — safe for `pytest -m "not integration"`.

agent_runner.py lives under output_apps/, outside pytest's `testpaths = ["src"]`
(see pyproject.toml), so it can't be `import`-ed normally. src/test_ci_quarantine_guard.py
forbids module-level side effects in any src/test_*.py (import-time code it can't see is
exactly what src/ci_quarantine.py exists to quarantine), so the dynamic file-path load
happens inside a fixture at test-setup time, not at collection/import time. Every test
below relies on the `agent_runner` global that fixture populates.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

agent_runner = None  # populated by _load_agent_runner() before any test runs


@pytest.fixture(scope="session", autouse=True)
def _load_agent_runner():
    global agent_runner
    if agent_runner is None:
        module_path = (
            Path(__file__).resolve().parents[2]
            / "output_apps"
            / "ecosystem_core"
            / "src"
            / "factory"
            / "agent_runner.py"
        )
        spec = importlib.util.spec_from_file_location("agent_runner", module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["agent_runner"] = module
        spec.loader.exec_module(module)
        agent_runner = module
    return agent_runner


# ---------------------------------------------------------------------------
# slug / branch naming
# ---------------------------------------------------------------------------


def test_slugify_basic():
    assert agent_runner.slugify("Fix the login bug!!") == "fix-the-login-bug"


def test_slugify_truncates():
    long_title = "a" * 100
    assert len(agent_runner.slugify(long_title, max_len=40)) <= 40


def test_slugify_non_ascii_falls_back_gracefully():
    # Persian-only titles must not crash the runner; ascii-encode drops them.
    slug = agent_runner.slugify("رفع باگ ورود")
    assert slug == "task"


def test_slugify_empty_string():
    assert agent_runner.slugify("") == "task"


def test_branch_name_format():
    assert agent_runner.branch_name(42, "Fix login bug") == "agent/42-fix-login-bug"


# ---------------------------------------------------------------------------
# denylist
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "docker-compose.prod.yml",
        "docker-compose.yml",
        ".github/workflows/ci.yml",
        ".github/dependabot.yml",
        "nginx.conf",
        "output_apps/nginx_config/nginx.conf",
        ".env",
        ".env.production",
        "some/deep/path/.env.local",
        "systemd/roxira-worker.service",
        "output_apps/generated_modules/smartjudge/zibal_gateway.py",
        "output_apps/generated_modules/smartjudge/payment/charge.py",
        "src/auth/session.py",
        "src/user_auth_helpers.py",
    ],
)
def test_denylist_blocks_sensitive_paths(path):
    assert agent_runner.denylist_violations([path]) == [path]


@pytest.mark.parametrize(
    "path",
    [
        "output_apps/generated_modules/smartjudge/models.py",
        "src/factory/product_scaffolder.py",
        "README.md",
        "output_apps/enterprise_hub/frontend/src/app/page.tsx",
    ],
)
def test_denylist_allows_ordinary_paths(path):
    assert agent_runner.denylist_violations([path]) == []


def test_denylist_mixed_list_returns_only_violations():
    files = ["src/ok.py", ".env", "docs/notes.md", "docker-compose.yml"]
    assert agent_runner.denylist_violations(files) == [".env", "docker-compose.yml"]


def test_denylist_empty_list():
    assert agent_runner.denylist_violations([]) == []


# ---------------------------------------------------------------------------
# budget ledger
# ---------------------------------------------------------------------------


def test_today_spend_usd_no_file(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    assert agent_runner.today_spend_usd(ledger) == 0.0


def test_append_ledger_writes_current_utc_timestamp(tmp_path):
    ledger = tmp_path / "reports" / "ledger.jsonl"
    agent_runner.append_ledger(ledger, {"issue": 1, "cost_usd": 0.10})
    rec = json.loads(ledger.read_text().splitlines()[0])
    assert rec["issue"] == 1
    assert rec["cost_usd"] == 0.10
    assert rec["ts"][:10] == agent_runner._today_str()


def test_today_spend_usd_sums_only_matching_day(tmp_path):
    ledger = tmp_path / "reports" / "ledger.jsonl"
    today = "2026-09-25"
    ledger.parent.mkdir(parents=True)
    rows = [
        {"ts": f"{today}T09:00:00+00:00", "issue": 1, "cost_usd": 0.10},
        {"ts": f"{today}T10:00:00+00:00", "issue": 2, "cost_usd": 0.25},
        {"ts": "2020-01-01T00:00:00+00:00", "issue": 3, "cost_usd": 99.0},
    ]
    with open(ledger, "a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")
        fh.write("not json, skip me\n")
    assert agent_runner.today_spend_usd(ledger, today=today) == 0.35


def test_budget_remaining_and_over_budget(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    today = "2026-09-25"
    ledger.parent.mkdir(parents=True, exist_ok=True)
    with open(ledger, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"ts": f"{today}T00:00:00+00:00", "issue": 1, "cost_usd": 1.5}) + "\n")
    assert agent_runner.budget_remaining_usd(ledger, 2.0, today=today) == 0.5
    assert agent_runner.over_budget(ledger, 2.0, today=today) is False
    assert agent_runner.over_budget(ledger, 1.5, today=today) is True


# ---------------------------------------------------------------------------
# concurrency lock
# ---------------------------------------------------------------------------


def test_acquire_and_release_lock(tmp_path):
    lock_dir = tmp_path / "locks"
    lock = agent_runner.acquire_lock(lock_dir, issue_number=7, max_concurrent=2)
    assert lock is not None
    assert lock.exists()
    agent_runner.release_lock(lock)
    assert not lock.exists()


def test_acquire_lock_respects_max_concurrent(tmp_path):
    lock_dir = tmp_path / "locks"
    lock1 = agent_runner.acquire_lock(lock_dir, issue_number=1, max_concurrent=1)
    lock2 = agent_runner.acquire_lock(lock_dir, issue_number=2, max_concurrent=1)
    assert lock1 is not None
    assert lock2 is None  # cap already reached
    agent_runner.release_lock(lock1)
    lock3 = agent_runner.acquire_lock(lock_dir, issue_number=2, max_concurrent=1)
    assert lock3 is not None


def test_acquire_lock_same_issue_twice_refused(tmp_path):
    lock_dir = tmp_path / "locks"
    lock1 = agent_runner.acquire_lock(lock_dir, issue_number=5, max_concurrent=5)
    lock2 = agent_runner.acquire_lock(lock_dir, issue_number=5, max_concurrent=5)
    assert lock1 is not None
    assert lock2 is None


def test_stale_lock_is_reclaimed(tmp_path, monkeypatch):
    lock_dir = tmp_path / "locks"
    lock = agent_runner.acquire_lock(lock_dir, issue_number=9, max_concurrent=1)
    assert lock is not None
    # Simulate a crashed run: push the lock's mtime far into the past.
    import os
    import time as time_mod

    old = time_mod.time() - agent_runner._STALE_LOCK_SECS - 10
    os.utime(lock, (old, old))
    lock2 = agent_runner.acquire_lock(lock_dir, issue_number=1, max_concurrent=1)
    assert lock2 is not None  # the stale lock was reclaimed, freeing a slot


# ---------------------------------------------------------------------------
# kill switch
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", ["1", "true", "True", "yes", "on"])
def test_is_enabled_truthy(value):
    assert agent_runner.is_enabled({"AGENT_ENABLED": value}) is True


@pytest.mark.parametrize("value", ["", "0", "false", "no", "garbage"])
def test_is_enabled_falsy(value):
    assert agent_runner.is_enabled({"AGENT_ENABLED": value}) is False


def test_is_enabled_missing_defaults_off():
    assert agent_runner.is_enabled({}) is False


# ---------------------------------------------------------------------------
# GitHub-Actions-only host allowlist
# ---------------------------------------------------------------------------


def test_is_github_actions_runtime_true_only_for_exact_marker():
    assert agent_runner.is_github_actions_runtime({"AGENT_RUNTIME": "github-actions"}) is True


@pytest.mark.parametrize("value", ["", "true", "1", "GitHub-Actions", "production"])
def test_is_github_actions_runtime_false_otherwise(value):
    assert agent_runner.is_github_actions_runtime({"AGENT_RUNTIME": value}) is False


def test_is_github_actions_runtime_tolerates_surrounding_whitespace():
    assert agent_runner.is_github_actions_runtime({"AGENT_RUNTIME": " github-actions "}) is True


def test_is_github_actions_runtime_missing_defaults_false():
    assert agent_runner.is_github_actions_runtime({}) is False


# ---------------------------------------------------------------------------
# minimal opencode env (no environment inheritance beyond PATH/HOME)
# ---------------------------------------------------------------------------


def test_minimal_opencode_env_contains_only_expected_keys():
    base_env = {
        "PATH": "/usr/bin",
        "HOME": "/home/runner",
        "GITHUB_AGENT_TOKEN": "supersecret",
        "ACTIONS_RUNTIME_TOKEN": "also-secret",
        "AWS_SECRET_ACCESS_KEY": "leaked-if-copied",
    }
    env = agent_runner.minimal_opencode_env("or-key-123", base_env=base_env)
    assert env == {"PATH": "/usr/bin", "HOME": "/home/runner", "OPENROUTER_API_KEY": "or-key-123"}
    assert "GITHUB_AGENT_TOKEN" not in env
    assert "ACTIONS_RUNTIME_TOKEN" not in env
    assert "AWS_SECRET_ACCESS_KEY" not in env


def test_minimal_opencode_env_tolerates_missing_path_or_home():
    env = agent_runner.minimal_opencode_env("or-key", base_env={})
    assert env == {"OPENROUTER_API_KEY": "or-key"}


# ---------------------------------------------------------------------------
# prompt building
# ---------------------------------------------------------------------------


def test_build_prompt_includes_issue_and_rules():
    issue = {"number": 42, "title": "Add a helper", "body": "Please add foo()."}
    prompt = agent_runner.build_prompt(issue, agents_md="## Rules\nDo X.")
    assert "Issue #42" in prompt
    assert "Add a helper" in prompt
    assert "Please add foo()." in prompt
    assert "never" in prompt.lower()
    assert "docker-compose" in prompt
    assert "## Rules" in prompt


def test_build_prompt_without_agents_md_or_body():
    issue = {"number": 1, "title": "Do a thing"}
    prompt = agent_runner.build_prompt(issue)
    assert "Issue #1" in prompt
    assert "AGENTS.md (repo" not in prompt


# ---------------------------------------------------------------------------
# RunnerConfig.from_env
# ---------------------------------------------------------------------------


def test_runner_config_defaults():
    cfg = agent_runner.RunnerConfig.from_env({})
    assert cfg.repo == agent_runner.DEFAULT_REPO
    assert cfg.model == agent_runner.DEFAULT_MODEL
    assert cfg.daily_budget_usd == agent_runner.DEFAULT_DAILY_BUDGET_USD
    assert cfg.max_concurrent == agent_runner.DEFAULT_MAX_CONCURRENT
    assert cfg.github_token == ""
    assert cfg.lock_dir == cfg.ledger_path.parent / "locks"


def test_default_model_comes_from_executor_role():
    """DEFAULT_MODEL (W12) tracks config/models.yaml's `executor` role, not a hardcoded id."""
    from output_apps.generated_modules.smartjudge import model_registry

    primary = model_registry.role_models("executor")[0]
    assert agent_runner.DEFAULT_MODEL == f"openrouter/{primary}"


# ---------------------------------------------------------------------------
# run_opencode
# ---------------------------------------------------------------------------


def test_run_opencode_pins_build_agent(monkeypatch, tmp_path):
    """`--agent build` must always be passed: OpenCode runs non-interactively in CI, and
    only the `build` agent's permissions in opencode.json avoid `ask` (which would hang)."""
    captured = {}

    def fake_run_cmd(args, **kwargs):
        captured["args"] = args
        return object()

    monkeypatch.setattr(agent_runner, "run_cmd", fake_run_cmd)
    agent_runner.run_opencode(tmp_path, "do the thing", "openrouter/some/model", 60, {})

    args = captured["args"]
    assert args[:2] == ["opencode", "run"]
    assert "--agent" in args
    assert args[args.index("--agent") + 1] == "build"
    assert "--model" in args
    assert args[args.index("--model") + 1] == "openrouter/some/model"


def test_runner_config_overrides_and_bad_numbers_fall_back():
    env = {
        "GITHUB_REPO": "owner/repo",
        "AGENT_DAILY_BUDGET_USD": "not-a-number",
        "AGENT_MAX_CONCURRENT": "5",
        "GITHUB_AGENT_TOKEN": "shh",
    }
    cfg = agent_runner.RunnerConfig.from_env(env)
    assert cfg.repo == "owner/repo"
    assert cfg.daily_budget_usd == agent_runner.DEFAULT_DAILY_BUDGET_USD  # bad value -> default
    assert cfg.max_concurrent == 5
    assert cfg.github_token == "shh"


# ---------------------------------------------------------------------------
# process_one_issue orchestration (git/opencode/GitHub all mocked)
# ---------------------------------------------------------------------------


def _base_cfg(tmp_path, **overrides):
    kwargs = dict(
        repo="Mahan-film/roxira-platform",
        model="openrouter/deepseek/deepseek-v4.1-flash",
        daily_budget_usd=2.0,
        max_concurrent=2,
        task_timeout_secs=60,
        ledger_path=tmp_path / "ledger.jsonl",
        lock_dir=tmp_path / "locks",
        worktrees_root=tmp_path / "worktrees",
        github_token="tok",
        openrouter_key="or-key",
    )
    kwargs.update(overrides)
    return agent_runner.RunnerConfig(**kwargs)


def test_process_one_issue_dry_run_does_no_io(tmp_path, monkeypatch):
    called = {"create_worktree": False}
    monkeypatch.setattr(
        agent_runner, "create_worktree", lambda *a, **k: called.__setitem__("create_worktree", True)
    )
    cfg = _base_cfg(tmp_path)
    issue = {"number": 1, "title": "Do a thing", "body": ""}
    result = agent_runner.process_one_issue(issue, cfg, tmp_path, dry_run=True)
    assert result["status"] == "dry-run"
    assert called["create_worktree"] is False


def test_process_one_issue_refuses_real_run_off_actions(tmp_path, monkeypatch):
    monkeypatch.delenv("AGENT_RUNTIME", raising=False)
    called = {"create_worktree": False}
    monkeypatch.setattr(
        agent_runner, "create_worktree", lambda *a, **k: called.__setitem__("create_worktree", True)
    )
    cfg = _base_cfg(tmp_path)
    issue = {"number": 99, "title": "Should not run for real", "body": ""}
    result = agent_runner.process_one_issue(issue, cfg, tmp_path, dry_run=False)
    assert result["status"] == "refused-not-actions"
    assert called["create_worktree"] is False
    assert not (tmp_path / "locks" / "99.lock").exists()  # never even got to the lock


def test_process_one_issue_no_changes(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_RUNTIME", "github-actions")
    cfg = _base_cfg(tmp_path)
    worktree = tmp_path / "wt"
    worktree.mkdir()
    monkeypatch.setattr(agent_runner, "create_worktree", lambda *a, **k: worktree)
    monkeypatch.setattr(agent_runner, "remove_worktree", lambda *a, **k: None)
    monkeypatch.setattr(agent_runner, "run_opencode", lambda *a, **k: None)
    monkeypatch.setattr(agent_runner, "changed_files", lambda *a, **k: [])
    monkeypatch.setattr(agent_runner, "openrouter_key_usage", lambda *a, **k: 1.0)
    comments = []
    monkeypatch.setattr(
        agent_runner, "comment_on_issue", lambda token, repo, number, body: comments.append(body)
    )

    issue = {"number": 2, "title": "No-op issue", "body": ""}
    result = agent_runner.process_one_issue(issue, cfg, tmp_path, dry_run=False)

    assert result["status"] == "no-changes"
    assert comments and "no changes" in comments[0].lower()
    assert not (tmp_path / "locks" / "2.lock").exists()  # lock released


def test_process_one_issue_denylist_blocked(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_RUNTIME", "github-actions")
    cfg = _base_cfg(tmp_path)
    worktree = tmp_path / "wt"
    worktree.mkdir()
    monkeypatch.setattr(agent_runner, "create_worktree", lambda *a, **k: worktree)
    monkeypatch.setattr(agent_runner, "remove_worktree", lambda *a, **k: None)
    monkeypatch.setattr(agent_runner, "run_opencode", lambda *a, **k: None)
    monkeypatch.setattr(agent_runner, "changed_files", lambda *a, **k: [".env", "src/ok.py"])
    monkeypatch.setattr(agent_runner, "openrouter_key_usage", lambda *a, **k: None)
    comments = []
    monkeypatch.setattr(
        agent_runner, "comment_on_issue", lambda token, repo, number, body: comments.append(body)
    )
    pr_calls = []
    monkeypatch.setattr(agent_runner, "create_pull_request", lambda *a, **k: pr_calls.append(1))

    issue = {"number": 3, "title": "Touches env file", "body": ""}
    result = agent_runner.process_one_issue(issue, cfg, tmp_path, dry_run=False)

    assert result["status"] == "denylist-blocked"
    assert result["violations"] == [".env"]
    assert not pr_calls
    assert comments and ".env" in comments[0]


def test_process_one_issue_checks_failed(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_RUNTIME", "github-actions")
    cfg = _base_cfg(tmp_path)
    worktree = tmp_path / "wt"
    worktree.mkdir()
    monkeypatch.setattr(agent_runner, "create_worktree", lambda *a, **k: worktree)
    monkeypatch.setattr(agent_runner, "remove_worktree", lambda *a, **k: None)
    monkeypatch.setattr(agent_runner, "run_opencode", lambda *a, **k: None)
    monkeypatch.setattr(agent_runner, "changed_files", lambda *a, **k: ["src/broken.py"])
    monkeypatch.setattr(agent_runner, "openrouter_key_usage", lambda *a, **k: None)
    failing_check = (False, "py_compile failed for src/broken.py")
    monkeypatch.setattr(agent_runner, "run_quality_checks", lambda *a, **k: failing_check)
    comments = []
    monkeypatch.setattr(
        agent_runner, "comment_on_issue", lambda token, repo, number, body: comments.append(body)
    )
    pr_calls = []
    monkeypatch.setattr(agent_runner, "create_pull_request", lambda *a, **k: pr_calls.append(1))

    issue = {"number": 4, "title": "Broken syntax", "body": ""}
    result = agent_runner.process_one_issue(issue, cfg, tmp_path, dry_run=False)

    assert result["status"] == "checks-failed"
    assert not pr_calls
    assert comments and "py_compile" in comments[0]


def test_process_one_issue_success_opens_pr_and_logs_spend(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_RUNTIME", "github-actions")
    cfg = _base_cfg(tmp_path)
    worktree = tmp_path / "wt"
    worktree.mkdir()
    monkeypatch.setattr(agent_runner, "create_worktree", lambda *a, **k: worktree)
    removed = []
    monkeypatch.setattr(agent_runner, "remove_worktree", lambda *a, **k: removed.append(True))
    monkeypatch.setattr(agent_runner, "run_opencode", lambda *a, **k: None)
    monkeypatch.setattr(agent_runner, "changed_files", lambda *a, **k: ["src/ok.py"])
    usage_values = iter([10.0, 10.20])
    monkeypatch.setattr(agent_runner, "openrouter_key_usage", lambda *a, **k: next(usage_values))
    monkeypatch.setattr(agent_runner, "run_quality_checks", lambda *a, **k: (True, "py_compile OK"))

    class _FakeCompletedProcess:
        returncode = 0
        stdout = ""
        stderr = ""

    monkeypatch.setattr(agent_runner, "run_cmd", lambda *a, **k: _FakeCompletedProcess())
    monkeypatch.setattr(agent_runner, "push_branch", lambda *a, **k: None)
    monkeypatch.setattr(
        agent_runner, "create_pull_request", lambda *a, **k: {"html_url": "https://github.com/x/y/pull/9"}
    )
    comments = []
    monkeypatch.setattr(
        agent_runner, "comment_on_issue", lambda token, repo, number, body: comments.append(body)
    )
    labels = []
    monkeypatch.setattr(
        agent_runner, "add_labels", lambda token, repo, number, labs: labels.append(labs)
    )

    issue = {"number": 5, "title": "Add a helper", "body": ""}
    result = agent_runner.process_one_issue(issue, cfg, tmp_path, dry_run=False)

    assert result["status"] == "pr-opened"
    assert result["pr_url"] == "https://github.com/x/y/pull/9"
    assert abs(result["cost_usd"] - 0.20) < 1e-9
    assert labels == [[agent_runner.DONE_LABEL]]
    assert any("https://github.com/x/y/pull/9" in c for c in comments)
    assert removed == [True]  # worktree cleanup always runs
    assert agent_runner.today_spend_usd(cfg.ledger_path) == pytest.approx(0.20)
    assert not (tmp_path / "locks" / "5.lock").exists()


def test_process_one_issue_releases_lock_on_exception(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_RUNTIME", "github-actions")
    cfg = _base_cfg(tmp_path)

    def boom(*a, **k):
        raise RuntimeError("git worktree add failed")

    monkeypatch.setattr(agent_runner, "create_worktree", boom)
    issue = {"number": 6, "title": "Will explode", "body": ""}
    with pytest.raises(RuntimeError):
        agent_runner.process_one_issue(issue, cfg, tmp_path, dry_run=False)
    assert not (tmp_path / "locks" / "6.lock").exists()


def test_process_one_issue_use_worktree_false_branches_in_place(tmp_path, monkeypatch):
    """On GitHub Actions (AGENT_USE_WORKTREE=false), branch in repo_dir directly and
    never call create_worktree/remove_worktree at all."""
    monkeypatch.setenv("AGENT_RUNTIME", "github-actions")
    cfg = _base_cfg(tmp_path, use_worktree=False)

    create_worktree_calls = []
    remove_worktree_calls = []
    monkeypatch.setattr(
        agent_runner, "create_worktree", lambda *a, **k: create_worktree_calls.append(1)
    )
    monkeypatch.setattr(
        agent_runner, "remove_worktree", lambda *a, **k: remove_worktree_calls.append(1)
    )

    in_place_calls = []

    def fake_create_branch_in_place(repo_dir, branch, base_ref="origin/main"):
        in_place_calls.append((repo_dir, branch))
        return repo_dir

    monkeypatch.setattr(agent_runner, "create_branch_in_place", fake_create_branch_in_place)
    monkeypatch.setattr(agent_runner, "run_opencode", lambda *a, **k: None)
    monkeypatch.setattr(agent_runner, "changed_files", lambda *a, **k: [])
    monkeypatch.setattr(agent_runner, "openrouter_key_usage", lambda *a, **k: None)
    monkeypatch.setattr(agent_runner, "comment_on_issue", lambda *a, **k: None)

    issue = {"number": 10, "title": "In-place branch test", "body": ""}
    result = agent_runner.process_one_issue(issue, cfg, tmp_path, dry_run=False)

    assert result["status"] == "no-changes"
    assert in_place_calls == [(tmp_path, "agent/10-in-place-branch-test")]
    assert not create_worktree_calls
    assert not remove_worktree_calls  # nothing to clean up in the caller's own checkout


# ---------------------------------------------------------------------------
# GitHub token never logged in a push failure
# ---------------------------------------------------------------------------


def test_push_branch_scrubs_token_on_failure(tmp_path, monkeypatch):
    class FakeResult:
        returncode = 1
        stderr = "remote: Invalid credentials for x-access-token:SECRET123"
        stdout = ""

    monkeypatch.setattr(agent_runner, "run_cmd", lambda *a, **k: FakeResult())
    with pytest.raises(RuntimeError) as excinfo:
        agent_runner.push_branch(tmp_path, "agent/1-x", "SECRET123", "owner/repo")
    assert "SECRET123" not in str(excinfo.value)
    assert "***" in str(excinfo.value)


@pytest.mark.parametrize("branch", ["main", "master", "feature/x", "", "Agent/1-x"])
def test_push_branch_refuses_non_agent_branch(tmp_path, monkeypatch, branch):
    calls = []
    monkeypatch.setattr(agent_runner, "run_cmd", lambda *a, **k: calls.append(1))
    with pytest.raises(ValueError, match="agent"):
        agent_runner.push_branch(tmp_path, branch, "tok", "owner/repo")
    assert not calls  # never even attempted the push


def test_push_branch_allows_agent_branch(tmp_path, monkeypatch):
    class FakeResult:
        returncode = 0
        stderr = ""
        stdout = ""

    monkeypatch.setattr(agent_runner, "run_cmd", lambda *a, **k: FakeResult())
    agent_runner.push_branch(tmp_path, "agent/1-x", "tok", "owner/repo")  # no raise


# ---------------------------------------------------------------------------
# in-place branching (GitHub Actions mode, no worktree)
# ---------------------------------------------------------------------------


def test_create_branch_in_place_success(tmp_path, monkeypatch):
    calls = []

    def fake_run_cmd(args, cwd=None, timeout=None, env=None):
        calls.append((args, cwd))
        return type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(agent_runner, "run_cmd", fake_run_cmd)
    result = agent_runner.create_branch_in_place(tmp_path, "agent/1-x")
    assert result == tmp_path
    assert calls == [(["git", "checkout", "-B", "agent/1-x", "origin/main"], tmp_path)]


def test_create_branch_in_place_raises_on_failure(tmp_path, monkeypatch):
    def fake_run_cmd(*a, **k):
        return type("R", (), {"returncode": 1, "stdout": "", "stderr": "fatal: bad ref"})()

    monkeypatch.setattr(agent_runner, "run_cmd", fake_run_cmd)
    with pytest.raises(RuntimeError, match="bad ref"):
        agent_runner.create_branch_in_place(tmp_path, "agent/1-x")


# ---------------------------------------------------------------------------
# RunnerConfig.use_worktree parsing
# ---------------------------------------------------------------------------


def test_runner_config_use_worktree_defaults_true():
    cfg = agent_runner.RunnerConfig.from_env({})
    assert cfg.use_worktree is True


@pytest.mark.parametrize("value", ["0", "false", "no", "off", "garbage"])
def test_runner_config_use_worktree_false(value):
    cfg = agent_runner.RunnerConfig.from_env({"AGENT_USE_WORKTREE": value})
    assert cfg.use_worktree is False


@pytest.mark.parametrize("value", ["1", "true", "True", "yes", "on"])
def test_runner_config_use_worktree_true(value):
    cfg = agent_runner.RunnerConfig.from_env({"AGENT_USE_WORKTREE": value})
    assert cfg.use_worktree is True

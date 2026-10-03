"""Unit tests for scripts/ci/merge_gate_run.py.

The fakes return the exact shapes captured from GitHub (gh 2.97.0): ``gh pr view
--json`` objects, and ``gh api --paginate --slurp`` arrays of pages. No network,
no gh, no import-time code: the script is loaded inside a fixture.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
CI_DIR = REPO_ROOT / "scripts" / "ci"

SHA = "2af56ab42dfb2e8ed1c23235f40a5d511282e1bf"
REPO = "org/repo"
SECRET = "ghp_SECRET_TOKEN_VALUE"
ALL_CHECKS = (
    "Detect changes",
    "Secret scan (new commits only)",
    "Pytest (unit)",
    "Frontend gate",
    "Undefined names",
    "System inventory up to date",
)


@pytest.fixture
def mgr(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Load scripts/ci/merge_gate_run.py (it imports merge_gate from its folder)."""
    monkeypatch.syspath_prepend(str(CI_DIR))
    monkeypatch.delitem(sys.modules, "merge_gate", raising=False)
    spec = importlib.util.spec_from_file_location(
        "merge_gate_run_under_test", CI_DIR / "merge_gate_run.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv("GH_REPO", REPO)
    return module


def pr_json(**over: Any) -> dict[str, Any]:
    base = {
        "additions": 346,
        "author": {"id": "U_kgDODXpkLA", "is_bot": False, "login": "mahan-films", "name": ""},
        "deletions": 0,
        "headRefName": "issue-361",
        "headRefOid": SHA,
        "isDraft": False,
        "labels": [],
        "mergeable": "MERGEABLE",
        "number": 362,
        "state": "OPEN",
    }
    base.update(over)
    return base


def run_obj(name: str, conclusion: str | None = "success", status: str = "completed") -> dict:
    return {"name": name, "status": status, "conclusion": conclusion}


class FakeGh:
    """Records calls; answers with the real --slurp shapes."""

    def __init__(
        self,
        pr: dict | None = None,
        check_pages: list[dict] | None = None,
        file_pages: list[list[dict]] | None = None,
        comment_pages: list[list[dict]] | None = None,
    ) -> None:
        self.pr = pr or pr_json()
        self.check_pages = check_pages if check_pages is not None else [
            {"total_count": 4, "check_runs": [run_obj(n) for n in ALL_CHECKS[:4]]},
            {"total_count": 4, "check_runs": [run_obj(n) for n in ALL_CHECKS[4:]]},
        ]
        self.file_pages = file_pages if file_pages is not None else [
            [{"filename": "docs/a.md"}],
            [{"filename": "docs/b.md"}],
        ]
        self.comment_pages = comment_pages if comment_pages is not None else [[]]
        self.calls: list[tuple[list[str], str]] = []

    def __call__(self, args: list[str], *, token_env: str = "GH_TOKEN") -> str:
        self.calls.append((args, token_env))
        if args[:2] == ["pr", "view"]:
            return json.dumps(self.pr)
        if args[:1] == ["api"] and args[-2:] == ["--paginate", "--slurp"]:
            if args[1].endswith("/check-runs"):
                return json.dumps(self.check_pages)
            if args[1].endswith("/files"):
                return json.dumps(self.file_pages)
            if args[1].endswith("/comments"):
                return json.dumps(self.comment_pages)
        return ""

    @property
    def writes(self) -> list[tuple[list[str], str]]:
        return [
            c
            for c in self.calls
            if c[0][:2] == ["pr", "merge"] or "--field" in c[0] or "--method" in c[0]
        ]


def decide(mgr: Any, fake: FakeGh, *, token: bool, expected: str = SHA) -> dict:
    return mgr.run(
        362, expected_sha=expected, actors="mahan-films", gh=fake, has_merge_token=token
    )


def test_normalize_pr_with_label_objects(mgr: Any) -> None:
    out = mgr.normalize_pr(pr_json(labels=[{"name": "hold"}, {"name": "bug"}]))
    assert out["labels"] == ["hold", "bug"]
    assert out["author_login"] == "mahan-films"
    assert out["head_sha"] == SHA and out["is_draft"] is False


def test_normalize_checks_two_pages_and_null_conclusion(mgr: Any) -> None:
    pages = [
        {"total_count": 2, "check_runs": [run_obj("A")]},
        {"total_count": 2, "check_runs": [run_obj("B", None, "in_progress")]},
    ]
    assert mgr.normalize_checks(pages) == [
        {"name": "A", "status": "completed", "conclusion": "success"},
        {"name": "B", "status": "in_progress", "conclusion": None},
    ]


def test_flatten_pages(mgr: Any) -> None:
    assert mgr.flatten_pages([[{"filename": "a"}], [{"filename": "b"}, {"filename": "c"}]]) == [
        {"filename": "a"},
        {"filename": "b"},
        {"filename": "c"},
    ]


def test_wait_does_no_writes(mgr: Any) -> None:
    fake = FakeGh()
    decision = decide(mgr, fake, token=True, expected="0" * 40)
    assert decision["action"] == "wait"
    assert fake.writes == []


def test_null_conclusion_waits(mgr: Any) -> None:
    pages = [{"total_count": 6, "check_runs": [run_obj(n) for n in ALL_CHECKS[:5]]
              + [run_obj(ALL_CHECKS[5], None, "in_progress")]}]
    fake = FakeGh(check_pages=pages)
    assert decide(mgr, fake, token=True)["action"] == "wait"
    assert fake.writes == []


def test_files_from_second_page_are_judged(mgr: Any) -> None:
    fake = FakeGh(file_pages=[[{"filename": "docs/a.md"}], [{"filename": ".github/workflows/x.yml"}]])
    decision = decide(mgr, fake, token=True)
    assert decision["action"] == "block"
    assert any(".github/workflows/x.yml" in r for r in decision["reasons"])


def test_block_creates_human_readable_comment(mgr: Any) -> None:
    fake = FakeGh(pr=pr_json(labels=[{"name": "hold"}], mergeable="CONFLICTING"))
    decision = decide(mgr, fake, token=True)
    assert decision["action"] == "block"
    writes = fake.writes
    assert len(writes) == 1
    args = writes[0][0]
    assert args[:2] == ["api", f"repos/{REPO}/issues/362/comments"]
    assert "--method" not in args
    body = args[args.index("--field") + 1]
    assert body.startswith("body=<!-- rx-merge-gate -->\nMerge gate: BLOCK\n")
    assert "- hold label present" in body
    assert "- merge conflict" in body
    assert "[" not in body


def test_block_patches_existing_marked_comment(mgr: Any) -> None:
    comments = [[{"id": 1, "body": "hello"}], [{"id": 77, "body": "<!-- rx-merge-gate -->\nold"}]]
    fake = FakeGh(pr=pr_json(isDraft=True), comment_pages=comments)
    assert decide(mgr, fake, token=True)["action"] == "block"
    args = fake.writes[0][0]
    assert args[:4] == ["api", f"repos/{REPO}/issues/comments/77", "--method", "PATCH"]
    assert len(fake.writes) == 1


def test_merge_without_token_only_comments(mgr: Any) -> None:
    fake = FakeGh()
    decision = decide(mgr, fake, token=False)
    assert decision["action"] == "merge" and not decision.get("merged")
    assert all(c[0][:2] != ["pr", "merge"] for c in fake.calls)
    assert len(fake.writes) == 1
    assert "MERGE_BOT_TOKEN is not set" in fake.writes[0][0][-1]
    assert "<!-- rx-merge-gate -->" in fake.writes[0][0][-1]


def test_merge_with_token_merges_with_bot_token(mgr: Any) -> None:
    fake = FakeGh()
    decision = decide(mgr, fake, token=True)
    assert decision["action"] == "merge" and decision["merged"] is True
    assert fake.calls[-1] == (
        ["pr", "merge", "362", "--squash", "--match-head-commit", SHA],
        "MERGE_BOT_TOKEN",
    )
    assert [c for c in fake.calls if c[1] == "MERGE_BOT_TOKEN"] == [fake.calls[-1]]


def test_empty_expected_sha_judges_current_head(mgr: Any) -> None:
    assert decide(mgr, FakeGh(), token=True, expected="")["action"] == "merge"


def test_main_called_process_error_exit_1_no_token(
    mgr: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("PR_NUMBER", "362")
    monkeypatch.setenv("EXPECTED_SHA", SHA)
    monkeypatch.setenv("MERGE_BOT_TOKEN", SECRET)
    monkeypatch.setenv("GH_TOKEN", SECRET)

    def boom(args: list[str], *, token_env: str = "GH_TOKEN") -> str:
        raise subprocess.CalledProcessError(4, ["gh", *args, SECRET], stderr=SECRET)

    monkeypatch.setattr(mgr, "gh", boom)
    assert mgr.main() == 1
    out = capsys.readouterr()
    assert "error: gh failed (exit 4)" in out.out
    assert SECRET not in out.out + out.err


def test_main_without_pr_number_is_noop(mgr: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PR_NUMBER", raising=False)
    monkeypatch.delenv("INPUT_PR_NUMBER", raising=False)
    assert mgr.main() == 0


def test_main_merge_ok_exit_0(mgr: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PR_NUMBER", "362")
    monkeypatch.setenv("EXPECTED_SHA", SHA)
    monkeypatch.setenv("MERGE_BOT_TOKEN", SECRET)
    fake = FakeGh()
    monkeypatch.setattr(mgr, "gh", fake)
    assert mgr.main() == 0
    assert fake.calls[-1][1] == "MERGE_BOT_TOKEN"


def test_gh_merge_requires_merge_bot_token(mgr: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MERGE_BOT_TOKEN", raising=False)
    monkeypatch.setenv("GH_TOKEN", SECRET)
    with pytest.raises(ValueError):
        mgr.gh(["pr", "merge", "1"], token_env="MERGE_BOT_TOKEN")


def test_main_prints_sanitized_gh_error(
    mgr: Any,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    summary = tmp_path / "step_summary.md"
    monkeypatch.setenv("PR_NUMBER", "362")
    monkeypatch.setenv("EXPECTED_SHA", SHA)
    monkeypatch.setenv("MERGE_BOT_TOKEN", SECRET)
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    fake = FakeGh()

    def boom(args: list[str], *, token_env: str = "GH_TOKEN") -> str:
        if args[:2] == ["pr", "merge"]:
            raise subprocess.CalledProcessError(
                1,
                ["gh", *args],
                stderr=(
                    "GraphQL: Resource not accessible by personal access token "
                    "(mergePullRequest)\nextra detail"
                ),
            )
        return fake(args, token_env=token_env)

    monkeypatch.setattr(mgr, "gh", boom)
    assert mgr.main() == 1
    out = capsys.readouterr()
    assert "error: gh failed (exit 1) while running: gh pr merge" in out.out
    assert (
        "gh said: GraphQL: Resource not accessible by personal access token "
        "(mergePullRequest)" in out.out
    )
    assert "extra detail" not in out.out
    assert "extra detail" not in out.err
    written = summary.read_text(encoding="utf-8")
    assert "error: gh failed (exit 1) while running: gh pr merge" in written
    assert "gh said: GraphQL: Resource not accessible by personal access token" in written


def test_main_gh_error_redacts_tokens(
    mgr: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    bot_token = "merge_bot_secret_value_0123456789"
    fake_pat = "ghp_" + "A" * 30
    monkeypatch.setenv("PR_NUMBER", "362")
    monkeypatch.setenv("EXPECTED_SHA", SHA)
    monkeypatch.setenv("MERGE_BOT_TOKEN", bot_token)
    fake = FakeGh()

    def boom(args: list[str], *, token_env: str = "GH_TOKEN") -> str:
        if args[:2] == ["pr", "merge"]:
            raise subprocess.CalledProcessError(
                1,
                ["gh", *args],
                stderr=f"token {fake_pat} and {bot_token} denied\nmore",
            )
        return fake(args, token_env=token_env)

    monkeypatch.setattr(mgr, "gh", boom)
    assert mgr.main() == 1
    out = capsys.readouterr()
    combined = out.out + out.err
    assert fake_pat not in combined
    assert bot_token not in combined
    assert "[REDACTED]" in out.out

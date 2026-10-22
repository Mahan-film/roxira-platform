"""daytona_runner tests: an in-memory fake client, no network and no real sandbox."""

from __future__ import annotations

import io
import json
import sys
import tarfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import daytona_runner as dr  # noqa: E402


class FakeClient:
    """Records every call; create/upload/exec succeed, delete is recorded."""

    def __init__(self):
        self.calls: list = []
        self.uploads: list = []
        self.deleted: list = []

    def create(self):
        self.calls.append("create")
        return {"id": "sbx-1"}

    def upload(self, sandbox, remote_path, data):
        self.calls.append("upload")
        self.uploads.append((remote_path, data))

    def exec(self, sandbox, command, cwd=None, env=None, timeout=None):
        self.calls.append("exec")
        return dr.CmdResult(0, "ok")

    def delete(self, sandbox):
        self.calls.append("delete")
        self.deleted.append(sandbox)


@pytest.fixture(autouse=True)
def state_home(tmp_path, monkeypatch):
    monkeypatch.setenv("ROXIRA_AGENTS_HOME", str(tmp_path))
    return tmp_path


def worktree(tmp_path: Path) -> Path:
    wt = tmp_path / "wt"
    (wt / "scripts").mkdir(parents=True)
    (wt / "scripts" / "run.sh").write_text("echo hi\n")
    return wt


def host_group() -> dict:
    return {"name": "sh:bash-n", "kind": "host", "dir": "", "cmd": "bash -n scripts/run.sh",
            "eslint_prefix": "", "files": []}


def test_tarball_excludes_secrets_and_heavy_paths(tmp_path):
    wt = worktree(tmp_path)
    (wt / ".env").write_text("SECRET=1\n")
    (wt / ".env.local").write_text("X=1\n")
    (wt / "nested").mkdir()
    (wt / "nested" / ".env.production").write_text("X=1\n")
    (wt / "data").mkdir()
    (wt / "data" / "dump.sql").write_text("select 1")
    (wt / ".git").mkdir()
    (wt / ".git" / "config").write_text("x")
    (wt / "node_modules").mkdir()
    (wt / "node_modules" / "a.js").write_text("x")
    (wt / "big").mkdir()
    (wt / "big" / "x.tar.gz").write_text("x")
    data = dr.build_tarball(wt)
    names = [m.name for m in tarfile.open(fileobj=io.BytesIO(data), mode="r:gz").getmembers()]
    assert "scripts/run.sh" in names
    assert not any(Path(n).name.startswith(".env") for n in names)
    assert not any(n.startswith(("data/", ".git/", "node_modules/")) for n in names)
    assert "big/x.tar.gz" not in names


def test_assert_no_env_rejects_a_secret(tmp_path):
    src = tmp_path / ".env"
    src.write_text("SECRET=1\n")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(src, arcname=".env")
    with pytest.raises(ValueError):
        dr.assert_no_env(buf.getvalue())


def test_run_creates_uploads_execs_and_deletes(tmp_path):
    wt = worktree(tmp_path)
    out = tmp_path / "out.json"
    client = FakeClient()
    rc = dr.run(str(wt), None, [host_group()], str(out), client=client)
    assert rc == 0
    assert client.calls[0] == "create"
    assert "upload" in client.calls and "exec" in client.calls
    assert client.deleted == [{"id": "sbx-1"}]
    payload = json.loads(out.read_text())
    assert payload["backend"] == "daytona" and payload["ok"] is True
    assert payload["groups"][0]["name"] == "sh:bash-n"
    assert payload["groups"][0]["status"] == "pass"
    assert any(path.endswith("wt.tar.gz") for path, _ in client.uploads)


def test_delete_happens_when_upload_fails(tmp_path):
    wt = worktree(tmp_path)

    class Boom(FakeClient):
        def upload(self, sandbox, remote_path, data):
            raise RuntimeError("boom")

    client = Boom()
    rc = dr.run(str(wt), None, [host_group()], str(tmp_path / "out.json"), client=client)
    assert rc == 3
    assert client.deleted == [{"id": "sbx-1"}]  # deleted even though setup failed


def test_delete_happens_when_unpack_exec_fails(tmp_path):
    wt = worktree(tmp_path)

    class Boom(FakeClient):
        def exec(self, sandbox, command, cwd=None, env=None, timeout=None):
            raise TimeoutError("slow")

    client = Boom()
    rc = dr.run(str(wt), None, [host_group()], str(tmp_path / "out.json"), client=client)
    assert rc == 3
    assert client.deleted == [{"id": "sbx-1"}]


def test_create_failure_reports_start_error(tmp_path):
    class NoCreate(FakeClient):
        def create(self):
            raise RuntimeError("no quota")

    client = NoCreate()
    rc = dr.run(str(worktree(tmp_path)), None, [host_group()],
                str(tmp_path / "out.json"), client=client)
    assert rc == 3
    assert client.deleted == []  # nothing to delete


def test_only_node_env_and_ci_are_forwarded(monkeypatch):
    monkeypatch.setenv("SECRET_TOKEN", "must-not-leak")
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("CI", "0")
    env = dr.forward_env()
    assert "SECRET_TOKEN" not in env
    assert env["NODE_ENV"] == "test"
    assert env["CI"] == "0"


class LintClient:
    """Serves the package probe / npm ci (fine) then two eslint reports (current, base)."""

    def __init__(self, current: str, base: str):
        self.current, self.base = current, base
        self.lint_calls = 0
        self.uploads: list = []

    def exec(self, sandbox, command, cwd=None, env=None, timeout=None):
        if "--format json" in command:
            self.lint_calls += 1
            return dr.CmdResult(0, self.current if self.lint_calls == 1 else self.base)
        return dr.CmdResult(0, "")  # package probe, npm ci and `true` all succeed

    def upload(self, sandbox, remote_path, data):
        self.uploads.append((remote_path, data))


def test_lint_reports_only_new_errors_and_uploads_base(tmp_path):
    group = {"name": "frontend:eslint", "kind": "lint", "dir": "app",
             "cmd": "npx --no-install eslint src/a.tsx", "eslint_prefix": "npx --no-install eslint",
             "files": ["src/a.tsx"], "base_files": {"src/a.tsx": "const a = 1;\n"}}
    current = json.dumps([{"filePath": "/tmp/wb/work/app/src/a.tsx",
                           "messages": [{"ruleId": "no-x", "severity": 2}]}])
    client = LintClient(current, "[]")
    result = dr._run_lint(client, {"id": "s"}, group, 60, set())
    assert result.exit_code == 1 and "new errors" in result.output
    assert any(path.endswith("app/src/a.tsx") for path, _ in client.uploads)


def test_lint_passes_when_error_is_pre_existing():
    group = {"name": "frontend:eslint", "kind": "lint", "dir": "app",
             "cmd": "npx --no-install eslint src/a.tsx", "eslint_prefix": "npx --no-install eslint",
             "files": ["src/a.tsx"], "base_files": {"src/a.tsx": "old\n"}}
    report = json.dumps([{"filePath": "/tmp/wb/work/app/src/a.tsx",
                          "messages": [{"ruleId": "no-x", "severity": 2}]}])
    client = LintClient(report, report)
    result = dr._run_lint(client, {"id": "s"}, group, 60, set())
    assert result.exit_code == 0 and "no new errors" in result.output


def test_missing_lockfile_is_skip_not_fail():
    class NoLock(FakeClient):
        def exec(self, sandbox, command, cwd=None, env=None, timeout=None):
            if "package-lock.json" in command:
                return dr.CmdResult(1, "")
            return dr.CmdResult(0, "")

    group = {"name": "hub:tsc", "kind": "node", "dir": "app", "cmd": "npx tsc",
             "eslint_prefix": "", "files": []}
    results, ok = dr.run_groups(NoLock(), {"id": "s"}, [group], 60, 900)
    assert ok is True and results[0]["status"] == "skip"


def test_py_group_skips_without_requirements():
    class NoReq(FakeClient):
        def exec(self, sandbox, command, cwd=None, env=None, timeout=None):
            if "requirements-test.txt" in command:
                return dr.CmdResult(4, "")
            return dr.CmdResult(0, "")

    group = {"name": "py:ruff-blocking", "kind": "py", "dir": "", "cmd": "ruff check x.py",
             "eslint_prefix": "", "files": []}
    results, ok = dr.run_groups(NoReq(), {"id": "s"}, [group], 60, 900)
    assert ok is True and results[0]["status"] == "skip"


def test_slot_guard_respects_the_limit(tmp_path):
    guard = dr.SlotGuard(tmp_path / "slots", 1)
    assert guard.acquire() is True
    assert dr.SlotGuard(tmp_path / "slots", 1).acquire() is False
    guard.release()
    assert dr.SlotGuard(tmp_path / "slots", 1).acquire() is True


def test_forward_env_defaults_ci(monkeypatch):
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("NODE_ENV", raising=False)
    env = dr.forward_env()
    assert env["CI"] == "1"
    assert env["NEXT_TELEMETRY_DISABLED"] == "1"

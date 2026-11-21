"""orch.gh_list must work without `gh api --slurp` (gh < 2.48): pages arrive as back-to-back JSON documents."""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import orch


def fake_run(stdout, rc=0, stderr=""):
    seen = {}

    def run(cmd, **kw):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, rc, stdout, stderr)

    return run, seen


def test_concatenated_pages_are_flattened(monkeypatch):
    run, seen = fake_run('[{"number": 1}, {"number": 2}]\n[{"number": 3}]\n')
    monkeypatch.setattr(orch.subprocess, "run", run)
    assert [x["number"] for x in orch.gh_list("repos/o/r/issues")] == [1, 2, 3]
    assert "--slurp" not in seen["cmd"] and "--paginate" in seen["cmd"]


def test_single_object_and_empty(monkeypatch):
    run, _ = fake_run('{"a": 1}')
    monkeypatch.setattr(orch.subprocess, "run", run)
    assert orch.gh_list("x") == [{"a": 1}]
    run, _ = fake_run("")
    monkeypatch.setattr(orch.subprocess, "run", run)
    assert orch.gh_list("x") == []


def test_failure_raises(monkeypatch):
    run, _ = fake_run("", rc=1, stderr="boom")
    monkeypatch.setattr(orch.subprocess, "run", run)
    try:
        orch.gh_list("x")
    except orch.GhError:
        return
    raise AssertionError("GhError not raised")


def test_allowlisted_numeric_id_is_trusted_but_contributor_is_not(monkeypatch):
    item = {"user": {"login": "x", "id": 42, "type": "User"}, "author_association": "CONTRIBUTOR", "body": "t"}
    monkeypatch.delenv("ORCH_TRUSTED_USER_IDS", raising=False)
    assert not orch.trusted(item)
    monkeypatch.setenv("ORCH_TRUSTED_USER_IDS", "7, 42,abc")
    assert orch.trusted(item)
    other = dict(item, user={"login": "y", "id": 43, "type": "User"})
    assert not orch.trusted(other)
    bot = dict(item, user={"login": "z[bot]", "id": 42, "type": "Bot"})
    assert not orch.trusted(bot)

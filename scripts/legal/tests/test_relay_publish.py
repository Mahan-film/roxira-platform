"""Offline tests for scripts/legal/relay_publish.sh.

Uses real local git repos (a bare `origin` plus a checkout) and a stub `gh` on PATH, so there is no
network and no GitHub call. Reproduces the bug where an untracked staged file already exists on
origin/main.

Run ONLY this file:
  python3 -m pytest scripts/legal/tests/test_relay_publish.py -q
"""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "relay_publish.sh"
GIT = shutil.which("git")
BASH = shutil.which("bash")
pytestmark = pytest.mark.skipif(not (GIT and BASH), reason="needs git and bash")

STAGED = "data/legal/staged/iran_relay_2026-10-15.jsonl"
OTHER = "data/legal/staged/law_watch_2026-10-15.jsonl"


def _git(*args, cwd=None, check=True):
    return subprocess.run(
        [GIT, *args], cwd=cwd, check=check, capture_output=True, text=True
    )


def _setup(tmp_path):
    """origin (bare) + work repo at commit A + a checkout clone that stays behind origin."""
    origin = tmp_path / "origin.git"
    _git("init", "--bare", str(origin))
    _git("symbolic-ref", "HEAD", "refs/heads/main", cwd=origin)

    work = tmp_path / "work"
    work.mkdir()
    _git("init", str(work))
    _git("symbolic-ref", "HEAD", "refs/heads/main", cwd=work)
    _git("remote", "add", "origin", str(origin), cwd=work)
    _git("config", "user.email", "relay@test", cwd=work)
    _git("config", "user.name", "relay test", cwd=work)
    (work / "README.md").write_text("seed\n", encoding="utf-8")
    _git("add", "-A", cwd=work)
    _git("commit", "-m", "seed", cwd=work)
    _git("push", "-u", "origin", "main", cwd=work)

    checkout = tmp_path / "checkout"
    _git("clone", str(origin), str(checkout))
    _git("config", "user.email", "relay@test", cwd=checkout)
    _git("config", "user.name", "relay test", cwd=checkout)
    return origin, checkout, work


def _advance_origin(work, files):
    """Commit `files` (rel path -> bytes) on main and push; the checkout does not see them yet."""
    for rel, data in files.items():
        p = work / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    _git("add", "-A", cwd=work)
    _git("commit", "-m", "advance", cwd=work)
    _git("push", "origin", "main", cwd=work)


def _write_untracked(checkout, rel, data):
    p = checkout / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


def _run(checkout, tmp_path):
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    calls = tmp_path / "gh-calls.txt"
    gh = bindir / "gh"
    gh.write_text(
        "#!/bin/sh\n" f"printf '%s\\n' \"$*\" >> '{calls}'\n" "exit 0\n",
        encoding="utf-8",
    )
    gh.chmod(0o755)
    env = dict(os.environ, PATH=f"{bindir}{os.pathsep}{os.environ['PATH']}")
    proc = subprocess.run(
        [BASH, str(SCRIPT), str(checkout)], env=env, capture_output=True, text=True
    )
    return proc, calls


def _branches(origin):
    out = _git("for-each-ref", "--format=%(refname:short)", "refs/heads", cwd=origin)
    return sorted(out.stdout.split())


def _relay_branch(origin):
    extra = [b for b in _branches(origin) if b != "main"]
    assert len(extra) == 1, extra
    return extra[0]


def _tree(origin, ref):
    return _git("ls-tree", "-r", "--name-only", ref, cwd=origin).stdout.split()


def test_untracked_file_tracked_on_origin_with_different_content_is_renamed(tmp_path):
    origin, checkout, work = _setup(tmp_path)
    _advance_origin(work, {STAGED: b"remote\n"})  # checkout is now behind origin/main
    local = _write_untracked(checkout, STAGED, b"local\n")

    proc, calls = _run(checkout, tmp_path)

    assert proc.returncode == 0, proc.stderr
    # origin/main keeps its own bytes: the tracked file was never overwritten.
    assert _git("show", f"main:{STAGED}", cwd=origin).stdout == "remote\n"
    branch = _relay_branch(origin)
    assert branch.startswith("relay/")
    # the relay branch is cut from origin/main, so STAGED is there with the REMOTE bytes
    assert _git("show", f"{branch}:{STAGED}", cwd=origin).stdout == "remote\n"
    stem = STAGED[: -len(".jsonl")] + "_local-"
    renamed = [p for p in _tree(origin, branch) if p.startswith(stem)]
    assert len(renamed) == 1, renamed
    assert _git("show", f"{branch}:{renamed[0]}", cwd=origin).stdout == "local\n"
    # the user checkout was not switched, emptied or modified
    head = _git("rev-parse", "--abbrev-ref", "HEAD", cwd=checkout)
    assert head.stdout.strip() == "main"
    assert local.read_bytes() == b"local\n"
    worktrees = _git("worktree", "list", cwd=checkout).stdout.strip().splitlines()
    assert len(worktrees) == 1
    assert calls.read_text(encoding="utf-8").startswith("pr create")


def test_untracked_file_identical_to_origin_is_skipped(tmp_path):
    origin, checkout, work = _setup(tmp_path)
    _advance_origin(work, {STAGED: b"same\n"})
    _write_untracked(checkout, STAGED, b"same\n")

    proc, calls = _run(checkout, tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert "nothing to publish" in proc.stdout
    assert _branches(origin) == ["main"]
    assert not calls.exists()


def test_brand_new_file_is_published_as_is(tmp_path):
    origin, checkout, _work = _setup(tmp_path)
    _write_untracked(checkout, STAGED, b"fresh\n")

    proc, _calls = _run(checkout, tmp_path)

    assert proc.returncode == 0, proc.stderr
    branch = _relay_branch(origin)
    assert branch.startswith("relay/")
    assert _git("show", f"{branch}:{STAGED}", cwd=origin).stdout == "fresh\n"


def test_mixed_batch_publishes_only_new_files(tmp_path):
    origin, checkout, work = _setup(tmp_path)
    _advance_origin(work, {STAGED: b"already\n"})
    _write_untracked(checkout, STAGED, b"already\n")
    _write_untracked(checkout, OTHER, b"new rows\n")

    proc, _calls = _run(checkout, tmp_path)

    assert proc.returncode == 0, proc.stderr
    branch = _relay_branch(origin)
    tree = _tree(origin, branch)
    assert OTHER in tree
    # STAGED is identical to origin/main: no `_local-` copy is added
    assert not [p for p in tree if "_local-" in p]
    assert _git("show", f"{branch}:{STAGED}", cwd=origin).stdout == "already\n"


def test_local_variant_already_on_origin_is_not_republished(tmp_path):
    origin, checkout, work = _setup(tmp_path)
    prior = STAGED[: -len(".jsonl")] + "_local-20261001-0000.jsonl"
    _advance_origin(work, {STAGED: b"remote\n", prior: b"local\n"})
    _write_untracked(checkout, STAGED, b"local\n")

    proc, calls = _run(checkout, tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert "identical copy already on origin/main" in proc.stdout
    assert [b for b in _branches(origin) if b != "main"] == []
    assert not calls.exists()


def test_detached_checkout_is_moved_to_fresh_origin_main(tmp_path):
    origin, checkout, work = _setup(tmp_path)
    _git("checkout", "--detach", cwd=checkout)
    _advance_origin(work, {"NEWCODE.txt": b"fresh\n"})
    _write_untracked(checkout, OTHER, b"new rows\n")

    proc, _calls = _run(checkout, tmp_path)

    assert proc.returncode == 0, proc.stderr
    head = _git("rev-parse", "HEAD", cwd=checkout).stdout.strip()
    assert head == _git("rev-parse", "origin/main", cwd=checkout).stdout.strip()
    assert (checkout / "NEWCODE.txt").exists()


def test_detached_checkout_update_failure_only_warns(tmp_path):
    origin, checkout, work = _setup(tmp_path)
    _git("checkout", "--detach", cwd=checkout)
    _advance_origin(work, {"clash.txt": b"remote\n"})
    clash = _write_untracked(checkout, "clash.txt", b"local\n")
    _write_untracked(checkout, OTHER, b"new rows\n")

    proc, _calls = _run(checkout, tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert "WARNING" in proc.stderr
    assert clash.read_bytes() == b"local\n"  # never deleted or overwritten

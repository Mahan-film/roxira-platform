"""Tests for scripts/dev/local_ci_remote.sh (#947 T227: LOCAL_CI_REMOTE=<ssh host>).

A fake `ssh` on PATH runs the remote side locally in a temp "remote home", so the real
git-over-ssh transport, the worktree, the patch for uncommitted edits and the exit code
are all exercised without a network.
"""
import os
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/dev/local_ci_remote.sh"

FAKE_SSH = """#!/usr/bin/env bash
# fake ssh: drop options, take the host, run the command in $FAKE_REMOTE_HOME
while [ $# -gt 0 ]; do
  case "$1" in
    -o|-p|-i|-l) shift 2 ;;
    -*) shift ;;
    *) break ;;
  esac
done
echo "$1" >> "$FAKE_REMOTE_HOME/.hosts"
shift
cd "$FAKE_REMOTE_HOME" && exec bash -c "$*"
"""


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


@pytest.fixture
def env(tmp_path):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    ssh = bindir / "ssh"
    ssh.write_text(FAKE_SSH)
    ssh.chmod(ssh.stat().st_mode | stat.S_IEXEC)
    remote_home = tmp_path / "remote"
    remote_home.mkdir()
    repo = tmp_path / "repo"
    repo.mkdir()
    e = {
        "PATH": f"{bindir}:{os.environ.get('PATH', '/usr/bin:/bin')}",
        "HOME": str(tmp_path),
        "FAKE_REMOTE_HOME": str(remote_home),
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@t", "GIT_CONFIG_NOSYSTEM": "1",
    }
    for k in ("GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"):
        e.pop(k, None)
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, check=True, env=e)
    (repo / "a.txt").write_text("base\n")
    subprocess.run(["git", "add", "a.txt"], cwd=repo, check=True, env=e)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True, env=e)
    subprocess.run(["git", "branch", "basebr"], cwd=repo, check=True, env=e)
    subprocess.run(["git", "checkout", "-qb", "feat/x"], cwd=repo, check=True, env=e)
    (repo / "b.txt").write_text("committed\n")
    subprocess.run(["git", "add", "b.txt"], cwd=repo, check=True, env=e)
    subprocess.run(["git", "commit", "-qm", "feat"], cwd=repo, check=True, env=e)
    return {"env": e, "repo": repo, "remote": remote_home}


def run(ctx, **extra):
    e = dict(ctx["env"])
    e.update(extra)
    return subprocess.run(["bash", str(SCRIPT), "basebr"], cwd=ctx["repo"], env=e,
                          capture_output=True, text=True)


def test_runs_remote_command_on_pushed_head_with_uncommitted_edits(env):
    (env["repo"] / "a.txt").write_text("edited, not committed\n")
    (env["repo"] / "secret.env").write_text("NEVER_SENT=1\n")  # untracked: must not travel
    cmd = ("test \"$(cat b.txt)\" = committed && test \"$(cat a.txt)\" = 'edited, not committed' "
           "&& test ! -e secret.env && git diff --name-only refs/heads/ci-base/feat-x...HEAD > ../seen "
           "&& exit 7")
    r = run(env, LOCAL_CI_REMOTE="box", LOCAL_CI_REMOTE_CMD=cmd)
    assert r.returncode == 7, r.stdout + r.stderr
    assert "finished: exit 7" in r.stdout
    assert (env["remote"] / ".hosts").read_text().split() == ["box", "box", "box"]
    seen = (env["remote"] / "local-ci/roxira/seen").read_text().split()
    assert seen == ["b.txt"]


def test_success_is_zero_and_rerun_reuses_the_bare_repo(env):
    r1 = run(env, LOCAL_CI_REMOTE="box", LOCAL_CI_REMOTE_CMD="true")
    r2 = run(env, LOCAL_CI_REMOTE="box", LOCAL_CI_REMOTE_CMD="true")
    assert r1.returncode == 0 and r2.returncode == 0, r2.stderr


def test_default_command_runs_local_ci_without_recursion(env):
    # No LOCAL_CI_REMOTE_CMD: the default command must clear LOCAL_CI_REMOTE on the remote.
    scripts = env["repo"] / "scripts/dev"
    scripts.mkdir(parents=True)
    (scripts / "local_ci.sh").write_text(
        '#!/bin/bash\necho "remote=[${LOCAL_CI_REMOTE:-}] port=${FRESH_DB_PORT:-} args=$*"\nexit 3\n')
    subprocess.run(["git", "add", "-A"], cwd=env["repo"], check=True, env=env["env"])
    subprocess.run(["git", "commit", "-qm", "stub"], cwd=env["repo"], check=True, env=env["env"])
    r = run(env, LOCAL_CI_REMOTE="box", FRESH_DB_PORT="55621", LOCAL_CI_SKIP_PYTEST="1")
    assert r.returncode == 3, r.stderr
    assert "remote=[] port=55621 args=--base refs/heads/ci-base/feat-x" in r.stdout


@pytest.mark.parametrize("extra", [
    {"LOCAL_CI_REMOTE": "box;rm -rf ~"},
    {"LOCAL_CI_REMOTE": "-oProxyCommand=x"},
    {"LOCAL_CI_REMOTE": "box", "LOCAL_CI_REMOTE_DIR": "/etc"},
    {"LOCAL_CI_REMOTE": "box", "LOCAL_CI_REMOTE_DIR": "a/../../b"},
    {"LOCAL_CI_REMOTE": "box", "FRESH_DB_PORT": "1;id"},
    {"LOCAL_CI_REMOTE": "box", "LOCAL_CI_SKIP_PYTEST": "yes"},
])
def test_rejects_unsafe_values(env, extra):
    r = run(env, **extra)
    assert r.returncode == 2
    assert not (env["remote"] / ".hosts").exists()


def test_local_ci_hands_off_only_when_remote_is_set():
    text = (ROOT / "scripts/dev/local_ci.sh").read_text()
    assert 'if [ -n "${LOCAL_CI_REMOTE:-}" ]; then' in text
    assert 'exec bash "$REPO_ROOT/scripts/dev/local_ci_remote.sh" "$BASE_REF"' in text

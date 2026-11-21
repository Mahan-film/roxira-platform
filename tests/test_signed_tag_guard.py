"""Tests for R20-4 (#1020): signed-tag guard and pull-deploy dry-run."""

from __future__ import annotations

import os
import pathlib
import subprocess
import time

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
GUARD_SCRIPT = REPO_ROOT / "scripts" / "ops" / "signed_tag_guard.sh"
PULL_DEPLOY_SCRIPT = REPO_ROOT / "scripts" / "ops" / "pull-deploy.sh"


def _run(cmd: list[str], cwd: pathlib.Path, env: dict[str, str] | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    merged = os.environ.copy()
    if env:
        merged.update(env)
    return subprocess.run(cmd, cwd=cwd, env=merged, text=True, capture_output=True, check=check)


def _init_repo_with_signed_and_unsigned_tags(tmp_path: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path, pathlib.Path, str, str]:
    # Generate ephemeral ed25519 keypair for SSH tag signing
    key_path = tmp_path / "signer_ed25519"
    _run(["ssh-keygen", "-t", "ed25519", "-N", "", "-f", str(key_path)], cwd=tmp_path)
    pub_key = (tmp_path / "signer_ed25519.pub").read_text(encoding="utf-8").strip()

    allowed_signers = tmp_path / "allowed_signers"
    allowed_signers.write_text(f'owner@roxira namespaces="git" {pub_key}\n', encoding="utf-8")

    # Create bare origin and working copy
    origin = tmp_path / "origin.git"
    _run(["git", "init", "--bare", "-b", "main", str(origin)], cwd=tmp_path)

    work = tmp_path / "work"
    _run(["git", "clone", str(origin), str(work)], cwd=tmp_path)
    _run(["git", "config", "user.name", "Owner"], cwd=work)
    _run(["git", "config", "user.email", "owner@roxira"], cwd=work)
    _run(["git", "config", "gpg.format", "ssh"], cwd=work)
    _run(["git", "config", "user.signingkey", str(key_path)], cwd=work)

    # Commit 0 (deployed baseline)
    (work / "README.md").write_text("v0\n", encoding="utf-8")
    _run(["git", "add", "README.md"], cwd=work)
    _run(["git", "commit", "-m", "v0"], cwd=work)
    _run(["git", "push", "origin", "main"], cwd=work)

    # Clone a "prod" checkout at v0
    prod = tmp_path / "prod"
    _run(["git", "clone", str(origin), str(prod)], cwd=tmp_path)

    # Commit 1: migration change + SIGNED tag deploy/2026-11-21-01
    mig_dir = work / "output_apps" / "enterprise_hub" / "migrations"
    mig_dir.mkdir(parents=True)
    (mig_dir / "1700000000000-init.ts").write_text("// mig 1\n", encoding="utf-8")
    _run(["git", "add", "."], cwd=work)
    _run(["git", "commit", "-m", "mig 1"], cwd=work)
    signed_sha = _run(["git", "rev-parse", "HEAD"], cwd=work).stdout.strip()
    _run(["git", "tag", "-s", "deploy/2026-11-21-01", "-m", "signed deploy 1"], cwd=work)

    # Ensure strictly newer creatordate for the unsigned tag
    time.sleep(1.1)

    # Commit 2: newer migration change + UNSIGNED tag deploy/2026-11-21-02
    (mig_dir / "1700000000001-unsigned.ts").write_text("// mig 2\n", encoding="utf-8")
    _run(["git", "add", "."], cwd=work)
    _run(["git", "commit", "-m", "mig 2"], cwd=work)
    unsigned_sha = _run(["git", "rev-parse", "HEAD"], cwd=work).stdout.strip()
    _run(["git", "tag", "-a", "deploy/2026-11-21-02", "-m", "unsigned deploy 2"], cwd=work)

    _run(["git", "push", "origin", "main", "--tags"], cwd=work)
    return prod, allowed_signers, key_path, signed_sha, unsigned_sha


def test_signed_tag_guard_ignores_unsigned_and_picks_signed(tmp_path: pathlib.Path) -> None:
    prod, allowed_signers, _, signed_sha, _ = _init_repo_with_signed_and_unsigned_tags(tmp_path)

    # Run pull-deploy.sh --dry-run with signed-tag guard enabled
    res = _run(
        ["bash", str(PULL_DEPLOY_SCRIPT), "--dry-run"],
        cwd=prod,
        env={
            "PROJECT_DIR": str(prod),
            "PULL_DEPLOY_MIN_AGE_S": "0",
            "PULL_DEPLOY_SIGNED_TAG_GUARD": "1",
            "ALLOWED_SIGNERS_FILE": str(allowed_signers),
            "SIGNED_TAG_GUARD_SCRIPT": str(GUARD_SCRIPT),
        },
    )
    assert "ignoring unsigned or invalid tag: deploy/2026-11-21-02" in res.stderr
    assert f"signed-tag guard selected deploy/2026-11-21-01 ({signed_sha})" in res.stdout
    assert f"dry-run would deploy {signed_sha}" in res.stdout


def test_signed_tag_guard_fails_closed_without_signers_file(tmp_path: pathlib.Path) -> None:
    res = _run(
        ["bash", str(GUARD_SCRIPT)],
        cwd=tmp_path,
        env={"ALLOWED_SIGNERS_FILE": str(tmp_path / "does_not_exist")},
        check=False,
    )
    assert res.returncode == 1
    assert "missing or empty" in res.stderr

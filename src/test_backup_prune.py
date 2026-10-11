"""Executes the real prune_sets() of scripts/ops/backup/server_backup.sh in a temp directory.

Uses the script's `--self-test-prune DIR [KEEP]` mode, which runs only prune_sets against DIR
(no env file, no docker, no network). No import-time side effects.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ops" / "backup" / "server_backup.sh"

NAMES = ["20260101T010000Z", "20260102T020000Z", "20260103T030000Z",
         "20260104T040000Z", "20260105T050000Z", "20260106T060000Z"]  # oldest first


def _prune(sets_dir: Path, keep: int) -> subprocess.CompletedProcess:
    if shutil.which("bash") is None:
        pytest.skip("bash not available")
    env = {"PATH": os.environ.get("PATH", ""), "HOME": str(sets_dir.parent)}
    return subprocess.run(
        ["bash", str(SCRIPT), "--self-test-prune", str(sets_dir), str(keep)],
        capture_output=True, text=True, env=env, timeout=30, check=False,
    )


def _make_sets(root: Path) -> Path:
    sets = root / "sets"
    sets.mkdir()
    for n in NAMES:
        (sets / n).mkdir()
        (sets / n / "dump.bin").write_text(n)
    return sets


def test_keeps_newest_n_sets(tmp_path: Path) -> None:
    sets = _make_sets(tmp_path)
    res = _prune(sets, 3)
    assert res.returncode == 0, res.stderr
    assert sorted(p.name for p in sets.iterdir()) == NAMES[-3:]


def test_never_deletes_latest_target(tmp_path: Path) -> None:
    sets = _make_sets(tmp_path)
    (sets / "latest").symlink_to(sets / NAMES[0])  # oldest set is the `latest` target
    res = _prune(sets, 2)
    assert res.returncode == 0, res.stderr
    left = sorted(p.name for p in sets.iterdir() if p.name != "latest")
    assert left == [NAMES[0], *NAMES[-2:]]
    assert (sets / "latest").resolve() == (sets / NAMES[0]).resolve()


def test_ignores_non_matching_names(tmp_path: Path) -> None:
    sets = _make_sets(tmp_path)
    odd = ["notes", "2026-01-01", "20260101T000000", "20260101T000000Z.bak", "tmp.20260101T000000Z"]
    for n in odd:
        (sets / n).mkdir()
    (sets / "readme.txt").write_text("keep")
    res = _prune(sets, 1)
    assert res.returncode == 0, res.stderr
    left = {p.name for p in sets.iterdir()}
    assert set(odd) | {"readme.txt", NAMES[-1]} == left


def test_deletes_nothing_outside_dir(tmp_path: Path) -> None:
    sets = _make_sets(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "20250101T000000Z").mkdir()
    (outside / "20250101T000000Z" / "precious").write_text("x")
    sibling = tmp_path / "sets-other"
    sibling.mkdir()
    (sibling / NAMES[0]).mkdir()
    # a timestamp-named symlink inside DIR pointing outside must not be followed or removed
    (sets / "20240101T000000Z").symlink_to(outside / "20250101T000000Z")
    res = _prune(sets, 1)
    assert res.returncode == 0, res.stderr
    assert (outside / "20250101T000000Z" / "precious").read_text() == "x"
    assert (sibling / NAMES[0]).is_dir()
    assert (sets / "20240101T000000Z").is_symlink()
    assert [p.name for p in sets.iterdir() if p.name in NAMES] == [NAMES[-1]]


def test_missing_dir_is_a_noop(tmp_path: Path) -> None:
    res = _prune(tmp_path / "does-not-exist", 3)
    assert res.returncode == 0, res.stderr

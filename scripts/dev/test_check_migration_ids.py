"""Tests for check_migration_ids.py using throwaway git repos.
Run only this file: python3 -m pytest scripts/dev/test_check_migration_ids.py"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).with_name("check_migration_ids.py")
sys.path.insert(0, str(SCRIPT.parent))
import check_migration_ids as m  # noqa: E402

MIG = "output_apps/enterprise_hub/migrations"
ENV = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
ENV.update(GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")


def git(cwd, *a):
    subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True, env=ENV)


def write(repo, mid, name="Thing", cls_id=None, name_id=None):
    p = Path(repo, MIG, f"{mid}-{name}.ts")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"export class {name}{cls_id or mid} {{\n  name = '{name}{name_id or mid}';\n}}\n")
    return p


def commit(repo):
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "x")


@pytest.fixture
def repo(tmp_path):
    r = tmp_path / "r"
    r.mkdir()
    git(r, "init", "-q", "-b", "main")
    write(r, "1789000000000", "A")
    write(r, "1789100000000", "B")
    commit(r)
    git(r, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(r, "switch", "-q", "-c", "feat")
    return r


def run(repo, *extra):
    p = subprocess.run([sys.executable, str(SCRIPT), "--repo", str(repo), *extra],
                       capture_output=True, text=True, env=ENV)
    return p.returncode, p.stdout + p.stderr


def test_no_added_files_passes(repo):
    assert run(repo)[0] == 0


def test_id_above_newest_passes(repo):
    write(repo, "1789200000000")
    commit(repo)
    assert run(repo)[0] == 0


def test_id_below_newest_fails_and_names_file(repo):
    write(repo, "1789050000000", "Low")
    commit(repo)
    code, out = run(repo)
    assert code == 1 and "1789050000000-Low.ts" in out and "1789100001000" in out


def test_id_equal_newest_fails(repo):
    write(repo, "1789100000000", "Same")
    commit(repo)
    assert run(repo)[0] == 1


def test_duplicate_added_ids_fail(repo):
    write(repo, "1789200000000", "One")
    write(repo, "1789200000000", "Two")
    commit(repo)
    code, out = run(repo)
    assert code == 1 and "duplicate id 1789200000000" in out


def test_class_suffix_mismatch_fails(repo):
    write(repo, "1789200000000", "Bad", cls_id="1789200000001")
    commit(repo)
    code, out = run(repo)
    assert code == 1 and "class" in out


def test_name_suffix_mismatch_fails(repo):
    write(repo, "1789200000000", "Bad", name_id="1")
    commit(repo)
    assert run(repo)[0] == 1


def test_staged_added_file_is_checked(repo):
    p = write(repo, "1789050000000", "Low")
    git(repo, "add", str(p))
    assert run(repo)[0] == 1


def test_newest_is_taken_from_base_not_merge_base(repo):
    git(repo, "switch", "-q", "main")
    write(repo, "1789300000000", "C")
    commit(repo)
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(repo, "switch", "-q", "feat")
    write(repo, "1789200000000", "Mine")
    commit(repo)
    code, out = run(repo)
    assert code == 1 and "1789300000000" in out


def test_open_prs_skips_without_gh(repo, monkeypatch):
    monkeypatch.setattr(m.shutil, "which", lambda _n: None)
    seen, why = m.open_pr_ids(str(repo), "feat")
    assert seen is None and "gh" in why
    write(repo, "1789200000000")
    commit(repo)
    assert m.check("origin/main", MIG, True, str(repo)) == []


def test_open_prs_detects_clash(repo, monkeypatch):
    write(repo, "1789200000000", "Mine")
    commit(repo)
    monkeypatch.setattr(m, "open_pr_ids", lambda cwd, own: ({"1789200000000": ["PR #9 (x)"]}, ""))
    assert any("PR #9" in p for p in m.check("origin/main", MIG, True, str(repo)))


def rename(repo, old, new_id, name):
    """Renumber like a lane does: git mv, then fix the class and name suffix."""
    src = Path(repo, MIG, old)
    dst = Path(repo, MIG, f"{new_id}-{name}.ts")
    git(repo, "mv", str(src), str(dst))
    dst.write_text(dst.read_text().replace(old[:13], new_id))
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "renumber")


def test_rename_to_too_low_id_fails(repo):
    write(repo, "1789200000000", "Mine")
    commit(repo)
    rename(repo, "1789200000000-Mine.ts", "1789050000000", "Mine")
    code, out = run(repo)
    assert code == 1 and "1789050000000-Mine.ts" in out


def test_rename_to_duplicate_id_fails(repo):
    write(repo, "1789200000000", "One")
    write(repo, "1789300000000", "Two")
    commit(repo)
    rename(repo, "1789300000000-Two.ts", "1789200000000", "Two")
    code, out = run(repo)
    assert code == 1 and "duplicate id 1789200000000" in out


def test_rename_of_existing_migration_to_valid_id_passes(repo):
    rename(repo, "1789000000000-A.ts", "1789400000000", "A")
    assert run(repo)[0] == 0

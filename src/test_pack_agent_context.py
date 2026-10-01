import shutil
import subprocess
from pathlib import Path

import pytest


def test_packs_small_files_without_repomix(tmp_path, monkeypatch):
    if shutil.which("zsh") is None:
        pytest.skip("zsh not installed on this runner")
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    (repo_root / "a.txt").write_text("alpha\n")
    (repo_root / "b.txt").write_text("beta\n")
    listfile = tmp_path / "files.txt"
    listfile.write_text("a.txt\nb.txt\n")
    outfile = tmp_path / "context.txt"
    script = Path(__file__).parents[1] / "scripts/dev/pack_agent_context.sh"

    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    result = subprocess.run(
        ["zsh", str(script), str(listfile), str(outfile)],
        cwd=repo_root,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    assert "=== a.txt ===" in outfile.read_text()
    assert "=== b.txt ===" in outfile.read_text()


def test_refuses_data_paths(tmp_path):
    if shutil.which("zsh") is None:
        pytest.skip("zsh not installed on this runner")
    listfile = tmp_path / "files.txt"
    listfile.write_text("data/x.json\n")
    outfile = tmp_path / "context.txt"
    script = Path(__file__).parents[1] / "scripts/dev/pack_agent_context.sh"

    result = subprocess.run(
        ["zsh", str(script), str(listfile), str(outfile)],
        text=True,
        capture_output=True,
    )

    assert result.returncode == 2

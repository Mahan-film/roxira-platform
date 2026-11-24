"""Tests for scripts/dev/install_reviewdog.sh (Issue #1343)."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/dev/install_reviewdog.sh"


def test_install_reviewdog_script_exists_and_executable():
    assert SCRIPT.is_file(), "install_reviewdog.sh must exist"
    assert SCRIPT.stat().st_mode & 0o111, "install_reviewdog.sh must be executable"


def test_install_reviewdog_pinned_version_and_shas():
    content = SCRIPT.read_text(encoding="utf-8")
    assert 'REVIEWDOG_VERSION="0.21.3"' in content
    assert 'SHA_LINUX_X64="7029c2faf54e1237454cae8f1adf876c965b3d13d054f1a392206459091af4a1"' in content
    assert 'SHA_DARWIN_ARM64="c2a393e438e1d6dfe64e4a5ee103f1f1e839fff605f26686d6a7083770cd0afd"' in content
    assert 'SHA_DARWIN_X64="ca114007f4562062b4b54b422d8d2d21317b548ec64b7848e7e2aea52e490abd"' in content


def test_install_reviewdog_execution(tmp_path):
    res = subprocess.run(
        ["bash", str(SCRIPT), str(tmp_path)],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, f"Script failed: {res.stderr}"
    bin_path = Path(res.stdout.strip())
    assert bin_path.is_file()
    assert bin_path.stat().st_mode & 0o111

    # Verify version output
    ver_res = subprocess.run([str(bin_path), "-version"], capture_output=True, text=True)
    assert ver_res.returncode == 0
    assert "0.21.3" in ver_res.stdout

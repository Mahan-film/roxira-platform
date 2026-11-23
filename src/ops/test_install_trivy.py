import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/dev/install_trivy.sh"


def test_install_trivy_script_exists_and_executable():
    assert SCRIPT.exists()
    assert (SCRIPT.stat().st_mode & 0o111) != 0


def test_install_trivy_defines_valid_checksums():
    content = SCRIPT.read_text(encoding="utf-8")
    for var in [
        "SHA_LINUX_AMD64",
        "SHA_LINUX_ARM64",
        "SHA_DARWIN_ARM64",
        "SHA_DARWIN_AMD64",
    ]:
        assert f'{var}="' in content
        line = [l for l in content.splitlines() if l.startswith(f"{var}=")][0]
        sha = line.split('"')[1]
        assert len(sha) == 64
        assert all(c in "0123456789abcdefABCDEF" for c in sha)


def test_install_trivy_runs_cleanly_when_installed(tmp_path: Path):
    fake_dir = tmp_path / "trivy-0.75.0"
    fake_dir.mkdir(parents=True)
    fake_bin = fake_dir / "trivy"
    fake_bin.write_text("#!/bin/sh\necho 'Version: 0.75.0'\n")
    fake_bin.chmod(0o755)

    res = subprocess.run(
        ["bash", str(SCRIPT), str(fake_dir)],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0
    assert "trivy 0.75.0 verified" in res.stderr
    assert str(fake_bin) == res.stdout.strip()

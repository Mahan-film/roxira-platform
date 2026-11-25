"""Offline tests for scripts/dev/lane_preflight.sh."""

from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "lane_preflight.sh"


def _make_stub_bin(tmp_path: Path) -> Path:
    """Create stub git/gh/docker commands so lane_preflight.sh runs offline."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    repo_dir = tmp_path / "repo"
    (repo_dir / ".git" / "hooks").mkdir(parents=True, exist_ok=True)
    (repo_dir / ".git" / "hooks" / "pre-push").write_text("# roxira-local-ci\n", encoding="utf-8")
    (repo_dir / "scripts" / "dev").mkdir(parents=True, exist_ok=True)
    (repo_dir / "scripts" / "dev" / "verify_agent_report.py").write_text("# ok\n", encoding="utf-8")

    git_stub = bin_dir / "git"
    git_stub.write_text(
        f"""#!/usr/bin/env bash
case "$1" in
  rev-parse)
    if [ "${{2:-}}" = "--show-toplevel" ]; then echo "{repo_dir}"; exit 0; fi
    if [ "${{2:-}}" = "--git-path" ]; then echo "{repo_dir}/.git/$3"; exit 0; fi
    ;;
  remote) echo "git@github.com:Mahan-film/roxira-platform.git"; exit 0 ;;
  fetch) exit 0 ;;
  rev-list) echo "0"; exit 0 ;;
  status) exit 0 ;;
esac
exit 0
""",
        encoding="utf-8",
    )

    gh_stub = bin_dir / "gh"
    gh_stub.write_text(
        """#!/usr/bin/env bash
if [ "$1" = "api" ]; then echo "tester"; exit 0; fi
if [ "$1" = "issue" ]; then echo "592"; exit 0; fi
exit 0
""",
        encoding="utf-8",
    )

    docker_stub = bin_dir / "docker"
    docker_stub.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")

    for p in (git_stub, gh_stub, docker_stub):
        p.chmod(p.stat().st_mode | stat.S_IXUSR)
    return bin_dir


def _run_preflight(lane: str, tmp_path: Path) -> subprocess.CompletedProcess[str]:
    bin_dir = _make_stub_bin(tmp_path)
    wt_dir = tmp_path / "wt"
    wt_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
    env["ROXIRA_WT_ROOT"] = str(wt_dir)
    return subprocess.run(
        ["bash", str(SCRIPT), lane],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_dq_lane_accepted(tmp_path: Path) -> None:
    res = _run_preflight("DQ", tmp_path)
    assert "OK    lane DQ" in res.stdout, res.stdout + res.stderr
    assert "FAIL  lane id missing or wrong" not in res.stdout


def test_invalid_lane_rejected(tmp_path: Path) -> None:
    res = _run_preflight("UNKNOWN_LANE", tmp_path)
    assert res.returncode == 1
    assert "FAIL  lane id missing or wrong ('UNKNOWN_LANE')" in res.stdout

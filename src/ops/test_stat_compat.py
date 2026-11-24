"""Tests for cross-platform stat compatibility (Issue #1320 / T347).

Verifies that the shell pattern:
  stat -c %a "$f" 2>/dev/null || stat -f %Lp "$f"
correctly extracts octal permission modes on both Linux (GNU stat) and macOS (BSD stat).
"""

import subprocess
import pytest


@pytest.mark.parametrize("mode,expected", [
    (0o600, "600"),
    (0o640, "640"),
    (0o755, "755"),
    (0o700, "700"),
])
def test_stat_permission_extraction_cross_platform(tmp_path, mode, expected):
    test_file = tmp_path / f"test_{expected}.env"
    test_file.write_text("DUMMY=1\n")
    test_file.chmod(mode)

    cmd = f'stat -c %a "{test_file}" 2>/dev/null || stat -f %Lp "{test_file}"'
    res = subprocess.run(["/bin/bash", "-c", cmd], capture_output=True, text=True, check=True)
    assert res.stdout.strip() == expected, f"Expected mode {expected}, got {res.stdout.strip()!r}"

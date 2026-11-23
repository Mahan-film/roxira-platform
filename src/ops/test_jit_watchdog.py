"""Tests for the JIT job wall-time watchdog and the digest-pinned light image (R20-8, #1024)."""
import importlib.util
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
POOL_DIR = ROOT / "scripts/ops/ci_box/jit_pool"


@pytest.fixture(scope="module")
def wd():
    spec = importlib.util.spec_from_file_location("jit_watchdog", POOL_DIR / "jit_watchdog.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_default_is_longest_job_plus_half(wd):
    assert 739 * 1.5 <= wd.DEFAULT_MAX_WALL_S <= 739 * 1.5 + 10  # 1108.5 rounded up


def test_expired_boundary(wd):
    assert not wd.expired(100.0, 100.0 + 1110, 1110)
    assert wd.expired(100.0, 100.0 + 1110.5, 1110)
    assert not wd.expired(100.0, 50.0, 1110)  # clock going backwards never kills


@pytest.mark.parametrize(
    "cli,env,ctl,want",
    [
        (None, None, None, 1110),
        ("900", "1200", "1500", 900),
        (None, "1200", "1500", 1200),
        (None, None, "1500\n", 1500),
        (None, "abc", "1500", 1500),
        (None, "0", "-5", 1110),
        ("5", None, None, 60),
        ("", None, "", 1110),
    ],
)
def test_resolve_max_wall(wd, cli, env, ctl, want):
    assert wd.resolve_max_wall(cli, env, ctl) == want


def test_read_control_missing(wd, tmp_path):
    assert wd.read_control(str(tmp_path / "nope")) is None
    p = tmp_path / "max"
    p.write_text("700\n")
    assert wd.read_control(str(p)) == "700\n"


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


def test_run_fast_job_returns_its_exit_code(wd):
    assert wd.run([sys.executable, "-c", "raise SystemExit(3)"], 100, poll=0.01) == 3


def test_run_kills_job_over_wall_time(wd, tmp_path):
    c = FakeClock()
    marker = tmp_path / "killed"
    rc = wd.run(
        [sys.executable, "-c", "import time; time.sleep(60)"],
        5,
        on_timeout=f"{sys.executable} -c \"open(r'{marker}','w').write('x')\"",
        grace=2,
        poll=1.0,
        clock=c,
        sleep=c.sleep,
    )
    assert rc == wd.EXIT_TIMEOUT == 124
    assert marker.exists()  # the on-timeout hook (docker kill in production) ran


def test_run_sigkills_a_job_that_ignores_sigterm(wd):
    c = FakeClock()
    code = "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)"
    import time as _t
    t0 = _t.time()
    # real sleep for the 0.2 s grace polling; fake clock only advances the wall time
    rc = wd.run([sys.executable, "-c", code], 1, grace=0.0, poll=1.0, clock=c, sleep=lambda s: setattr(c, "t", c.t + s))
    assert rc == 124
    assert _t.time() - t0 < 20


def test_main_uses_control_file_and_dashdash(wd, tmp_path):
    ctl = tmp_path / "max-wall-s"
    ctl.write_text("60")
    assert wd.main(["--control-file", str(ctl), "--", sys.executable, "-c", "raise SystemExit(0)"]) == 0


def test_main_requires_command(wd):
    with pytest.raises(SystemExit):
        wd.main([])


def test_launcher_wires_watchdog_for_both_slots():
    s = (POOL_DIR / "jit_launcher.sh").read_text()
    assert 'guard "docker kill $name" docker start -a "$cid"' in s
    assert 'guard "" $pin env -i' in s
    assert "jit_watchdog.py" in s


def test_pool_installer_installs_watchdog():
    root = (ROOT / "scripts/ops/ci_box/08_root_ci_pool.sh").read_text()
    assert root.count("jit_watchdog.py") >= 3  # presence check, compare, install
    # watchdog must land before the launcher that calls it
    assert root.index('install -o root -g root -m 0755 "$SRC/jit_watchdog.py"') < root.index('"$SRC/jit_launcher.sh" "$SRC/runner_setup.sh"')


def test_light_image_base_pinned_by_digest():
    froms = [ln for ln in (POOL_DIR / "Dockerfile.light").read_text().splitlines() if ln.startswith("FROM ")]
    assert froms
    for ln in froms:
        assert re.fullmatch(r"FROM \S+@sha256:[0-9a-f]{64}", ln), ln

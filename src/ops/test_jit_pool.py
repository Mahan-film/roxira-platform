"""Tests for the JIT runner pool (R20-8, #1024): scripts/ops/ci_box/jit_pool/."""
import importlib.util
import os
import stat
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
POOL_DIR = ROOT / "scripts/ops/ci_box/jit_pool"
NOW = 1_800_000_000
SECRET = "Q" * 600  # stands in for an encoded JIT config; must never be logged


@pytest.fixture(scope="module")
def jp():
    spec = importlib.util.spec_from_file_location("jit_pool", POOL_DIR / "jit_pool.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FakeApi:
    def __init__(self, runners=None, var_exists=True):
        self.runners = list(runners or [])
        self.calls = []
        self.var_exists = var_exists
        self.next_id = 100

    def __call__(self, method, path, fields=None):
        self.calls.append((method, path, fields))
        if method == "GET" and path.startswith("repos/o/r/actions/runners"):
            return {"total_count": len(self.runners), "runners": list(self.runners)}
        if method == "POST" and path.endswith("/generate-jitconfig"):
            self.next_id += 1
            self.runners.append({"id": self.next_id, "name": fields["name"], "status": "offline", "busy": False})
            return {"runner": {"id": self.next_id}, "encoded_jit_config": SECRET}
        if method == "DELETE":
            rid = int(path.rsplit("/", 1)[1])
            self.runners = [r for r in self.runners if r["id"] != rid]
            return None
        if method == "PATCH" and "/actions/variables/" in path:
            if not self.var_exists:
                raise self.err("HTTP 404: Not Found")
            return None
        if method == "POST" and path.endswith("/actions/variables"):
            self.var_exists = True
            return None
        raise AssertionError(f"unexpected call {method} {path}")


@pytest.fixture
def env(tmp_path, jp):
    spool = tmp_path / "spool"
    for s in ("light", "docker"):
        (spool / s).mkdir(parents=True)
    cfg = jp.load_config(None)
    cfg.update({
        "repo": "o/r", "dry_run": False, "spool_dir": str(spool),
        "state_dir": str(tmp_path / "state"), "control_dir": str(tmp_path / "control"),
    })
    (tmp_path / "control").mkdir()
    FakeApi.err = jp.GhError
    return {"cfg": cfg, "spool": spool, "control": tmp_path / "control", "tmp": tmp_path}


def alive(env, *slots, age=0):
    for s in slots:
        f = env["spool"] / s / ".alive"
        f.touch()
        os.utime(f, (NOW - age, NOW - age))


def run_tick(jp, env, api, now=NOW):
    return jp.Pool(env["cfg"], api, now=now).tick()


def mints(api):
    return [c for c in api.calls if c[1].endswith("generate-jitconfig")]


def test_mints_one_per_live_slot_and_writes_spool(jp, env):
    alive(env, "light", "docker")
    api = FakeApi()
    run_tick(jp, env, api)
    assert len(mints(api)) == 2
    for s in ("light", "docker"):
        files = list((env["spool"] / s).glob("jit-*.jit"))
        assert len(files) == 1
        assert files[0].read_text() == SECRET
        assert stat.S_IMODE(files[0].stat().st_mode) == 0o640
        assert jp.parse_name(files[0].stem)[0] == s
    labels = {c[2]["name"].split("-")[1]: c[2]["labels"] for c in mints(api)}
    assert labels["light"] == ["self-hosted", "linux-box", "jit", "slot-light"]
    assert "hp" not in labels["docker"]
    assert all(c[2]["runner_group_id"] == 1 for c in mints(api))


def test_no_second_mint_while_a_runner_is_registered(jp, env):
    alive(env, "light", "docker")
    api = FakeApi()
    run_tick(jp, env, api)
    run_tick(jp, env, api, now=NOW + 30)          # configs pending (offline, young)
    assert len(mints(api)) == 2
    for r in api.runners:                          # launchers started them; one is busy
        r["status"] = "online"
    api.runners[0]["busy"] = True
    run_tick(jp, env, api, now=NOW + 60)
    assert len(mints(api)) == 2


def test_mints_again_after_github_removes_the_finished_runner(jp, env):
    alive(env, "light")
    api = FakeApi()
    run_tick(jp, env, api)
    for f in (env["spool"] / "light").glob("jit-*.jit"):
        f.unlink()                                 # launcher consumed it
    api.runners = []                               # job done, JIT runner de-registered
    alive(env, "light")
    run_tick(jp, env, api, now=NOW + 5)
    assert sum(1 for c in mints(api) if "-light-" in c[2]["name"]) == 2


def test_no_mint_without_live_launcher_or_with_hold(jp, env):
    api = FakeApi()
    run_tick(jp, env, api)                         # no .alive files
    assert mints(api) == []
    alive(env, "light", age=500)                   # stale launcher
    run_tick(jp, env, api)
    assert mints(api) == []
    alive(env, "light", "docker")
    (env["control"] / "HOLD").touch()
    run_tick(jp, env, api)
    assert mints(api) == []


def test_stop_does_nothing(jp, env):
    alive(env, "light", "docker")
    (env["control"] / "STOP").touch()
    api = FakeApi()
    assert run_tick(jp, env, api) == {"stopped": True}
    assert api.calls == []


def test_cleanup_deletes_only_stale_offline_pool_runners(jp, env):
    alive(env, "light", "docker")
    old = f"jit-light-{NOW - 1000:010d}-abcdef"
    (env["spool"] / "light" / f"{old}.jit").write_text(SECRET)
    api = FakeApi([
        {"id": 1, "name": "roxira-ci", "status": "offline", "busy": False},          # old runner
        {"id": 2, "name": old, "status": "offline", "busy": False},                   # stale
        {"id": 3, "name": f"jit-docker-{NOW - 1000:010d}-123456", "status": "online", "busy": True},
        {"id": 4, "name": f"jit-light-{NOW - 10:010d}-fedcba", "status": "offline", "busy": False},
        {"id": 5, "name": f"jit-docker-{NOW - 2000:010d}-0a0b0c", "status": "offline", "busy": True},  # blip mid-job
    ])
    run_tick(jp, env, api)
    deleted = [c[1] for c in api.calls if c[0] == "DELETE"]
    assert deleted == ["repos/o/r/actions/runners/2"]
    assert not (env["spool"] / "light" / f"{old}.jit").exists()
    assert mints(api) == []                        # both slots still have a registered runner


def test_heartbeat_written_and_rate_limited(jp, env):
    alive(env, "light", "docker")
    api = FakeApi(var_exists=False)
    run_tick(jp, env, api)
    hb = [c for c in api.calls if "variables" in c[1]]
    assert hb[0][0] == "PATCH" and hb[1][0] == "POST"
    assert hb[1][2] == {"name": "CI_BOX_HEARTBEAT", "value": f"{NOW} 1 1"}
    api.calls.clear()
    alive(env, "light", "docker")
    run_tick(jp, env, api, now=NOW + 30)           # unchanged, too soon
    assert not [c for c in api.calls if "variables" in c[1]]
    alive(env, "light", "docker", age=-200)        # launchers still touching .alive
    run_tick(jp, env, api, now=NOW + 200)          # interval passed
    assert [c[2]["value"] for c in api.calls if "variables" in c[1]] == [f"{NOW + 200} 1 1"]


def test_heartbeat_reports_dead_slot_and_hold_at_once(jp, env):
    alive(env, "light", "docker")
    api = FakeApi()
    run_tick(jp, env, api)
    api.calls.clear()
    alive(env, "light")
    alive(env, "docker", age=1000)                 # docker launcher died
    run_tick(jp, env, api, now=NOW + 10)
    assert [c[2]["value"] for c in api.calls if "variables" in c[1]] == [f"{NOW + 10} 1 0"]
    api.calls.clear()
    (env["control"] / "HOLD").touch()
    run_tick(jp, env, api, now=NOW + 20)
    assert [c[2]["value"] for c in api.calls if "variables" in c[1]] == [f"{NOW + 20} 0 0"]


def test_dry_run_only_lists(jp, env):
    alive(env, "light", "docker")
    env["cfg"]["dry_run"] = True
    api = FakeApi()
    res = run_tick(jp, env, api)
    assert [c[0] for c in api.calls] == ["GET"]
    assert any(a.startswith("mint jit-light-") for a in res["actions"])
    assert not list((env["spool"] / "light").glob("*.jit"))


def test_config_never_logged(jp, env, caplog):
    alive(env, "light", "docker")
    caplog.set_level("DEBUG")
    run_tick(jp, env, FakeApi())
    assert SECRET not in caplog.text
    assert "[redacted]" in jp.redact("error " + SECRET)


@pytest.mark.parametrize("labels", [["linux-box"], ["self-hosted", "hp"]])
def test_config_rejects_unsafe_labels(jp, tmp_path, labels):
    p = tmp_path / "c.toml"
    p.write_text("[slots.light]\nlabels = [%s]\n" % ", ".join(f'"{x}"' for x in labels))
    with pytest.raises(ValueError):
        jp.load_config(str(p))


def test_parse_name(jp):
    assert jp.parse_name(f"jit-light-{NOW}-abcdef") == ("light", NOW)
    for bad in ("roxira-ci", "jit-light-1-abcdef", f"jit-Light-{NOW}-abcdef", f"jit-light-{NOW}-xyz123"):
        assert jp.parse_name(bad) is None


# ---- launcher (bash) -------------------------------------------------------------------------

FAKE_DOCKER = """#!/usr/bin/env bash
# fake docker: records argv (never the env file content) and the env file's content check
log="$FAKE_LOG"
case "$1" in
  create)
    shift
    envf=""; prev=""
    for a in "$@"; do [ "$prev" = "--env-file" ] && envf="$a"; prev="$a"; done
    grep -q '^ACTIONS_RUNNER_INPUT_JITCONFIG=' "$envf" && echo "envfile-ok mode=$(stat -c %a "$envf")" >> "$log"
    printf 'create %s\\n' "$*" >> "$log"
    echo 0123456789abcdef ;;
  start) echo "start $*" >> "$log"; exit 0 ;;
  *) echo "other $*" >> "$log" ;;
esac
"""


@pytest.fixture
def launcher_env(tmp_path):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    d = bindir / "docker"
    d.write_text(FAKE_DOCKER)
    d.chmod(0o755)
    tpl = tmp_path / "template"
    tpl.mkdir()
    (tpl / "run.sh").write_text('#!/bin/bash\n[ -n "$ACTIONS_RUNNER_INPUT_JITCONFIG" ] && echo "ran in $PWD" >> "$HOME/log"\n'
                               'echo "$@" | grep -q -- "$ACTIONS_RUNNER_INPUT_JITCONFIG" && echo LEAK >> "$HOME/log"\n'
                               'env | grep -q FAKE_LOG && echo ENVLEAK >> "$HOME/log"\nexit 0\n')
    (tpl / "run.sh").chmod(0o755)
    spool = tmp_path / "spool"
    run_dir = tmp_path / "xdg"
    run_dir.mkdir()
    env = {
        "PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(tmp_path), "FAKE_LOG": str(tmp_path / "log"),
        "JIT_SPOOL": str(spool), "JIT_CONTROL": str(tmp_path / "control"),
        "JIT_HOME": str(tmp_path / "jithome"), "JIT_TEMPLATE": str(tpl), "JIT_ONCE": "1",
        "XDG_RUNTIME_DIR": str(run_dir),
    }
    return {"env": env, "spool": spool, "tmp": tmp_path}


def launch(le, slot):
    return subprocess.run(["bash", str(POOL_DIR / "jit_launcher.sh"), slot], env=le["env"],
                          capture_output=True, text=True, timeout=30)


def put_config(le, slot, name=f"jit-light-{NOW}-abcdef"):
    d = le["spool"] / slot
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{name}.jit").write_text(SECRET)
    return name


def test_launcher_light_uses_a_fresh_locked_down_container(launcher_env):
    name = put_config(launcher_env, "light")
    r = launch(launcher_env, "light")
    assert r.returncode == 0, r.stderr
    log = (launcher_env["tmp"] / "log").read_text()
    assert "envfile-ok mode=600" in log
    create = next(line for line in log.splitlines() if line.startswith("create "))
    for flag in ("--rm", f"--name {name}", "--cpus 1", "--memory 2g", "--cap-drop ALL",
                 "--security-opt no-new-privileges", "roxira-ci-light:latest"):
        assert flag in create
    assert "docker.sock" not in create            # light slot: no Docker socket
    assert SECRET not in log + r.stdout + r.stderr
    assert not list((launcher_env["spool"] / "light").glob("jit-*"))
    assert (launcher_env["spool"] / "light" / ".alive").exists()
    assert not list(Path(launcher_env["env"]["XDG_RUNTIME_DIR"]).glob("jit-env.*"))


def test_launcher_docker_runs_fresh_dir_and_removes_it(launcher_env):
    put_config(launcher_env, "docker", f"jit-docker-{NOW}-abcdef")
    r = launch(launcher_env, "docker")
    assert r.returncode == 0, r.stderr
    log = (launcher_env["tmp"] / "log").read_text()
    assert f"ran in {launcher_env['tmp']}/jithome/docker/jit-docker-{NOW}-abcdef" in log
    assert "LEAK" not in log                       # config not on the command line, env scrubbed
    assert SECRET not in r.stdout + r.stderr
    assert not (launcher_env["tmp"] / "jithome/docker" / f"jit-docker-{NOW}-abcdef").exists()


def test_launcher_idles_without_config_and_rejects_unknown_slot(launcher_env):
    r = launch(launcher_env, "light")
    assert r.returncode == 0
    assert not (launcher_env["tmp"] / "log").exists()
    assert launch(launcher_env, "gpu").returncode == 2


def test_root_script_dry_run_needs_no_root_and_prints_no_secrets():
    text = (ROOT / "scripts/ops/ci_box/08_root_ci_pool.sh").read_text()
    for forbidden in ("nft ", "ufw ", "/etc/xray", "sudoers", "phone-stack"):
        code = [ln for ln in text.splitlines() if not ln.lstrip().startswith("#")]
        assert not any(forbidden in ln for ln in code), forbidden
    assert "--dry-run" in text and "systemctl set-property" in text


def test_launcher_retires_old_runner_only_when_idle(launcher_env, tmp_path):
    bindir = Path(launcher_env["env"]["PATH"].split(":")[0])
    (bindir / "systemctl").write_text('#!/bin/bash\necho "systemctl $*" >> "$FAKE_LOG"\nexit 0\n')
    (bindir / "systemctl").chmod(0o755)
    (bindir / "pgrep").write_text('#!/bin/bash\n[ -e "$HOME/busy" ]\n')
    (bindir / "pgrep").chmod(0o755)
    control = Path(launcher_env["env"]["JIT_CONTROL"])
    control.mkdir(parents=True, exist_ok=True)
    (control / "retire-old-runner").touch()
    (launcher_env["tmp"] / "busy").touch()
    assert launch(launcher_env, "light").returncode == 0
    log = (launcher_env["tmp"] / "log").read_text()
    assert "disable --now actions-runner" not in log           # busy: left alone
    (launcher_env["tmp"] / "busy").unlink()
    assert launch(launcher_env, "light").returncode == 0
    assert "systemctl --user disable --now actions-runner" in (launcher_env["tmp"] / "log").read_text()


def test_reported_status_is_before_minting(jp, env):
    alive(env, "light", "docker")
    res = run_tick(jp, env, FakeApi())
    assert res["status"]["light"]["present"] == 0 and res["status"]["light"]["pending"] == 0
    assert any(a.startswith("mint jit-light-") for a in res["actions"])

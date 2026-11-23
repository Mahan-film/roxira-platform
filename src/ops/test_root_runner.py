# ruff: noqa: E501
"""roxira-root (issue #1315): fixed-verb root runner. Offline, no root, no systemd, no network.
The frozen script is rewritten (constants only) to point at fake binaries and temp files, then run for real."""

import os
import re
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "scripts/ops/ci_box/root_runner"
SCRIPT = PACK / "roxira-root"
INSTALLER = PACK / "install_root.sh"
DOC = ROOT / "docs/ops/ROOT_RUNNER.md"
VERBS = ["phone-keys-sync", "phone-restart", "phone-status", "jit-restart", "jit-status", "box-status"]

GOOD1 = "GOODKEY1_aaaaaaaaaaaaaaaaaaaa"
GOOD2 = "GOODKEY2_bbbbbbbbbbbbbbbbbbbb"
BAD = "BADKEY0000_cccccccccccccccccc"


def _stub(path: Path, body: str) -> Path:
    path.write_text("#!/bin/bash\n" + body)
    path.chmod(0o755)
    return path


@pytest.fixture()
def box(tmp_path):
    tmp = tmp_path.resolve()
    bindir = tmp / "bin"
    bindir.mkdir()
    calls = tmp / "calls.log"
    logs = tmp / "journal.log"
    calls.touch()
    logs.touch()
    # fakes: curl reads the key from the stdin config and answers 200 only for GOOD keys
    _stub(bindir / "curl", f'cfg="$(cat)"; echo "curl $*" >>{calls}; case "$cfg" in *GOODKEY*) printf 200;; *) printf 403;; esac\n')
    _stub(bindir / "systemctl", f'echo "systemctl $*" >>{calls}\ncase "$1" in is-active) echo active;; esac\n')
    _stub(bindir / "runuser", f'echo "runuser $*" >>{calls}\ncase "$*" in *is-active*) echo active;; esac\n')
    _stub(bindir / "logger", f'echo "$*" >>{logs}\n')
    _stub(bindir / "flock", "exit 0\n")
    _stub(bindir / "chown", f'echo "chown $*" >>{calls}\n')
    _stub(bindir / "sleep", "exit 0\n")
    _stub(bindir / "id", 'if [ "$1" = -u ] && [ -n "${2:-}" ]; then echo 1001; else echo 0; fi\n')
    _stub(bindir / "df", "echo df-ok\n")
    src_dir = tmp / "home/Secrets"
    src_dir.mkdir(parents=True)
    dst_dir = tmp / "srv/agent"
    dst_dir.mkdir(parents=True)
    src = src_dir / "roxira.env"
    dst = dst_dir / ".env"
    src.write_text(f"OTHER=1\nGEMINI_API_KEY={BAD}\nGEMINI_API_KEY_2='{GOOD1}'\nexport GEMINI_API_KEY_3=\"{GOOD2}\"\n")
    dst.write_text("PHONE_X=keep\nGEMINI_API_KEY=old\nGEMINI_API_KEY_2=old2\nLAST=keep\n")
    dst.chmod(0o640)
    text = SCRIPT.read_text()
    repl = {
        "SRC_ENV": str(src), "DST_ENV": str(dst), "LOCK": str(tmp / "lock"), "REBOOT_FLAG": str(tmp / "none"),
        "SENSORS": str(tmp / "nosensors"), "PROXY": "http://127.0.0.1:1",
        **{n: str(bindir / b) for n, b in [("CURL", "curl"), ("SYSTEMCTL", "systemctl"), ("RUNUSER", "runuser"), ("LOGGER", "logger"),
                                              ("FLOCK", "flock"), ("IDBIN", "id"), ("CHOWN", "chown"), ("SLEEP", "sleep"), ("DFBIN", "df")]},
    }
    for k, v in repl.items():
        text, n = re.subn(rf"^{k}=.*$", f"{k}={v}", text, flags=re.M)
        assert n == 1, k
    variant = tmp / "roxira-root"
    variant.write_text(text)
    variant.chmod(0o755)

    class Box:
        pass

    b = Box()
    b.tmp, b.src, b.dst, b.calls, b.logs, b.variant = tmp, src, dst, calls, logs, variant

    def run(*args, env=None):
        e = {"PATH": "/usr/bin:/bin"}
        e.update(env or {})
        return subprocess.run(["/bin/bash", str(variant), *args], capture_output=True, text=True, env=e, timeout=30)

    b.run = run
    return b


# ---- static properties of the frozen script ---------------------------------------------------------------------
def test_scripts_parse():
    for f in (SCRIPT, INSTALLER):
        assert subprocess.run(["bash", "-n", str(f)]).returncode == 0, f


def test_script_never_sources_evals_or_expands_arguments():
    code = "\n".join(line for line in SCRIPT.read_text().splitlines() if not line.lstrip().startswith("#"))
    assert not re.search(r"(?m)(^\s*|[;&|(]\s*)(source|eval)\s", code)
    assert not re.search(r"(^|\s)\.\s+\S", code)
    assert "$*" not in code and "${@" not in code
    assert code.count('"$@"') == 1  # only runner_systemctl forwards its OWN fixed arguments
    assert "$2" not in code and "$3" not in code
    # the only /home path is the key file, read as data
    assert re.findall(r"/home/[^\s'\"]*", code) == ["/home/mahan/Secrets/roxira/roxira.env"]
    assert "/roxira-wt" not in code and "worktree" not in code.lower()


def test_script_only_has_the_documented_verbs():
    code = SCRIPT.read_text()
    m = re.search(r"^  (phone-keys-sync \|[^)\n]*)\) ;;", code, flags=re.M)
    assert m and sorted(x.strip() for x in m.group(1).split("|")) == sorted(VERBS)


def test_installer_dry_run_changes_nothing_and_shows_the_grant():
    out = subprocess.run(["bash", str(INSTALLER)], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    o = out.stdout
    assert "Nothing changed" in o and "UNDO: rm -r /usr/local/lib/roxira-root" in o
    assert "mahan ALL=(root) NOPASSWD: /usr/local/sbin/roxira-root" in o
    assert "mahanfilms ALL=(root) NOPASSWD: /usr/local/sbin/roxira-root" in o
    assert o.count("NOPASSWD") == 2  # exactly two grants, both for the one stub
    assert "!setenv" in o and "exec /usr/local/lib/roxira-root/roxira-root" in o
    out2 = subprocess.run(["bash", str(INSTALLER), "--undo", "--dry-run"], capture_output=True, text=True)
    assert out2.returncode == 0 and "Nothing changed" in out2.stdout


def test_installer_apply_needs_root_and_unknown_option_fails():
    if os.getuid() != 0:
        r = subprocess.run(["bash", str(INSTALLER), "--apply"], capture_output=True, text=True)
        assert r.returncode == 1 and "run as root" in r.stderr
    assert subprocess.run(["bash", str(INSTALLER), "--bogus"], capture_output=True).returncode == 2


def test_doc_exists_and_states_the_threat_model():
    d = DOC.read_text()
    for needle in ("passwordless", "mahanfilms", "frozen", "install_root.sh", "undo", *VERBS):
        assert needle.lower() in d.lower(), needle


# ---- behaviour with fakes ---------------------------------------------------------------------------------------
@pytest.mark.parametrize("args", [[], ["nope"], ["phone-status", "x"], ["phone-status", "--help"], ["jit-restart", "123"], [""], ["../x"]])
def test_bad_arguments_are_refused_and_logged(box, args):
    r = box.run(*args)
    assert r.returncode == 2
    assert "refused" in box.logs.read_text()
    assert "systemctl" not in box.calls.read_text()


def test_every_call_is_logged_with_the_caller_uid(box):
    r = box.run("phone-status", env={"SUDO_UID": "1000"})
    assert r.returncode == 0
    j = box.logs.read_text()
    assert "uid=1000 verb=phone-status start" in j and "uid=1000 verb=phone-status done rc=0" in j
    box.logs.write_text("")
    box.run("phone-status", env={"SUDO_UID": "1000; rm -rf /"})  # junk is not trusted: falls back to the real uid
    assert "uid=0 verb=phone-status" in box.logs.read_text()


def test_keys_sync_keeps_working_keys_only_and_prints_no_values(box):
    r = box.run("phone-keys-sync", env={"SUDO_UID": "1002"})
    assert r.returncode == 0, r.stdout + r.stderr
    assert "GEMINI_API_KEY http=403" in r.stdout and "GEMINI_API_KEY_2 http=200" in r.stdout
    assert "GEMINI_API_KEY_3 http=200" in r.stdout and "GEMINI_API_KEY_4 not in file" in r.stdout
    for secret in (GOOD1, GOOD2, BAD):
        assert secret not in r.stdout + r.stderr + box.calls.read_text() + box.logs.read_text()  # not in argv, output or journal
    lines = box.dst.read_text().splitlines()
    assert lines[:2] == ["PHONE_X=keep", "LAST=keep"]
    assert lines[2:] == [f"GEMINI_API_KEY={GOOD1}", f"GEMINI_API_KEY_2={GOOD2}"]
    assert stat.S_IMODE(box.dst.stat().st_mode) == 0o600
    c = box.calls.read_text()
    assert "chown phone:phone" in c and "systemctl restart voice-ai-agent" in c
    assert "-K -" in c and "-x http://127.0.0.1:1" in c
    assert not list(box.dst.parent.glob(".env.*"))  # temp file renamed away


def test_keys_sync_no_working_key_leaves_env_and_service_alone(box):
    box.src.write_text(f"GEMINI_API_KEY={BAD}\n")
    before = box.dst.read_text()
    r = box.run("phone-keys-sync")
    assert r.returncode == 1 and "no working key" in r.stdout
    assert box.dst.read_text() == before
    assert "restart" not in box.calls.read_text()


def test_keys_sync_skips_values_with_odd_characters(box):
    box.src.write_text("GEMINI_API_KEY=abc;rm -rf /tmpxxxxxxxxxxxxxxxxx\nGEMINI_API_KEY_2=short\n")
    r = box.run("phone-keys-sync")
    assert r.returncode == 1
    assert r.stdout.count("unexpected format") == 2
    assert "curl" not in box.calls.read_text()


def test_keys_sync_refuses_symlinked_source(box):
    real = box.tmp / "elsewhere.env"
    real.write_text(box.src.read_text())
    box.src.unlink()
    box.src.symlink_to(real)
    r = box.run("phone-keys-sync")
    assert r.returncode == 1 and "not a regular file" in r.stdout
    assert "curl" not in box.calls.read_text()


def test_keys_sync_refuses_symlinked_source_directory(box):
    moved = box.tmp / "moved"
    box.src.parent.rename(moved)
    box.src.parent.symlink_to(moved)
    r = box.run("phone-keys-sync")
    assert r.returncode == 1 and "resolves elsewhere" in r.stdout
    assert "curl" not in box.calls.read_text()


def test_keys_sync_refuses_symlinked_destination(box):
    real = box.tmp / "target.env"
    real.write_text("x\n")
    box.dst.unlink()
    box.dst.symlink_to(real)
    assert box.run("phone-keys-sync").returncode == 1
    assert real.read_text() == "x\n"


def test_keys_sync_aborts_cleanly_when_chown_fails(box):
    _stub(box.tmp / "bin/chown", "exit 1\n")
    before = box.dst.read_text()
    r = box.run("phone-keys-sync")
    assert r.returncode == 1 and "chown failed" in r.stdout
    assert box.dst.read_text() == before
    assert not list(box.dst.parent.glob(".env.*"))
    assert "restart" not in box.calls.read_text()


def test_curl_ignores_rc_files_and_script_resets_home_and_shebang():
    code = SCRIPT.read_text()
    assert code.startswith("#!/bin/bash -p\n")
    assert re.search(r"^HOME=/root", code, flags=re.M)
    assert '"$CURL" -q ' in code  # -q first: no ~/.curlrc
    assert "#!/bin/bash -p" in INSTALLER.read_text()


def test_phone_restart_and_status(box):
    assert box.run("phone-restart").returncode == 0
    assert "systemctl restart voice-ai-agent" in box.calls.read_text()
    r = box.run("phone-status")
    assert r.returncode == 0 and "voice-ai-agent: active" in r.stdout
    assert "systemctl show voice-ai-agent" in box.calls.read_text()


def test_jit_restart_targets_fixed_units_as_runner(box):
    r = box.run("jit-restart")
    assert r.returncode == 0, r.stderr
    c = box.calls.read_text()
    assert "runuser -u runner -- " in c and "XDG_RUNTIME_DIR=/run/user/1001" in c
    assert "--user restart roxira-jit@light.service roxira-jit@docker.service" in c
    assert "--user try-restart actions-runner.service" in c  # old runner: restarted only if already active
    assert " start actions-runner" not in c
    assert "roxira-jit@light.service: active" in r.stdout


def test_jit_status_and_box_status_are_read_only(box):
    for v in ("jit-status", "box-status"):
        r = box.run(v)
        assert r.returncode == 0, r.stderr
    c = box.calls.read_text()
    assert " restart" not in c and "chown" not in c
    assert "== disk" in box.run("box-status").stdout and "no reboot required" in box.run("box-status").stdout


def test_lock_failure_blocks_state_changing_verbs(box):
    _stub(box.tmp / "bin/flock", "exit 1\n")
    r = box.run("phone-restart")
    assert r.returncode == 1 and "lock timeout" in r.stdout
    assert "restart" not in box.calls.read_text()

# ruff: noqa: E501
"""Builder separation (issue #1022): argument validation and path handling of the root runner, the wrapper verb,
the lane-side shim/importer and apply_root.sh. Offline, no root, no systemd, no network."""

import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "scripts/ops/ci_box/builder_egress"
LANE = ROOT / "scripts/ops/ci_box/lane_runner"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, PACK / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# no import-time side effects (src/test_ci_quarantine_guard.py): the modules are loaded by a module fixture
br = None
bio = None
UID = 0


@pytest.fixture(autouse=True, scope="module")
def _modules():
    global br, bio, UID
    br = _load("builder_run")
    bio = _load("builder_io")
    UID = os.getuid()


# secret-shaped values are assembled at run time so no scanner sees a key literal in the repo
KN = "KEYPOOL_MASTER" + "_KEY"
VAL = "place" + "holder-" + "value"
GOOD_CONFIG = (
    '{"model": "keypool/best-all", "provider": {"keypool": {"options": '
    '{"baseURL": "http://127.0.0.1:4181/v1", "apiKey": "{env:KEYPOOL_MASTER_KEY}"}}}}'
)


# ------------------------------------------------------------------ task id and other validators


@pytest.mark.parametrize("good", ["1", "0", "123", "000000000001", "999999999999"])
def test_task_id_accepts_digits(good):
    assert br.validate_task_id(good) == good


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "abc",
        "1;id",
        "1 2",
        "-1",
        "1234567890123",
        "١٢",
        "12\n",
        "../1",
        "0x10",
        "1/2",
        "1\x00",
        " 1",
        "$(id)",
        "1.5",
        None,
    ],
)
def test_task_id_rejects_everything_else(bad):
    with pytest.raises(br.RunnerError):
        br.validate_task_id(bad)


@pytest.mark.parametrize("bad", ["root", "", "A", "a b", "a;b", "../x", "x" * 40, "-x"])
def test_user_rejected(bad):
    with pytest.raises(br.RunnerError):
        br.validate_user(bad)


def test_model_allowlist():
    assert br.parse_model(b"keypool/agent-light-free\n") == "keypool/agent-light-free"
    for bad in (
        b"openrouter/x",
        b"keypool/private",
        b"keypool/best-all extra",
        b"",
        b"keypool/agent-light-free\nx",
    ):
        with pytest.raises(br.RunnerError):
            br.parse_model(bad)


def test_config_must_point_only_at_the_loopback_gateway():
    assert br.parse_config(GOOD_CONFIG.encode())
    evil = json.dumps({"provider": {"x": {"options": {"baseURL": "https://api.github.com/v1"}}}})
    for bad in (
        evil,
        "[]",
        "not json",
        json.dumps({"a": [{"baseURL": "http://127.0.0.1:4181/v1/../x"}]}),
        json.dumps({"provider": {"k": {"options": {"baseURL": "http://127.0.0.1:4000/v1"}}}}),
    ):
        with pytest.raises(br.RunnerError):
            br.parse_config(bad.encode())


def test_key_file_charset():
    assert br.parse_key(f"{KN}={VAL}\n".encode()) == VAL
    for bad in (
        f"{KN}=short".encode(),
        b"OTHER=abcdefgh1234",
        f"{KN}=abc def ghij".encode(),
        f"{KN}={VAL}\nFOO=bar".encode(),
        f"{KN}=$(id)abcdef".encode(),
        f"{KN}='abcdefgh12'".encode(),
        f"{KN}=".encode() + b"a" * 300,
    ):
        with pytest.raises(br.RunnerError):
            br.parse_key(bad)


def test_prompt_validation():
    assert br.parse_prompt("hello é".encode()) == "hello é"
    for bad in (b"", b"   \n", b"a\x00b", b"\xff\xfe"):
        with pytest.raises(br.RunnerError):
            br.parse_prompt(bad)


# ------------------------------------------------------------------ sandbox command line


def _argv(tmp_path):
    cfg = br.Cfg()
    return cfg, br.systemd_run_argv(
        cfg,
        "42",
        "/srv/data/roxira-lane/tasks/42/work",
        "/run/roxira-builder/42/task",
        "/run/roxira-builder/42/env",
    )


def test_sandbox_argv_is_fixed_and_hardened(tmp_path):
    _cfg_unused, argv = _argv(tmp_path)
    props = [argv[i + 1] for i, a in enumerate(argv) if a == "-p"]
    for needed in (
        "NoNewPrivileges=yes",
        "PrivateTmp=yes",
        "ProtectHome=yes",
        "ProtectSystem=strict",
        "PrivateDevices=yes",
        "CapabilityBoundingSet=",
        "MemoryMax=3G",
        "CPUQuota=200%",
        "RuntimeMaxSec=3600",
        "User=roxira-builder",
        "IPAddressDeny=any",
        "TemporaryFileSystem=/srv:ro",
        "RestrictSUIDSGID=yes",
        "MemorySwapMax=0",
    ):
        assert needed in props, needed
    assert "--expand-environment=no" in argv
    assert argv[argv.index("--") + 1 :] == [
        "/usr/bin/python3",
        "-I",
        "/usr/local/libexec/roxira-lane/builder-run",
        "--launch",
    ]
    assert argv[0] == "/usr/bin/systemd-run"
    assert not any(a.startswith("--setenv") for a in argv)


def test_sandbox_argv_has_no_secret_and_no_shell(tmp_path):
    _cfg, argv = _argv(tmp_path)
    blob = "\n".join(argv)
    assert "KEYPOOL" not in blob and "bash" not in blob and "sh -c" not in blob
    assert "$" not in blob and "%" not in blob.replace(
        "200%", ""
    )  # no systemd specifier/variable syntax


def test_unit_name_only_from_a_valid_id():
    assert br.unit_name("7") == "roxira-builder-7"
    with pytest.raises(br.RunnerError):
        br.unit_name("7;reboot")


def test_env_lines_fixed_and_key_only_when_given():
    cfg = br.Cfg()
    no_key = br.env_lines(cfg, None)
    assert all(not line.startswith("KEYPOOL") for line in no_key)
    assert "OPENCODE_CONFIG=/run/roxira-task/config.json" in no_key
    assert f"{KN}={VAL}" in br.env_lines(cfg, VAL)


# ------------------------------------------------------------------ path handling (real files in tmp, current uid)


def _cfg(tmp_path, **kw):
    tasks = tmp_path / "tasks"
    tasks.mkdir(mode=0o755, exist_ok=True)
    return br.Cfg(tasks_dir=str(tasks), runtime_dir=str(tmp_path / "rt"), trusted_uid=UID, **kw)


def _task(tmp_path, tid="55", key=True, **over):
    d = tmp_path / "tasks" / tid
    d.mkdir(mode=0o700, parents=True)
    (d / "work").mkdir()
    (d / "out").mkdir()
    files = {"prompt.txt": "do it", "model.txt": "keypool/best-all\n", "config.json": GOOD_CONFIG}
    if key:
        files["gateway.env"] = f"{KN}={VAL}\n"
    files.update(over)
    for n, c in files.items():
        if c is not None:
            (d / n).write_text(c)
            (d / n).chmod(0o600)
    return d


def _prepare(cfg, tid="55"):
    prep, *fds = br.prepare(cfg, UID, tid)
    for fd in fds:
        os.close(fd)
    return prep


def test_prepare_happy_path(tmp_path):
    cfg = _cfg(tmp_path)
    _task(tmp_path)
    prep = _prepare(cfg)
    assert (prep.prompt, prep.model, prep.key) == ("do it", "keypool/best-all", VAL)


def test_prepare_without_key_is_allowed(tmp_path):
    cfg = _cfg(tmp_path)
    _task(tmp_path, key=False)
    assert _prepare(cfg).key is None


@pytest.mark.parametrize("name", ["prompt.txt", "model.txt", "config.json"])
def test_missing_required_file(tmp_path, name):
    cfg = _cfg(tmp_path)
    _task(tmp_path, **{name: None})
    (tmp_path / "tasks/55" / name).unlink(missing_ok=True)
    with pytest.raises(br.RunnerError):
        _prepare(cfg)


def test_symlinked_spec_file_is_refused(tmp_path):
    cfg = _cfg(tmp_path)
    d = _task(tmp_path)
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret")
    (d / "prompt.txt").unlink()
    (d / "prompt.txt").symlink_to(secret)
    with pytest.raises(br.RunnerError):
        _prepare(cfg)


def test_hardlinked_spec_file_is_refused(tmp_path):
    cfg = _cfg(tmp_path)
    d = _task(tmp_path)
    os.link(d / "prompt.txt", tmp_path / "elsewhere")
    with pytest.raises(br.RunnerError):
        _prepare(cfg)


def test_fifo_spec_file_is_refused_without_blocking(tmp_path):
    cfg = _cfg(tmp_path)
    d = _task(tmp_path)
    (d / "prompt.txt").unlink()
    os.mkfifo(d / "prompt.txt", 0o600)
    with pytest.raises(br.RunnerError):
        _prepare(cfg)


def test_oversized_spec_file_is_refused(tmp_path):
    cfg = _cfg(tmp_path)
    _task(tmp_path, **{"prompt.txt": "x" * (br.MAX_PROMPT + 1)})
    with pytest.raises(br.RunnerError):
        _prepare(cfg)


def test_group_writable_spec_file_is_refused(tmp_path):
    cfg = _cfg(tmp_path)
    d = _task(tmp_path)
    (d / "prompt.txt").chmod(0o666)
    with pytest.raises(br.RunnerError):
        _prepare(cfg)


def test_wrong_owner_is_refused(tmp_path):
    cfg = _cfg(tmp_path)
    _task(tmp_path)
    with pytest.raises(br.RunnerError):
        br.prepare(cfg, UID + 1, "55")


def test_task_dir_symlink_is_refused(tmp_path):
    cfg = _cfg(tmp_path)
    real = _task(tmp_path, tid="66")
    (tmp_path / "tasks" / "77").symlink_to(real)
    with pytest.raises(br.RunnerError):
        _prepare(cfg, "77")


def test_task_dir_group_writable_is_refused(tmp_path):
    cfg = _cfg(tmp_path)
    d = _task(tmp_path)
    d.chmod(0o770)
    with pytest.raises(br.RunnerError):
        _prepare(cfg)


def test_work_or_out_missing_or_symlinked(tmp_path):
    cfg = _cfg(tmp_path)
    d = _task(tmp_path)
    shutil.rmtree(d / "work")
    (d / "work").symlink_to(tmp_path)
    with pytest.raises(br.RunnerError):
        _prepare(cfg)


def test_tasks_dir_must_be_owned_by_trusted_uid(tmp_path):
    (tmp_path / "tasks").mkdir()
    _task(tmp_path)
    cfg = br.Cfg(tasks_dir=str(tmp_path / "tasks"), trusted_uid=UID + 1, check_ancestors=False)
    with pytest.raises(br.RunnerError):
        br.prepare(cfg, UID, "55")


def test_ancestor_checks(tmp_path):
    a = tmp_path / "a"
    a.mkdir(mode=0o755)
    (a / "tasks").mkdir()
    br.check_ancestors(str(a / "tasks"), UID)  # fine
    a.chmod(0o775)
    with pytest.raises(br.RunnerError):
        br.check_ancestors(str(a / "tasks"), UID)  # group-writable ancestor
    a.chmod(0o755)
    link = tmp_path / "link"
    link.symlink_to(a)
    with pytest.raises(br.RunnerError):
        br.check_ancestors(str(link / "tasks"), UID)  # symlinked ancestor
    with pytest.raises(br.RunnerError):
        br.check_ancestors(
            str(a / "tasks"), UID + 1000 if UID else 1000
        )  # wrong owner (root also counts as trusted)


def test_task_id_with_path_tricks_never_reaches_the_filesystem(tmp_path):
    cfg = _cfg(tmp_path)
    _task(tmp_path)
    for bad in ("../tasks/55", "55/../55", "/etc", ".", ".."):
        with pytest.raises(br.RunnerError):
            br.prepare(cfg, UID, bad)


def test_stage_runtime_layout(tmp_path):
    cfg = _cfg(tmp_path)
    _task(tmp_path)
    prep = _prepare(cfg)
    task, env = br.stage_runtime(cfg, prep)
    assert sorted(os.listdir(task)) == ["config.json", "model.txt", "prompt.txt"]
    assert stat.S_IMODE(os.stat(env).st_mode) == 0o600
    assert f"{KN}={VAL}" in Path(env).read_text()
    for f in os.listdir(task):  # the key must not be in the sandbox-visible mount
        assert VAL not in (Path(task) / f).read_text()
    br.stage_runtime(cfg, prep)  # a stale runtime dir is replaced, not an error


def test_write_out_is_exclusive_and_no_follow(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    fd = br._open_dir(str(out))
    br.write_out(fd, "builder.log", b"x", UID, os.getgid())
    with pytest.raises(FileExistsError):
        br.write_out(fd, "builder.log", b"y", UID, os.getgid())
    (out / "link").symlink_to(tmp_path / "victim")
    with pytest.raises(OSError):
        br.write_out(fd, "link", b"z", UID, os.getgid())
    assert not (tmp_path / "victim").exists()
    os.close(fd)


def test_chown_tree_does_not_follow_symlinks_and_refuses_hardlinks(tmp_path):
    work = tmp_path / "work"
    (work / "sub").mkdir(parents=True)
    (work / "sub" / "f").write_text("1")
    outside = tmp_path / "outside"
    outside.write_text("keep")
    (work / "l").symlink_to(outside)
    fd = br._open_dir(str(work))
    assert br.chown_tree(fd, UID, os.getgid()) == 3
    os.close(fd)
    os.link(work / "sub" / "f", tmp_path / "second-name")
    fd = br._open_dir(str(work))
    with pytest.raises(br.RunnerError):
        br.chown_tree(fd, UID, os.getgid())
    os.close(fd)


def test_main_usage_errors_exit_2(capsys):
    for argv in (
        [],
        ["--task", "5"],
        ["--lane-user", "x", "--task", "abc"],
        ["--lane-user", "x", "--task", "1;id"],
        ["--launch", "extra"],
        ["--lane-user", "root", "--task", "5"],
        ["--lane-user", "x", "--task", "5", "more"],
    ):
        assert br.main(argv) == 2, argv


def test_run_refuses_non_root():
    if os.geteuid() == 0:
        pytest.skip("running as root")
    with pytest.raises(br.RunnerError):
        br.run(br.Cfg(), "someone", "5")


# ------------------------------------------------------------------ the root wrapper verb (rendered by install_root.sh)


def _wrapper_text():
    out = subprocess.run(
        ["bash", str(LANE / "install_root.sh"), "--lane-user", "nobody"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    body = out.split("(root:root 755):\n", 1)[1].split("[dry-run] would write /etc/sudoers.d", 1)[0]
    return body


@pytest.fixture()
def wrapper(tmp_path):
    stub = tmp_path / "builder-run"
    stub.write_text(
        '#!/bin/bash\nprintf "ARGS:"; for a in "$@"; do printf " [%s]" "$a"; done; echo\n'
    )
    stub.chmod(0o755)
    text = _wrapper_text().replace("/usr/local/libexec/roxira-lane/builder-run", str(stub))
    path = tmp_path / "wrapper"
    path.write_text(text)
    return path


def _w(wrapper, *args):
    return subprocess.run(["bash", str(wrapper), *args], capture_output=True, text=True)


def test_wrapper_valid_task_id_reaches_the_runner_with_fixed_args(wrapper):
    r = _w(wrapper, "run-builder", "123456789012")
    assert r.returncode == 0
    assert r.stdout.strip() == "ARGS: [--lane-user] [nobody] [--task] [123456789012]"


@pytest.mark.parametrize(
    "args",
    [
        ("run-builder",),
        ("run-builder", ""),
        ("run-builder", "abc"),
        ("run-builder", "1;id"),
        ("run-builder", "1 2"),
        ("run-builder", "-1"),
        ("run-builder", "1234567890123"),
        ("run-builder", "12\n"),
        ("run-builder", "$(id)"),
        ("run-builder", "../1"),
        ("run-builder", "1", "2"),
        ("run-builder", "1", "--lane-user", "root"),
        ("run-builder", "\u0661"),
        ("bogus",),
        (),
        ("linger-on", "extra"),
        ("status", "x"),
    ],
)
def test_wrapper_rejects_bad_arguments(wrapper, args):
    r = _w(wrapper, *args)
    assert r.returncode == 2 and "usage:" in r.stderr and "ARGS:" not in r.stdout


def test_wrapper_text_has_no_eval_and_no_caller_paths():
    t = _wrapper_text()
    assert "eval" not in t and "$@" not in t and "$*" not in t
    assert t.count("exec ") == 4  # three linger verbs + the one runner exec


# ------------------------------------------------------------------ lane-side shim and importer


def _tree(root: Path, files: dict):
    for rel, content in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)


def test_stage_tree_skips_git_keeps_exec_bit(tmp_path):
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.mkdir()
    dst.mkdir()
    _tree(src, {".git": "gitdir: /elsewhere", "a/b.txt": "x", "run.sh": "#!/bin/sh"})
    (src / "run.sh").chmod(0o755)
    (src / "ln").symlink_to("a/b.txt")
    bio.stage_tree(src, dst)
    assert not (dst / ".git").exists()
    assert (dst / "a/b.txt").read_text() == "x"
    assert os.access(dst / "run.sh", os.X_OK)
    assert os.readlink(dst / "ln") == "a/b.txt"


def test_import_applies_edits_creations_and_deletions(tmp_path):
    wt, work = tmp_path / "wt", tmp_path / "work"
    wt.mkdir()
    work.mkdir()
    _tree(
        wt,
        {
            ".git": "gitdir: x",
            "keep.txt": "same",
            "edit.txt": "old",
            "gone.txt": "bye",
            "d/gone2.txt": "bye",
        },
    )
    bio.stage_tree(wt, work)
    (work / "edit.txt").write_text("new")
    (work / "gone.txt").unlink()
    shutil.rmtree(work / "d")
    _tree(work, {"new/dir/f.txt": "created"})
    assert bio.import_tree(work, wt) == []
    assert (wt / "edit.txt").read_text() == "new"
    assert (wt / "new/dir/f.txt").read_text() == "created"
    assert (wt / "keep.txt").read_text() == "same"
    assert not (wt / "gone.txt").exists() and not (wt / "d").exists()
    assert (wt / ".git").read_text() == "gitdir: x"


def test_import_refuses_symlinks_git_and_special_files(tmp_path):
    wt, work = tmp_path / "wt", tmp_path / "work"
    wt.mkdir()
    work.mkdir()
    _tree(wt, {"ok.txt": "1", "victim.txt": "precious"})
    bio.stage_tree(wt, work)
    (work / "evil").symlink_to("/etc/passwd")
    (work / "victim.txt").unlink()
    (work / "victim.txt").symlink_to("/etc/passwd")
    _tree(work, {".git/config": "[core]\nfsmonitor = x", "sub/.git/hooks": "x"})
    os.mkfifo(work / "pipe")
    bad = bio.import_tree(work, wt)
    joined = "\n".join(bad)
    assert (
        "evil (symlink change)" in joined and ".git" in joined and "pipe (special file)" in joined
    )
    assert not os.path.lexists(wt / "evil")
    assert (wt / "victim.txt").read_text() == "precious"  # a refused entry keeps the original
    assert not (wt / "sub").exists() or not (wt / "sub/.git").exists()


def test_import_accepts_unchanged_repo_symlinks(tmp_path):
    wt, work = tmp_path / "wt", tmp_path / "work"
    wt.mkdir()
    work.mkdir()
    _tree(wt, {"a.txt": "1"})
    (wt / "ln").symlink_to("a.txt")
    bio.stage_tree(wt, work)
    assert bio.import_tree(work, wt) == []
    assert os.readlink(wt / "ln") == "a.txt"


def test_import_handles_type_changes_and_limits(tmp_path, monkeypatch):
    wt, work = tmp_path / "wt", tmp_path / "work"
    wt.mkdir()
    work.mkdir()
    _tree(wt, {"x/inner.txt": "1", "y": "file"})
    bio.stage_tree(wt, work)
    shutil.rmtree(work / "x")
    (work / "x").write_text("now a file")
    (work / "y").unlink()
    _tree(work, {"y/now_dir.txt": "2"})
    assert bio.import_tree(work, wt) == []
    assert (wt / "x").read_text() == "now a file" and (wt / "y/now_dir.txt").read_text() == "2"
    monkeypatch.setattr(bio, "MAX_FILE_BYTES", 4)
    (work / "big.txt").write_text("123456789")
    assert any("too large" in b for b in bio.import_tree(work, wt))
    assert not (wt / "big.txt").exists()


def test_import_fixes_unreadable_directories(tmp_path):
    wt, work = tmp_path / "wt", tmp_path / "work"
    wt.mkdir()
    (work / "d").mkdir(parents=True)
    (work / "d" / "f.txt").write_text("1")
    (work / "d").chmod(0o000)
    assert bio.import_tree(work, wt) == []
    assert (wt / "d/f.txt").read_text() == "1"


def test_shim_argument_parsing():
    assert bio.parse_opencode_args(["run", "-m", "keypool/best-all", "p"]) == (
        "keypool/best-all",
        "p",
    )
    for bad in (
        [],
        ["run"],
        ["run", "-m", "x", "p"],
        ["serve", "-m", "keypool/best-all", "p"],
        ["run", "-m", "keypool/best-all", "p", "extra"],
        ["run", "-m", "keypool/best-all", "  "],
        ["run", "-m", "keypool/best-all\n", "p"],
    ):
        with pytest.raises(bio.ShimError):
            bio.parse_opencode_args(bad)


def test_new_task_dir_id_format_and_collision(tmp_path):
    seen = set()
    counter = iter(range(100))
    for _ in range(5):
        tid, d = bio.new_task_dir(tmp_path, lambda n, c=counter: next(c))
        seen.add(tid)
        assert re.fullmatch(r"[0-9]{1,12}", tid) and (d / "work").is_dir() and (d / "out").is_dir()
        assert stat.S_IMODE(d.stat().st_mode) == 0o700
    assert len(seen) == 5
    with pytest.raises(
        bio.ShimError
    ):  # a constant "random" part collides on the second call within one second
        for _ in range(2):
            bio.new_task_dir(tmp_path, lambda n: 99)


def test_shim_end_to_end_with_fake_wrapper(tmp_path):
    wt = tmp_path / "wt"
    tasks = tmp_path / "tasks"
    wt.mkdir()
    tasks.mkdir()
    _tree(wt, {".git": "gitdir: x", "docs/a.md": "old"})
    fake = tmp_path / "fake-root"
    fake.write_text("""#!/bin/bash
set -eu
[ "$1" = run-builder ] && [ $# -eq 2 ]
d="$ROXIRA_BUILDER_TASKS/$2"
[ -z "${KEYPOOL_MASTER_KEY:-}" ] && [ -z "${OPENCODE_CONFIG_CONTENT:-}" ]      # secrets never in the child env
[ "$(stat -c %a "$d/gateway.env")" = 600 ] && grep -q "^KEYPOOL_MASTER_KEY=${EXPECT_KEY}$" "$d/gateway.env"
[ "$(cat "$d/prompt.txt")" = "do the task" ] && [ -f "$d/work/.git/HEAD" ] && ! grep -q remote "$d/work/.git/config" && [ -z "$(ls "$d/work/.git/hooks" 2>/dev/null)" ]
echo edited > "$d/work/docs/a.md"; echo made > "$d/work/docs/b.md"
echo "builder says hi" > "$d/out/builder.log"; echo '{"exit": 0}' > "$d/out/result.json"
""")
    fake.chmod(0o755)
    env = dict(
        os.environ,
        ROXIRA_BUILDER_TASKS=str(tasks),
        ROXIRA_BUILDER_ROOT_WRAPPER=str(fake),
        ROXIRA_BUILDER_NO_SUDO="1",
        OPENCODE_CONFIG_CONTENT=GOOD_CONFIG,
        EXPECT_KEY=VAL,
        **{KN: VAL},
    )
    r = subprocess.run(
        [str(PACK / "builder-shim"), "run", "-m", "keypool/best-all", "do the task"],
        cwd=wt,
        env=env,
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    assert "builder says hi" in r.stdout  # the log is replayed for run_task.sh's classifier
    assert (wt / "docs/a.md").read_text() == "edited\n" and (
        wt / "docs/b.md"
    ).read_text() == "made\n"
    assert (wt / ".git").read_text() == "gitdir: x"
    assert os.listdir(tasks) == []  # task dir removed (the key file with it)


def test_shim_failure_exit_code_is_passed_through(tmp_path):
    wt, tasks = tmp_path / "wt", tmp_path / "tasks"
    wt.mkdir()
    tasks.mkdir()
    fake = tmp_path / "fake-root"
    fake.write_text(
        '#!/bin/bash\nd="$ROXIRA_BUILDER_TASKS/$2"; echo "429 rate limit" > "$d/out/builder.log"; '
        'echo \'{"exit": 124}\' > "$d/out/result.json"; exit 124\n'
    )
    fake.chmod(0o755)
    env = dict(
        os.environ,
        ROXIRA_BUILDER_TASKS=str(tasks),
        ROXIRA_BUILDER_ROOT_WRAPPER=str(fake),
        ROXIRA_BUILDER_NO_SUDO="1",
        OPENCODE_CONFIG_CONTENT=GOOD_CONFIG,
    )
    r = subprocess.run(
        [str(PACK / "builder-shim"), "run", "-m", "keypool/best-all", "p"],
        cwd=wt,
        env=env,
        capture_output=True,
        text=True,
    )
    assert r.returncode == 124 and "429 rate limit" in r.stdout


def test_shim_refuses_without_config_or_with_wrong_args(tmp_path):
    env = {k: v for k, v in os.environ.items() if k != "OPENCODE_CONFIG_CONTENT"}
    assert (
        subprocess.run(
            [str(PACK / "builder-shim"), "run", "-m", "keypool/best-all", "p"],
            cwd=tmp_path,
            env=env,
            capture_output=True,
        ).returncode
        == 2
    )
    assert (
        subprocess.run(
            [str(PACK / "builder-shim"), "serve"], cwd=tmp_path, env=env, capture_output=True
        ).returncode
        == 2
    )


# ------------------------------------------------------------------ apply_root.sh

APPLY = PACK / "apply_root.sh"


def _apply(*args):
    return subprocess.run(["bash", str(APPLY), *args], capture_output=True, text=True)


@pytest.mark.skipif(
    sys.platform != "linux" or not shutil.which("getent"), reason="needs a Linux userland"
)
def test_apply_root_dry_run_changes_nothing_and_prints_undo_per_step():
    me = subprocess.run(["id", "-un"], capture_output=True, text=True).stdout.strip()
    if me == "root":
        pytest.skip("dry-run test is for non-root")
    r = _apply("--lane-user", me)
    assert r.returncode == 0, r.stderr
    assert "Nothing changed" in r.stdout
    assert r.stdout.count("UNDO:") >= 6
    assert "docker group members (left untouched)" in r.stdout
    assert "[dry-run]" in r.stdout and "nft" in r.stdout


def test_apply_root_apply_needs_root():
    if os.geteuid() == 0:
        pytest.skip("running as root")
    assert _apply("--lane-user", "nobody", "--apply").returncode == 2


@pytest.mark.parametrize(
    "args",
    [
        [],
        ["--lane-user", "root"],
        ["--lane-user", "a b"],
        ["--lane-user", "nobody", "--builder-user", "nobody"],
        ["--lane-user", "nobody", "--remove-docker"],
        ["--lane-user", "nobody", "--docker-drop-user"],
        ["--lane-user", "nobody", "--bogus"],
        ["--lane-user", "no-such-user-xyz"],
    ],
)
def test_apply_root_refuses_bad_or_docker_options(args):
    assert _apply(*args).returncode == 2


def test_apply_root_never_edits_group_membership():
    """Structural guard: the script has no command that could change anyone's groups."""
    code = [line for line in APPLY.read_text().splitlines() if not line.lstrip().startswith("#")]
    text = "\n".join(code)
    for forbidden in (
        "gpasswd",
        "usermod",
        "deluser",
        "adduser",
        "groupmod",
        "groupdel",
        "newgrp",
        "delgroup",
        "--groups",
        " -G ",
    ):
        assert forbidden not in text, forbidden
    assert not re.search(
        r"visudo|\bufw\b|iptables|/etc/sudoers|/etc/xray|/etc/group", text
    )  # no sudoers/ufw/xray/group-file edits
    assert (
        "useradd --system --user-group" in text
    )  # the only account change: a new group-less system user


def test_pack_has_no_hostnames_ips_or_keys():
    mine = [
        "apply_root.sh",
        "builder_run.py",
        "builder_io.py",
        "builder-shim",
        "roxira-builder-proxy.service",
        "roxira-builder-nft.service",
        "egress_probe.sh",
    ]
    for p in [PACK / n for n in mine] + [LANE / "install_root.sh", LANE / "lane-run"]:
        if p.is_file():
            t = p.read_text()
            assert not re.search(
                r"\b(?:\d{1,3}\.){3}\d{1,3}\b", t.replace("127.0.0.1", "").replace("0.0.0.0", "")
            ), p
            assert not re.search(
                r"(sk-[A-Za-z0-9]{10}|gsk_[A-Za-z0-9]{10}|BEGIN [A-Z ]*PRIVATE KEY)", t
            ), p


def test_chown_tree_return_pass_accepts_hard_links(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    (work / "f").write_text("1")
    os.link(work / "f", work / "g")
    fd = br._open_dir(str(work))
    assert br.chown_tree(fd, UID, os.getgid(), refuse_links=False) == 2
    with pytest.raises(br.RunnerError):
        br.chown_tree(fd, UID, os.getgid())
    os.close(fd)


def test_import_size_limits_apply_to_changes_not_to_the_whole_tree(tmp_path, monkeypatch):
    wt, work = tmp_path / "wt", tmp_path / "work"
    wt.mkdir()
    work.mkdir()
    _tree(wt, {"bin/big.bin": "x" * 50, "a.txt": "1"})
    bio.stage_tree(wt, work)
    monkeypatch.setattr(bio, "MAX_FILE_BYTES", 10)
    assert bio.import_tree(work, wt) == []  # the unchanged 50-byte file is fine
    (work / "a.txt").write_text("2" * 11)
    assert any("too large" in b for b in bio.import_tree(work, wt))
    assert (wt / "a.txt").read_text() == "1"
    monkeypatch.setattr(bio, "MAX_FILE_BYTES", 100)
    monkeypatch.setattr(bio, "MAX_TOTAL_BYTES", 10)
    assert any("too large" in b for b in bio.import_tree(work, wt))


def test_sandbox_property_set_is_the_tested_one():
    props = br.unit_properties(br.Cfg(), "9", "/w", "/r/task", "/r/env")
    assert not any(p.startswith("ProcSubset") for p in props)
    assert sum(p.startswith("EnvironmentFile=") for p in props) == 2


def test_init_work_repo_is_fresh_without_remote_or_hooks(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    bio.init_work_repo(work)
    assert (work / ".git" / "HEAD").is_file()
    assert "remote" not in (work / ".git" / "config").read_text()
    assert not (work / ".git" / "hooks").exists() or not os.listdir(work / ".git" / "hooks")
    out = subprocess.run(["git", "-C", str(work), "log"], capture_output=True, text=True)
    assert out.returncode != 0  # no history: nothing of the real repository is reachable


def test_import_ignores_the_builders_root_git_even_if_hostile(tmp_path):
    wt, work = tmp_path / "wt", tmp_path / "work"
    wt.mkdir()
    work.mkdir()
    _tree(wt, {".git": "gitdir: x", "a.txt": "1"})
    bio.stage_tree(wt, work)
    bio.init_work_repo(work)
    (work / ".git" / "config").write_text("[core]\nfsmonitor = touch /tmp/pwned\n")
    (work / "a.txt").write_text("2")
    assert bio.import_tree(work, wt) == []
    assert (wt / ".git").read_text() == "gitdir: x" and (wt / "a.txt").read_text() == "2"
    (work / "sub").mkdir()
    (work / "sub" / ".git").mkdir()
    assert any(
        "sub/.git" in b for b in bio.import_tree(work, wt)
    )  # nested repositories stay refused


def test_apply_root_installs_ripgrep_idempotently():
    text = APPLY.read_text()
    assert "dpkg -s ripgrep" in text and "apt-get install -y ripgrep" in text

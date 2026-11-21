#!/usr/bin/python3 -I
# ruff: noqa: E501
"""Root-side builder runner (issue #1022). Installed root-owned as /usr/local/libexec/roxira-lane/builder-run.

Only ever started by the root wrapper verb `roxira-lane-root run-builder <task-id>`:

    builder-run --lane-user <user> --task <digits>     (root) validate, run ONE sandboxed builder, write results
    builder-run --launch                               (inside the sandbox, as the builder user) exec the fixed command

The caller supplies one thing: a task id of 1-12 digits. Everything else is fixed here or read from files below the
fixed directory TASKS_DIR/<id>/ (the lane user may write there; nothing else is taken from the caller):

    prompt.txt   the task text (utf-8, <= 256 KiB)               required
    model.txt    one of MODELS                                     required
    config.json  opencode config (JSON object, gateway URL fixed)  required
    gateway.env  KEYPOOL_MASTER_KEY=<capped virtual key>           optional, single line, strict charset
    work/        the tree the builder may edit (becomes the cwd)   required, owned by the lane user
    out/         results: builder.log, result.json (written by root, owned by the lane user)  required

No shell is involved anywhere: the sandbox is `systemd-run` with an argv list, the builder command is
`builder-run --launch`, which execs the fixed opencode binary with the prompt as ONE argv element read from a file.
Files are opened below directory descriptors with O_NOFOLLOW and checked with fstat (regular file, owner = lane user,
single link, size cap), so a planted symlink or hard link cannot make root read or hand over another file.
Stdlib only. Exit: the builder's exit code; 2 usage/validation; 6 egress lock missing; 75 another builder is running.
"""

from __future__ import annotations

import fcntl
import json
import os
import pwd
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
from dataclasses import dataclass

TASK_ID_RE = re.compile(r"[0-9]{1,12}")
USER_RE = re.compile(r"[a-z_][a-z0-9_-]{0,31}")
KEY_RE = re.compile(r"[A-Za-z0-9_.-]{8,256}")
ENV_VALUE_RE = re.compile(r"[A-Za-z0-9_./:@,+=-]*")
GATEWAY_URL_RE = re.compile(r"http://127\.0\.0\.1:4181/v1/?")
MODELS = frozenset({"keypool/agent-light-free", "keypool/agent-strong-free", "keypool/best-all"})
TASK_MOUNT = "/run/roxira-task"
MAX_PROMPT = 256 * 1024
MAX_CONFIG = 100 * 1024
MAX_KEY_FILE = 1024
MAX_LOG = 2 * 1024 * 1024


class RunnerError(Exception):
    def __init__(self, msg: str, rc: int = 2):
        super().__init__(msg)
        self.rc = rc


@dataclass(frozen=True)
class Cfg:
    tasks_dir: str = "/srv/data/roxira-lane/tasks"
    self_path: str = "/usr/local/libexec/roxira-lane/builder-run"
    opencode: str = "/opt/roxira-builder/bin/opencode"
    env_file: str = "/etc/roxira-lane/builder-proxy.env"
    builder_user: str = "roxira-builder"
    home: str = "/var/lib/roxira-builder"
    runtime_dir: str = "/run/roxira-builder"
    lock_file: str = "/run/roxira-builder.lock"
    systemd_run: str = "/usr/bin/systemd-run"
    systemctl: str = "/usr/bin/systemctl"
    nft: str = "/usr/sbin/nft"
    python: str = "/usr/bin/python3"
    max_runtime: int = 3600
    trusted_uid: int = 0  # owner required for TASKS_DIR and every ancestor
    check_ancestors: bool = True
    require_nft: bool = True  # fail closed when the egress table is not loaded


# ---------------------------------------------------------------- validation (pure, unit-tested)


def validate_task_id(s: str) -> str:
    if not isinstance(s, str) or not TASK_ID_RE.fullmatch(s):
        raise RunnerError("task id must be 1-12 digits")
    return s


def validate_user(s: str) -> str:
    if not isinstance(s, str) or not USER_RE.fullmatch(s) or s == "root":
        raise RunnerError("bad user name")
    return s


def parse_prompt(data: bytes) -> str:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as e:
        raise RunnerError("prompt.txt is not utf-8") from e
    if "\x00" in text or not text.strip():
        raise RunnerError("prompt.txt is empty or contains NUL")
    return text


def parse_model(data: bytes) -> str:
    m = data.decode("utf-8", "replace").strip()
    if m not in MODELS:
        raise RunnerError("model.txt: model not allowed")
    return m


def _base_urls(node, out: list) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            if k.lower() in ("baseurl", "base_url", "api_base") and isinstance(v, str):
                out.append(v)
            _base_urls(v, out)
    elif isinstance(node, list):
        for v in node:
            _base_urls(v, out)


def parse_config(data: bytes) -> bytes:
    try:
        cfg = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as e:
        raise RunnerError("config.json is not valid JSON") from e
    if not isinstance(cfg, dict):
        raise RunnerError("config.json must be a JSON object")
    urls: list[str] = []
    _base_urls(cfg, urls)
    for u in urls:  # the gateway key goes to whatever URL the config names: only the loopback gateway is allowed
        if not GATEWAY_URL_RE.fullmatch(u):
            raise RunnerError("config.json: a provider URL is not the loopback gateway")
    return data


def parse_key(data: bytes) -> str:
    text = data.decode("utf-8", "replace")
    if text.endswith("\n"):
        text = text[:-1]
    name, sep, value = text.partition("=")
    if name != "KEYPOOL_MASTER_KEY" or not sep or not KEY_RE.fullmatch(value):
        raise RunnerError("gateway.env: expected one line KEYPOOL_MASTER_KEY=<token>")
    return value


def env_lines(cfg: Cfg, key: str | None) -> list[str]:
    """Fixed per-run environment (root-only EnvironmentFile). The proxy variables come from cfg.env_file itself."""
    d = {
        "HOME": f"{cfg.home}/home",
        "XDG_CONFIG_HOME": f"{cfg.home}/xdg/config",
        "XDG_DATA_HOME": f"{cfg.home}/xdg/data",
        "XDG_CACHE_HOME": f"{cfg.home}/xdg/cache",
        "XDG_STATE_HOME": f"{cfg.home}/xdg/state",
        "OPENCODE_DISABLE_AUTOUPDATE": "1",
        "OPENCODE_DISABLE_MODELS_FETCH": "1",
        "OPENCODE_DISABLE_PROJECT_CONFIG": "1",
        "OPENCODE_CONFIG": f"{TASK_MOUNT}/config.json",
    }
    if key is not None:
        d["KEYPOOL_MASTER_KEY"] = key
    out = []
    for k, v in d.items():
        if not ENV_VALUE_RE.fullmatch(v):
            raise RunnerError(f"unsafe value for {k}")
        out.append(f"{k}={v}")
    return out


def unit_name(task_id: str) -> str:
    return f"roxira-builder-{validate_task_id(task_id)}"


def unit_properties(cfg: Cfg, task_id: str, work: str, rt_task: str, env_run: str) -> list[str]:
    """The sandbox, one systemd property per entry. The only variable parts are paths this module built itself."""
    p = [
        f"User={cfg.builder_user}",
        f"WorkingDirectory={work}",
        f"RuntimeMaxSec={cfg.max_runtime}",
        "ProtectSystem=strict",
        "ProtectHome=yes",
        f"ReadWritePaths={work} {cfg.home}",
        "PrivateTmp=yes",
        "PrivateDevices=yes",
        "PrivatePIDs=yes",
        "ProtectProc=invisible",
        "ProcSubset=pid",
        "ProtectKernelTunables=yes",
        "ProtectKernelModules=yes",
        "ProtectKernelLogs=yes",
        "ProtectControlGroups=yes",
        "ProtectClock=yes",
        "ProtectHostname=yes",
        "NoNewPrivileges=yes",
        "CapabilityBoundingSet=",
        "RestrictSUIDSGID=yes",
        "RestrictNamespaces=yes",
        "RestrictRealtime=yes",
        "LockPersonality=yes",
        "SystemCallArchitectures=native",
        "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX",
        "IPAddressDeny=any",
        "IPAddressAllow=127.0.0.1 ::1",
        "MemoryMax=3G",
        "MemorySwapMax=0",
        "CPUQuota=200%",
        "TasksMax=512",
        "LimitNOFILE=4096",
        "TemporaryFileSystem=/srv:ro",
        f"BindPaths={work}",
        f"BindReadOnlyPaths={rt_task}:{TASK_MOUNT}",
        "InaccessiblePaths=-/run/docker.sock -/var/run/docker.sock -/run/user -/var/lib/docker -/var/lib/containerd "
        "-/etc/xray -/etc/roxira -/etc/roxira-lane -/etc/ssh -/root",
        f"EnvironmentFile={cfg.env_file}",
        f"EnvironmentFile={env_run}",
    ]
    return p


def systemd_run_argv(cfg: Cfg, task_id: str, work: str, rt_task: str, env_run: str) -> list[str]:
    argv = [
        cfg.systemd_run,
        "--quiet",
        "--wait",
        "--pipe",
        "--collect",
        "--expand-environment=no",
        f"--unit={unit_name(task_id)}",
    ]
    for prop in unit_properties(cfg, task_id, work, rt_task, env_run):
        argv += ["-p", prop]
    argv += ["--", cfg.python, "-I", cfg.self_path, "--launch"]
    return argv


# ---------------------------------------------------------------- safe file access


def check_ancestors(path: str, trusted_uid: int) -> None:
    """Every ancestor of `path` must be a real directory owned by trusted_uid and not writable by others
    (sticky directories such as /tmp are accepted)."""
    parts = os.path.abspath(path).split(os.sep)
    cur = os.sep
    for comp in parts[1:-1]:
        cur = os.path.join(cur, comp)
        st = os.lstat(cur)
        if not stat.S_ISDIR(st.st_mode):
            raise RunnerError(f"{cur}: not a directory (symlink?)")
        if st.st_uid != trusted_uid and st.st_uid != 0:
            raise RunnerError(f"{cur}: not owned by root")
        if st.st_mode & 0o022 and not st.st_mode & stat.S_ISVTX:
            raise RunnerError(f"{cur}: writable by group/other")


def _open_dir(name: str, dir_fd: int | None = None) -> int:
    return os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dir_fd)


def open_task_dir(cfg: Cfg, task_id: str, lane_uid: int) -> tuple[int, int]:
    """-> (tasks_fd, task_fd). tasks dir: owned by root; task dir: owned by the lane user, not group/other writable."""
    validate_task_id(task_id)
    if cfg.check_ancestors:
        check_ancestors(cfg.tasks_dir, cfg.trusted_uid)
    try:
        tasks_fd = _open_dir(cfg.tasks_dir)
    except OSError as e:
        raise RunnerError(f"tasks dir not usable: {e.strerror}") from e
    st = os.fstat(tasks_fd)
    if st.st_uid != cfg.trusted_uid:
        os.close(tasks_fd)
        raise RunnerError("tasks dir is not root-owned")
    try:
        task_fd = _open_dir(task_id, tasks_fd)
    except OSError as e:
        os.close(tasks_fd)
        raise RunnerError(f"task {task_id}: {e.strerror}") from e
    st = os.fstat(task_fd)
    if st.st_uid != lane_uid or st.st_mode & 0o022:
        os.close(tasks_fd)
        os.close(task_fd)
        raise RunnerError("task dir must be owned by the lane user and not group/other writable")
    return tasks_fd, task_fd


def read_spec_file(
    task_fd: int, name: str, lane_uid: int, cap: int, required: bool = True
) -> bytes | None:
    try:
        fd = os.open(
            name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=task_fd
        )
    except FileNotFoundError:
        if required:
            raise RunnerError(f"missing {name}") from None
        return None
    except OSError as e:
        raise RunnerError(f"{name}: {e.strerror}") from e
    try:
        st = os.fstat(fd)
        if (
            not stat.S_ISREG(st.st_mode)
            or st.st_uid != lane_uid
            or st.st_nlink != 1
            or st.st_mode & 0o022
        ):
            raise RunnerError(
                f"{name}: must be a regular file owned by the lane user, one link, not group/other writable"
            )
        if st.st_size > cap:
            raise RunnerError(f"{name}: larger than {cap} bytes")
        with os.fdopen(os.dup(fd), "rb") as f:
            return f.read(cap + 1)
    finally:
        os.close(fd)


def open_subdir(task_fd: int, name: str, lane_uid: int) -> int:
    try:
        fd = _open_dir(name, task_fd)
    except OSError as e:
        raise RunnerError(f"{name}/: {e.strerror}") from e
    if os.fstat(fd).st_uid != lane_uid:
        os.close(fd)
        raise RunnerError(f"{name}/ must be owned by the lane user")
    return fd


def chown_tree(top_fd: int, uid: int, gid: int) -> int:
    """No-follow recursive chown below a directory fd. Refuses hard-linked files (their other name could be elsewhere)."""
    n = 0
    os.fchown(top_fd, uid, gid)
    for _root, dirs, files, dfd in os.fwalk(
        ".", dir_fd=top_fd, topdown=True, follow_symlinks=False
    ):
        for name in dirs + files:
            st = os.lstat(name, dir_fd=dfd)
            if stat.S_ISREG(st.st_mode) and st.st_nlink != 1:
                raise RunnerError(f"hard-linked file in work tree: {name}")
            os.chown(name, uid, gid, dir_fd=dfd, follow_symlinks=False)
            n += 1
    return n


def write_out(out_fd: int, name: str, data: bytes, uid: int, gid: int) -> None:
    fd = os.open(
        name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o640,
        dir_fd=out_fd,
    )
    try:
        os.fchown(fd, uid, gid)
        os.write(fd, data)
    finally:
        os.close(fd)


# ---------------------------------------------------------------- run


@dataclass
class Prepared:
    task_id: str
    prompt: str
    model: str
    config: bytes
    key: str | None


def prepare(cfg: Cfg, lane_uid: int, task_id: str) -> tuple[Prepared, int, int, int, int]:
    """Validate the whole spec. -> (Prepared, tasks_fd, task_fd, work_fd, out_fd). No side effects besides open fds."""
    tasks_fd, task_fd = open_task_dir(cfg, task_id, lane_uid)
    try:
        prompt = parse_prompt(read_spec_file(task_fd, "prompt.txt", lane_uid, MAX_PROMPT))
        model = parse_model(read_spec_file(task_fd, "model.txt", lane_uid, 256))
        config = parse_config(read_spec_file(task_fd, "config.json", lane_uid, MAX_CONFIG))
        raw = read_spec_file(task_fd, "gateway.env", lane_uid, MAX_KEY_FILE, required=False)
        key = parse_key(raw) if raw is not None else None
        work_fd = open_subdir(task_fd, "work", lane_uid)
        out_fd = open_subdir(task_fd, "out", lane_uid)
    except BaseException:
        os.close(tasks_fd)
        os.close(task_fd)
        raise
    return Prepared(task_id, prompt, model, config, key), tasks_fd, task_fd, work_fd, out_fd


def stage_runtime(cfg: Cfg, prep: Prepared) -> tuple[str, str]:
    """Root-only runtime dir: task/ (read-only bind into the sandbox) and env (EnvironmentFile). -> (task_dir, env_path)"""
    os.makedirs(cfg.runtime_dir, mode=0o700, exist_ok=True)
    rt = os.path.join(cfg.runtime_dir, prep.task_id)
    shutil.rmtree(rt, ignore_errors=True)
    os.mkdir(rt, 0o700)
    task = os.path.join(rt, "task")
    os.mkdir(task, 0o755)
    for name, data in (
        ("prompt.txt", prep.prompt.encode()),
        ("model.txt", prep.model.encode()),
        ("config.json", prep.config),
    ):
        with open(os.path.join(task, name), "wb") as f:
            f.write(data)
        os.chmod(os.path.join(task, name), 0o644)
    env_path = os.path.join(rt, "env")
    fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(env_lines(cfg, prep.key)) + "\n")
    return task, env_path


def egress_lock_loaded(cfg: Cfg) -> bool:
    r = subprocess.run(
        [cfg.nft, "list", "table", "inet", "roxira_builder"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return r.returncode == 0


def run_unit(cfg: Cfg, argv: list[str], task_id: str) -> tuple[int, bytes, bool]:
    """Run the sandbox; capture at most MAX_LOG bytes of output. A TERM/INT/HUP to us stops the unit."""
    proc = subprocess.Popen(
        argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )

    def stop(_sig, _frm):
        subprocess.run(
            [cfg.systemctl, "stop", unit_name(task_id) + ".service"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=60,
        )

    for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(s, stop)
    buf = bytearray()
    truncated = False
    assert proc.stdout is not None
    while True:
        chunk = proc.stdout.read1(65536)
        if not chunk:
            break
        room = MAX_LOG - len(buf)
        if room > 0:
            buf += chunk[:room]
        if len(chunk) > room:
            truncated = True
    return proc.wait(), bytes(buf), truncated


def run(cfg: Cfg, lane_user: str, task_id: str) -> int:
    lane_user = validate_user(lane_user)
    validate_task_id(task_id)
    if os.geteuid() != 0:
        raise RunnerError("must run as root (use the roxira-lane-root wrapper)")
    lane = pwd.getpwnam(lane_user)
    builder = pwd.getpwnam(validate_user(cfg.builder_user))
    if builder.pw_uid in (0, lane.pw_uid):
        raise RunnerError("builder user must be unprivileged and different from the lane user")
    if not os.access(cfg.opencode, os.X_OK) or not os.access(cfg.env_file, os.R_OK):
        raise RunnerError(
            "builder is not installed (opencode binary or proxy env missing): run apply_root.sh", 5
        )
    if cfg.require_nft and not egress_lock_loaded(cfg):
        raise RunnerError(
            "egress lock (nft table roxira_builder) is not loaded: refusing to start a builder", 6
        )
    lock = os.open(cfg.lock_file, os.O_WRONLY | os.O_CREAT | os.O_CLOEXEC, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RunnerError("another builder run is active", 75) from None
    prep, tasks_fd, task_fd, work_fd, out_fd = prepare(cfg, lane.pw_uid, task_id)
    work_path = os.path.join(cfg.tasks_dir, task_id, "work")
    rt = os.path.join(cfg.runtime_dir, task_id)
    t0 = time.monotonic()
    rc = 1
    log, truncated = b"", False
    try:
        rt_task, env_run = stage_runtime(cfg, prep)
        chown_tree(work_fd, builder.pw_uid, builder.pw_gid)
        try:
            rc, log, truncated = run_unit(
                cfg, systemd_run_argv(cfg, task_id, work_path, rt_task, env_run), task_id
            )
        finally:
            chown_tree(work_fd, lane.pw_uid, lane.pw_gid)
        result = {
            "exit": rc,
            "duration_s": int(time.monotonic() - t0),
            "unit": unit_name(task_id),
            "log_truncated": truncated,
            "model": prep.model,
        }
        write_out(out_fd, "builder.log", log, lane.pw_uid, lane.pw_gid)
        write_out(
            out_fd, "result.json", (json.dumps(result) + "\n").encode(), lane.pw_uid, lane.pw_gid
        )
    finally:
        shutil.rmtree(rt, ignore_errors=True)
        for fd in (work_fd, out_fd, task_fd, tasks_fd, lock):
            os.close(fd)
    return rc


def launch(cfg: Cfg) -> None:
    """Inside the sandbox, as the builder user: the ONE fixed command. Prompt and model come from the read-only mount."""
    prompt = parse_prompt(open(f"{TASK_MOUNT}/prompt.txt", "rb").read(MAX_PROMPT + 1))
    model = parse_model(open(f"{TASK_MOUNT}/model.txt", "rb").read(256))
    os.execve(cfg.opencode, [cfg.opencode, "run", "-m", model, prompt], os.environ)


def main(argv: list[str]) -> int:
    cfg = Cfg()
    try:
        if argv == ["--launch"]:
            launch(cfg)
            return 127  # not reached
        if len(argv) == 4 and argv[0] == "--lane-user" and argv[2] == "--task":
            return run(cfg, argv[1], argv[3])
        raise RunnerError("usage: builder-run --lane-user USER --task DIGITS")
    except RunnerError as e:
        print(f"builder-run: {e}", file=sys.stderr)
        return e.rc
    except OSError as e:
        print(f"builder-run: {e.strerror}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

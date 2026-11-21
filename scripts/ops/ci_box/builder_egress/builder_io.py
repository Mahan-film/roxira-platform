#!/usr/bin/env python3
# ruff: noqa: E501
"""Lane-side half of the builder separation (issue #1022). Runs as the LANE user (no root). Stdlib only.

`builder-shim` (bash, next to this file) is used as OPENCODE_BIN when lane-run runs with ROXIRA_BUILDER=1. run_task.sh
then calls it exactly like opencode (`<bin> run -m <model> <prompt>`, cwd = the agent worktree, overlay config in
OPENCODE_CONFIG_CONTENT, gateway key in KEYPOOL_MASTER_KEY). The shim:

  1. makes TASKS_DIR/<id>/ with prompt.txt, model.txt, config.json, gateway.env (0600), work/ (a copy of the worktree
     WITHOUT .git), out/;
  2. runs `sudo -n roxira-lane-root run-builder <id>` (the only privileged step; the builder runs as another uid);
  3. imports the builder's edits from work/ back into the worktree as plain regular files (no symlinks, no .git,
     size limits), so the usual run_task.sh scope check, commit and diff run as the lane user on the result;
  4. prints the builder log (run_task.sh classifies rate limit / auth errors from it), removes the task dir, exits
     with the builder's exit code.

The builder never sees a git directory, the lane user's home, a token or the other tasks.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

TASKS_DIR_DEFAULT = "/srv/data/roxira-lane/tasks"
ROOT_WRAPPER_DEFAULT = "/usr/local/sbin/roxira-lane-root"
MAX_FILES = 20000
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 300 * 1024 * 1024
MODEL_RE = re.compile(r"keypool/(agent-light-free|agent-strong-free|best-all)")


class ShimError(Exception):
    pass


# ---------------------------------------------------------------- staging


def stage_tree(src: Path, dst: Path) -> int:
    """Copy src into dst (existing empty dir): regular files, directories and symlinks; skip the top-level .git."""
    n = 0
    for entry in sorted(os.scandir(src), key=lambda e: e.name):
        if entry.name == ".git":
            continue
        target = dst / entry.name
        st = entry.stat(follow_symlinks=False)
        if stat.S_ISDIR(st.st_mode):
            target.mkdir(mode=0o755)
            n += stage_tree(Path(entry.path), target)
        elif stat.S_ISLNK(st.st_mode):
            os.symlink(os.readlink(entry.path), target)
            n += 1
        elif stat.S_ISREG(st.st_mode):
            shutil.copyfile(entry.path, target, follow_symlinks=False)
            os.chmod(target, 0o755 if st.st_mode & stat.S_IXUSR else 0o644)
            n += 1
    return n


def new_task_dir(base: Path, rand) -> tuple[str, Path]:
    """Create <base>/<id>/{work,out}, mode 0700. id = 12 digits from time and a random part; retried on collision."""
    import time

    for _ in range(20):
        tid = str(int(time.time()) * 100 + rand(100))
        if not re.fullmatch(r"[0-9]{1,12}", tid):
            raise ShimError("bad task id")
        d = base / tid
        try:
            d.mkdir(mode=0o700)
        except FileExistsError:
            continue
        (d / "work").mkdir(mode=0o755)
        (d / "out").mkdir(mode=0o755)
        return tid, d
    raise ShimError("could not allocate a task id")


def write_private(path: Path, data: str, mode: int) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "w") as f:
        f.write(data)


# ---------------------------------------------------------------- import


def _scan(root: Path) -> tuple[dict[str, os.stat_result], list[str]]:
    """All entries under root (no symlink following) as {relpath: lstat}; plus violations."""
    found: dict[str, os.stat_result] = {}
    bad: list[str] = []
    total = 0
    stack = [""]
    while stack:
        rel = stack.pop()
        d = root / rel if rel else root
        dst = os.lstat(d)
        if stat.S_ISDIR(dst.st_mode) and (dst.st_mode & 0o700) != 0o700:
            os.chmod(
                d, (dst.st_mode & 0o7777) | 0o700
            )  # the builder may have left a directory unreadable
        with os.scandir(d) as it:
            for e in it:
                r = f"{rel}/{e.name}" if rel else e.name
                st = e.stat(follow_symlinks=False)
                if e.name == ".git":
                    bad.append(f"{r} (.git is not allowed)")
                    continue
                if len(found) >= MAX_FILES:
                    bad.append(f"{r} (too many files)")
                    continue
                if stat.S_ISDIR(st.st_mode):
                    found[r] = st
                    stack.append(r)
                elif stat.S_ISLNK(st.st_mode):
                    found[r] = st
                elif stat.S_ISREG(st.st_mode):
                    total += st.st_size
                    if st.st_size > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
                        bad.append(f"{r} (too large)")
                        continue
                    found[r] = st
                else:
                    bad.append(f"{r} (special file)")
    return found, bad


def _same_file(a: Path, b: Path) -> bool:
    try:
        if os.lstat(b).st_size != os.lstat(a).st_size:
            return False
        with open(a, "rb") as fa, open(b, "rb") as fb:
            while True:
                x, y = fa.read(1 << 20), fb.read(1 << 20)
                if x != y:
                    return False
                if not x:
                    return True
    except OSError:
        return False


def _remove(p: Path) -> None:
    try:
        st = os.lstat(p)
    except FileNotFoundError:
        return
    if stat.S_ISDIR(st.st_mode):
        shutil.rmtree(p)
    else:
        os.unlink(p)


def import_tree(work: Path, wt: Path) -> list[str]:
    """Make wt (the real worktree) equal to work (what the builder left), as plain files. wt/.git is never touched.
    Returns violations (skipped entries); the caller treats any as a failed run."""
    found, bad = _scan(work)
    for rel in sorted(found, key=lambda r: r.count("/")):
        src, dst = work / rel, wt / rel
        st = found[rel]
        if stat.S_ISDIR(st.st_mode):
            if os.path.lexists(dst) and not stat.S_ISDIR(os.lstat(dst).st_mode):
                _remove(dst)
            dst.mkdir(mode=0o755, exist_ok=True)
        elif stat.S_ISLNK(st.st_mode):
            # a symlink is accepted only if the worktree already has the same one (repo symlinks); never created
            if not (os.path.islink(dst) and os.readlink(dst) == os.readlink(src)):
                bad.append(f"{rel} (symlink change)")
        else:
            if os.path.lexists(dst) and (
                os.path.islink(dst) or stat.S_ISDIR(os.lstat(dst).st_mode)
            ):
                _remove(dst)
            mode = 0o755 if st.st_mode & stat.S_IXUSR else 0o644
            if os.path.isfile(dst) and _same_file(src, dst):
                if (os.lstat(dst).st_mode & 0o777) != mode:
                    os.chmod(dst, mode)
                continue
            tmp = dst.with_name(f".{dst.name}.builder-import")
            shutil.copyfile(src, tmp, follow_symlinks=False)
            os.chmod(tmp, mode)
            os.replace(tmp, dst)
    # deletions: anything in wt (except the top-level .git) that the builder removed
    dirs_gone: list[str] = []
    stack = [""]
    while stack:
        rel = stack.pop()
        with os.scandir(wt / rel if rel else wt) as it:
            for e in it:
                r = f"{rel}/{e.name}" if rel else e.name
                if r == ".git":
                    continue
                if r in found:
                    if e.is_dir(follow_symlinks=False):
                        stack.append(r)
                    continue
                if any(b.startswith(r + " ") for b in bad):
                    continue  # entry exists in work but was refused: keep the original
                dirs_gone.append(r)
    for r in dirs_gone:
        _remove(wt / r)
    return bad


# ---------------------------------------------------------------- shim


def parse_opencode_args(argv: list[str]) -> tuple[str, str]:
    """run_task.sh calls: <bin> run -m <model> <prompt>. Anything else is refused. -> (model, prompt)"""
    if (
        len(argv) != 4
        or argv[0] != "run"
        or argv[1] != "-m"
        or not MODEL_RE.fullmatch(argv[2])
        or not argv[3].strip()
    ):
        raise ShimError("unexpected arguments (expected: run -m <gateway model> <prompt>)")
    return argv[2], argv[3]


def rmtree_force(path: Path) -> None:
    for dp, dns, fns in os.walk(path):
        for n in dns + fns:
            p = os.path.join(dp, n)
            if not os.path.islink(p):
                try:
                    os.chmod(p, 0o700 if os.path.isdir(p) else 0o600)
                except OSError:
                    pass
    shutil.rmtree(path, ignore_errors=True)


def shim_main(argv: list[str], env: dict[str, str], cwd: Path) -> int:
    import random
    import signal

    model, prompt = parse_opencode_args(argv)
    config = env.get("OPENCODE_CONFIG_CONTENT", "")
    if not config:
        raise ShimError("OPENCODE_CONFIG_CONTENT is empty (run_task.sh sets it)")
    base = Path(env.get("ROXIRA_BUILDER_TASKS", TASKS_DIR_DEFAULT))
    tid, tdir = new_task_dir(base, random.randrange)
    rc = 1
    try:
        stage_tree(cwd, tdir / "work")
        write_private(tdir / "prompt.txt", prompt, 0o600)
        write_private(tdir / "model.txt", model + "\n", 0o600)
        write_private(tdir / "config.json", config, 0o600)
        key = env.get("KEYPOOL_MASTER_KEY", "")
        if key:
            write_private(tdir / "gateway.env", f"KEYPOOL_MASTER_KEY={key}\n", 0o600)
        wrapper = env.get("ROXIRA_BUILDER_ROOT_WRAPPER", ROOT_WRAPPER_DEFAULT)
        cmd = ["sudo", "-n", wrapper, "run-builder", tid]
        if env.get("ROXIRA_BUILDER_NO_SUDO") == "1":  # tests only
            cmd = [wrapper, "run-builder", tid]
        child_env = {
            k: v
            for k, v in env.items()
            if k not in ("KEYPOOL_MASTER_KEY", "OPENCODE_CONFIG_CONTENT")
        }
        p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, env=child_env)
        old = signal.signal(signal.SIGTERM, lambda s, f: p.send_signal(signal.SIGTERM))
        try:
            rc = p.wait()
        finally:
            signal.signal(signal.SIGTERM, old)
        log = tdir / "out" / "builder.log"
        if log.is_file() and not log.is_symlink():
            sys.stdout.write(log.read_text(errors="replace"))
            sys.stdout.flush()
        res = tdir / "out" / "result.json"
        if res.is_file() and not res.is_symlink():
            try:
                rc = int(json.loads(res.read_text()).get("exit", rc))
            except (ValueError, TypeError):
                pass
        bad = import_tree(tdir / "work", cwd)
        for b in bad:
            print(f"[builder-shim] refused to import: {b}", file=sys.stderr)
        if bad and rc == 0:
            rc = 1
    finally:
        rmtree_force(tdir)
    return rc


def main(argv: list[str]) -> int:
    if argv[:1] == ["shim"]:
        try:
            return shim_main(argv[1:], dict(os.environ), Path.cwd())
        except ShimError as e:
            print(f"[builder-shim] {e}", file=sys.stderr)
            return 2
    print("usage: builder_io.py shim run -m MODEL PROMPT", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

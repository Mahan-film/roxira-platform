#!/usr/bin/env python3
"""Daytona backend for the workbench checks (factory F1 / suite v2, docs/factory/DAYTONA.md).

Runs the SAME check groups the local workbench uses (tsc/eslint/jest/ruff/pytest) inside a disposable
Daytona sandbox instead of Docker on srv1. Gate 2 `docker` groups need a daemon the sandbox does not have,
so they are reported as skip here and still run on the local backend. The group list is produced by `workbench.sh --emit-groups`
(or passed in with `--groups`), so the check commands themselves are never duplicated here; this module
only provides the remote plumbing.

CLI:
  daytona_runner.py --worktree DIR [--base REF] [--groups FILE] --json OUT [--files-from FILE]

Exit codes: 0 = checks ran (pass or fail, result in OUT); 3 = the sandbox could not be started, so the
caller (workbench.sh) can fall back to the local Docker backend.

Safety and cost:
  * The worktree is uploaded as a tarball that never contains .env* (asserted before upload), .git/,
    data/, node_modules/, *.sql or *.tar.gz.
  * Only NODE_ENV and CI are forwarded from this host (plus fixed NODE_OPTIONS / NEXT_TELEMETRY_DISABLED
    constants); no other environment variable is sent.
  * Cost guard: at most WORKBENCH_DAYTONA_MAX (default 2) sandboxes at once, 1 vCPU / 2 GB RAM / 5 GB
    disk, auto-stop after 15 min.
  * The sandbox is ALWAYS deleted (finally).
"""

from __future__ import annotations

import argparse
import io
import json
import os
import shlex
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

HERE = Path(__file__).resolve().parent
WORKBENCH = HERE / "workbench.sh"

# Cost guard (docs/factory/DAYTONA.md): keep the sandbox small, short-lived and few.
SANDBOX_CPU = 1
SANDBOX_MEM_GB = 2
SANDBOX_DISK_GB = 5
SANDBOX_TTL_MIN = 15
DEFAULT_MAX_CONCURRENT = 2
GROUP_TIMEOUT = int(os.environ.get("WB_GROUP_TIMEOUT", "480"))
TOTAL_TIMEOUT = int(os.environ.get("WB_TOTAL_TIMEOUT", "900"))
REMOTE = os.environ.get("WORKBENCH_DAYTONA_WORKDIR", "/tmp/wb")
REMOTE_WORK = REMOTE + "/work"
DAYTONA_API = os.environ.get("DAYTONA_API_URL", "https://app.daytona.io/api")

EXCLUDE_DIRS = ("node_modules", ".git", "data")


@dataclass
class CmdResult:
    exit_code: int
    output: str


class SkipGroup(Exception):
    """Raised when a group cannot apply (e.g. no package.json/package-lock.json), like the local setup."""


class Client(Protocol):
    """The minimal surface the runner needs; implemented by the SDK, the REST client and the tests."""

    def create(self) -> Any: ...

    def upload(self, sandbox: Any, remote_path: str, data: bytes) -> None: ...

    def exec(self, sandbox: Any, command: str, cwd: str | None = None,
             env: dict[str, str] | None = None, timeout: int | None = None) -> CmdResult: ...

    def delete(self, sandbox: Any) -> None: ...


# ------------------------------------------------------------------ upload package
def _excluded(rel: Path) -> bool:
    if any(part in EXCLUDE_DIRS for part in rel.parts):
        return True
    name = rel.name
    if name == ".env" or name.startswith(".env"):
        return True
    return name.endswith(".sql") or name.endswith(".tar.gz")


def build_tarball(worktree: Path) -> bytes:
    """gzip tar of the worktree without .git/node_modules/data, *.sql, *.tar.gz or any .env* file."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(worktree):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for name in files:
                path = Path(root) / name
                rel = path.relative_to(worktree)
                if _excluded(rel):
                    continue
                tar.add(path, arcname=str(rel))
    data = buf.getvalue()
    assert_no_env(data)
    return data


def assert_no_env(data: bytes) -> None:
    """Refuse to upload a tarball that contains a .env* file (never send secrets)."""
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            parts = Path(member.name).parts
            if any(part == ".env" or part.startswith(".env") for part in parts):
                raise ValueError(f"refusing to upload secret file {member.name!r}")


def upload_worktree(client: Client, sandbox: Any, worktree: Path, timeout: int = 300) -> None:
    data = build_tarball(worktree)
    client.upload(sandbox, REMOTE + "/wt.tar.gz", data)
    script = (f"set -e; rm -rf {REMOTE_WORK}; mkdir -p {REMOTE_WORK}; "
              f"tar -xzf {REMOTE}/wt.tar.gz -C {REMOTE_WORK}; echo uploaded")
    res = client.exec(sandbox, script, timeout=timeout)
    if res.exit_code != 0:
        raise RuntimeError(f"unpack failed: {res.output.strip()[-500:]}")


# ------------------------------------------------------------------ environment
def forward_env() -> dict[str, str]:
    """Only NODE_ENV/CI may cross from srv1; the rest are fixed sandbox-local constants."""
    env = {
        "NODE_OPTIONS": "--max-old-space-size=1536",
        "NEXT_TELEMETRY_DISABLED": "1",
    }
    for name in ("NODE_ENV", "CI"):
        value = os.environ.get(name)
        if value:
            env[name] = value
    env.setdefault("CI", "1")
    return env


def _base_env() -> dict[str, str]:
    return dict(forward_env())


# ------------------------------------------------------------------ group execution
def rec(name: str, cmd: str, status: str, seconds: float, output: str) -> dict:
    tail = "\n".join((output or "").splitlines()[-60:])
    return {"name": name, "cmd": cmd, "status": status, "seconds": int(seconds), "tail": tail}


def _status(rc: int) -> str:
    if rc == 0:
        return "pass"
    return "timeout" if rc in (124, 137) else "fail"


def _run_node(client: Client, sandbox: Any, group: dict, timeout: int, ready: set[str]) -> CmdResult:
    directory = group["dir"]
    workdir = f"{REMOTE_WORK}/{directory}"
    if directory not in ready:
        probe = client.exec(
            sandbox, f"test -f {workdir}/package-lock.json && test -f {workdir}/package.json",
            timeout=60)
        if probe.exit_code != 0:
            raise SkipGroup(f"skip: no package.json/package-lock.json in {directory}")
        install = client.exec(
            sandbox, f"cd {workdir} && npm ci --ignore-scripts --no-audit --no-fund",
            env=_base_env(), timeout=timeout)
        if install.exit_code != 0:
            return install
        ready.add(directory)
    return client.exec(sandbox, f"cd {workdir} && {group['cmd']}", env=_base_env(), timeout=timeout)


def _json_report(text: str) -> list:
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end < start:
        return []
    try:
        parsed = json.loads(text[start:end + 1])
    except ValueError:
        return []
    return parsed if isinstance(parsed, list) else []


def _run_lint(client: Client, sandbox: Any, group: dict, timeout: int, ready: set[str]) -> CmdResult:
    directory = group["dir"]
    workdir = f"{REMOTE_WORK}/{directory}"
    files = group.get("files") or []
    if not files:
        return CmdResult(0, "no lint files")
    setup = _run_node_probe(client, sandbox, group, timeout, ready)
    if setup is not None:
        return setup
    prefix = group.get("eslint_prefix") or "npx --no-install eslint"
    args = " ".join(shlex.quote(f) for f in files)
    run = (f"cd {workdir} && {prefix} --format json {args} > {REMOTE}/eslint.json 2>/dev/null "
           f"|| true; cat {REMOTE}/eslint.json")
    current = client.exec(sandbox, run, env=_base_env(), timeout=timeout)
    base_files = group.get("base_files") or {}
    if base_files:
        for path, content in base_files.items():
            client.upload(sandbox, f"{workdir}/{path}", content.encode())
        base = client.exec(sandbox, run, env=_base_env(), timeout=timeout)
        base_report = _json_report(base.output)
    else:
        base_report = []
    sys.path.insert(0, str(HERE))
    import eslint_diff  # local to the workbench scripts
    new, pre = eslint_diff.compare(_json_report(current.output), base_report)
    return CmdResult(1 if new else 0, eslint_diff.report(new, pre))


def _run_node_probe(client: Client, sandbox: Any, group: dict, timeout: int,
                    ready: set[str]) -> CmdResult | None:
    """npm ci once per package dir; returns the failed result or None when dependencies are usable."""
    directory = group["dir"]
    if directory in ready:
        return None
    result = _run_node(client, sandbox, {"dir": directory, "cmd": "true"}, timeout, ready)
    return result if result.exit_code != 0 else None


def _run_py(client: Client, sandbox: Any, group: dict, timeout: int, ready: dict) -> CmdResult:
    if not ready.get("py"):
        req = f"{REMOTE_WORK}/ci/requirements-test.txt"
        script = (f"set -e; test -f {req} || exit 4; python3 -m venv {REMOTE}/venv; "
                  f"{REMOTE}/venv/bin/pip install -q --no-cache-dir -r {req} ruff")
        install = client.exec(sandbox, script, env=_base_env(), timeout=timeout)
        if install.exit_code == 4:
            raise SkipGroup("skip:ci/requirements-test.txt missing")
        if install.exit_code != 0:
            return install
        ready["py"] = True
    env = _base_env()
    env["PATH"] = f"{REMOTE}/venv/bin:/usr/local/bin:/usr/bin:/bin"
    env["PYTHONPATH"] = REMOTE_WORK
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return client.exec(sandbox, group["cmd"], cwd=REMOTE_WORK, env=env, timeout=timeout)


def run_groups(client: Client, sandbox: Any, groups: list[dict], group_timeout: int,
               total_timeout: int) -> tuple[list[dict], bool]:
    results: list[dict] = []
    ok = True
    start = time.monotonic()
    node_ready: set[str] = set()
    py_ready: dict = {}
    for group in groups:
        name, cmd, kind = group["name"], group["cmd"], group["kind"]
        left = total_timeout - (time.monotonic() - start)
        if left <= 0:
            results.append(rec(name, cmd, "skip", 0, "overall timeout reached before this group"))
            continue
        limit = min(group_timeout, int(left))
        t0 = time.monotonic()
        try:
            if kind == "node":
                result = _run_node(client, sandbox, group, limit, node_ready)
            elif kind == "lint":
                result = _run_lint(client, sandbox, group, limit, node_ready)
            elif kind == "py":
                result = _run_py(client, sandbox, group, limit, py_ready)
            elif kind == "docker":
                raise SkipGroup("skip:docker builds run on the local backend only")
            else:
                result = client.exec(sandbox, cmd, cwd=REMOTE_WORK, env=_base_env(), timeout=limit)
        except SkipGroup as exc:
            results.append(rec(name, cmd, "skip", time.monotonic() - t0, str(exc)))
            continue
        except Exception as exc:  # noqa: BLE001 - a transport error is a failed check, not a crash
            code = 124 if isinstance(exc, TimeoutError) else 1
            result = CmdResult(code, f"daytona: {type(exc).__name__}: {exc}")
        status = _status(result.exit_code)
        if status in ("fail", "timeout"):
            ok = False
        results.append(rec(name, cmd, status, time.monotonic() - t0, result.output))
    return results, ok


# ------------------------------------------------------------------ concurrency guard
class SlotGuard:
    """Best-effort cross-process counter so at most `limit` sandboxes run at once (cost guard)."""

    def __init__(self, path: Path, limit: int):
        self.path, self.limit, self.acquired = path, limit, False
        self._fh = None

    def acquire(self) -> bool:
        import fcntl
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self.path, "a+", encoding="utf-8")
        fcntl.flock(self._fh, fcntl.LOCK_EX)
        try:
            self._fh.seek(0)
            used = int((self._fh.read().strip() or "0"))
            if used >= self.limit:
                return False
            self._fh.seek(0)
            self._fh.truncate()
            self._fh.write(str(used + 1))
            self._fh.flush()
            self.acquired = True
            return True
        finally:
            fcntl.flock(self._fh, fcntl.LOCK_UN)

    def release(self) -> None:
        if not self.acquired or self._fh is None:
            return
        import fcntl
        fcntl.flock(self._fh, fcntl.LOCK_EX)
        try:
            self._fh.seek(0)
            used = int((self._fh.read().strip() or "1"))
            self._fh.seek(0)
            self._fh.truncate()
            self._fh.write(str(max(0, used - 1)))
            self._fh.flush()
        finally:
            fcntl.flock(self._fh, fcntl.LOCK_UN)
            self._fh.close()
        self.acquired = False


# ------------------------------------------------------------------ clients
def _sandbox_id(sandbox: Any) -> str:
    if isinstance(sandbox, dict):
        return str(sandbox.get("id") or sandbox.get("sandboxId"))
    return str(getattr(sandbox, "id", sandbox))


class SdkClient:
    """Thin wrapper over the official `daytona` SDK (preferred when importable)."""

    kind = "sdk"

    def __init__(self, api_key: str):
        from daytona import Daytona, DaytonaConfig  # optional dependency

        self._client = Daytona(DaytonaConfig(api_key=api_key))

    def create(self) -> Any:
        from daytona import CreateSandboxParams

        params: dict = {"auto_stop_interval": SANDBOX_TTL_MIN}
        snapshot = os.environ.get("WORKBENCH_DAYTONA_SNAPSHOT")
        if snapshot:
            params["snapshot"] = snapshot
        try:
            from daytona import CreateSandboxResourcesParams
            params["resources"] = CreateSandboxResourcesParams(
                cpu=SANDBOX_CPU, memory=SANDBOX_MEM_GB, disk=SANDBOX_DISK_GB)
        except Exception:  # noqa: BLE001 - older SDKs set resources differently
            pass
        return self._client.create(CreateSandboxParams(**params))

    def upload(self, sandbox: Any, remote_path: str, data: bytes) -> None:
        sandbox.fs.upload_file(data, remote_path)

    def exec(self, sandbox: Any, command: str, cwd: str | None = None,
             env: dict[str, str] | None = None, timeout: int | None = None) -> CmdResult:
        res = sandbox.process.exec(command, cwd=cwd, env=env, timeout=timeout)
        code = int(getattr(res, "exit_code", getattr(res, "exitCode", 0)) or 0)
        out = getattr(res, "result", None) or getattr(res, "output", "") or ""
        return CmdResult(code, str(out))

    def delete(self, sandbox: Any) -> None:
        self._client.delete(sandbox)


class RestClient:
    """Stdlib REST fallback for app.daytona.io (used when the SDK is not installed)."""

    kind = "rest"

    def __init__(self, api_key: str, base: str | None = None):
        self.base = (base or DAYTONA_API).rstrip("/")
        self.key = api_key

    def _request(self, method: str, path: str, body: bytes | None = None,
                 content_type: str = "application/json", timeout: int = 60) -> Any:
        import urllib.request

        req = urllib.request.Request(self.base + path, data=body, method=method)
        req.add_header("Authorization", f"Bearer {self.key}")
        if body is not None:
            req.add_header("Content-Type", content_type)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
        return json.loads(raw) if raw else {}

    def create(self) -> Any:
        body: dict = {
            "autoStopInterval": SANDBOX_TTL_MIN,
            "resources": {"cpu": SANDBOX_CPU, "memory": SANDBOX_MEM_GB, "disk": SANDBOX_DISK_GB},
        }
        snapshot = os.environ.get("WORKBENCH_DAYTONA_SNAPSHOT")
        if snapshot:
            body["snapshot"] = snapshot
        return self._request("POST", "/sandbox", json.dumps(body).encode())

    def upload(self, sandbox: Any, remote_path: str, data: bytes) -> None:
        payload, ctype = _multipart(remote_path, data)
        self._request("POST", f"/sandbox/{_sandbox_id(sandbox)}/toolbox/files", payload, ctype)

    def exec(self, sandbox: Any, command: str, cwd: str | None = None,
             env: dict[str, str] | None = None, timeout: int | None = None) -> CmdResult:
        body: dict = {"command": command, "timeout": int(timeout or SANDBOX_TTL_MIN * 60)}
        if cwd:
            body["cwd"] = cwd
        if env:
            body["env"] = env
        result = self._request("POST", f"/sandbox/{_sandbox_id(sandbox)}/toolbox/process/execute",
                               json.dumps(body).encode(), timeout=int(timeout or 300) + 30)
        code = int(result.get("exitCode", result.get("exit_code", 0)) or 0)
        return CmdResult(code, str(result.get("result", result.get("output", "")) or ""))

    def delete(self, sandbox: Any) -> None:
        try:
            self._request("DELETE", f"/sandbox/{_sandbox_id(sandbox)}")
        except Exception:  # noqa: BLE001 - auto-stop is the backstop if the delete call fails
            pass


def _multipart(remote_path: str, data: bytes) -> tuple[bytes, str]:
    boundary = "----rxworkbench" + uuid.uuid4().hex
    marker = f"--{boundary}".encode()
    out = bytearray()
    out += marker + b"\r\n"
    out += b'Content-Disposition: form-data; name="path"\r\n\r\n'
    out += remote_path.encode() + b"\r\n"
    out += marker + b"\r\n"
    out += b'Content-Disposition: form-data; name="file"; filename="wt.tar.gz"\r\n'
    out += b"Content-Type: application/gzip\r\n\r\n"
    out += data + b"\r\n"
    out += marker + b"--\r\n"
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def make_client() -> Client:
    """Prefer the official SDK when importable; fall back to the REST client. Never prints the key."""
    api_key = os.environ.get("DAYTONA_API_KEY", "")
    if not api_key:
        raise RuntimeError("DAYTONA_API_KEY is not set")
    mode = os.environ.get("WORKBENCH_DAYTONA_CLIENT", "auto").lower()
    if mode in ("auto", "sdk"):
        try:
            return SdkClient(api_key)
        except ImportError:
            if mode == "sdk":
                raise
    return RestClient(api_key)


# ------------------------------------------------------------------ orchestration
def load_groups(workbench: Path, worktree: str, base: str | None,
                files_from: str | None) -> list[dict]:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        out = fh.name
    cmd = ["bash", str(workbench), worktree, "--emit-groups", out]
    if base:
        cmd += ["--base", base]
    if files_from:
        cmd += ["--files-from", files_from]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, timeout=120)
    try:
        return json.loads(Path(out).read_text()).get("groups", [])
    finally:
        os.unlink(out)


def write_json(path: str | None, obj: dict) -> None:
    text = json.dumps(obj, indent=1)
    if path and path != "-":
        Path(path).write_text(text + "\n")
    else:
        print(text)


def run(worktree: str, base: str | None, groups: list[dict] | None, json_out: str | None,
        files_from: str | None = None, client: Client | None = None,
        group_timeout: int = GROUP_TIMEOUT, total_timeout: int = TOTAL_TIMEOUT) -> int:
    """Run the groups in one sandbox and write the workbench JSON shape. 0 = ran, 3 = could not start."""
    if groups is None:
        try:
            groups = load_groups(WORKBENCH, worktree, base, files_from)
        except Exception as exc:  # noqa: BLE001
            print(f"daytona: cannot load groups: {exc}", file=sys.stderr)
            return 3
    if not groups:
        write_json(json_out, {"groups": [], "ok": True, "backend": "daytona"})
        return 0
    if client is None:
        try:
            client = make_client()
        except Exception as exc:  # noqa: BLE001
            print(f"daytona: cannot create client: {exc}", file=sys.stderr)
            return 3
    limit = int(os.environ.get("WORKBENCH_DAYTONA_MAX", str(DEFAULT_MAX_CONCURRENT)))
    state = Path(os.environ.get("ROXIRA_AGENTS_HOME", "/var/lib/roxira-agents"))
    slots = SlotGuard(state / "daytona.slots", limit)
    try:
        if not slots.acquire():
            print(f"daytona: {limit} sandboxes already running (cost guard)", file=sys.stderr)
            return 3
    except OSError as exc:
        print(f"daytona: cannot track slots: {exc}", file=sys.stderr)
        return 3
    sandbox = None
    try:
        try:
            sandbox = client.create()
        except Exception as exc:  # noqa: BLE001
            print(f"daytona: sandbox create failed: {exc}", file=sys.stderr)
            return 3
        try:
            upload_worktree(client, sandbox, Path(worktree))
        except Exception as exc:  # noqa: BLE001
            print(f"daytona: worktree upload failed: {exc}", file=sys.stderr)
            return 3
        results, ok = run_groups(client, sandbox, groups, group_timeout, total_timeout)
        write_json(json_out, {"groups": results, "ok": ok, "backend": "daytona"})
        return 0
    finally:
        if sandbox is not None:
            try:
                client.delete(sandbox)
            except Exception:  # noqa: BLE001 - deletion is best effort; auto-stop is the backstop
                pass
        slots.release()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--worktree", required=True)
    parser.add_argument("--base")
    parser.add_argument("--groups")
    parser.add_argument("--json")
    parser.add_argument("--files-from")
    args = parser.parse_args(argv)
    groups = None
    if args.groups:
        groups = json.loads(Path(args.groups).read_text()).get("groups", [])
    return run(args.worktree, args.base, groups, args.json, args.files_from)


if __name__ == "__main__":
    sys.exit(main())

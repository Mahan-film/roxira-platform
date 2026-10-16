#!/usr/bin/env python3
"""projectctl: run many products (templates/saas-chassis style) on one server.

Runs ON the server as root. Stdlib + PyYAML. Independent of roxira-autodeploy.
Manifests live in scripts/ops/projects/projects/<name>.yaml. See docs/ops/PROJECTS.md.

  projectctl.py list | status | create <n> | deploy <n> [--force] | rollback <n>
                logs <n> [service] | disable <n> | deploy-all | render-proxy [--reload]

Secrets: the per-project DB password is generated here, written only to the project's env
file (mode 600) and never printed or logged.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import yaml

HERE = Path(__file__).resolve().parent
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}$")
DB_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
DOMAIN_RE = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
SERVICE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
REPO_RE = re.compile(r"^(https://[^\s]+|ssh://[^\s]+|git@[A-Za-z0-9.-]+:[^\s]+)$")
BRANCH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
KEYS = {"name", "repo", "branch", "domains", "compose_file", "service", "port", "health_url",
        "env_file", "db_name", "migrate_command", "enabled"}


class ManifestError(ValueError):
    pass


class LockBusy(RuntimeError):
    pass


@dataclass(frozen=True)
class Manifest:
    name: str
    repo: str
    branch: str
    domains: tuple
    compose_file: str
    service: str
    port: int
    health_url: str
    env_file: str
    db_name: str
    migrate_command: str
    enabled: bool
    path: Optional[Path] = None


def parse_manifest(data: dict, expect_name: Optional[str] = None, path: Optional[Path] = None) -> Manifest:
    if not isinstance(data, dict):
        raise ManifestError("manifest must be a mapping")
    unknown = set(data) - KEYS
    if unknown:
        raise ManifestError(f"unknown keys: {sorted(unknown)}")
    for req in ("name", "repo", "domains", "health_url", "db_name"):
        if isinstance(data.get(req), bool):  # YAML turns bare on/off/yes/no into booleans
            raise ManifestError(f"{req} parsed as a boolean; quote it (e.g. \"off\")")
        if not data.get(req):
            raise ManifestError(f"missing required key: {req}")
    name = str(data["name"])
    if not NAME_RE.match(name):
        raise ManifestError(f"bad name {name!r} (a-z, 0-9, '-', 2-31 chars, starts with a letter)")
    if expect_name is not None and name != expect_name:
        raise ManifestError(f"name {name!r} does not match file name {expect_name!r}")
    repo = str(data["repo"])
    if not REPO_RE.match(repo):
        raise ManifestError("repo must be an https://, ssh:// or git@host:path URL")
    branch = str(data.get("branch", "main"))
    if not BRANCH_RE.match(branch) or ".." in branch:
        raise ManifestError(f"bad branch {branch!r}")
    domains = data["domains"]
    if not isinstance(domains, list) or not domains:
        raise ManifestError("domains must be a non-empty list")
    for d in domains:
        if not isinstance(d, str) or not DOMAIN_RE.match(d):
            raise ManifestError(f"bad domain {d!r} (lowercase hostname)")
    if len(set(domains)) != len(domains):
        raise ManifestError("duplicate domain in list")
    compose = str(data.get("compose_file", "docker-compose.yml"))
    if compose.startswith("/") or ".." in Path(compose).parts or not compose.strip():
        raise ManifestError("compose_file must be a relative path inside the repo")
    service = str(data.get("service", "app"))
    if not SERVICE_RE.match(service):
        raise ManifestError(f"bad service {service!r}")
    port = data.get("port", 3000)
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        raise ManifestError("port must be an integer 1-65535")
    health = str(data["health_url"])
    if not re.match(r"^https?://[^\s]+$", health):
        raise ManifestError("health_url must be http(s)://...")
    env_file = str(data.get("env_file", f"/srv/projects/{name}/.env"))
    if not env_file.startswith("/") or ".." in Path(env_file).parts:
        raise ManifestError("env_file must be an absolute path")
    db = str(data["db_name"])
    if not DB_RE.match(db) or db in {"postgres", "template0", "template1"}:
        raise ManifestError(f"bad db_name {db!r}")
    mig = str(data.get("migrate_command") or "")
    if "\n" in mig:
        raise ManifestError("migrate_command must be one line")
    enabled = data.get("enabled", False)
    if not isinstance(enabled, bool):
        raise ManifestError("enabled must be true or false")
    return Manifest(name, repo, branch, tuple(domains), compose, service, port, health,
                    env_file, db, mig, enabled, path)


def load_manifest(path: Path) -> Manifest:
    try:
        data = yaml.safe_load(Path(path).read_text())
    except yaml.YAMLError as exc:
        raise ManifestError(f"{path}: invalid YAML: {exc}") from exc
    return parse_manifest(data, expect_name=Path(path).stem, path=Path(path))


def load_all(manifest_dir: Path) -> list:
    manifests = [load_manifest(p) for p in sorted(Path(manifest_dir).glob("*.yaml"))]
    seen: dict = {}
    dbs: dict = {}
    for m in manifests:
        for d in m.domains:
            if d in seen:
                raise ManifestError(f"domain {d} used by both {seen[d]} and {m.name}")
            seen[d] = m.name
        if m.db_name in dbs:
            raise ManifestError(f"db_name {m.db_name} used by both {dbs[m.db_name]} and {m.name}")
        dbs[m.db_name] = m.name
    return manifests


def render_caddyfile(manifests, http_port: int = 80, https_port: int = 443, email: str = "") -> str:
    lines = ["# Generated by projectctl.py render-proxy -- do not edit by hand.", "{"]
    if email:
        lines.append(f"\temail {email}")
    if http_port != 80:
        lines.append(f"\thttp_port {http_port}")
    if https_port != 443:
        lines.append(f"\thttps_port {https_port}")
    lines.append("}")
    for m in manifests:
        if not m.enabled:
            continue
        lines += ["", f"{', '.join(m.domains)} {{", "\tencode zstd gzip",
                  f"\treverse_proxy {m.name}-app:{m.port}", "}"]
    return "\n".join(lines) + "\n"


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


class Result:
    def __init__(self, rc: int, out: str = ""):
        self.rc, self.out = rc, out


class Runner:
    """Runs commands. Stdin (`input`) may carry secrets and is never logged."""

    def run(self, argv, cwd=None, input=None, timeout=None) -> Result:
        try:
            p = subprocess.run(argv, cwd=cwd, input=input, text=True, capture_output=True,
                               timeout=timeout)
        except FileNotFoundError as exc:
            return Result(127, str(exc))
        except subprocess.TimeoutExpired:
            return Result(124, "timeout")
        return Result(p.returncode, (p.stdout or "") + (p.stderr or ""))


def http_status(url: str, timeout: float = 10) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": "projectctl-health"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (manifest URL)
            return r.status
    except urllib.error.HTTPError as exc:
        return exc.code
    except Exception:
        return 0


def _best_effort_notify(text: str) -> None:
    try:
        sys.path.insert(0, str(HERE.parent / "notify"))
        import notify  # type: ignore

        notify.send(text)
    except Exception:
        pass


class Ctx:
    def __init__(self, runner=None, http=None, sleep=time.sleep, notify=None, now=None,
                 root=None, manifest_dir=None, state_dir=None, lock_path=None,
                 health_tries=24, health_interval=5.0):
        self.runner = runner or Runner()
        self.http = http or http_status
        self.sleep = sleep
        self.notify = notify or _best_effort_notify
        self.now = now or (lambda: time.strftime("%Y-%m-%dT%H:%M:%S%z"))
        self.root = Path(root or os.environ.get("PROJECTS_ROOT", "/srv/projects"))
        self.manifest_dir = Path(manifest_dir or os.environ.get("PROJECTCTL_MANIFESTS", HERE / "projects"))
        self.state_dir = Path(state_dir or os.environ.get("PROJECTCTL_STATE_DIR", "/root/deploy-state"))
        self.lock_path = Path(lock_path or os.environ.get("PROJECTCTL_LOCK", "/run/projectctl.lock"))
        self.health_tries = health_tries
        self.health_interval = health_interval

    # paths
    def pdir(self, m): return self.root / m.name
    def repo_dir(self, m): return self.pdir(m) / "repo"
    def state_file(self, m): return self.pdir(m) / ".deploy-state.json"
    def override_file(self, m): return self.pdir(m) / "projectctl.override.yml"
    def proxy_dir(self): return Path(os.environ.get("PROJECTS_PROXY_DIR", self.root / "_proxy"))
    def log_file(self): return self.state_dir / "projects.jsonl"


class Lock:
    """Global non-blocking exclusive lock: two deploys never overlap."""

    def __init__(self, path: Path):
        self.path, self.fd = Path(path), None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(self.fd)
            self.fd = None
            raise LockBusy(f"another projectctl operation holds {self.path}")
        return self

    def __exit__(self, *exc):
        if self.fd is not None:
            fcntl.flock(self.fd, fcntl.LOCK_UN)
            os.close(self.fd)
            self.fd = None


# ---- state -----------------------------------------------------------------------------
def read_state(ctx, m) -> dict:
    try:
        return json.loads(ctx.state_file(m).read_text())
    except (OSError, ValueError):
        return {}


def write_state(ctx, m, state: dict) -> None:
    f = ctx.state_file(m)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1))
    os.replace(tmp, f)


def tag_for(m, sha: str) -> str:
    return f"{m.name}-app:{sha[:12]}"


def write_override(ctx, m, sha: str) -> None:
    doc = {
        "services": {m.service: {
            "image": tag_for(m, sha),
            "networks": {"default": {}, "projects_net": {"aliases": [f"{m.name}-app"]}},
        }},
        "networks": {"projects_net": {"external": True, "name": "projects_net"}},
    }
    ctx.override_file(m).write_text(yaml.safe_dump(doc, sort_keys=False))


def compose(ctx, m, *args) -> list:
    return ["docker", "compose", "-p", m.name, "--project-directory", str(ctx.repo_dir(m)),
            "-f", str(ctx.repo_dir(m) / m.compose_file), "-f", str(ctx.override_file(m)),
            "--env-file", m.env_file, *args]


def git(ctx, m, *args) -> Result:
    return ctx.runner.run(["git", "-C", str(ctx.repo_dir(m)), *args])


def wait_healthy(ctx, m) -> bool:
    for i in range(ctx.health_tries):
        code = ctx.http(m.health_url)
        if 200 <= code < 400:
            return True
        if i + 1 < ctx.health_tries:
            ctx.sleep(ctx.health_interval)
    return False


def _scrub(text: str, *secrets_: str) -> str:
    for s in secrets_:
        if s:
            text = text.replace(s, "[x]")
    return text.strip()[-400:]


# ---- create ----------------------------------------------------------------------------
def create_project(ctx, m) -> str:
    pdir = ctx.pdir(m)
    pdir.mkdir(parents=True, exist_ok=True)
    if not (ctx.repo_dir(m) / ".git").exists():
        r = ctx.runner.run(["git", "clone", "--branch", m.branch, m.repo, str(ctx.repo_dir(m))])
        if r.rc != 0:
            raise RuntimeError(f"git clone failed: {_scrub(r.out)}")
    env_path = Path(m.env_file)
    if env_path.exists():
        return "exists"  # credentials already provisioned; never regenerate or overwrite
    password = secrets.token_hex(24)
    user, db = m.db_name, m.db_name
    psql = ["docker", "exec", "-i", "projects_postgres", "psql", "-U", "postgres",
            "-v", "ON_ERROR_STOP=1", "-qtA"]
    role_sql = (f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='{user}') "
                f"THEN CREATE ROLE {user} LOGIN PASSWORD '{password}'; "
                f"ELSE ALTER ROLE {user} PASSWORD '{password}'; END IF; END $$;\n")
    r = ctx.runner.run(psql, input=role_sql)
    if r.rc != 0:
        raise RuntimeError(f"creating db role failed: {_scrub(r.out, password)}")
    r = ctx.runner.run(psql, input=f"SELECT 1 FROM pg_database WHERE datname='{db}';\n")
    if r.rc != 0:
        raise RuntimeError(f"checking database failed: {_scrub(r.out, password)}")
    if r.out.strip() != "1":
        r = ctx.runner.run(psql, input=f"CREATE DATABASE {db} OWNER {user};\n")
        if r.rc != 0:
            raise RuntimeError(f"creating database failed: {_scrub(r.out, password)}")
    body = "\n".join([
        "NODE_ENV=production",
        f"APP_URL=https://{m.domains[0]}",
        "POSTGRES_HOST=projects_postgres",
        "POSTGRES_PORT=5432",
        f"POSTGRES_DB={db}",
        f"POSTGRES_USER={user}",
        f"POSTGRES_PASSWORD={password}",
        f"DATABASE_URL=postgresql://{user}:{password}@projects_postgres:5432/{db}",
        "",
    ])
    env_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(body)
    os.chmod(env_path, 0o600)
    return "created"


# ---- deploy ----------------------------------------------------------------------------
def _record(ctx, m, result: str, sha: str = "", previous: str = "", detail: str = "") -> dict:
    return {"ts": ctx.now(), "project": m.name, "result": result, "sha": sha[:12],
            "previous": previous[:12], "detail": detail}


def _activate(ctx, m, sha: str, build: bool) -> Result:
    write_override(ctx, m, sha)
    return ctx.runner.run(compose(ctx, m, "up", "-d", "--remove-orphans") if build
                          else compose(ctx, m, "up", "-d", "--no-build", "--remove-orphans"))


def deploy_project(ctx, m, force: bool = False) -> dict:
    """Deploy one project if its branch has a new commit. Caller holds the global lock."""
    try:
        return _deploy(ctx, m, force)
    except Exception as exc:  # never let one project break the loop
        return _record(ctx, m, "failed", detail=_scrub(str(exc)))


def _deploy(ctx, m, force: bool) -> dict:
    if not m.enabled:
        return _record(ctx, m, "disabled")
    if not (ctx.repo_dir(m) / ".git").exists():
        return _record(ctx, m, "failed", detail="not created; run: projectctl.py create " + m.name)
    state = read_state(ctx, m)
    r = git(ctx, m, "fetch", "--prune", "origin", m.branch)
    if r.rc != 0:
        return _record(ctx, m, "failed", detail="git fetch failed: " + _scrub(r.out))
    r = git(ctx, m, "rev-parse", f"origin/{m.branch}")
    sha = r.out.strip()
    if r.rc != 0 or not SHA_RE.match(sha):
        return _record(ctx, m, "failed", detail="cannot resolve origin/" + m.branch)
    current = state.get("deployed_sha", "")
    if not force:
        if sha == current:
            return _record(ctx, m, "up-to-date", sha)
        if sha == state.get("failed_sha"):
            return _record(ctx, m, "skipped-failed", sha, current, "this commit failed before")
    r = git(ctx, m, "checkout", "--force", "--detach", sha)
    if r.rc != 0:
        return _record(ctx, m, "failed", sha, current, "git checkout failed: " + _scrub(r.out))

    def fail(detail: str) -> dict:
        state["failed_sha"] = sha
        write_state(ctx, m, state)
        return _record(ctx, m, "failed", sha, current, detail)

    write_override(ctx, m, sha)
    r = ctx.runner.run(compose(ctx, m, "build"), cwd=str(ctx.repo_dir(m)))
    if r.rc != 0:
        return fail("build failed: " + _scrub(r.out))
    if m.migrate_command:
        backup_dir = ctx.pdir(m) / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        dump = backup_dir / f"{m.db_name}-{sha[:12]}.dump"
        r = ctx.runner.run(["docker", "exec", "projects_postgres", "sh", "-c",
                            f"pg_dump -U postgres -Fc {m.db_name} > /tmp/{m.db_name}.dump"])
        if r.rc == 0:
            r = ctx.runner.run(["docker", "cp", f"projects_postgres:/tmp/{m.db_name}.dump", str(dump)])
        if r.rc != 0:
            return fail("pre-migration backup failed: " + _scrub(r.out))
        r = ctx.runner.run(compose(ctx, m, "run", "--rm", "--no-deps", m.service,
                                   "sh", "-c", m.migrate_command), cwd=str(ctx.repo_dir(m)))
        if r.rc != 0:
            return fail("migration failed (backup kept): " + _scrub(r.out))
    r = _activate(ctx, m, sha, build=True)
    if r.rc != 0:
        return fail("compose up failed: " + _scrub(r.out))
    if wait_healthy(ctx, m):
        write_state(ctx, m, {"deployed_sha": sha, "previous_sha": current,
                             "failed_sha": state.get("failed_sha", ""), "deployed_at": ctx.now()})
        return _record(ctx, m, "deployed", sha, current)
    # health failed: roll back to the previous image
    state["failed_sha"] = sha
    if current and ctx.runner.run(["docker", "image", "inspect", tag_for(m, current)]).rc == 0:
        git(ctx, m, "checkout", "--force", "--detach", current)
        _activate(ctx, m, current, build=False)
        ok = wait_healthy(ctx, m)
        write_state(ctx, m, state)
        return _record(ctx, m, "rolled_back", sha, current,
                       "health check failed; previous version " + ("healthy" if ok else "ALSO unhealthy"))
    write_state(ctx, m, state)
    return _record(ctx, m, "failed", sha, current, "health check failed; no previous image to roll back to")


def rollback_project(ctx, m) -> dict:
    state = read_state(ctx, m)
    prev, cur = state.get("previous_sha", ""), state.get("deployed_sha", "")
    if not prev:
        return _record(ctx, m, "failed", cur, "", "no previous version recorded")
    if ctx.runner.run(["docker", "image", "inspect", tag_for(m, prev)]).rc != 0:
        return _record(ctx, m, "failed", cur, prev, "previous image missing; redeploy instead")
    git(ctx, m, "checkout", "--force", "--detach", prev)
    r = _activate(ctx, m, prev, build=False)
    if r.rc != 0 or not wait_healthy(ctx, m):
        return _record(ctx, m, "failed", prev, cur, "rollback target did not become healthy")
    write_state(ctx, m, {"deployed_sha": prev, "previous_sha": cur,
                         "failed_sha": cur, "deployed_at": ctx.now()})
    return _record(ctx, m, "rolled_back", prev, cur, "manual rollback (database NOT reverted)")


def log_result(ctx, rec: dict) -> None:
    try:
        ctx.state_dir.mkdir(parents=True, exist_ok=True)
        with open(ctx.log_file(), "a") as fh:
            fh.write(json.dumps(rec) + "\n")
    except OSError:
        pass


NOTIFY_RESULTS = {"deployed", "rolled_back", "failed"}


def deploy_all(ctx) -> list:
    results = []
    manifests = load_all(ctx.manifest_dir)
    for m in manifests:
        if not m.enabled:
            continue
        rec = deploy_project(ctx, m)
        results.append(rec)
        if rec["result"] != "up-to-date":
            log_result(ctx, rec)
        if rec["result"] in NOTIFY_RESULTS:
            ctx.notify(f"[projects] {rec['project']}: {rec['result']} {rec['sha']} {rec['detail']}".strip())
    try:
        reload_proxy(ctx, manifests)
    except Exception:
        pass
    return results


# ---- proxy -----------------------------------------------------------------------------
def render_proxy(ctx, manifests=None) -> bool:
    """Write the Caddyfile; returns True if its content changed."""
    manifests = load_all(ctx.manifest_dir) if manifests is None else manifests
    text = render_caddyfile(manifests, _env_int("PROJECTS_HTTP_PORT", 80),
                            _env_int("PROJECTS_HTTPS_PORT", 443),
                            os.environ.get("PROJECTS_ACME_EMAIL", ""))
    target = ctx.proxy_dir() / "Caddyfile"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_text() == text:
        return False
    target.write_text(text)
    return True


def reload_proxy(ctx, manifests=None) -> None:
    changed = render_proxy(ctx, manifests)
    running = ctx.runner.run(["docker", "ps", "-q", "--filter", "name=^projects_caddy$"])
    if changed and running.rc == 0 and running.out.strip():
        ctx.runner.run(["docker", "exec", "projects_caddy", "caddy", "reload",
                        "--config", "/etc/caddy/Caddyfile"])


# ---- cli -------------------------------------------------------------------------------
def _get(ctx, name: str) -> Manifest:
    p = ctx.manifest_dir / f"{name}.yaml"
    if not NAME_RE.match(name) or not p.exists():
        raise ManifestError(f"no manifest for project {name!r}")
    return load_manifest(p)


def set_enabled(path: Path, value: bool) -> None:
    text = path.read_text()
    new = f"enabled: {'true' if value else 'false'}"
    if re.search(r"(?m)^enabled:.*$", text):
        text = re.sub(r"(?m)^enabled:.*$", new, text)
    else:
        text = text.rstrip("\n") + "\n" + new + "\n"
    path.write_text(text)


def main(argv=None, ctx: Optional[Ctx] = None) -> int:
    ap = argparse.ArgumentParser(prog="projectctl")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sub.add_parser("status")
    sub.add_parser("deploy-all")
    for c in ("create", "rollback", "disable", "logs"):
        sub.add_parser(c).add_argument("name")
    sub.choices["logs"].add_argument("service", nargs="?")
    d = sub.add_parser("deploy")
    d.add_argument("name")
    d.add_argument("--force", action="store_true")
    rp = sub.add_parser("render-proxy")
    rp.add_argument("--reload", action="store_true")
    a = ap.parse_args(argv)
    ctx = ctx or Ctx()
    try:
        if a.cmd == "list":
            for m in load_all(ctx.manifest_dir):
                print(f"{m.name}\t{'enabled' if m.enabled else 'disabled'}\t{','.join(m.domains)}\t{m.repo}@{m.branch}")
            return 0
        if a.cmd == "status":
            for m in load_all(ctx.manifest_dir):
                st = read_state(ctx, m)
                ps = ctx.runner.run(["docker", "ps", "--filter", f"label=com.docker.compose.project={m.name}",
                                     "--format", "{{.Names}}: {{.Status}}"])
                print(f"{m.name}\t{'enabled' if m.enabled else 'disabled'}\tdeployed={st.get('deployed_sha', '-')[:12] or '-'}"
                      f"\tprevious={st.get('previous_sha', '-')[:12] or '-'}\tfailed={st.get('failed_sha', '-')[:12] or '-'}")
                for line in ps.out.strip().splitlines():
                    print("    " + line)
            return 0
        if a.cmd == "logs":
            m = _get(ctx, a.name)
            args = ["logs", "--tail", "200"] + ([a.service] if a.service else [])
            r = ctx.runner.run(compose(ctx, m, *args))
            print(r.out)
            return r.rc
        if a.cmd == "render-proxy":
            changed = render_proxy(ctx)
            print(f"Caddyfile {'updated' if changed else 'unchanged'}: {ctx.proxy_dir() / 'Caddyfile'}")
            if a.reload:
                reload_proxy(ctx)
            return 0
        with Lock(ctx.lock_path):
            if a.cmd == "deploy-all":
                results = deploy_all(ctx)
                for rec in results:
                    print(json.dumps(rec))
                return 1 if any(r["result"] in ("failed", "rolled_back") for r in results) else 0
            m = _get(ctx, a.name)
            if a.cmd == "create":
                print(f"{m.name}: {create_project(ctx, m)} (credentials are in {m.env_file}, not shown)")
                reload_proxy(ctx)
                return 0
            if a.cmd == "disable":
                set_enabled(m.path, False)
                ctx.runner.run(compose(ctx, m, "stop"))
                reload_proxy(ctx)
                print(f"{m.name}: disabled")
                return 0
            rec = deploy_project(ctx, m, a.force) if a.cmd == "deploy" else rollback_project(ctx, m)
            log_result(ctx, rec)
            print(json.dumps(rec))
            good = ("deployed", "up-to-date") + (("rolled_back",) if a.cmd == "rollback" else ())
            return 0 if rec["result"] in good else 1
    except LockBusy as exc:
        print(f"busy: {exc}", file=sys.stderr)
        return 3
    except ManifestError as exc:
        print(f"manifest error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

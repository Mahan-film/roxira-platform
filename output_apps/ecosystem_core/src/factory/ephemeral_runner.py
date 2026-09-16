"""Ephemeral sandbox build worker for the Roxira Software Foundry.

Consumes build requests produced by ``POST /api/v1/factory/synthesize-app``,
materialises an isolated docker-compose project under
``/opt/roxira_platform/data/sandboxes/{app_id}``, builds and runs it against the
host Docker daemon exposed at ``/var/run/docker.sock`` on a dynamic port in the
4000-4999 range, and finally registers a subdomain vhost in Nginx via a graceful
``nginx -s reload`` (no existing container is restarted).

The module is intentionally dependency-light: it only requires the standard
library, using the ``docker`` / ``docker compose`` CLI over the unix socket.
Redis Streams (``redis.asyncio``) and the FastAPI router factory are optional,
guarded imports so the worker stays importable in minimal environments.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import shutil
import signal
import socket
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field, fields
from enum import Enum
from pathlib import Path
from typing import Any, Optional, Protocol

try:  # optional — enables the Redis Streams transport
    from redis.asyncio import Redis as AsyncRedis
except Exception:  # pragma: no cover - optional dependency
    AsyncRedis = None  # type: ignore[assignment]

try:  # templates live alongside this module
    from .templates import SandboxTemplate, select_template
except ImportError:  # pragma: no cover - direct script execution
    from templates import SandboxTemplate, select_template  # type: ignore[no-redef]

__all__ = [
    "BuildRequest",
    "BuildResult",
    "BuildStage",
    "BuildStatus",
    "SandboxRecord",
    "DockerCommandError",
    "EphemeralRunnerError",
    "PortAllocationError",
    "NginxReloadError",
    "DockerEngine",
    "HostPortInspector",
    "parse_published_ports",
    "PortAllocator",
    "ComposeProjectGenerator",
    "GeneratedProject",
    "NginxRouteRegistrar",
    "InMemoryBuildQueue",
    "RedisStreamBuildQueue",
    "make_build_queue",
    "redis_configured",
    "requires_in_process_advancement",
    "DEPLOYED_STAGES",
    "HEALTH_HEALTHY",
    "HEALTH_STARTING",
    "HEALTH_UNHEALTHY",
    "classify_health",
    "probe_sandbox_http",
    "sandbox_health",
    "sandbox_summary",
    "FileBuildStatusStore",
    "RedisBuildStatusStore",
    "make_status_store",
    "slugify_app_id",
    "EphemeralRunner",
    "create_factory_router",
]

APP_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,60}$")
DEFAULT_SANDBOX_ROOT = Path("/opt/roxira_platform/data/sandboxes")
DEFAULT_NGINX_SANDBOX_DIR = Path("/opt/roxira_platform/nginx/sandboxes")
DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock"
DEFAULT_NGINX_CONTAINER = "roxira_nginx_prod"
PORT_RANGE_START = 4000
PORT_RANGE_END = 4999
STREAM_KEY = "factory:build:requests"
STATUS_TTL_SECONDS = 7 * 24 * 3600


def slugify_app_id(value: str) -> str:
    """Normalise a human app name into a DNS-safe ``app_id``."""
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return slug[:60] or f"app-{uuid.uuid4().hex[:12]}"


class EphemeralRunnerError(RuntimeError):
    """Base error for the ephemeral sandbox worker."""


class DockerCommandError(EphemeralRunnerError):
    """Raised when a docker / docker compose invocation fails."""

    def __init__(self, command: str, returncode: int, stderr: str) -> None:
        self.command = command
        self.returncode = returncode
        self.stderr = stderr
        super().__init__(f"command failed ({returncode}): {command}\n{stderr.strip()}")


class PortAllocationError(EphemeralRunnerError):
    """Raised when no free port is available in the configured range."""


class NginxReloadError(EphemeralRunnerError):
    """Raised when the Nginx configuration test or reload fails."""


# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class BuildRequest:
    app_id: str
    prompt: str
    app_name: Optional[str] = None
    target_framework: str = "FastAPI"
    tier: str = "STANDARD"
    requested_by: Optional[str] = None
    created_at: float = field(default_factory=time.time)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "BuildRequest":
        app_name = payload.get("app_name")
        app_id = payload.get("app_id") or (slugify_app_id(str(app_name)) if app_name else None)
        return cls(
            app_id=str(app_id or f"app-{uuid.uuid4().hex[:12]}"),
            prompt=str(
                payload.get("specification")
                or payload.get("prompt")
                or payload.get("spec_prompt")
                or ""
            ).strip(),
            app_name=str(app_name) if app_name else None,
            target_framework=str(payload.get("target_framework") or "FastAPI"),
            tier=str(payload.get("tier") or payload.get("engine_tier") or "STANDARD"),
            requested_by=(str(payload["requested_by"]) if payload.get("requested_by") else None),
            created_at=float(payload.get("created_at") or time.time()),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class SandboxRecord:
    app_id: str
    host_port: int
    project_name: str
    container_name: str
    subdomain: str
    project_dir: str
    status: str
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class BuildResult:
    app_id: str
    status: str
    host_port: Optional[int] = None
    url: Optional[str] = None
    container_id: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class BuildStage(str, Enum):
    """Ordered pipeline stages reported by the status endpoint."""

    QUEUED = "QUEUED"
    PORT_ALLOCATED = "PORT_ALLOCATED"
    PROJECT_GENERATED = "PROJECT_GENERATED"
    BUILDING = "BUILDING"
    CONTAINER_STARTED = "CONTAINER_STARTED"
    ROUTE_REGISTERED = "ROUTE_REGISTERED"
    RUNNING = "RUNNING"
    FAILED = "FAILED"
    REJECTED = "REJECTED"
    DESTROYED = "DESTROYED"


@dataclass(slots=True)
class BuildStatus:
    """Canonical, shareable view of a build's current runner state."""

    app_id: str
    stage: str = BuildStage.QUEUED.value
    status: str = "QUEUED"
    app_name: Optional[str] = None
    prompt: Optional[str] = None
    target_framework: Optional[str] = None
    tier: Optional[str] = None
    host_port: Optional[int] = None
    subdomain: Optional[str] = None
    url: Optional[str] = None
    container_id: Optional[str] = None
    container_name: Optional[str] = None
    project_dir: Optional[str] = None
    error: Optional[str] = None
    repair_attempts: int = 0
    repairs: list[str] = field(default_factory=list)
    stages: list[dict[str, Any]] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @classmethod
    def from_request(cls, request: BuildRequest) -> "BuildStatus":
        return cls(
            app_id=request.app_id,
            app_name=request.app_name,
            prompt=request.prompt,
            target_framework=request.target_framework,
            tier=request.tier,
            created_at=request.created_at,
        )

    def advance(self, stage: BuildStage, *, status: Optional[str] = None, **fields_: Any) -> "BuildStatus":
        self.stage = stage.value
        self.status = status or stage.value
        for key, value in fields_.items():
            if hasattr(self, key):
                setattr(self, key, value)
        self.updated_at = time.time()
        self.stages.append({"stage": stage.value, "at": self.updated_at})
        return self

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "BuildStatus":
        allowed = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in allowed})


DEPLOYED_STAGES: frozenset[str] = frozenset(
    {
        BuildStage.CONTAINER_STARTED.value,
        BuildStage.ROUTE_REGISTERED.value,
        BuildStage.RUNNING.value,
    }
)


# ---------------------------------------------------------------------------
# Sandbox liveness
# ---------------------------------------------------------------------------

HEALTH_HEALTHY = "HEALTHY"
HEALTH_UNHEALTHY = "UNHEALTHY"
HEALTH_STARTING = "STARTING"

#: HTTP probe budget for a single sandbox (seconds).
HEALTH_PROBE_TIMEOUT = float(os.getenv("ROXIRA_HEALTH_TIMEOUT", "1.5"))
#: A sandbox that reached RUNNING less than this long ago is still booting.
SANDBOX_STARTUP_GRACE_SECONDS = float(os.getenv("ROXIRA_SANDBOX_STARTUP_GRACE", "30"))
#: Cap on concurrent probes so listing can't stampede the host.
HEALTH_PROBE_CONCURRENCY = int(os.getenv("ROXIRA_HEALTH_CONCURRENCY", "8"))

_HEALTH_REQUEST = (
    "GET / HTTP/1.1\r\n"
    "Host: 127.0.0.1:{port}\r\n"
    "User-Agent: roxira-health/1.0\r\n"
    "Accept: */*\r\n"
    "Connection: close\r\n\r\n"
)


async def probe_sandbox_http(port: Optional[int], timeout: float = HEALTH_PROBE_TIMEOUT) -> str:
    """HTTP-liveness probe of a sandbox on ``127.0.0.1:{port}/``.

    Returns ``HEALTHY`` when the sandbox answers with an HTTP status below 500,
    ``UNHEALTHY`` otherwise (connection refused/reset, timeout, no HTTP status
    line, or a 5xx — i.e. listening but broken).

    Uses raw asyncio streams so no HTTP client dependency is required.  The
    probe assumes the API process shares the host network namespace with the
    published container port; from a network-isolated API container this
    degrades to ``UNHEALTHY`` rather than raising.
    """
    if not port:
        return HEALTH_UNHEALTHY
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection("127.0.0.1", int(port)), timeout=timeout
        )
    except (OSError, asyncio.TimeoutError, ValueError):
        return HEALTH_UNHEALTHY

    status_line = b""
    try:
        writer.write(_HEALTH_REQUEST.format(port=int(port)).encode("ascii"))
        await writer.drain()
        status_line = await asyncio.wait_for(reader.readline(), timeout=timeout)
    except (OSError, asyncio.TimeoutError):
        return HEALTH_UNHEALTHY
    finally:
        with contextlib.suppress(Exception):
            writer.close()
            await writer.wait_closed()

    if not status_line.startswith(b"HTTP/"):
        return HEALTH_UNHEALTHY  # socket open, but not speaking HTTP
    parts = status_line.split()
    if len(parts) < 2:
        return HEALTH_UNHEALTHY
    try:
        code = int(parts[1])
    except ValueError:
        return HEALTH_UNHEALTHY
    return HEALTH_HEALTHY if code < 500 else HEALTH_UNHEALTHY


def classify_health(status: BuildStatus, probe: Optional[str] = None) -> str:
    """Combine build state with a probe result into the public health value.

    ``STARTING`` covers everything that isn't expected to serve traffic yet:
    builds still in the pipeline, and a sandbox that reached ``RUNNING`` within
    :data:`SANDBOX_STARTUP_GRACE_SECONDS` (the app process boots after the
    container starts, so the first probes legitimately fail).  Terminal states
    and failed probes past the grace window are ``UNHEALTHY``.
    """
    if probe == HEALTH_HEALTHY:
        return HEALTH_HEALTHY

    if status.stage in DEPLOYED_STAGES:
        age = time.time() - (status.updated_at or status.created_at or 0.0)
        if age < SANDBOX_STARTUP_GRACE_SECONDS:
            return HEALTH_STARTING
        return HEALTH_UNHEALTHY

    if status.stage in (
        BuildStage.FAILED.value,
        BuildStage.REJECTED.value,
        BuildStage.DESTROYED.value,
    ):
        return HEALTH_UNHEALTHY
    return HEALTH_STARTING  # QUEUED / PORT_ALLOCATED / PROJECT_GENERATED / BUILDING


async def sandbox_health(status: BuildStatus) -> str:
    """Health for one sandbox, probing only when a probe makes sense."""
    # Only a deployed sandbox has a live container on its port.  Probing a
    # QUEUED/FAILED/DESTROYED record could hit a *different* sandbox that has
    # since been allocated the same port, reporting a false HEALTHY.
    if status.stage in DEPLOYED_STAGES and status.host_port:
        return classify_health(status, await probe_sandbox_http(status.host_port))
    return classify_health(status)


def sandbox_summary(status: BuildStatus, health: Optional[str] = None) -> dict[str, Any]:
    """Flatten a :class:`BuildStatus` into the sandbox-listing row shape."""
    return {
        "app_id": status.app_id,
        "app_name": status.app_name,
        "status": status.status,
        "stage": status.stage,
        "port": status.host_port,
        "subdomain": status.subdomain,
        "url": status.url,
        "container_id": status.container_id,
        "deployed": status.stage in DEPLOYED_STAGES,
        "health": health or classify_health(status),
        "self_healed": status.repair_attempts > 0,
        "repairs": status.repairs,
        "created_at": status.created_at,
        "updated_at": status.updated_at,
    }


class BuildStatusStore(Protocol):
    async def save(self, status: BuildStatus) -> None: ...

    async def get(self, app_id: str) -> Optional[BuildStatus]: ...

    async def list_all(self) -> list[BuildStatus]: ...


class FileBuildStatusStore:
    """Filesystem status store — shared via the sandbox-root volume."""

    def __init__(self, sandbox_root: Path) -> None:
        self._sandbox_root = sandbox_root

    def _path(self, app_id: str) -> Path:
        return self._sandbox_root / app_id / "status.json"

    async def save(self, status: BuildStatus) -> None:
        path = self._path(status.app_id)
        await asyncio.to_thread(path.parent.mkdir, parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        await asyncio.to_thread(
            tmp.write_text,
            json.dumps(status.to_dict(), ensure_ascii=False, indent=2),
            "utf-8",
        )
        await asyncio.to_thread(os.replace, tmp, path)

    async def get(self, app_id: str) -> Optional[BuildStatus]:
        path = self._path(app_id)
        if not path.exists():
            return None
        try:
            raw = await asyncio.to_thread(path.read_text, "utf-8")
            return BuildStatus.from_dict(json.loads(raw))
        except Exception:
            return None

    async def list_all(self) -> list[BuildStatus]:
        """Every persisted build status, newest first.

        A corrupted/half-written ``status.json`` is skipped rather than failing
        the whole listing; ``save`` writes atomically so this should be rare.
        """
        if not self._sandbox_root.exists():
            return []
        statuses: list[BuildStatus] = []
        for path in await asyncio.to_thread(lambda: sorted(self._sandbox_root.glob("*/status.json"))):
            try:
                raw = await asyncio.to_thread(path.read_text, "utf-8")
                statuses.append(BuildStatus.from_dict(json.loads(raw)))
            except Exception:
                continue
        statuses.sort(key=lambda s: s.created_at, reverse=True)
        return statuses


class RedisBuildStatusStore:
    """Redis-backed status store — preferred when multiple replicas are live."""

    def __init__(self, client: "AsyncRedis") -> None:
        self._client = client

    @staticmethod
    def _key(app_id: str) -> str:
        return f"factory:build:status:{app_id}"

    async def save(self, status: BuildStatus) -> None:
        await self._client.set(
            self._key(status.app_id),
            json.dumps(status.to_dict(), ensure_ascii=False),
            ex=STATUS_TTL_SECONDS,
        )

    async def get(self, app_id: str) -> Optional[BuildStatus]:
        raw = await self._client.get(self._key(app_id))
        if not raw:
            return None
        try:
            return BuildStatus.from_dict(json.loads(raw))
        except Exception:
            return None

    async def list_all(self) -> list[BuildStatus]:
        """Every live build status via a non-blocking SCAN (never ``KEYS``)."""
        prefix = "factory:build:status:"
        keys: list[str] = []
        try:
            async for key in self._client.scan_iter(match=f"{prefix}*", count=200):
                keys.append(key if isinstance(key, str) else key.decode("utf-8"))
        except Exception:
            return []
        if not keys:
            return []
        try:
            raws = await self._client.mget(keys)
        except Exception:
            return []
        statuses: list[BuildStatus] = []
        for raw in raws:
            if not raw:
                continue
            try:
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8")
                statuses.append(BuildStatus.from_dict(json.loads(raw)))
            except Exception:
                continue
        statuses.sort(key=lambda s: s.created_at, reverse=True)
        return statuses


async def make_status_store() -> BuildStatusStore:
    redis_url = os.getenv("REDIS_URL", "").strip()
    if redis_url and AsyncRedis is not None:
        try:
            client = AsyncRedis.from_url(redis_url, decode_responses=True)
            await client.ping()
            return RedisBuildStatusStore(client)
        except Exception:
            pass
    return FileBuildStatusStore(
        Path(os.getenv("ROXIRA_SANDBOX_ROOT", str(DEFAULT_SANDBOX_ROOT)))
    )


# ---------------------------------------------------------------------------
# Port allocation
# ---------------------------------------------------------------------------


class HostPortInspector(Protocol):
    """Anything able to report which host ports Docker has already published.

    Structural type satisfied by :class:`DockerEngine`; kept as a Protocol so
    the allocator stays testable with a lightweight fake.
    """

    async def published_host_ports(self, timeout: float = ...) -> set[int]: ...


class PortAllocator:
    """Allocates a free TCP port within [start, end] while avoiding collisions.

    Four independent layers of defence are applied before a port is handed out,
    because a duplicate host port makes ``docker compose up`` fail *after* the
    expensive image build:

    1. **Docker daemon truth** — :meth:`_host_reserved_ports` asks the host
       Docker daemon (``docker ps --all``) for every already-published port.
       This catches containers whose sandbox directory was deleted, containers
       belonging to other services, and ports published without a userland
       proxy listener (``userland-proxy=false`` + nftables DNAT), which a plain
       ``bind()`` probe cannot see.
    2. **Filesystem records** — ``{app_id}/sandbox.json`` and
       ``{app_id}/.reservation`` from previous/parallel generations.
    3. **Socket availability** — :meth:`_is_bindable` binds ``0.0.0.0:{port}``
       so anything listening on the host (Docker proxy, another service) blocks
       the allocation even if the daemon is unreachable.
    4. **Cross-process port locks** — an ``O_EXCL`` lock file per port under
       ``{sandbox_root}/.portlocks/`` makes the reserve decision atomic between
       independent worker processes sharing the sandbox root; two processes can
       no longer both observe a port as free and both claim it.

    All four must agree before a port is returned; the port is then recorded in
    ``{app_id}/.reservation`` for observability by out-of-band tooling.
    """

    def __init__(
        self,
        sandbox_root: Path,
        start: int = PORT_RANGE_START,
        end: int = PORT_RANGE_END,
        docker: Optional[HostPortInspector] = None,
    ) -> None:
        self._sandbox_root = sandbox_root
        self._start = start
        self._end = end
        self._docker = docker
        self._lock = asyncio.Lock()
        self._in_flight: set[int] = set()

    def _reservation_path(self, app_id: str) -> Path:
        return self._sandbox_root / app_id / ".reservation"

    def _port_lock_path(self, port: int) -> Path:
        return self._sandbox_root / ".portlocks" / f"{port}.lock"

    @property
    def range(self) -> tuple[int, int]:
        return (self._start, self._end)

    # -- layer 1: docker daemon -------------------------------------------

    async def _host_reserved_ports(self) -> set[int]:
        """Host ports published by the Docker daemon (empty if unreachable)."""
        if self._docker is None:
            return set()
        try:
            ports = await self._docker.published_host_ports()
        except Exception as exc:  # daemon down / CLI missing -> degrade gracefully
            print(
                "[PortAllocator] WARN docker port query failed (%s); "
                "falling back to socket probing only" % exc,
                file=sys.stderr,
            )
            return set()
        return {p for p in ports if self._start <= p <= self._end}

    # -- layer 2: filesystem records --------------------------------------

    def reserved_ports(self) -> set[int]:
        reserved: set[int] = set()
        if not self._sandbox_root.exists():
            return reserved
        for record_path in self._sandbox_root.glob("*/sandbox.json"):
            try:
                data = json.loads(record_path.read_text(encoding="utf-8"))
                port = int(data.get("host_port", 0))
                if port:
                    reserved.add(port)
            except Exception:
                continue
        for reservation in self._sandbox_root.glob("*/.reservation"):
            with contextlib.suppress(ValueError, OSError):
                reserved.add(int(reservation.read_text(encoding="utf-8").strip()))
        for lock in (self._sandbox_root / ".portlocks").glob("*.lock"):
            with contextlib.suppress(ValueError, OSError):
                reserved.add(int(lock.stem))
        return reserved

    # -- layer 3: socket availability -------------------------------------

    @staticmethod
    def _is_bindable(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("0.0.0.0", port))
                return True
            except OSError:
                return False

    # -- layer 4: cross-process atomic reservation ------------------------

    def _lock_port(self, port: int) -> bool:
        """Atomically claim ``port`` via an ``O_EXCL`` lock file."""
        path = self._port_lock_path(port)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            return False  # another worker holds it
        except OSError as exc:
            # Read-only sandbox root: proceed on the remaining three layers
            # rather than refusing to allocate at all.
            print(
                "[PortAllocator] WARN cannot create port lock for %d (%s)" % (port, exc),
                file=sys.stderr,
            )
            return True
        try:
            os.write(fd, str(os.getpid()).encode("utf-8"))
        finally:
            os.close(fd)
        return True

    def _unlock_port(self, port: int) -> None:
        with contextlib.suppress(FileNotFoundError, OSError):
            self._port_lock_path(port).unlink()

    # -- public API --------------------------------------------------------

    async def verify_available(self, port: int) -> bool:
        """True only if ``port`` is free according to every check layer."""
        if not (self._start <= port <= self._end):
            return False
        if port in self._in_flight or port in self.reserved_ports():
            return False
        if port in await self._host_reserved_ports():
            return False
        return await asyncio.to_thread(self._is_bindable, port)

    async def allocate(self, app_id: str, preferred: Optional[int] = None) -> int:
        async with self._lock:
            blocked = self.reserved_ports() | self._in_flight
            blocked |= await self._host_reserved_ports()
            candidates = (
                [preferred]
                if preferred and self._start <= preferred <= self._end and preferred not in blocked
                else []
            ) + list(range(self._start, self._end + 1))
            for port in candidates:
                if port in blocked:
                    continue
                # Cheap local probe first, then the atomic cross-process lock.
                if not await asyncio.to_thread(self._is_bindable, port):
                    blocked.add(port)
                    continue
                if not await asyncio.to_thread(self._lock_port, port):
                    blocked.add(port)
                    continue
                self._in_flight.add(port)
                reservation = self._reservation_path(app_id)
                await asyncio.to_thread(reservation.parent.mkdir, parents=True, exist_ok=True)
                await asyncio.to_thread(reservation.write_text, str(port), "utf-8")
                return port
            raise PortAllocationError(
                f"no free port available in range {self._start}-{self._end}"
            )

    def release(self, app_id: str, port: int) -> None:
        self._in_flight.discard(port)
        self._unlock_port(port)
        with contextlib.suppress(FileNotFoundError, OSError):
            self._reservation_path(app_id).unlink()


# ---------------------------------------------------------------------------
# Docker engine (host daemon over the unix socket)
# ---------------------------------------------------------------------------


_PUBLISHED_PORT_RE = re.compile(r"(\d+)(?:-(\d+))?->\d+(?:-\d+)?/(?:tcp|udp)")


def parse_published_ports(raw: str) -> set[int]:
    """Extract host ports from ``docker ps`` ``{{.Ports}}`` output.

    Handles the shapes Docker emits::

        "0.0.0.0:4000->80/tcp, [::]:4000->80/tcp"   -> {4000}
        "0.0.0.0:4000-4005->80-85/tcp"              -> {4000..4005}
        "80/tcp"  (published to nothing)             -> {}
        "127.0.0.1:5432->5432/tcp"                   -> {5432}
    """
    used: set[int] = set()
    for start, end in _PUBLISHED_PORT_RE.findall(raw or ""):
        first = int(start)
        last = int(end) if end else first
        if last < first:
            first, last = last, first
        if last - first > PORT_RANGE_END - PORT_RANGE_START:  # malformed range guard
            last = first
        used.update(range(first, last + 1))
    return used


class DockerEngine:
    """Thin async wrapper around the docker CLI bound to the host socket."""

    def __init__(
        self,
        socket_path: str = DEFAULT_DOCKER_SOCKET,
        compose_bin: Optional[str] = None,
        command_timeout: float = 900.0,
    ) -> None:
        self._socket_path = socket_path
        self._command_timeout = command_timeout
        self._compose = compose_bin or os.getenv("ROXIRA_COMPOSE_BIN", "docker compose")
        self._env = {**os.environ, "DOCKER_HOST": f"unix://{socket_path}"}

    async def _run(
        self,
        args: list[str],
        cwd: Optional[Path] = None,
        timeout: Optional[float] = None,
    ) -> str:
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(cwd) if cwd else None,
            env=self._env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout or self._command_timeout
            )
        except asyncio.TimeoutError as exc:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            await proc.wait()
            raise DockerCommandError(" ".join(args), -1, f"timed out: {exc}") from exc

        if proc.returncode != 0:
            raise DockerCommandError(" ".join(args), proc.returncode or 1, stderr.decode())
        return stdout.decode()

    def _compose_cmd(self, project_dir: Path, project_name: str, *tail: str) -> list[str]:
        parts = self._compose.split()
        return [
            *parts,
            "-f",
            str(project_dir / "docker-compose.yml"),
            "-p",
            project_name,
            *tail,
        ]

    async def ping(self) -> bool:
        try:
            await self._run(["docker", "version", "--format", "{{.Server.Version}}"], timeout=20)
            return True
        except (DockerCommandError, FileNotFoundError):
            return False

    async def socket_available(self) -> bool:
        """True when the Docker socket exists and the daemon answers."""
        if not os.path.exists(self._socket_path):
            return False
        try:
            return await self.ping()
        except Exception:
            return False

    async def published_host_ports(self, timeout: float = 30.0) -> set[int]:
        """Every host port published by *any* container (running or stopped).

        ``--all`` is deliberate: a stopped container with
        ``restart: unless-stopped`` (which :meth:`ComposeProjectGenerator`
        emits) can resurrect and re-grab its port at any moment, so its binding
        must be treated as reserved.

        Returns an empty set when the daemon is unreachable, so callers can
        degrade to socket probing instead of failing outright.
        """
        if not await self.socket_available():
            return set()
        try:
            output = await self._run(
                ["docker", "ps", "--all", "--no-trunc", "--format", "{{.Ports}}"],
                timeout=timeout,
            )
        except (DockerCommandError, FileNotFoundError):
            return set()
        ports: set[int] = set()
        for line in output.splitlines():
            ports |= parse_published_ports(line)
        return ports

    async def ensure_network(self, network: str) -> None:
        try:
            await self._run(["docker", "network", "inspect", network], timeout=30)
            return
        except DockerCommandError:
            pass
        await self._run(["docker", "network", "create", network], timeout=60)

    async def compose_build(
        self, project_dir: Path, project_name: str, timeout: Optional[float] = None
    ) -> str:
        """Run ``docker compose build`` on its own.

        Split from ``up`` so a build failure surfaces as a
        :class:`DockerCommandError` carrying the full stderr — that log is the
        input to the self-healing repair pass.
        """
        return await self._run(
            self._compose_cmd(project_dir, project_name, "build"),
            timeout=timeout or self._command_timeout,
        )

    async def up(self, project_dir: Path, project_name: str) -> Optional[str]:
        """Start the already-built compose project and return the container id."""
        await self._run(
            self._compose_cmd(project_dir, project_name, "up", "-d"),
            timeout=300,
        )
        return await self.container_id(project_dir, project_name)

    async def build_and_up(self, project_dir: Path, project_name: str) -> Optional[str]:
        await self._run(self._compose_cmd(project_dir, project_name, "up", "-d", "--build"))
        return await self.container_id(project_dir, project_name)

    async def container_id(self, project_dir: Path, project_name: str) -> Optional[str]:
        try:
            out = await self._run(
                self._compose_cmd(project_dir, project_name, "ps", "-q", "app"),
                timeout=60,
            )
        except DockerCommandError:
            return None
        container_id = out.strip().splitlines()[0].strip() if out.strip() else ""
        return container_id or None

    async def down(self, project_dir: Path, project_name: str) -> None:
        try:
            await self._run(
                self._compose_cmd(project_dir, project_name, "down", "--remove-orphans", "-v"),
                timeout=300,
            )
        except DockerCommandError:
            return

    async def remove_container(self, name: str, timeout: float = 120.0) -> bool:
        """Force-stop and remove a container by name.

        Used as the belt-and-braces teardown path: ``compose down`` needs the
        project directory to still exist, so a sandbox whose directory was
        already cleaned up would otherwise leave an orphan running.

        Returns ``True`` when a container was removed, ``False`` when none
        matched (already gone — not an error for teardown).
        """
        try:
            await self._run(["docker", "rm", "-f", name], timeout=timeout)
            return True
        except DockerCommandError as exc:
            if "no such container" in (exc.stderr or "").lower():
                return False
            raise

    async def exec_in_container(
        self, container: str, args: list[str], timeout: Optional[float] = 60.0
    ) -> str:
        return await self._run(["docker", "exec", container, *args], timeout=timeout)


# ---------------------------------------------------------------------------
# docker-compose project generation
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class GeneratedProject:
    project_dir: Path
    container_port: int
    template_id: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "project_dir": str(self.project_dir),
            "container_port": self.container_port,
            "template_id": self.template_id,
        }


# ---------------------------------------------------------------------------
# Build self-healing
# ---------------------------------------------------------------------------

#: Toggle the build-failure repair pass (set ROXIRA_SELF_HEAL_BUILD=0 to disable).
SELF_HEAL_ENABLED = os.getenv("ROXIRA_SELF_HEAL_BUILD", "1") != "0"
#: Most repairs applied per failure, so a pathological log can't patch forever.
MAX_BUILD_REPAIRS = 5

#: Python import name → PyPI distribution for obvious mismatches.
PIP_DISTRIBUTION_ALIASES: dict[str, str] = {
    "yaml": "PyYAML",
    "cv2": "opencv-python-headless",
    "PIL": "Pillow",
    "sklearn": "scikit-learn",
    "bs4": "beautifulsoup4",
    "dotenv": "python-dotenv",
    "jwt": "PyJWT",
    "jose": "python-jose",
    "dateutil": "python-dateutil",
    "decouple": "python-decouple",
    "multipart": "python-multipart",
    "docx": "python-docx",
    "pptx": "python-pptx",
    "fitz": "PyMuPDF",
    "attr": "attrs",
    "nacl": "PyNaCl",
    "Crypto": "pycryptodome",
    "magic": "python-magic",
    "psycopg2": "psycopg2-binary",
    "MySQLdb": "mysqlclient",
}

#: Compiler/header hint in the log → Debian package to install in the image.
SYSTEM_PACKAGE_HINTS: tuple[tuple[str, str], ...] = (
    ("pg_config", "libpq-dev"),
    ("Python.h", "python3-dev"),
    ("ffi.h", "libffi-dev"),
    ("gcc: not found", "build-essential"),
    ("cc1: not found", "build-essential"),
    ("make: not found", "build-essential"),
    ("not found: make", "build-essential"),
    ("libjpeg", "libjpeg-dev"),
    ("libpng", "libpng-dev"),
    ("cairo", "libcairo2-dev"),
)

_NPM_ERESOLVE_RE = re.compile(
    r"npm ERR! code ERESOLVE|ERESOLVE unable to resolve dependency tree"
    r"|Could not resolve dependency:|--legacy-peer-deps",
    re.IGNORECASE,
)
_NPM_TARGET_RE = re.compile(r"No matching version found for ([@\w./\-]+)@", re.IGNORECASE)
_URL_RE = re.compile(r"https?://[^\s'\")]+")


_NPM_NOT_IN_REGISTRY_RE = re.compile(
    r"'([@\w./\-]+)@[^']*'\s+is not in (?:this|the npm) registry", re.IGNORECASE
)


def _npm_404_packages(log: str) -> list[str]:
    """Package names npm reported as missing from the registry.

    Handles both npm 404 shapes: the URL form (parsed by path, since a regex
    over the whole line would capture the registry host or a tarball filename)
    and ``npm ERR! 404 'foo@*' is not in this registry.`` which carries the name
    without any URL.
    """
    packages: list[str] = []
    for line in log.splitlines():
        if "404" not in line:
            continue
        packages.extend(_NPM_NOT_IN_REGISTRY_RE.findall(line))
        for url in _URL_RE.findall(line):
            path = url.split("//", 1)[-1]
            segments = [seg for seg in path.split("/")[1:] if seg]
            if not segments:
                continue
            if segments[0].startswith("@"):
                package = "/".join(segments[:2]) if len(segments) > 1 else segments[0]
            else:
                package = segments[0]
            package = re.sub(r"\.tgz$", "", package.split("?")[0].strip(".,"))
            if package and package not in ("@",):
                packages.append(package)
    return packages
_NPM_MISSING_RE = re.compile(r"Cannot find module '([^']+)'|Can't resolve '([^']+)'")
_PIP_PIN_RE = re.compile(
    r"(?:Could not find a version that satisfies the requirement|No matching distribution found for)"
    r"\s+([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?==([^\s,)'\"]+)",
    re.IGNORECASE,
)
_PIP_MODULE_RE = re.compile(r"(?:ModuleNotFoundError|ImportError): No module named '([A-Za-z0-9_.]+)'")
_SYSTEM_HINT_RE = re.compile(
    "|".join(re.escape(hint) for hint, _ in SYSTEM_PACKAGE_HINTS), re.IGNORECASE
)


@dataclass(slots=True)
class BuildRepair:
    """One automated fix derived from ``docker compose build`` stderr."""

    kind: str
    detail: str
    payload: dict[str, Any] = field(default_factory=dict)


def analyse_build_failure(stderr: str) -> list[BuildRepair]:
    """Derive repair actions from build stderr (pure — no filesystem access).

    Recognises the failure modes worth automating: npm peer-dependency
    conflicts, unsatisfiable/removed npm versions, missing node modules,
    unsatisfiable Python pins, missing Python distributions and missing
    compiler/header packages.  When nothing specific matches, falls back to a
    generic dependency relaxation so the single retry still has a chance.
    """
    log = stderr or ""
    repairs: list[BuildRepair] = []

    if _NPM_ERESOLVE_RE.search(log):
        repairs.append(
            BuildRepair(
                kind="npm_relax_peers",
                detail="enabled legacy peer-dependency resolution for npm",
                payload={},
            )
        )

    for package in dict.fromkeys(_NPM_TARGET_RE.findall(log)):
        repairs.append(
            BuildRepair(
                kind="npm_relax_version",
                detail=f"relaxed npm version constraint for {package}",
                payload={"package": package},
            )
        )

    for package in dict.fromkeys(_npm_404_packages(log)):
        repairs.append(
            BuildRepair(
                kind="npm_drop_missing",
                detail=f"dropped unavailable npm package {package}",
                payload={"package": package},
            )
        )

    for first, second in _NPM_MISSING_RE.findall(log):
        module = (first or second).strip()
        # Skip local/aliased paths ('./x', '@/lib/x') — not installable packages.
        if not module or module.startswith((".", "/", "@/")):
            continue
        if "/" in module and not module.startswith("@"):
            continue
        repairs.append(
            BuildRepair(
                kind="npm_add_missing",
                detail=f"added missing npm package {module}",
                payload={"package": module},
            )
        )

    for package, pin in dict.fromkeys(_PIP_PIN_RE.findall(log)):
        repairs.append(
            BuildRepair(
                kind="pip_relax_pin",
                detail=f"relaxed pinned Python requirement {package}=={pin}",
                payload={"package": package},
            )
        )

    for module in dict.fromkeys(_PIP_MODULE_RE.findall(log)):
        root = module.split(".")[0]
        repairs.append(
            BuildRepair(
                kind="pip_add_missing",
                detail=f"added missing Python distribution for {root}",
                payload={"module": root},
            )
        )

    if _SYSTEM_HINT_RE.search(log):
        packages = list(
            dict.fromkeys(
                debian for hint, debian in SYSTEM_PACKAGE_HINTS if hint.lower() in log.lower()
            )
        )
        if packages:
            repairs.append(
                BuildRepair(
                    kind="apt_system_deps",
                    detail="installed build toolchain/packages: " + ", ".join(packages),
                    payload={"packages": packages},
                )
            )

    if not repairs:
        repairs.append(
            BuildRepair(
                kind="generic_relax",
                detail="applied generic dependency relaxation (unpinned versions)",
                payload={},
            )
        )

    # De-duplicate by kind+payload, preserving detection order.
    seen: set[tuple[str, str]] = set()
    unique: list[BuildRepair] = []
    for repair in repairs:
        key = (repair.kind, json.dumps(repair.payload, sort_keys=True))
        if key in seen:
            continue
        seen.add(key)
        unique.append(repair)
    return unique[:MAX_BUILD_REPAIRS]


class ComposeProjectGenerator:
    """Renders an isolated docker-compose project for a single sandbox.

    The application source is provided by the scaffold templates in
    ``templates.py`` (``nextjs-tailwind-landing`` / ``fastapi-microservice``);
    this class selects the right template, substitutes context, and layers the
    compose file, environment metadata and network wiring on top.
    """

    def __init__(self, sandbox_root: Path, network: str = "roxira_net", attach_network: bool = True) -> None:
        self._sandbox_root = sandbox_root
        self._network = network
        self._attach_network = attach_network

    def project_dir(self, app_id: str) -> Path:
        return self._sandbox_root / app_id

    @property
    def network(self) -> str:
        return self._network

    @property
    def attach_network(self) -> bool:
        return self._attach_network

    def generate(self, request: BuildRequest, host_port: int) -> GeneratedProject:
        template: SandboxTemplate = select_template(request.target_framework)
        project_dir = self.project_dir(request.app_id)
        project_dir.mkdir(parents=True, exist_ok=True)

        generated_files = template.render(
            {
                "app_id": request.app_id,
                "app_name": request.app_name or request.app_id,
                "app_name_escaped": json.dumps(request.app_name or request.app_id)[1:-1],
                "prompt": request.prompt,
                "prompt_escaped": json.dumps(request.prompt)[1:-1],
                "target_framework": request.target_framework,
                "tier": request.tier,
                "template_id": template.template_id,
                "container_port": str(template.container_port),
            }
        )

        self._clean_previous(project_dir)

        for relative_path, content in generated_files.items():
            target = project_dir / relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")

        container_name = f"roxira_sandbox_{request.app_id}"
        image = f"roxira-sandbox-{request.app_id}:latest"
        (project_dir / "docker-compose.yml").write_text(
            self._render_compose(
                request, host_port, container_name, image, template.container_port, template.template_id
            ),
            encoding="utf-8",
        )
        (project_dir / ".roxira.env").write_text(
            "\n".join(
                [
                    f"APP_ID={request.app_id}",
                    f"TARGET_FRAMEWORK={request.target_framework}",
                    f"TEMPLATE={template.template_id}",
                    f"HOST_PORT={host_port}",
                    f"CONTAINER_PORT={template.container_port}",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

        manifest = sorted([*generated_files.keys(), "docker-compose.yml", ".roxira.env"])
        (project_dir / ".roxira.manifest").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        return GeneratedProject(
            project_dir=project_dir,
            container_port=template.container_port,
            template_id=template.template_id,
        )

    @staticmethod
    def _clean_previous(project_dir: Path) -> None:
        """Remove files from a prior generation (keeps ``.reservation``/``sandbox.json``)."""
        manifest_path = project_dir / ".roxira.manifest"
        if not manifest_path.exists():
            return
        try:
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            previous = []
        for relative_path in previous:
            stale = project_dir / str(relative_path)
            if stale.is_file():
                stale.unlink()
            elif stale.is_dir():
                shutil.rmtree(stale, ignore_errors=True)

    # -- self-healing --------------------------------------------------------

    def repair_build_failure(
        self, request: BuildRequest, project_dir: Path, stderr: str
    ) -> list[str]:
        """Patch a generated project in place from build stderr.

        Returns notes describing what was actually applied — an empty list
        means nothing could be changed (no matching manifest), so the caller
        should not waste a retry.
        """
        applied: list[str] = []
        for repair in analyse_build_failure(stderr):
            try:
                note = self._apply_repair(repair, project_dir)
            except Exception as exc:  # a bad patch must not mask the build error
                print(
                    "[factory] WARN could not apply repair %s: %s" % (repair.kind, exc),
                    file=sys.stderr,
                )
                continue
            if note:
                applied.append(note)
        print(
            "[factory] self-heal for %s: %s" % (request.app_id, "; ".join(applied) or "no change"),
            file=sys.stderr,
        )
        return applied

    def _apply_repair(self, repair: BuildRepair, project_dir: Path) -> Optional[str]:
        payload = repair.payload
        if repair.kind == "npm_relax_peers":
            return self._npm_legacy_peers(project_dir)
        if repair.kind == "npm_relax_version":
            return self._relax_npm_version(project_dir, str(payload["package"]))
        if repair.kind == "npm_drop_missing":
            return self._drop_npm_package(project_dir, str(payload["package"]))
        if repair.kind == "npm_add_missing":
            return self._add_npm_package(project_dir, str(payload["package"]))
        if repair.kind == "pip_relax_pin":
            return self._relax_pip_pin(project_dir, str(payload["package"]))
        if repair.kind == "pip_add_missing":
            return self._add_pip_distribution(project_dir, str(payload["module"]))
        if repair.kind == "apt_system_deps":
            return self._inject_system_packages(project_dir, list(payload["packages"]))
        if repair.kind == "generic_relax":
            return self._generic_relax(project_dir)
        return None

    @staticmethod
    def _read_text(path: Path) -> Optional[str]:
        try:
            return path.read_text(encoding="utf-8")
        except OSError:
            return None

    # ---- npm ----

    def _npm_legacy_peers(self, project_dir: Path) -> Optional[str]:
        package_json = project_dir / "package.json"
        if not package_json.exists():
            return None
        changed = False

        npmrc = project_dir / ".npmrc"
        desired = {
            "legacy-peer-deps=true",
            "strict-peer-dependencies=false",
            "fund=false",
            "audit=false",
        }
        current = set((self._read_text(npmrc) or "").split())
        if not desired <= current:
            npmrc.write_text("\n".join(sorted(current | desired)) + "\n", encoding="utf-8")
            changed = True

        dockerfile = project_dir / "Dockerfile"
        text = self._read_text(dockerfile)
        if text:
            # The flag is the reliable fix; the COPY is needed for npm run build
            # stages that read .npmrc.
            patched = re.sub(
                r"RUN npm (ci|install)(?! --legacy-peer-deps)",
                r"RUN npm \1 --legacy-peer-deps",
                text,
            )
            patched = re.sub(r"COPY package\.json \./", "COPY package.json .npmrc ./", patched)
            if patched != text:
                dockerfile.write_text(patched, encoding="utf-8")
                changed = True
        return "enabled legacy peer-dependency resolution for npm" if changed else None

    def _patch_package_json(self, project_dir: Path, mutate) -> Optional[str]:
        package_json = project_dir / "package.json"
        text = self._read_text(package_json)
        if text is None:
            return None
        try:
            data = json.loads(text)
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
        return mutate(data, package_json)

    def _relax_npm_version(self, project_dir: Path, package: str) -> Optional[str]:
        def mutate(data: dict, path: Path) -> Optional[str]:
            for section in ("dependencies", "devDependencies"):
                deps = data.get(section)
                if isinstance(deps, dict) and package in deps:
                    deps[package] = "*"
                    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
                    return f"relaxed npm version constraint for {package}"
            return None

        return self._patch_package_json(project_dir, mutate)

    def _drop_npm_package(self, project_dir: Path, package: str) -> Optional[str]:
        def mutate(data: dict, path: Path) -> Optional[str]:
            removed = False
            for section in ("dependencies", "devDependencies"):
                deps = data.get(section)
                if isinstance(deps, dict) and deps.pop(package, None) is not None:
                    removed = True
            if not removed:
                return None
            path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            return f"dropped unavailable npm package {package}"

        return self._patch_package_json(project_dir, mutate)

    def _add_npm_package(self, project_dir: Path, package: str) -> Optional[str]:
        def mutate(data: dict, path: Path) -> Optional[str]:
            deps = data.setdefault("dependencies", {})
            if not isinstance(deps, dict):
                return None
            if package in deps:
                return None
            deps[package] = "*"
            path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            return f"added missing npm package {package}"

        return self._patch_package_json(project_dir, mutate)

    # ---- pip / apt ----

    def _rewrite_requirements(self, project_dir: Path, mutate) -> Optional[str]:
        requirements = project_dir / "requirements.txt"
        text = self._read_text(requirements)
        if text is None:
            return None
        updated = mutate(text)
        if updated is None or updated == text:
            return None
        requirements.write_text(updated, encoding="utf-8")
        return True  # type: ignore[return-value]

    def _relax_pip_pin(self, project_dir: Path, package: str) -> Optional[str]:
        def mutate(text: str) -> Optional[str]:
            # keep extras (uvicorn[standard]) but drop the pin
            pattern = re.compile(
                r"^(\s*)" + re.escape(package) + r"(\[[^\]]*\])?==[^\s;]+",
                re.IGNORECASE | re.MULTILINE,
            )
            if not pattern.search(text):
                return None
            return pattern.sub(r"\1" + package + r"\2", text)

        changed = self._rewrite_requirements(project_dir, mutate)
        return f"relaxed pinned Python requirement {package}" if changed else None

    def _add_pip_distribution(self, project_dir: Path, module: str) -> Optional[str]:
        distribution = PIP_DISTRIBUTION_ALIASES.get(module, module)
        normalize = lambda name: re.sub(r"[-_.]+", "-", name).lower()  # noqa: E731

        def mutate(text: str) -> Optional[str]:
            for line in text.splitlines():
                name = re.split(r"[<>=!~\[;]", line.strip(), maxsplit=1)[0].strip()
                if name and normalize(name) == normalize(distribution):
                    return None
            return text.rstrip("\n") + f"\n{distribution}\n"

        changed = self._rewrite_requirements(project_dir, mutate)
        return f"added Python distribution {distribution}" if changed else None

    _APK_ALIASES = {
        "build-essential": "build-base",
        "libpq-dev": "postgresql-dev",
        "python3-dev": "python3-dev",
    }

    def _inject_system_packages(self, project_dir: Path, packages: list[str]) -> Optional[str]:
        dockerfile = project_dir / "Dockerfile"
        text = self._read_text(dockerfile)
        if text is None:
            return None
        first_from = re.search(r"^FROM\s+(\S+)", text, re.MULTILINE)
        if not first_from:
            return None
        base = first_from.group(1).lower()
        requested = list(dict.fromkeys(packages))
        if "python" in base:
            effective = requested
            anchor = "COPY requirements.txt ."
        elif "node" in base or "alpine" in base:
            # Alpine needs its own package names (build-essential → build-base)
            effective = [self._APK_ALIASES.get(p, p) for p in requested]
            anchor = "COPY package.json"
        else:
            return None

        # Idempotency must be judged on the *effective* names, otherwise an
        # Alpine image would get a duplicate apk line on every repair pass.
        installed = [p for p in effective if p not in text]
        if not installed:
            return None
        if "python" in base:
            install = (
                "RUN apt-get update && apt-get install -y --no-install-recommends "
                + " ".join(installed)
                + " && rm -rf /var/lib/apt/lists/*\n"
            )
        else:
            install = "RUN apk add --no-cache " + " ".join(installed) + "\n"

        if anchor in text:
            text = text.replace(anchor, install + anchor, 1)
        else:
            insert_at = first_from.end() + 1
            text = text[:insert_at] + install + text[insert_at:]
        dockerfile.write_text(text, encoding="utf-8")
        # report the names actually installed (Debian vs Alpine differ)
        return "installed build packages: " + ", ".join(installed)

    def _generic_relax(self, project_dir: Path) -> Optional[str]:
        """Last-resort relaxation when the log matched nothing specific."""
        notes: list[str] = []
        relaxed_pins = self._rewrite_requirements(
            project_dir,
            lambda text: re.sub(r"^(\s*[A-Za-z0-9_.\-]+)==[^\s;]+", r"\1", text, flags=re.MULTILINE),
        )
        if relaxed_pins:
            notes.append("unpinned Python requirements")
        if self._npm_legacy_peers(project_dir):
            notes.append("enabled legacy peer-dependency resolution for npm")
        return "generic relaxation: " + ", ".join(notes) if notes else None

    def _render_compose(
        self,
        request: BuildRequest,
        host_port: int,
        container_name: str,
        image: str,
        container_port: int,
        template_id: str,
    ) -> str:
        app_id = json.dumps(request.app_id)
        prompt = json.dumps(request.prompt)
        framework = json.dumps(request.target_framework)
        template = json.dumps(template_id)
        network_block = ""
        if self._attach_network:
            network_block = (
                "    networks:\n"
                f"      - {self._network}\n"
                "networks:\n"
                f"  {self._network}:\n"
                "    external: true\n"
            )
        return (
            f"name: roxira-sandbox-{request.app_id}\n"
            "services:\n"
            "  app:\n"
            "    build:\n"
            "      context: .\n"
            "      dockerfile: Dockerfile\n"
            f"    image: {image}\n"
            f"    container_name: {container_name}\n"
            "    restart: unless-stopped\n"
            "    ports:\n"
            f'      - "{host_port}:{container_port}"\n'
            "    environment:\n"
            f"      APP_ID: {app_id}\n"
            f"      BUILD_PROMPT: {prompt}\n"
            f"      TARGET_FRAMEWORK: {framework}\n"
            f"      ROXIRA_TEMPLATE: {template}\n"
            "    labels:\n"
            '      roxira.sandbox: "true"\n'
            f"      roxira.app_id: {app_id}\n"
            f"      roxira.template: {template}\n"
            f'      roxira.host_port: "{host_port}"\n'
            f"{network_block}"
        )


# ---------------------------------------------------------------------------
# Nginx route registration
# ---------------------------------------------------------------------------


class NginxRouteRegistrar:
    """Writes per-sandbox vhosts and gracefully reloads Nginx."""

    def __init__(
        self,
        conf_dir: Path = DEFAULT_NGINX_SANDBOX_DIR,
        container: str = DEFAULT_NGINX_CONTAINER,
        base_domain: str = "roxira.app",
        docker: Optional[DockerEngine] = None,
    ) -> None:
        self._conf_dir = conf_dir
        self._container = container
        self._base_domain = base_domain
        self._docker = docker or DockerEngine()

    def subdomain(self, app_id: str) -> str:
        return f"{app_id}.{self._base_domain}"

    def _conf_path(self, app_id: str) -> Path:
        return self._conf_dir / f"{app_id}.conf"

    def conf_path(self, app_id: str) -> Path:
        """Absolute path of a sandbox's vhost file."""
        return self._conf_path(app_id)

    def _render(self, app_id: str, upstream: str) -> str:
        return (
            f"# roxira sandbox vhost — {app_id}\n"
            f"# managed by ephemeral_runner.py; do not edit manually\n"
            "server {\n"
            "    listen 80;\n"
            f"    server_name {self.subdomain(app_id)};\n\n"
            "    location / {\n"
            f"        proxy_pass http://{upstream};\n"
            "        proxy_http_version 1.1;\n"
            '        proxy_set_header Host $host;\n'
            '        proxy_set_header X-Real-IP $remote_addr;\n'
            '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n'
            '        proxy_set_header X-Forwarded-Proto $scheme;\n'
            "    }\n"
            "}\n"
        )

    async def register(self, app_id: str, upstream: str) -> str:
        await asyncio.to_thread(self._conf_dir.mkdir, parents=True, exist_ok=True)
        target = self._conf_path(app_id)
        tmp = target.with_suffix(".conf.tmp")
        await asyncio.to_thread(tmp.write_text, self._render(app_id, upstream), "utf-8")
        await asyncio.to_thread(os.replace, tmp, target)
        await self.reload()
        return self.subdomain(app_id)

    async def unregister(self, app_id: str, reload: bool = True) -> bool:
        """Delete a sandbox vhost; returns True when a file was removed.

        Pass ``reload=False`` when the caller will reload once for several
        changes (teardown deletes the file *and* re-checks the config).
        """
        target = self._conf_path(app_id)
        if not target.exists():
            return False
        await asyncio.to_thread(target.unlink)
        if reload:
            await self.reload()
        return True

    async def reload(self) -> None:
        try:
            await self._docker.exec_in_container(self._container, ["nginx", "-t"])
            await self._docker.exec_in_container(self._container, ["nginx", "-s", "reload"])
        except DockerCommandError as exc:
            raise NginxReloadError(str(exc)) from exc


# ---------------------------------------------------------------------------
# Build queue transports
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class QueuedBuild:
    message_id: Optional[str]
    request: BuildRequest


class BuildQueue(Protocol):
    async def enqueue(self, request: BuildRequest) -> None: ...

    async def dequeue(self, timeout: float = 1.0) -> Optional[QueuedBuild]: ...

    async def ack(self, message: QueuedBuild) -> None: ...


class InMemoryBuildQueue:
    """Fallback transport — process-local asyncio queue."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[BuildRequest] = asyncio.Queue()

    async def enqueue(self, request: BuildRequest) -> None:
        await self._queue.put(request)

    async def dequeue(self, timeout: float = 1.0) -> Optional[QueuedBuild]:
        try:
            request = await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None
        return QueuedBuild(message_id=None, request=request)

    async def ack(self, message: QueuedBuild) -> None:
        return None


class RedisStreamBuildQueue:
    """Redis Streams transport (consumer group) for multi-worker fan-out."""

    def __init__(
        self,
        client: "AsyncRedis",
        stream: str = STREAM_KEY,
        group: str = "factory-builders",
        consumer: Optional[str] = None,
    ) -> None:
        self._client = client
        self._stream = stream
        self._group = group
        self._consumer = consumer or f"worker-{socket.gethostname()}-{uuid.uuid4().hex[:6]}"

    @classmethod
    async def from_url(cls, url: str, **kwargs: Any) -> "RedisStreamBuildQueue":
        if AsyncRedis is None:
            raise EphemeralRunnerError("redis.asyncio is not installed")
        client = AsyncRedis.from_url(url, decode_responses=True)
        queue = cls(client, **kwargs)
        await queue.ensure_group()
        return queue

    async def ensure_group(self) -> None:
        try:
            await self._client.xgroup_create(self._stream, self._group, id="0", mkstream=True)
        except Exception as exc:  # BUSYGROUP means it already exists
            if "BUSYGROUP" not in str(exc):
                raise

    async def enqueue(self, request: BuildRequest) -> None:
        await self._client.xadd(
            self._stream,
            {"payload": json.dumps(request.to_dict(), ensure_ascii=False)},
        )

    async def dequeue(self, timeout: float = 1.0) -> Optional[QueuedBuild]:
        response = await self._client.xreadgroup(
            self._group,
            self._consumer,
            {self._stream: ">"},
            count=1,
            block=int(timeout * 1000),
        )
        if not response:
            return None
        _, entries = response[0]
        if not entries:
            return None
        message_id, fields = entries[0]
        payload = json.loads(fields.get("payload") or "{}")
        return QueuedBuild(message_id=message_id, request=BuildRequest.from_dict(payload))

    async def ack(self, message: QueuedBuild) -> None:
        if message.message_id:
            await self._client.xack(self._stream, self._group, message.message_id)


async def make_build_queue() -> BuildQueue:
    redis_url = os.getenv("REDIS_URL", "").strip()
    if redis_url and AsyncRedis is not None:
        try:
            return await RedisStreamBuildQueue.from_url(redis_url)
        except Exception:
            pass
    return InMemoryBuildQueue()


def redis_configured() -> bool:
    """True when a Redis Streams transport is actually usable in this process."""
    return bool(os.getenv("REDIS_URL", "").strip()) and AsyncRedis is not None


def requires_in_process_advancement(queue: BuildQueue) -> bool:
    """True when no external worker can drain the queue, so the API must run it.

    Without ``REDIS_URL`` (or when Redis is unreachable / the client library is
    missing) ``make_build_queue`` falls back to a process-local
    :class:`InMemoryBuildQueue`.  An external worker process has its *own*
    queue instance, so nothing would ever dequeue the request and the build
    would sit in ``QUEUED`` forever.  In that topology the API process has to
    advance the build itself.
    """
    return isinstance(queue, InMemoryBuildQueue) or not redis_configured()


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


class EphemeralRunner:
    """End-to-end orchestrator: generate → build → run → register → persist."""

    def __init__(
        self,
        queue: BuildQueue,
        docker: DockerEngine,
        allocator: PortAllocator,
        generator: ComposeProjectGenerator,
        nginx: NginxRouteRegistrar,
        sandbox_root: Path,
        status_store: BuildStatusStore,
        max_concurrency: int = 2,
        poll_timeout: float = 1.0,
    ) -> None:
        self._queue = queue
        self._docker = docker
        self._allocator = allocator
        self._generator = generator
        self._nginx = nginx
        self._sandbox_root = sandbox_root
        self._status = status_store
        self._poll_timeout = poll_timeout
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._tasks: set[asyncio.Task[None]] = set()

    @classmethod
    def from_env(cls, queue: BuildQueue, status_store: BuildStatusStore) -> "EphemeralRunner":
        sandbox_root = Path(os.getenv("ROXIRA_SANDBOX_ROOT", str(DEFAULT_SANDBOX_ROOT)))
        nginx_dir = Path(os.getenv("ROXIRA_NGINX_SANDBOX_DIR", str(DEFAULT_NGINX_SANDBOX_DIR)))
        docker = DockerEngine(
            socket_path=os.getenv("ROXIRA_DOCKER_SOCKET", DEFAULT_DOCKER_SOCKET),
            compose_bin=os.getenv("ROXIRA_COMPOSE_BIN") or None,
        )
        network = os.getenv("ROXIRA_SANDBOX_NETWORK", "roxira_net")
        attach = os.getenv("ROXIRA_SANDBOX_ATTACH_NETWORK", "1") != "0"
        return cls(
            queue=queue,
            docker=docker,
            # docker-aware: the allocator asks the daemon which ports are taken
            allocator=PortAllocator(sandbox_root, docker=docker),
            generator=ComposeProjectGenerator(sandbox_root, network=network, attach_network=attach),
            nginx=NginxRouteRegistrar(
                conf_dir=nginx_dir,
                container=os.getenv("ROXIRA_NGINX_CONTAINER", DEFAULT_NGINX_CONTAINER),
                base_domain=os.getenv("ROXIRA_SANDBOX_BASE_DOMAIN", "roxira.app"),
                docker=docker,
            ),
            sandbox_root=sandbox_root,
            status_store=status_store,
            max_concurrency=int(os.getenv("ROXIRA_BUILD_CONCURRENCY", "2")),
        )

    def _write_record(self, record: SandboxRecord) -> None:
        path = self._sandbox_root / record.app_id / "sandbox.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")

    async def handle(self, request: BuildRequest) -> BuildResult:
        status = BuildStatus.from_request(request)

        if not APP_ID_RE.match(request.app_id):
            await self._status.save(status.advance(BuildStage.REJECTED, error="invalid app_id"))
            return BuildResult(app_id=request.app_id, status="rejected", error="invalid app_id")
        if not request.prompt:
            await self._status.save(status.advance(BuildStage.REJECTED, error="empty prompt"))
            return BuildResult(app_id=request.app_id, status="rejected", error="empty prompt")

        host_port = await self._allocator.allocate(request.app_id)
        project_name = f"roxira-sandbox-{request.app_id}"
        container_name = f"roxira_sandbox_{request.app_id}"

        try:
            await self._status.save(
                status.advance(
                    BuildStage.PORT_ALLOCATED,
                    host_port=host_port,
                    container_name=container_name,
                )
            )
            generated = await asyncio.to_thread(self._generator.generate, request, host_port)
            project_dir = generated.project_dir
            await self._status.save(
                status.advance(BuildStage.PROJECT_GENERATED, project_dir=str(project_dir))
            )

            try:
                if self._generator.attach_network:
                    await self._docker.ensure_network(self._generator.network)
                await self._status.save(status.advance(BuildStage.BUILDING))
                container_id = await self._build_self_healing(
                    request, project_dir, project_name, status
                )
                await self._status.save(
                    status.advance(BuildStage.CONTAINER_STARTED, container_id=container_id)
                )
                subdomain = await self._nginx.register(
                    request.app_id, f"{container_name}:{generated.container_port}"
                )
                await self._status.save(
                    status.advance(
                        BuildStage.ROUTE_REGISTERED,
                        subdomain=subdomain,
                        url=f"http://{subdomain}",
                    )
                )
            except Exception as exc:
                await self._docker.down(project_dir, project_name)
                await self._nginx.unregister(request.app_id)
                await self._status.save(
                    status.advance(BuildStage.FAILED, status="FAILED", error=str(exc))
                )
                return BuildResult(app_id=request.app_id, status="failed", error=str(exc))

            self._write_record(
                SandboxRecord(
                    app_id=request.app_id,
                    host_port=host_port,
                    project_name=project_name,
                    container_name=container_name,
                    subdomain=subdomain,
                    project_dir=str(project_dir),
                    status="running",
                )
            )
            await self._status.save(status.advance(BuildStage.RUNNING, status="RUNNING"))
            return BuildResult(
                app_id=request.app_id,
                status="running",
                host_port=host_port,
                url=f"http://{subdomain}",
                container_id=container_id,
            )
        finally:
            self._allocator.release(request.app_id, host_port)

    async def _build_self_healing(
        self, request: BuildRequest, project_dir: Path, project_name: str, status: BuildStatus
    ) -> Optional[str]:
        """Build the sandbox, repairing the project and retrying once on failure.

        On ``docker compose build`` failure the captured stderr is analysed and
        the generated project is patched in place (npm peer deps, npm/pip
        versions, missing packages, build toolchain), then the build is retried
        **once**.  If the retry also fails it is re-raised annotated with what
        was attempted, plus the original error, so the runner records FAILED
        with full context.
        """
        try:
            await self._docker.compose_build(project_dir, project_name)
        except DockerCommandError as exc:
            if not SELF_HEAL_ENABLED:
                raise
            first_error = exc
        else:
            return await self._docker.up(project_dir, project_name)

        print(
            "[factory] build failed for %s; attempting self-heal. build log tail:\n%s"
            % (request.app_id, (first_error.stderr or "").strip()[-2000:]),
            file=sys.stderr,
        )
        applied = await asyncio.to_thread(
            self._generator.repair_build_failure,
            request,
            project_dir,
            first_error.stderr or "",
        )
        if not applied:
            # Nothing patchable (unrecognised failure, no manifest to edit):
            # a blind retry would just burn another build.
            print(
                "[factory] self-heal for %s found no applicable repair; failing without retry"
                % request.app_id,
                file=sys.stderr,
            )
            raise first_error

        status.repair_attempts = 1
        status.repairs = list(applied)
        with contextlib.suppress(Exception):
            await self._status.save(status)

        try:
            await self._docker.compose_build(project_dir, project_name)
        except DockerCommandError as retry_error:
            # Rebuild the error (not a mutation of .stderr) so str(exc) — and
            # therefore the persisted FAILED reason — carries the annotation.
            raise DockerCommandError(
                retry_error.command,
                retry_error.returncode,
                (retry_error.stderr or "")
                + "\n--- roxira self-heal attempted: "
                + "; ".join(applied)
                + "\n--- original build error:\n"
                + (first_error.stderr or ""),
            ) from first_error
        return await self._docker.up(project_dir, project_name)

    async def advance_build(self, request: BuildRequest) -> BuildResult:
        """Run the full pipeline for ``request`` immediately, in-process.

        This is the fallback used by the FastAPI layer when no external queue
        daemon is running (no ``REDIS_URL``): the request is advanced through
        ``PORT_ALLOCATED`` → ``PROJECT_GENERATED`` → ``BUILDING`` →
        ``CONTAINER_STARTED`` → ``ROUTE_REGISTERED`` → ``RUNNING`` without a
        consumer process.  The same concurrency semaphore as the queue worker
        is honoured, so in-process builds can't starve the host.

        Never raises: failures are persisted as ``FAILED`` build status.
        """
        async with self._semaphore:
            try:
                return await self.handle(request)
            except Exception as exc:  # pragma: no cover - defensive
                status = BuildStatus.from_request(request)
                with contextlib.suppress(Exception):
                    await self._status.save(
                        status.advance(BuildStage.FAILED, status="FAILED", error=str(exc))
                    )
                return BuildResult(app_id=request.app_id, status="failed", error=str(exc))

    def _record_path(self, app_id: str) -> Path:
        return self._sandbox_root / app_id / "sandbox.json"

    def _read_record(self, app_id: str) -> dict[str, Any]:
        try:
            return json.loads(self._record_path(app_id).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    async def destroy(
        self, app_id: str, status: Optional[BuildStatus] = None
    ) -> dict[str, Any]:
        """Tear a sandbox down: container, port, vhost, status. Idempotent.

        Steps, in order:

        1. ``docker compose down -v`` (when the project dir still exists) plus a
           ``docker rm -f`` by container name, so an orphan survives neither a
           deleted project directory nor a broken compose file.
        2. Release the port reservation (``.reservation`` + cross-process lock).
        3. Delete the nginx vhost ``{nginx_dir}/{app_id}.conf``.
        4. Mark the build ``DESTROYED``.
        5. Graceful nginx reload.

        Never raises for a partially-reachable host: individual failures are
        collected in ``warnings`` and reported, because a leftover nginx reload
        problem must not prevent the port from being reclaimed.  Every step is
        safe to repeat.
        """
        status = status or await self._status.get(app_id)
        record = self._read_record(app_id)
        warnings: list[str] = []

        port = (status.host_port if status else None) or record.get("host_port")
        project_dir = (status.project_dir if status else None) or record.get("project_dir")
        container_name = (
            (status.container_name if status else None)
            or record.get("container_name")
            or f"roxira_sandbox_{app_id}"
        )
        project_name = record.get("project_name") or f"roxira-sandbox-{app_id}"

        # 1. stop + remove the isolated container
        if project_dir:
            try:
                await self._docker.down(Path(str(project_dir)), project_name)
            except Exception as exc:
                warnings.append("compose down failed: %s" % exc)
        container_removed = False
        try:
            container_removed = await self._docker.remove_container(container_name)
        except Exception as exc:
            warnings.append("docker rm -f %s failed: %s" % (container_name, exc))

        # 2. release the port reservation (unlinks lock + .reservation)
        released_port: Optional[int] = None
        if port:
            with contextlib.suppress(Exception):
                released_port = int(port)
            if released_port:
                self._allocator.release(app_id, released_port)

        # 3. remove the nginx sandbox vhost
        conf_path = self._nginx.conf_path(app_id)
        conf_removed = False
        try:
            conf_removed = await self._nginx.unregister(app_id, reload=False)
        except Exception as exc:
            warnings.append("nginx vhost removal failed: %s" % exc)

        # 4. drop the sandbox.json record so layer-2 reservation frees the port
        record_removed = False
        try:
            if self._record_path(app_id).exists():
                await asyncio.to_thread(self._record_path(app_id).unlink)
                record_removed = True
        except OSError as exc:
            warnings.append("could not remove sandbox record: %s" % exc)

        # 5. mark DESTROYED
        if status is not None:
            try:
                await self._status.save(status.advance(BuildStage.DESTROYED, status="DESTROYED"))
            except Exception as exc:
                warnings.append("could not persist DESTROYED status: %s" % exc)

        # 6. single graceful reload after the vhost is gone
        nginx_reloaded = False
        try:
            await self._nginx.reload()
            nginx_reloaded = True
        except Exception as exc:
            warnings.append("nginx reload failed: %s" % exc)

        return {
            "app_id": app_id,
            "status": BuildStage.DESTROYED.value,
            "stage": BuildStage.DESTROYED.value,
            "deployed": False,
            # a destroyed sandbox has no listener by definition
            "health": HEALTH_UNHEALTHY,
            "port": released_port,
            "released_port": released_port,
            "container_name": container_name,
            "container_removed": container_removed,
            "nginx_conf": str(conf_path),
            "nginx_conf_removed": conf_removed,
            "nginx_reloaded": nginx_reloaded,
            "record_removed": record_removed,
            "warnings": warnings,
        }

    async def _process(self, message: QueuedBuild) -> None:
        async with self._semaphore:
            try:
                await self.handle(message.request)
            except Exception:
                pass
            finally:
                await self._queue.ack(message)

    async def run_forever(self, stop: Optional[asyncio.Event] = None) -> None:
        while stop is None or not stop.is_set():
            message = await self._queue.dequeue(timeout=self._poll_timeout)
            if message is None:
                continue
            task = asyncio.create_task(self._process(message))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def shutdown(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)


# ---------------------------------------------------------------------------
# Optional FastAPI integration
# ---------------------------------------------------------------------------

try:  # optional — only required when the FastAPI router is mounted
    from pydantic import BaseModel as _PydanticBaseModel
except Exception:  # pragma: no cover - optional dependency
    _PydanticBaseModel = None  # type: ignore[assignment]

try:  # optional — used as a route parameter annotation, so it must live here.
    # NOTE: ``from __future__ import annotations`` turns route annotations into
    # strings that FastAPI resolves against *module* globals; a function-local
    # import would be invisible and the parameter would be misread as a query
    # param. Hence the module-level (optional) import.
    from fastapi import BackgroundTasks as BackgroundTasks  # noqa: PLC0414
except Exception:  # pragma: no cover - optional dependency
    BackgroundTasks = None  # type: ignore[assignment, misc]


if _PydanticBaseModel is not None:

    class SynthesizeAppRequest(_PydanticBaseModel):  # type: ignore[misc, valid-type]
        """Request body for the foundry build endpoints."""

        app_name: Optional[str] = None
        app_id: Optional[str] = None
        specification: Optional[str] = None
        prompt: Optional[str] = None
        target_framework: str = "FastAPI"
        tier: str = "STANDARD"
        requested_by: Optional[str] = None

else:  # pragma: no cover - worker-only environments
    SynthesizeAppRequest = None  # type: ignore[assignment]


def create_factory_router(
    queue: Optional[BuildQueue] = None,
    status_store: Optional[BuildStatusStore] = None,
):
    """Return an ``APIRouter`` wiring the Software Foundry endpoints.

    Routes (prefix ``/api/v1/factory``):
      * ``POST /synthesize-app``           — enqueue a build, ``202``
      * ``POST /synthesize``               — alias of the above
      * ``GET  /synthesize-app/{app_id}``  — read live runner state

    The queue and status store are resolved lazily on first request, so the
    router can be mounted without blocking import (Redis is optional).

    Transport selection:

      * ``REDIS_URL`` configured → the request is pushed onto Redis Streams and
        drained by the standalone worker process (``python -m
        ephemeral_runner``); the API stays stateless.
      * No ``REDIS_URL`` → ``make_build_queue`` yields a process-local
        ``InMemoryBuildQueue`` that no external daemon can ever see.  In that
        topology the API advances the build itself through
        ``EphemeralRunner.advance_build`` as a FastAPI ``BackgroundTask``,
        so the job progresses PORT_ALLOCATED → … → RUNNING without a queue
        daemon.  The response is still ``202`` and returns immediately.
    """
    from fastapi import APIRouter, HTTPException, status

    if SynthesizeAppRequest is None:
        raise EphemeralRunnerError("pydantic is required to build the factory router")

    router = APIRouter(prefix="/api/v1/factory", tags=["Roxira Software Foundry"])
    resolved_queue: Optional[BuildQueue] = queue
    resolved_store: Optional[BuildStatusStore] = status_store
    in_process_runner: Optional[EphemeralRunner] = None
    runner_lock = asyncio.Lock()

    async def _get_queue() -> BuildQueue:
        nonlocal resolved_queue
        if resolved_queue is None:
            resolved_queue = await make_build_queue()
        return resolved_queue

    async def _get_store() -> BuildStatusStore:
        nonlocal resolved_store
        if resolved_store is None:
            resolved_store = await make_status_store()
        return resolved_store

    async def _get_runner() -> EphemeralRunner:
        """Lazily build the single orchestrator shared by this router.

        Used for in-process build advancement *and* for sandbox teardown, which
        is always local to the API process regardless of queue topology.
        """
        nonlocal in_process_runner
        if in_process_runner is None:
            async with runner_lock:
                if in_process_runner is None:
                    in_process_runner = EphemeralRunner.from_env(
                        await _get_queue(), await _get_store()
                    )
        return in_process_runner

    async def _enqueue(
        payload: "SynthesizeAppRequest", background_tasks: BackgroundTasks
    ) -> dict[str, Any]:
        request = BuildRequest.from_dict(payload.model_dump())
        if not request.prompt:
            raise HTTPException(status_code=422, detail="specification is required")
        store = await _get_store()
        await store.save(BuildStatus.from_request(request).advance(BuildStage.QUEUED))
        build_queue = await _get_queue()
        await build_queue.enqueue(request)

        # No external worker can drain a process-local queue — run it here.
        if requires_in_process_advancement(build_queue):
            runner = await _get_runner()
            background_tasks.add_task(runner.advance_build, request)

        return {
            "status": "QUEUED",
            "stage": BuildStage.QUEUED.value,
            "app_id": request.app_id,
            "app_name": request.app_name,
            "poll": f"/api/v1/factory/synthesize-app/{request.app_id}",
            "execution": (
                "in-process"
                if requires_in_process_advancement(build_queue)
                else "redis-streams"
            ),
        }

    @router.post("/synthesize-app", status_code=status.HTTP_202_ACCEPTED)
    async def synthesize_app(
        payload: SynthesizeAppRequest, background_tasks: BackgroundTasks
    ) -> dict[str, Any]:
        return await _enqueue(payload, background_tasks)

    @router.post("/synthesize", status_code=status.HTTP_202_ACCEPTED)
    async def synthesize(
        payload: SynthesizeAppRequest, background_tasks: BackgroundTasks
    ) -> dict[str, Any]:
        return await _enqueue(payload, background_tasks)

    @router.get("/synthesize-app/{app_id}")
    async def synthesize_status(app_id: str) -> dict[str, Any]:
        store = await _get_store()
        build_status = await store.get(app_id)
        if build_status is None:
            raise HTTPException(status_code=404, detail=f"unknown app_id: {app_id}")
        return build_status.to_dict()

    @router.get("/sandboxes")
    async def list_sandboxes() -> list[dict[str, Any]]:
        """List every known sandbox/build with live health.

        Each row carries app_id, status, port, subdomain, timestamps and a
        ``health`` of ``HEALTHY``/``UNHEALTHY``/``STARTING``, determined by an
        HTTP probe of ``http://127.0.0.1:{port}/`` (1.5s budget).  Probes run
        concurrently, so a listing costs ~one timeout rather than one per row.

        Reads straight from the status store (filesystem or Redis), so it works
        identically for in-process and externally-drained builds.  Newest first.
        """
        store = await _get_store()
        lister = getattr(store, "list_all", None)
        if lister is None:  # custom/injected store without listing support
            print(
                "[factory] WARN status store %s has no list_all(); "
                "/sandboxes returning []" % type(store).__name__,
                file=sys.stderr,
            )
            return []
        statuses = await lister()
        probes = asyncio.Semaphore(HEALTH_PROBE_CONCURRENCY)

        async def row(status: BuildStatus) -> dict[str, Any]:
            async with probes:
                health = await sandbox_health(status)
            return sandbox_summary(status, health=health)

        # gather preserves the store's newest-first order
        return list(await asyncio.gather(*(row(s) for s in statuses)))

    @router.delete("/sandboxes/{app_id}")
    async def destroy_sandbox(app_id: str) -> dict[str, Any]:
        """Stop and remove a sandbox and release everything it holds.

        Removes the container, the port reservation, the nginx vhost
        (``/opt/roxira_platform/nginx/sandboxes/{app_id}.conf``), marks the
        build ``DESTROYED`` and reloads nginx.  Repeat calls are a no-op.
        """
        store = await _get_store()
        build_status = await store.get(app_id)
        if build_status is None:
            raise HTTPException(status_code=404, detail=f"unknown app_id: {app_id}")
        if build_status.stage == BuildStage.DESTROYED.value:
            return {
                **sandbox_summary(build_status),
                "already_destroyed": True,
                "warnings": [],
            }
        runner = await _get_runner()
        return await runner.destroy(app_id, build_status)

    return router


async def _amain() -> None:
    queue = await make_build_queue()
    status_store = await make_status_store()
    runner = EphemeralRunner.from_env(queue, status_store)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)

    await runner.run_forever(stop)
    await runner.shutdown()


if __name__ == "__main__":
    asyncio.run(_amain())

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
    "PortAllocator",
    "ComposeProjectGenerator",
    "GeneratedProject",
    "NginxRouteRegistrar",
    "InMemoryBuildQueue",
    "RedisStreamBuildQueue",
    "make_build_queue",
    "redis_configured",
    "requires_in_process_advancement",
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


class BuildStatusStore(Protocol):
    async def save(self, status: BuildStatus) -> None: ...

    async def get(self, app_id: str) -> Optional[BuildStatus]: ...


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


class PortAllocator:
    """Allocates a free TCP port within [start, end] while avoiding collisions.

    Reservations are persisted as ``{app_id}/.reservation`` so that multiple
    worker processes sharing the sandbox root don't hand out the same port.
    """

    def __init__(self, sandbox_root: Path, start: int = PORT_RANGE_START, end: int = PORT_RANGE_END) -> None:
        self._sandbox_root = sandbox_root
        self._start = start
        self._end = end
        self._lock = asyncio.Lock()
        self._in_flight: set[int] = set()

    def _reservation_path(self, app_id: str) -> Path:
        return self._sandbox_root / app_id / ".reservation"

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
        return reserved

    @staticmethod
    def _is_bindable(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("0.0.0.0", port))
                return True
            except OSError:
                return False

    async def allocate(self, app_id: str, preferred: Optional[int] = None) -> int:
        async with self._lock:
            reserved = self.reserved_ports() | self._in_flight
            candidates = (
                [preferred] if preferred and self._start <= preferred <= self._end else []
            ) + list(range(self._start, self._end + 1))
            for port in candidates:
                if port in reserved:
                    continue
                if await asyncio.to_thread(self._is_bindable, port):
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
        with contextlib.suppress(FileNotFoundError, OSError):
            self._reservation_path(app_id).unlink()


# ---------------------------------------------------------------------------
# Docker engine (host daemon over the unix socket)
# ---------------------------------------------------------------------------


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

    async def ensure_network(self, network: str) -> None:
        try:
            await self._run(["docker", "network", "inspect", network], timeout=30)
            return
        except DockerCommandError:
            pass
        await self._run(["docker", "network", "create", network], timeout=60)

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

    async def unregister(self, app_id: str) -> None:
        target = self._conf_path(app_id)
        if target.exists():
            await asyncio.to_thread(target.unlink)
            await self.reload()

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
            allocator=PortAllocator(sandbox_root),
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
                container_id = await self._docker.build_and_up(project_dir, project_name)
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

    async def _get_in_process_runner() -> EphemeralRunner:
        """Lazily build the single in-process orchestrator for this router."""
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
            runner = await _get_in_process_runner()
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

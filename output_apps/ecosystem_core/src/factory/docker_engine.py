"""Resilient Docker access helpers for the Roxira Software Foundry.

The foundry runs on hosts with differing layouts (Docker Desktop, distro
packages, snap, docker-compose v1/v2 plugins).  This module resolves the
``docker`` / ``docker compose`` binaries and the daemon socket across those
layouts, and offers an optional python-docker SDK fallback so a build never
fails *silently* just because a standalone binary path differs.

Nothing here imports the optional ``docker`` SDK at module import time; the SDK
is only probed lazily via :func:`sdk_available` / :func:`sdk_client`.
"""

from __future__ import annotations

import os
import shutil
import socket
from dataclasses import dataclass, field
from typing import Any, Optional

__all__ = [
    "DockerDiagnostics",
    "resolve_docker_binary",
    "resolve_compose_binary",
    "resolve_docker_socket",
    "socket_reachable",
    "sdk_available",
    "sdk_client",
    "sdk_network_exists",
    "sdk_ping",
]

DOCKER_BIN_CANDIDATES: tuple[str, ...] = (
    "docker",
    "/usr/bin/docker",
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/snap/bin/docker",
)

COMPOSE_BIN_CANDIDATES: tuple[str, ...] = (
    "docker-compose",
    "/usr/local/bin/docker-compose",
    "/opt/homebrew/bin/docker-compose",
    "/usr/bin/docker-compose",
)

SOCKET_CANDIDATES: tuple[str, ...] = (
    "/var/run/docker.sock",
    "/run/docker.sock",
)


def _usable(path: str) -> bool:
    if os.path.sep in path:
        return os.path.isfile(path) and os.access(path, os.X_OK)
    return shutil.which(path) is not None


def _first_usable(candidates: tuple[str, ...]) -> Optional[str]:
    for candidate in candidates:
        if _usable(candidate):
            return candidate
    return None


def resolve_docker_binary() -> str:
    """Absolute/relative path to the docker CLI, across common host layouts."""
    override = os.getenv("ROXIRA_DOCKER_BIN", "").strip()
    if override and _usable(override):
        return override
    return _first_usable(DOCKER_BIN_CANDIDATES) or "docker"


def resolve_compose_binary(override: Optional[str] = None) -> str:
    """Resolve the compose invocation (``docker compose`` v2 or ``docker-compose``)."""
    explicit = (override or os.getenv("ROXIRA_COMPOSE_BIN", "")).strip()
    if explicit:
        return explicit
    docker_bin = resolve_docker_binary()
    if _usable(docker_bin):
        # Prefer the modern CLI plugin; the caller falls back on failure.
        return f"{docker_bin} compose"
    legacy = _first_usable(COMPOSE_BIN_CANDIDATES)
    return legacy or "docker-compose"


def resolve_docker_socket(explicit: Optional[str] = None) -> str:
    """Resolve the daemon unix socket path (honours ``DOCKER_HOST``)."""
    env = os.getenv("DOCKER_HOST", "").strip()
    if env.startswith("unix://"):
        return env[len("unix://") :]
    if explicit and os.path.exists(explicit):
        return explicit
    for candidate in SOCKET_CANDIDATES:
        if os.path.exists(candidate):
            return candidate
    return explicit or SOCKET_CANDIDATES[0]


def socket_reachable(path: str, timeout: float = 2.0) -> bool:
    """True when a unix socket accepts a connection (daemon present)."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect(path)
            return True
    except OSError:
        return False


def sdk_available() -> bool:
    """True when the optional ``docker`` python SDK can be imported."""
    try:
        import docker  # noqa: F401
    except Exception:
        return False
    return True


def sdk_client(socket_path: Optional[str] = None) -> Optional[Any]:
    """Return a python-docker client bound to ``socket_path`` (or ``None``)."""
    try:
        import docker
    except Exception:
        return None
    try:
        if socket_path:
            return docker.DockerClient(base_url=f"unix://{socket_path}", timeout=30)
        return docker.from_env()
    except Exception:
        return None


def sdk_network_exists(network: str, socket_path: Optional[str] = None) -> bool:
    """True when ``network`` exists, using the SDK (best-effort)."""
    client = sdk_client(socket_path)
    if client is None:
        return False
    try:
        client.networks.get(network)
        return True
    except Exception:
        return False
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass


def sdk_ping(socket_path: Optional[str] = None) -> bool:
    """Daemon liveness via the SDK (best-effort fallback for the CLI ping)."""
    client = sdk_client(socket_path)
    if client is None:
        return False
    try:
        return bool(client.ping())
    except Exception:
        return False
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass


@dataclass
class DockerDiagnostics:
    """Structured capture of a failed docker invocation for self-healing."""

    command: str
    returncode: int
    stderr: str = ""
    fallback: Optional[str] = None
    recovered: bool = False
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "command": self.command,
            "returncode": self.returncode,
            "stderr": self.stderr,
            "fallback": self.fallback,
            "recovered": self.recovered,
            "notes": list(self.notes),
        }

"""Docker execution transport for the Roxira Software Foundry.

Every command the foundry issues against Docker (``docker compose build``,
``docker ps``, ``docker exec … nginx -t``, …) is routed through a
:class:`RemoteHostDispatcher`.  The dispatcher resolves a *logical* node
identifier — the ``target_host`` field carried on a build payload — to a
concrete :class:`HostNode`, then executes the command through one of three
transports:

``local``
    The command runs on the API/worker host against its own Docker daemon
    (``DOCKER_HOST=unix:///var/run/docker.sock``).  This is the default: a
    request with no ``target_host`` behaves exactly as before.

``ssh``
    The command is wrapped in ``ssh -i <key> <user>@<host>`` and executed on a
    remote worker node, using *that* node's Docker daemon.  Non-interactive
    (``BatchMode=yes``) so a missing key fails fast instead of hanging the
    build, and the sandbox project path is translated through the node's
    ``work_root`` so a project generated under the local sandbox root is
    addressed at its remote equivalent.

``context``
    ``docker`` runs locally but is pointed at a named Docker context (or, when
    the value looks like a URL, ``DOCKER_HOST``) — the idiomatic way to reach a
    remote engine that already has a context configured.

Design notes
------------
* The module is dependency-light: standard library only, so it can be imported
  by the worker process, the FastAPI layer and tests alike.
* It deliberately does **not** import :mod:`ephemeral_runner` (which imports
  this module) — errors therefore carry the same ``command`` / ``returncode`` /
  ``stderr`` attributes as :class:`ephemeral_runner.DockerCommandError`, and the
  engine adapts them.
* Node inventory can be supplied programmatically (``register``) or through the
  ``ROXIRA_FACTORY_HOSTS`` environment variable, letting a deployment scale to
  external worker nodes without a code change.
"""

from __future__ import annotations

import asyncio
import json
import os
import shlex
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional

__all__ = [
    "DEFAULT_LOCAL_HOST_ID",
    "DISPATCH_MODE_LOCAL",
    "DISPATCH_MODE_SSH",
    "DISPATCH_MODE_CONTEXT",
    "HostNode",
    "DispatchError",
    "UnknownHostError",
    "DispatchTimeoutError",
    "RemoteHostDispatcher",
    "parse_hosts_env",
]

#: ``host_id`` reserved for the node the API/worker itself runs on.
DEFAULT_LOCAL_HOST_ID = "local"

DISPATCH_MODE_LOCAL = "local"
DISPATCH_MODE_SSH = "ssh"
DISPATCH_MODE_CONTEXT = "context"

#: Environment variable holding a JSON (or shorthand) node inventory.
HOSTS_ENV = "ROXIRA_FACTORY_HOSTS"
#: Environment variable naming which ``host_id`` is considered "local".
LOCAL_HOST_ID_ENV = "ROXIRA_LOCAL_HOST_ID"

#: A value of ``docker_context`` starting with one of these is treated as a
#: ``DOCKER_HOST`` URL rather than a named context.
_DOCKER_URL_SCHEMES = ("ssh://", "tcp://", "unix://", "npipe://")


class DispatchError(RuntimeError):
    """Raised when a command cannot be dispatched to its target node."""

    def __init__(self, message: str, *, command: str = "", returncode: int = -1,
                 stderr: str = "") -> None:
        self.command = command
        self.returncode = returncode
        self.stderr = stderr
        super().__init__(message)


class UnknownHostError(DispatchError):
    """Raised when ``target_host`` names a node the dispatcher does not know."""


class DispatchTimeoutError(DispatchError):
    """Raised when a dispatched command exceeds its timeout."""


# ---------------------------------------------------------------------------
# Node model
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class HostNode:
    """A place Docker commands can be executed.

    ``host_id`` is the logical name referenced by ``payload.target_host`` (e.g.
    ``"worker-1"``); ``host_ip`` is the address the command is actually sent to.
    A node with ``is_local=True`` is the host the foundry itself runs on and is
    always addressable as ``"local"``.  Remote nodes are reached either over SSH
    (``ssh_user`` + ``ssh_key_path``) or through a pre-configured Docker context.
    """

    host_id: str
    host_ip: str = "127.0.0.1"
    ssh_user: Optional[str] = None
    ssh_key_path: Optional[str] = None
    is_local: bool = False
    #: SSH port (ignored for local / context nodes).
    ssh_port: int = 22
    #: Named Docker context, or a ``DOCKER_HOST``-style URL, for context mode.
    docker_context: Optional[str] = None
    #: Base directory on the remote node holding generated sandbox projects;
    #: when set, local sandbox paths are rewritten under it for remote runs.
    work_root: Optional[str] = None
    #: Extra ``ssh`` options, e.g. ``("-o", "ProxyJump=bastion")``.
    ssh_options: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_remote(self) -> bool:
        return not self.is_local

    @property
    def ssh_target(self) -> Optional[str]:
        if not self.ssh_user:
            return None
        return f"{self.ssh_user}@{self.host_ip}"

    @classmethod
    def local(cls, host_id: str = DEFAULT_LOCAL_HOST_ID) -> "HostNode":
        """The implicit node representing this very host."""
        return cls(host_id=host_id or DEFAULT_LOCAL_HOST_ID, host_ip="127.0.0.1", is_local=True)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "HostNode":
        """Build a node from decoded JSON / payload data (unknown keys ignored)."""
        raw_options = data.get("ssh_options") or ()
        if isinstance(raw_options, str):
            raw_options = tuple(shlex.split(raw_options))
        options = tuple(str(part) for part in raw_options)
        node = cls(
            host_id=str(data.get("host_id") or data.get("id") or "").strip(),
            host_ip=str(data.get("host_ip") or data.get("ip") or "127.0.0.1").strip(),
            ssh_user=(str(data["ssh_user"]).strip() if data.get("ssh_user") else None),
            ssh_key_path=(
                str(data["ssh_key_path"]).strip() if data.get("ssh_key_path") else None
            ),
            is_local=bool(data.get("is_local", False)),
            ssh_port=int(data.get("ssh_port") or 22),
            docker_context=(
                str(data["docker_context"]).strip() if data.get("docker_context") else None
            ),
            work_root=(str(data["work_root"]).strip() if data.get("work_root") else None),
            ssh_options=options,
        )
        if not node.host_id:
            raise DispatchError("host definition is missing 'host_id'")
        return node

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["is_remote"] = self.is_remote
        return data


# ---------------------------------------------------------------------------
# Environment-driven inventory
# ---------------------------------------------------------------------------


def parse_hosts_env(raw: str) -> list[HostNode]:
    """Decode a ``ROXIRA_FACTORY_HOSTS`` value into nodes.

    Two shapes are accepted, so a quick deployment does not need JSON:

    * JSON — ``[{"host_id": "worker-1", "host_ip": "10.0.0.5",
      "ssh_user": "root", "ssh_key_path": "/root/.ssh/id_ed25519"}]``
    * shorthand — comma/whitespace separated ``id=user@ip:port`` entries, e.g.
      ``worker-1=root@10.0.0.5:22,worker-2=deploy@10.0.0.6``.  A missing user
      yields a context-less remote node with no transport, which
      :meth:`RemoteHostDispatcher.mode` will reject at dispatch time.

    Malformed entries are skipped with a warning rather than aborting startup.
    """
    text = (raw or "").strip()
    if not text:
        return []
    if text[0] in "[{":
        try:
            decoded = json.loads(text)
        except ValueError as exc:
            print("[dispatcher] WARN invalid %s JSON: %s" % (HOSTS_ENV, exc), file=sys.stderr)
            return []
        if isinstance(decoded, dict):
            decoded = [decoded]
        nodes: list[HostNode] = []
        for entry in decoded if isinstance(decoded, list) else []:
            if not isinstance(entry, dict):
                continue
            try:
                nodes.append(HostNode.from_dict(entry))
            except DispatchError as exc:
                print("[dispatcher] WARN skipped host: %s" % exc, file=sys.stderr)
        return nodes

    nodes = []
    for token in (t for t in raw.replace(",", " ").split() if t):
        try:
            name, _, spec = token.partition("=")
            if not spec:
                raise DispatchError("expected 'host_id=user@host[:port]', got %r" % token)
            user = None
            host = spec
            if "@" in spec:
                user, _, host = spec.partition("@")
            port = 22
            if ":" in host:
                host, _, raw_port = host.partition(":")
                port = int(raw_port or 22)
            nodes.append(
                HostNode(
                    host_id=name.strip(),
                    host_ip=host.strip(),
                    ssh_user=user.strip() or None,
                    ssh_port=port,
                )
            )
        except (DispatchError, ValueError) as exc:
            print("[dispatcher] WARN skipped host %r: %s" % (token, exc), file=sys.stderr)
    return [node for node in nodes if node.host_id]


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------


class RemoteHostDispatcher:
    """Resolves ``target_host`` values and executes Docker commands accordingly.

    The dispatcher is transport-only: it never mutates the command (beyond
    prefixing SSH and rewriting a remote working directory), so the same
    ``DockerEngine`` code path drives a local daemon, a worker node over SSH, or
    a named Docker context.
    """

    def __init__(
        self,
        hosts: Iterable[HostNode] = (),
        *,
        local_host: Optional[HostNode] = None,
        local_sandbox_root: Optional[Path] = None,
        ssh_binary: str = "ssh",
        default_timeout: float = 900.0,
        ssh_connect_timeout: float = 15.0,
    ) -> None:
        self._ssh_binary = ssh_binary
        self._default_timeout = default_timeout
        self._ssh_connect_timeout = ssh_connect_timeout
        self._local_root = Path(local_sandbox_root) if local_sandbox_root else None
        self._local = local_host or HostNode.local()
        self._hosts: dict[str, HostNode] = {self._local.host_id: self._local}
        for node in hosts:
            self.register(node)

    # -- registry ----------------------------------------------------------

    @property
    def local_node(self) -> HostNode:
        return self._local

    @property
    def hosts(self) -> list[HostNode]:
        return list(self._hosts.values())

    def register(self, node: HostNode) -> HostNode:
        """Add or replace a node in the inventory (idempotent by ``host_id``)."""
        self._hosts[node.host_id] = node
        return node

    def get(self, host_id: str) -> Optional[HostNode]:
        return self._hosts.get((host_id or "").strip())

    def resolve(self, target_host: Optional[str], *, fallback_to_local: bool = True) -> HostNode:
        """Map a logical ``target_host`` onto a registered node.

        Accepts a ``host_id`` (``"worker-1"``), a literal IP (``"10.0.0.5"``) or
        an SSH target (``"root@10.0.0.5"``).  ``None`` / ``""`` / ``"local"``
        resolve to this host.  An unknown *explicit* target raises
        :class:`UnknownHostError` — silently building on the wrong machine would
        be worse than failing — unless ``fallback_to_local`` is set.
        """
        value = (target_host or "").strip()
        if not value or value.lower() in {DEFAULT_LOCAL_HOST_ID, "localhost", "self"}:
            return self._local
        exact = self._hosts.get(value)
        if exact is not None:
            return exact
        for node in self._hosts.values():
            if value == node.host_ip or value == node.ssh_target:
                return node
        if fallback_to_local:
            print(
                "[dispatcher] WARN unknown target_host %r; falling back to local" % value,
                file=sys.stderr,
            )
            return self._local
        raise UnknownHostError(
            "unknown target_host %r (known: %s)"
            % (value, ", ".join(sorted(self._hosts)) or "none")
        )

    def resolve_or_raise(self, target_host: Optional[str]) -> HostNode:
        """Like :meth:`resolve` but never silently degrades to the local node."""
        return self.resolve(target_host, fallback_to_local=False)

    # -- transport selection ----------------------------------------------

    @staticmethod
    def mode(node: HostNode) -> str:
        """Which transport drives ``node``: ``local``, ``ssh`` or ``context``."""
        if node.is_local:
            return DISPATCH_MODE_LOCAL
        if node.ssh_user:
            return DISPATCH_MODE_SSH
        if node.docker_context:
            return DISPATCH_MODE_CONTEXT
        raise DispatchError(
            "node %r is remote but defines neither 'ssh_user' nor 'docker_context'"
            % node.host_id
        )

    def describe(self, node: HostNode) -> dict[str, Any]:
        """Observability view of how ``node`` will be dispatched."""
        mode = self.mode(node)
        return {
            "host_id": node.host_id,
            "host_ip": node.host_ip,
            "mode": mode,
            "is_local": node.is_local,
            "ssh_target": node.ssh_target if mode == DISPATCH_MODE_SSH else None,
            "docker_context": node.docker_context if mode == DISPATCH_MODE_CONTEXT else None,
            "work_root": node.work_root,
        }

    # -- working directory translation ------------------------------------

    def translate_cwd(self, node: HostNode, cwd: Optional[Path | str]) -> Optional[str]:
        """Rewrite a local sandbox path into the node's own filesystem layout.

        A project generated under ``/opt/roxira_platform/data/sandboxes/{app_id}``
        on the API host lives at ``{node.work_root}/{app_id}`` on a worker node
        that mounts/synchronises the same tree elsewhere.  Paths outside the
        local sandbox root are passed through untouched.
        """
        if cwd is None:
            return None
        text = str(cwd)
        if node.is_local or not node.work_root or self._local_root is None:
            return text
        try:
            relative = Path(text).resolve().relative_to(self._local_root.resolve())
        except (ValueError, OSError):
            return text
        return str(Path(node.work_root) / relative)

    def _ssh_prefix(self, node: HostNode) -> list[str]:
        argv = [self._ssh_binary, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"]
        argv += ["-o", "ConnectTimeout=%d" % int(self._ssh_connect_timeout)]
        if node.ssh_key_path:
            argv += ["-i", node.ssh_key_path]
        if node.ssh_port and int(node.ssh_port) != 22:
            argv += ["-p", str(int(node.ssh_port))]
        argv += list(node.ssh_options)
        argv.append(node.ssh_target or node.host_ip)
        return argv

    def build_argv(
        self, node: HostNode, args: list[str], cwd: Optional[Path | str] = None
    ) -> list[str]:
        """Translate ``args`` (a full ``docker …`` argv) for ``node``."""
        mode = self.mode(node)
        if mode == DISPATCH_MODE_LOCAL:
            return list(args)
        if mode == DISPATCH_MODE_CONTEXT:
            return list(args)
        remote_cwd = self.translate_cwd(node, cwd)
        remote_command = shlex.join(list(args))
        if remote_cwd:
            remote_command = "cd %s && %s" % (shlex.quote(remote_cwd), remote_command)
        return [*self._ssh_prefix(node), remote_command]

    def build_env(
        self, node: HostNode, extra_env: Optional[dict[str, str]] = None
    ) -> dict[str, str]:
        """Environment for the dispatched process.

        Local runs inherit ``extra_env`` (which carries the sandbox's
        ``DOCKER_HOST``); remote runs deliberately *drop* any local
        ``DOCKER_HOST`` / ``DOCKER_CONTEXT`` so the command talks to the remote
        daemon instead of being tunneled back to this host, and context runs
        pin the node's own context/URL.
        """
        base = {**os.environ, **(extra_env or {})}
        mode = self.mode(node)
        if mode == DISPATCH_MODE_LOCAL:
            return base
        base.pop("DOCKER_HOST", None)
        base.pop("DOCKER_CONTEXT", None)
        if mode == DISPATCH_MODE_CONTEXT and node.docker_context:
            if node.docker_context.startswith(_DOCKER_URL_SCHEMES):
                base["DOCKER_HOST"] = node.docker_context
            else:
                base["DOCKER_CONTEXT"] = node.docker_context
        return base

    # -- execution ---------------------------------------------------------

    async def run(
        self,
        node: HostNode,
        args: list[str],
        *,
        cwd: Optional[Path | str] = None,
        timeout: Optional[float] = None,
        env: Optional[dict[str, str]] = None,
    ) -> str:
        """Execute ``args`` on ``node`` and return stdout.

        Raises :class:`DispatchTimeoutError` on timeout and
        :class:`DispatchError` (carrying ``command``/``returncode``/``stderr``)
        on a non-zero exit, a missing binary, or an unreachable node.
        """
        argv = self.build_argv(node, args, cwd)
        run_env = self.build_env(node, env)
        # The working directory only applies when the process itself runs
        # locally; for SSH the remote command carries its own ``cd``.
        local_cwd = (
            str(cwd) if cwd is not None and self.mode(node) == DISPATCH_MODE_LOCAL else None
        )
        budget = timeout or self._default_timeout
        display = " ".join(argv)
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                cwd=local_cwd,
                env=run_env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            raise DispatchError(
                "cannot dispatch to %s: %s" % (node.host_id, exc),
                command=display,
                returncode=127,
                stderr=str(exc),
            ) from exc
        except OSError as exc:
            raise DispatchError(
                "cannot dispatch to %s: %s" % (node.host_id, exc),
                command=display,
                stderr=str(exc),
            ) from exc

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=budget)
        except asyncio.TimeoutError as exc:
            proc.kill()
            try:
                await proc.wait()
            except Exception:  # pragma: no cover - defensive
                pass
            raise DispatchTimeoutError(
                "command on %s timed out after %ss: %s" % (node.host_id, budget, display),
                command=display,
                returncode=-1,
                stderr="timed out after %ss" % budget,
            ) from exc

        if proc.returncode != 0:
            raise DispatchError(
                "command failed (%s) on %s: %s" % (proc.returncode, node.host_id, display),
                command=display,
                returncode=proc.returncode or 1,
                stderr=stderr.decode(errors="replace"),
            )
        return stdout.decode(errors="replace")

    # -- construction helpers ---------------------------------------------

    @classmethod
    def from_env(
        cls, *, local_sandbox_root: Optional[Path | str] = None
    ) -> "RemoteHostDispatcher":
        """Build a dispatcher from ``ROXIRA_*`` environment configuration.

        * ``ROXIRA_FACTORY_HOSTS`` — JSON or shorthand node inventory.
        * ``ROXIRA_LOCAL_HOST_ID`` — which ``host_id`` is "this host".
        * ``ROXIRA_SSH_BIN`` — alternative ``ssh`` binary.
        * ``ROXIRA_SANDBOX_ROOT`` — used to derive path translation for remotes.
        """
        raw = os.getenv(HOSTS_ENV, "")
        nodes = parse_hosts_env(raw)
        local_id = (os.getenv(LOCAL_HOST_ID_ENV) or DEFAULT_LOCAL_HOST_ID).strip()
        local_host = HostNode.local(local_id)
        remaining: list[HostNode] = []
        for node in nodes:
            if node.host_id == local_id or node.is_local:
                # An inventory entry may pin the local node's address/work root.
                local_host = HostNode(
                    host_id=node.host_id or local_id,
                    host_ip=node.host_ip or "127.0.0.1",
                    is_local=True,
                    work_root=node.work_root,
                )
            else:
                remaining.append(node)
        root = local_sandbox_root or os.getenv("ROXIRA_SANDBOX_ROOT")
        return cls(
            remaining,
            local_host=local_host,
            local_sandbox_root=Path(root) if root else None,
            ssh_binary=os.getenv("ROXIRA_SSH_BIN", "ssh"),
        )


if __name__ == "__main__":  # pragma: no cover - manual inspection helper
    dispatcher = RemoteHostDispatcher.from_env()
    for host in dispatcher.hosts:
        print(json.dumps(dispatcher.describe(host), ensure_ascii=False))

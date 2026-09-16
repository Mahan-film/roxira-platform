"""MCP (Model Context Protocol) Tool Server for the Roxira Software Foundry.

Exposes the foundry and the legal vector store as MCP *tools*, so any MCP
client (Claude Desktop, an IDE agent, the Roxira control plane) can drive the
platform over a single protocol:

======================  ==========================================================
tool                    purpose
======================  ==========================================================
``synthesize_app``      queue a build (``app_name``, ``specification``, ``tier``,
                        ``target_framework`` [+ ``target_host``]) — returns an
                        ``app_id`` immediately, exactly like ``POST
                        /api/v1/factory/synthesize-app``.
``get_sandbox_status``  live runner state for one ``app_id`` (stage, port,
                        subdomain, health, failures).
``teardown_sandbox``    stop/remove a sandbox, release its port and vhost.
``list_sandboxes``      inventory with live health, newest first, ``limit``ed.
``query_legal_vector_db`` semantic/lexical retrieval over Qdrant legal
                        collections (``iran_laws_bge_m3``, ``judicial_precedents``,
                        ``software_factory_code_vectors``).
======================  ==========================================================

Two transports are implemented, both carrying plain JSON-RPC 2.0:

``stdio``
    ``python -m mcp_server`` speaks newline-delimited JSON-RPC on stdin/stdout —
    the transport MCP hosts launch a subprocess with.  No third-party MCP SDK is
    required.

``SSE``
    :func:`create_mcp_router` returns a FastAPI router exposing
    ``GET /mcp/sse`` (the event stream, whose first event announces the message
    endpoint), ``POST /mcp/messages`` (client → server) and ``POST /mcp`` (a
    stateless one-shot JSON-RPC call, handy for curl/health checks).

Every method of :class:`McpToolServer` is transport-agnostic
(:meth:`McpToolServer.handle_message`), so a new transport only needs to feed it
decoded messages.

Design notes
------------
* Dependency-light: stdlib only, except for the optional FastAPI router and an
  optional ``httpx`` (with a ``urllib`` fallback) for Qdrant.
* Tool *execution* is delegated to the same objects the HTTP API uses — the
  build queue, the status store and an :class:`~ephemeral_runner.EphemeralRunner`
  — so MCP and REST never diverge.
* ``query_legal_vector_db`` degrades in three steps (embedding search → lexical
  payload ranking → static legal corpus) so a caller always receives a usable
  answer instead of a transport error when Qdrant or an embedding endpoint is
  unreachable.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from typing import Any, Optional

try:  # optional — the standard MCP HTTP transports
    from fastapi import APIRouter, Request
    from fastapi.responses import JSONResponse, StreamingResponse
except Exception:  # pragma: no cover - stdio-only environments
    APIRouter = None  # type: ignore[assignment]
    Request = None  # type: ignore[assignment]
    JSONResponse = None  # type: ignore[assignment]
    StreamingResponse = None  # type: ignore[assignment]

try:  # optional — richer HTTP client for Qdrant
    import httpx
except Exception:  # pragma: no cover - stdlib fallback is used instead
    httpx = None  # type: ignore[assignment]

try:  # the foundry orchestrator this server exposes
    from .ephemeral_runner import (
        BuildRequest,
        BuildStage,
        BuildStatus,
        DockerEngine,  # noqa: F401  (re-exported for callers/tests)
        EphemeralRunner,
        FileBuildStatusStore,
        HEALTH_STARTING,
        PortAllocator,  # noqa: F401
        make_build_queue,
        make_status_store,
        requires_in_process_advancement,
        sandbox_health,
        sandbox_summary,
    )
except ImportError:  # pragma: no cover - direct script execution
    from ephemeral_runner import (  # type: ignore[no-redef]
        BuildRequest,
        BuildStage,
        BuildStatus,
        DockerEngine,  # noqa: F401
        EphemeralRunner,
        FileBuildStatusStore,
        HEALTH_STARTING,
        PortAllocator,  # noqa: F401
        make_build_queue,
        make_status_store,
        requires_in_process_advancement,
        sandbox_health,
        sandbox_summary,
    )

__all__ = [
    "MCP_PROTOCOL_VERSION",
    "SERVER_NAME",
    "SERVER_VERSION",
    "TOOL_SPECS",
    "JsonRpcError",
    "MethodNotFound",
    "InvalidParams",
    "LegalVectorStore",
    "FoundryFacade",
    "McpToolServer",
    "create_mcp_router",
    "serve_stdio",
]

MCP_PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "roxira-software-foundry"
SERVER_VERSION = "1.0.0"

# JSON-RPC 2.0 standard error codes.
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

#: Qdrant collections the legal tool is allowed to read.
LEGAL_COLLECTIONS: tuple[str, ...] = (
    "iran_laws_bge_m3",
    "judicial_precedents",
    "software_factory_code_vectors",
)
DEFAULT_LEGAL_COLLECTION = os.getenv("ROXIRA_LEGAL_COLLECTION", LEGAL_COLLECTIONS[0])
#: Optional embedding endpoint: POST {"text": ...} -> {"vector": [...]}. Without
#: it the legal tool ranks Qdrant payloads lexically instead of by vector.
EMBEDDING_URL_ENV = "ROXIRA_EMBED_URL"
#: Rows fetched per search before the response is trimmed to ``limit``.
LEGAL_SCROLL_LIMIT = int(os.getenv("ROXIRA_LEGAL_SCROLL_LIMIT", "256"))


class JsonRpcError(Exception):
    """A JSON-RPC error that must be reported to the client."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        self.code = code
        self.message = message
        self.data = data
        super().__init__(message)

    def to_dict(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.data is not None:
            error["data"] = self.data
        return error


class MethodNotFound(JsonRpcError):
    def __init__(self, method: str) -> None:
        super().__init__(METHOD_NOT_FOUND, f"method not found: {method}")


class InvalidParams(JsonRpcError):
    def __init__(self, message: str) -> None:
        super().__init__(INVALID_PARAMS, message)


# ---------------------------------------------------------------------------
# Tool catalogue
# ---------------------------------------------------------------------------

TOOL_SPECS: tuple[dict[str, Any], ...] = (
    {
        "name": "synthesize_app",
        "description": (
            "Synthesize and deploy a new application from a natural-language "
            "specification. Queues a build on the Roxira Software Foundry and "
            "returns an app_id immediately; poll get_sandbox_status for progress. "
            "Tier AUTO/AUTONOMOUS_SWARM runs the hierarchical multi-agent pipeline."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app_name": {
                    "type": "string",
                    "description": "Human name; also derives the app_id/subdomain.",
                },
                "specification": {
                    "type": "string",
                    "description": "What to build, in natural language (the build prompt).",
                },
                "tier": {
                    "type": "string",
                    "description": "Build tier, e.g. STANDARD or AUTONOMOUS_SWARM.",
                    "default": "STANDARD",
                },
                "target_framework": {
                    "type": "string",
                    "description": "Backend framework of the generated app.",
                    "default": "FastAPI",
                },
                "target_host": {
                    "type": "string",
                    "description": (
                        "Optional worker node to build on (host_id or IP); "
                        "defaults to the primary host. See GET /api/v1/factory/nodes."
                    ),
                },
            },
            "required": ["app_name", "specification"],
        },
    },
    {
        "name": "get_sandbox_status",
        "description": (
            "Return the live runner state of one sandbox: stage, status, port, "
            "subdomain/url, route, health, swarm QA score and any failure reason."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app_id": {"type": "string", "description": "Sandbox identifier."},
            },
            "required": ["app_id"],
        },
    },
    {
        "name": "teardown_sandbox",
        "description": (
            "Stop and remove a sandbox: container, port reservation and nginx "
            "vhost, marking it DESTROYED. Idempotent."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app_id": {"type": "string", "description": "Sandbox identifier."},
            },
            "required": ["app_id"],
        },
    },
    {
        "name": "list_sandboxes",
        "description": (
            "List sandboxes with live health (HEALTHY/UNHEALTHY/STARTING), "
            "newest first."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of rows to return (default 50).",
                    "default": 50,
                },
            },
            "required": [],
        },
    },
    {
        "name": "query_legal_vector_db",
        "description": (
            "Search the Roxira legal vector database (Qdrant) for statutes, "
            "judicial precedents or generated-code vectors. Uses embeddings when "
            "configured, otherwise ranks stored payloads lexically."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural-language or keyword query.",
                },
                "collection_name": {
                    "type": "string",
                    "description": "Qdrant collection to search.",
                    "default": DEFAULT_LEGAL_COLLECTION,
                    "enum": list(LEGAL_COLLECTIONS),
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum results (default 5).",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    },
)

_TOOL_NAMES = tuple(spec["name"] for spec in TOOL_SPECS)


# ---------------------------------------------------------------------------
# Legal vector store
# ---------------------------------------------------------------------------


class LegalVectorStore:
    """Read-only access to the Qdrant legal collections.

    Three progressively weaker strategies keep the tool useful on a partially
    configured host:

    1. **embedding** — ``ROXIRA_EMBED_URL`` turns the query into a vector that
       Qdrant searches natively (requires the collection to hold vectors).
    2. **lexical** — ``scroll`` a page of points and rank them locally by query
       token overlap, so retrieval still works without an embedding service.
    3. **corpus fallback** — when Qdrant is unreachable, defer to the static
       :class:`LegalMCPTools` corpus if importable, otherwise report
       ``unavailable`` with the connection error (never raise at the tool edge).
    """

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[str] = None,
        timeout: float = 10.0,
    ) -> None:
        self._host = host or os.getenv("QDRANT_HOST", "roxira_qdrant_prod")
        self._port = str(port or os.getenv("QDRANT_PORT", "6333"))
        self._timeout = timeout

    @property
    def base_url(self) -> str:
        return f"http://{self._host}:{self._port}"

    # -- HTTP --------------------------------------------------------------

    async def _request(
        self, method: str, path: str, payload: Optional[dict[str, Any]] = None
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        if httpx is not None:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.request(method, url, json=payload)
                response.raise_for_status()
                return response.json()
        return await asyncio.to_thread(self._urlopen, method, url, payload)

    @staticmethod
    def _urlopen(method: str, url: str, payload: Optional[dict[str, Any]]) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(url, data=body, method=method)
        if body is not None:
            request.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(request, timeout=10.0) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8") or "{}")

    async def _embed(self, query: str) -> Optional[list[float]]:
        url = os.getenv(EMBEDDING_URL_ENV, "").strip()
        if not url:
            return None
        try:
            if httpx is not None:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    response = await client.post(url, json={"text": query, "input": query})
                    response.raise_for_status()
                    data = response.json()
            else:
                data = await asyncio.to_thread(self._urlopen, "POST", url, {"text": query})
        except Exception as exc:
            print("[mcp] WARN embedding service unavailable: %s" % exc, file=sys.stderr)
            return None
        vector = data.get("vector") or data.get("embedding") or data.get("data")
        if isinstance(vector, dict):  # OpenAI-ish shape
            vector = vector.get("embedding")
        return vector if isinstance(vector, list) and vector else None

    # -- retrieval ---------------------------------------------------------

    @staticmethod
    def _payload_text(payload: Any) -> str:
        if isinstance(payload, str):
            return payload
        if not isinstance(payload, dict):
            return ""
        for key in ("text", "content", "article", "body", "summary", "title", "name"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value
        return json.dumps(payload, ensure_ascii=False)[:1000]

    @staticmethod
    def _tokens(text: str) -> list[str]:
        cleaned = "".join(ch if ch.isalnum() else " " for ch in (text or "").lower())
        return [token for token in cleaned.split() if len(token) > 1]

    def _rank(self, query: str, points: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Lexical score = fraction of query tokens present in the payload."""
        query_tokens = set(self._tokens(query))
        scored: list[dict[str, Any]] = []
        for point in points:
            payload = point.get("payload") or {}
            text = self._payload_text(payload)
            hits = sum(1 for token in query_tokens if token in text.lower())
            score = (hits / len(query_tokens)) if query_tokens else 0.0
            scored.append(
                {
                    "id": point.get("id"),
                    "score": round(float(score), 4),
                    "text": text,
                    "payload": payload,
                }
            )
        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored

    async def search(
        self,
        query: str,
        collection_name: str = DEFAULT_LEGAL_COLLECTION,
        limit: int = 5,
    ) -> dict[str, Any]:
        """Search ``collection_name`` and always return a JSON-serialisable dict."""
        query = (query or "").strip()
        collection = (collection_name or DEFAULT_LEGAL_COLLECTION).strip()
        limit = max(1, int(limit or 5))
        result: dict[str, Any] = {
            "status": "success",
            "query": query,
            "collection": collection,
            "limit": limit,
            "backend": None,
            "count": 0,
            "results": [],
            "known_collections": list(LEGAL_COLLECTIONS),
        }
        if not query:
            result.update(status="error", error="query is required")
            return result

        # 1. native vector search (only when an embedding service is configured)
        vector = await self._embed(query)
        if vector is not None:
            try:
                response = await self._request(
                    "POST",
                    f"/collections/{collection}/points/search",
                    {"vector": vector, "limit": limit, "with_payload": True},
                )
                hits = response.get("result") or []
                result.update(
                    backend="embedding",
                    count=len(hits),
                    results=[
                        {
                            "id": hit.get("id"),
                            "score": round(float(hit.get("score") or 0.0), 4),
                            "text": self._payload_text(hit.get("payload")),
                            "payload": hit.get("payload") or {},
                        }
                        for hit in hits
                    ],
                )
                return result
            except Exception as exc:
                result["vector_error"] = str(exc)
                print("[mcp] WARN vector search failed: %s" % exc, file=sys.stderr)

        # 2. lexical ranking over a page of stored points
        try:
            response = await self._request(
                "POST",
                f"/collections/{collection}/points/scroll",
                {"limit": limit, "with_payload": True, "with_vector": False},
            )
            points = (response.get("result") or {}).get("points") or []
            ranked = self._rank(query, points)[:limit]
            result.update(
                backend="lexical",
                count=len(ranked),
                scanned=len(points),
                results=ranked,
            )
            if not points:
                result["note"] = "collection is empty or does not exist"
            return result
        except Exception as exc:
            result["qdrant_error"] = str(exc)

        # 3. static corpus fallback so the tool stays informative offline
        fallback = await self._static_fallback(query)
        result.update(status=fallback.get("status", "fallback"), backend="fallback")
        result["results"] = [fallback]
        result["count"] = 1
        return result

    @staticmethod
    async def _static_fallback(query: str) -> dict[str, Any]:
        """Best-effort answer when Qdrant is unreachable."""
        for module_name in ("legal_mcp_tools",):
            try:
                module = __import__(module_name)  # type: ignore[import-not-found]
            except Exception:
                continue
            tools = getattr(module, "LegalMCPTools", None)
            if tools is None:
                continue
            try:
                answer = tools.query_legal_knowledge(query)  # type: ignore[attr-defined]
                if asyncio.iscoroutine(answer):
                    answer = await answer
                return {"id": None, "score": 0.0, "text": json.dumps(answer, ensure_ascii=False),
                        "payload": answer}
            except Exception:
                continue
        return {
            "id": None,
            "score": 0.0,
            "text": (
                "Legal vector database unreachable and no static legal corpus is "
                "available in this process."
            ),
            "payload": {"status": "unavailable", "query": query},
        }


# ---------------------------------------------------------------------------
# Foundry facade (shared by the tools)
# ---------------------------------------------------------------------------


class FoundryFacade:
    """Thin async adapter over the Software Foundry's queue/store/runner.

    Everything is resolved lazily (Redis and the sandbox root are optional), and
    the same objects are reused for every tool call, so MCP builds land in the
    same status store that ``/api/v1/factory/sandboxes`` reads.
    """

    #: Cap on status rows returned by ``list_sandboxes`` when asked for more.
    MAX_LIST_LIMIT = 500

    def __init__(
        self,
        queue: Any = None,
        status_store: Any = None,
        runner: Optional[EphemeralRunner] = None,
        legal: Optional[LegalVectorStore] = None,
        sandbox_root: Optional[Any] = None,
    ) -> None:
        self._queue = queue
        self._store = status_store
        self._runner = runner
        self._legal = legal or LegalVectorStore()
        self._sandbox_root = sandbox_root
        self._lock = asyncio.Lock()
        #: In-process advancement tasks (kept referenced so they cannot be GC'd).
        self._tasks: set[asyncio.Task[Any]] = set()

    # -- lazy singletons ---------------------------------------------------

    async def queue(self) -> Any:
        if self._queue is None:
            self._queue = await make_build_queue()
        return self._queue

    async def store(self) -> Any:
        if self._store is None:
            if self._sandbox_root is not None:
                self._store = FileBuildStatusStore(self._sandbox_root)
            else:
                self._store = await make_status_store()
        return self._store

    async def runner(self) -> EphemeralRunner:
        if self._runner is None:
            async with self._lock:
                if self._runner is None:
                    self._runner = EphemeralRunner.from_env(await self.queue(), await self.store())
        return self._runner

    # -- tools -------------------------------------------------------------

    async def synthesize_app(
        self,
        app_name: str = "",
        specification: str = "",
        tier: str = "STANDARD",
        target_framework: str = "FastAPI",
        target_host: Optional[str] = None,
    ) -> dict[str, Any]:
        """Queue a build; returns as soon as it is accepted (never blocks on it)."""
        prompt = (specification or "").strip()
        if not prompt:
            raise InvalidParams("specification is required")
        request = BuildRequest.from_dict(
            {
                "app_name": app_name or None,
                "specification": prompt,
                "tier": tier or "STANDARD",
                "target_framework": target_framework or "FastAPI",
                "target_host": target_host or None,
            }
        )
        store = await self.store()
        await store.save(BuildStatus.from_request(request).advance(BuildStage.QUEUED))
        queue = await self.queue()
        await queue.enqueue(request)
        in_process = requires_in_process_advancement(queue)
        if in_process:
            # No external worker can drain a process-local queue: advance here.
            runner = await self.runner()
            task = asyncio.create_task(runner.advance_build(request))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        return {
            "status": "QUEUED",
            "stage": BuildStage.QUEUED.value,
            "app_id": request.app_id,
            "app_name": request.app_name,
            "target_framework": request.target_framework,
            "tier": request.tier,
            "target_host": request.target_host,
            "execution": "in-process" if in_process else "redis-streams",
            "poll": f"/api/v1/factory/synthesize-app/{request.app_id}",
            "hint": "call get_sandbox_status with this app_id until stage is RUNNING",
        }

    async def get_sandbox_status(self, app_id: str) -> dict[str, Any]:
        app_id = (app_id or "").strip()
        if not app_id:
            raise InvalidParams("app_id is required")
        store = await self.store()
        status = await store.get(app_id)
        if status is None:
            raise InvalidParams(f"unknown app_id: {app_id}")
        payload = status.to_dict()
        payload["health"] = await sandbox_health(status)
        return payload

    async def teardown_sandbox(self, app_id: str) -> dict[str, Any]:
        app_id = (app_id or "").strip()
        if not app_id:
            raise InvalidParams("app_id is required")
        store = await self.store()
        status = await store.get(app_id)
        runner = await self.runner()
        if status is None:
            # Still attempt the teardown: a partially-recorded sandbox may hold
            # a container/port/vhost that must be reclaimed.
            report = await runner.destroy(app_id, None)
            report["note"] = f"no status record for {app_id}; teardown attempted anyway"
            return report
        if status.stage == BuildStage.DESTROYED.value:
            return {**sandbox_summary(status), "already_destroyed": True, "warnings": []}
        return await runner.destroy(app_id, status)

    async def list_sandboxes(self, limit: int = 50) -> dict[str, Any]:
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            limit = 50
        limit = max(1, min(limit, self.MAX_LIST_LIMIT))
        store = await self.store()
        lister = getattr(store, "list_all", None)
        statuses = await lister() if lister is not None else []
        selected = statuses[:limit]
        rows = [sandbox_summary(s, health=await sandbox_health(s)) for s in selected]
        return {"count": len(rows), "total": len(statuses), "limit": limit, "sandboxes": rows}

    async def query_legal_vector_db(
        self, query: str, collection_name: str = DEFAULT_LEGAL_COLLECTION, limit: int = 5
    ) -> dict[str, Any]:
        return await self._legal.search(query, collection_name, limit)

    # -- dispatch ----------------------------------------------------------

    async def call(self, name: str, arguments: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        """Execute tool ``name`` with ``arguments`` and return its JSON result."""
        arguments = arguments or {}
        if name == "synthesize_app":
            return await self.synthesize_app(**arguments)
        if name == "get_sandbox_status":
            return await self.get_sandbox_status(**arguments)
        if name == "teardown_sandbox":
            return await self.teardown_sandbox(**arguments)
        if name == "list_sandboxes":
            return await self.list_sandboxes(**arguments)
        if name == "query_legal_vector_db":
            return await self.query_legal_vector_db(**arguments)
        raise MethodNotFound(f"tool: {name}")


# ---------------------------------------------------------------------------
# Protocol server
# ---------------------------------------------------------------------------


class McpToolServer:
    """JSON-RPC 2.0 / MCP endpoint implementation (transport-agnostic)."""

    def __init__(
        self,
        facade: Optional[FoundryFacade] = None,
        name: str = SERVER_NAME,
        version: str = SERVER_VERSION,
    ) -> None:
        self.facade = facade or FoundryFacade()
        self.name = name
        self.version = version
        self.initialized = False

    # -- MCP methods -------------------------------------------------------

    def _initialize(self, params: dict[str, Any]) -> dict[str, Any]:
        self.initialized = True
        return {
            "protocolVersion": params.get("protocolVersion") or MCP_PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": self.name, "version": self.version},
        }

    @staticmethod
    def _tools_list(params: dict[str, Any]) -> dict[str, Any]:
        return {"tools": [dict(spec) for spec in TOOL_SPECS]}

    async def _tools_call(self, params: dict[str, Any]) -> dict[str, Any]:
        name = params.get("name")
        if not name:
            raise InvalidParams("tool name is required")
        arguments = params.get("arguments") or {}
        if not isinstance(arguments, dict):
            raise InvalidParams("tool arguments must be an object")
        if name not in _TOOL_NAMES:
            raise MethodNotFound(f"tool: {name}")
        try:
            result = await self.facade.call(name, arguments)
        except JsonRpcError:
            raise
        except TypeError as exc:  # unknown/misspelled argument for the tool
            return self._tool_error(f"invalid arguments for {name}: {exc}")
        except Exception as exc:
            return self._tool_error(f"{type(exc).__name__}: {exc}")
        return self._tool_result(result)

    @staticmethod
    def _tool_result(result: Any) -> dict[str, Any]:
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(result, ensure_ascii=False, indent=2, default=str),
                }
            ],
            "isError": False,
        }

    @staticmethod
    def _tool_error(message: str) -> dict[str, Any]:
        return {"content": [{"type": "text", "text": message}], "isError": True}

    # -- dispatch ----------------------------------------------------------

    async def dispatch(self, method: str, params: Optional[dict[str, Any]]) -> Any:
        """Execute a single MCP method, raising :class:`JsonRpcError` on failure."""
        params = params or {}
        if method == "initialize":
            return self._initialize(params)
        if method in ("notifications/initialized", "initialized"):
            self.initialized = True
            return {}
        if method == "ping":
            return {}
        if method == "tools/list":
            return self._tools_list(params)
        if method == "tools/call":
            return await self._tools_call(params)
        if method in ("foundry/list_nodes", "nodes/list"):
            runner = await self.facade.runner()
            return {"nodes": runner.node_summary()}
        raise MethodNotFound(method)

    async def handle_message(self, message: Any) -> Optional[dict[str, Any]]:
        """Handle one decoded JSON-RPC message (or batch) and return the reply.

        Returns ``None`` for notifications (no ``id``), per JSON-RPC 2.0.
        """
        if isinstance(message, list):
            replies = [reply for reply in
                       [await self.handle_message(item) for item in message] if reply is not None]
            return replies or None  # type: ignore[return-value]
        if not isinstance(message, dict):
            return self._error_response(None, JsonRpcError(INVALID_REQUEST, "invalid request"))

        request_id = message.get("id")
        method = message.get("method")
        is_notification = request_id is None
        if not isinstance(method, str) or not method:
            if is_notification:
                return None
            return self._error_response(
                request_id, JsonRpcError(INVALID_REQUEST, "missing method")
            )
        if is_notification:
            with contextlib.suppress(Exception):
                await self.dispatch(method, message.get("params"))
            return None
        try:
            result = await self.dispatch(method, message.get("params"))
        except JsonRpcError as exc:
            return self._error_response(request_id, exc)
        except Exception as exc:  # never leak a traceback into the transport
            return self._error_response(
                request_id,
                JsonRpcError(INTERNAL_ERROR, f"{type(exc).__name__}: {exc}"),
            )
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    @staticmethod
    def _error_response(request_id: Any, error: JsonRpcError) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": request_id, "error": error.to_dict()}

    @staticmethod
    def parse_error() -> dict[str, Any]:
        return McpToolServer._error_response(None, JsonRpcError(PARSE_ERROR, "parse error"))

    async def handle_line(self, line: str) -> Optional[str]:
        """Decode, handle and re-encode a single JSON-RPC line."""
        text = (line or "").strip()
        if not text:
            return None
        try:
            message = json.loads(text)
        except ValueError:
            return json.dumps(self.parse_error())
        reply = await self.handle_message(message)
        if reply is None:
            return None
        return json.dumps(reply, ensure_ascii=False, default=str)


# ---------------------------------------------------------------------------
# stdio transport
# ---------------------------------------------------------------------------


async def serve_stdio(
    server: Optional[McpToolServer] = None,
    reader: Any = None,
    writer: Any = None,
) -> None:
    """Serve newline-delimited JSON-RPC on ``reader``/``writer`` until EOF.

    Defaults to the process's stdin/stdout, which is how an MCP host launches
    this module (``python -m mcp_server``).  Diagnostics go to stderr only —
    stdout is reserved for protocol frames.
    """
    server = server or McpToolServer()
    print("[mcp] %s %s ready on stdio" % (server.name, server.version), file=sys.stderr)

    # A blocking ``readline`` in a worker thread is the portable way to pump
    # stdin: asyncio's pipe transports do not support regular files on every
    # platform.  ``reader``/``writer`` may be injected (used by tests).
    loop = asyncio.get_running_loop()
    read = reader.readline if reader is not None else sys.stdin.readline

    async def emit(text: str) -> None:
        if writer is not None:
            result = writer.write(text)
            if asyncio.iscoroutine(result):  # a StreamWriter-style sink
                await result
            drain = getattr(writer, "drain", None)
            if drain is not None:
                with contextlib.suppress(Exception):
                    await drain()
            return
        sys.stdout.write(text)
        sys.stdout.flush()

    while True:
        line = await loop.run_in_executor(None, read)
        if not line:
            break
        if isinstance(line, bytes):
            line = line.decode("utf-8", errors="replace")
        reply = await server.handle_line(line)
        if reply is None:
            continue
        await emit(reply + "\n")


# ---------------------------------------------------------------------------
# SSE transport (FastAPI)
# ---------------------------------------------------------------------------

#: Heartbeat so intermediaries keep an idle SSE stream open.
SSE_KEEPALIVE_SECONDS = float(os.getenv("ROXIRA_MCP_SSE_KEEPALIVE", "15"))


def create_mcp_router(server: Optional[McpToolServer] = None):
    """Return a FastAPI ``APIRouter`` serving MCP over HTTP.

    Routes (prefix ``/mcp``):
      * ``GET  /sse``      — SSE stream; first event announces ``/mcp/messages``
        (with a ``session_id``), later events carry JSON-RPC replies.
      * ``POST /messages`` — client → server JSON-RPC; the reply is pushed onto
        that session's SSE stream (``202 Accepted``).
      * ``POST /``         — stateless one-shot JSON-RPC call returning the
        reply directly (curl-friendly, and how tests drive the router).
    """
    if APIRouter is None:  # pragma: no cover - stdio-only environments
        raise RuntimeError("fastapi is required to build the MCP SSE router")

    mcp = server or McpToolServer()
    router = APIRouter(prefix="/mcp", tags=["Roxira MCP"])
    sessions: dict[str, "asyncio.Queue[Optional[str]]"] = {}

    @router.get("/sse")
    async def sse_stream(request: Request) -> Any:
        session_id = uuid.uuid4().hex
        queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
        sessions[session_id] = queue

        async def event_stream():
            try:
                # 1. tell the client where to POST its requests
                yield f"event: endpoint\ndata: /mcp/messages?session_id={session_id}\n\n"
                while True:
                    try:
                        payload = await asyncio.wait_for(
                            queue.get(), timeout=SSE_KEEPALIVE_SECONDS
                        )
                    except asyncio.TimeoutError:
                        yield ": keepalive\n\n"
                        continue
                    if payload is None:
                        break
                    yield f"event: message\ndata: {payload}\n\n"
            finally:
                sessions.pop(session_id, None)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    @router.post("/messages")
    async def messages(request: Request, session_id: Optional[str] = None) -> Any:
        try:
            message = await request.json()
        except Exception:
            return JSONResponse(mcp.parse_error(), status_code=400)
        reply = await mcp.handle_message(message)
        if reply is None:
            return JSONResponse({"status": "accepted"}, status_code=202)
        queue = sessions.get(session_id or "")
        if queue is None:
            # No live SSE stream (session-less caller): answer inline.
            return JSONResponse(reply)
        await queue.put(json.dumps(reply, ensure_ascii=False, default=str))
        return JSONResponse({"status": "accepted", "session_id": session_id}, status_code=202)

    @router.post("")
    @router.post("/")
    async def rpc(request: Request) -> Any:
        """Stateless JSON-RPC endpoint — reply returned in the HTTP body."""
        try:
            message = await request.json()
        except Exception:
            return JSONResponse(mcp.parse_error(), status_code=400)
        reply = await mcp.handle_message(message)
        if reply is None:
            return JSONResponse({"status": "accepted"}, status_code=202)
        return JSONResponse(reply)

    @router.get("/tools")
    async def tools() -> dict[str, Any]:
        """Convenience (non-protocol) listing of the exposed tools."""
        return {"server": mcp.name, "version": mcp.version, "tools": list(_TOOL_NAMES)}

    return router


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


async def _amain() -> None:
    server = McpToolServer()
    await serve_stdio(server)


def main(argv: Optional[list[str]] = None) -> int:
    """CLI entrypoint: stdio by default, ``--http`` to serve SSE via uvicorn."""
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--http" in argv:
        if APIRouter is None:  # pragma: no cover - optional dependency
            print("[mcp] fastapi is required for --http", file=sys.stderr)
            return 2
        import uvicorn
        from fastapi import FastAPI

        app = FastAPI(title="Roxira MCP Tool Server")
        app.include_router(create_mcp_router())
        host = os.getenv("ROXIRA_MCP_HOST", "0.0.0.0")
        port = int(os.getenv("ROXIRA_MCP_PORT", "8770"))
        print("[mcp] serving SSE on http://%s:%d/mcp/sse" % (host, port), file=sys.stderr)
        uvicorn.run(app, host=host, port=port)
        return 0
    asyncio.run(_amain())
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

"""Hierarchical multi-agent code generator for the Roxira Software Foundry.

Pipeline (``SwarmStage``)::

    ARCHITECT_RESEARCH -> SCHEMA_DESIGN -> BACKEND_GENERATION
                       -> FRONTEND_GENERATION -> QA_EVALUATION

The **architect** turns a high-level prompt ("Cloud Accounting ERP") into an
OpenAPI 3.1 contract plus a folder blueprint by querying an OpenRouter-hosted
LLM.  The contract is then the single source of truth: the schema designer
derives the tables from ``components.schemas``, and the backend and
frontend workers emit FastAPI routers and Next.js pages *strictly* from the
paths/schemas in that document — no worker is allowed to invent an endpoint.
The generated routers talk to a project-local SQLite file through an injected
SQLAlchemy ``AsyncSession`` (``app/db.py``), and the schema is created on
startup with ``Base.metadata.create_all``.

Everything degrades deterministically: with no ``OPENROUTER_API_KEY`` (or an
unusable LLM reply) the architect falls back to a built-in domain blueprint, so
the pipeline is testable offline and never blocks a build on a third party.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

__all__ = [
    "SwarmStage",
    "SwarmError",
    "OpenRouterError",
    "Artifact",
    "SwarmBlueprint",
    "QaReport",
    "SwarmResult",
    "OpenRouterClient",
    "ArchitectAgent",
    "SchemaDesigner",
    "BackendWorker",
    "FrontendWorker",
    "QaEvaluator",
    "SwarmOrchestrator",
    "AUTONOMOUS_SWARM_TIER",
    "is_swarm_tier",
    "run_swarm_blueprint",
]

#: Tier name that routes a synthesize request through this orchestrator.
AUTONOMOUS_SWARM_TIER = "AUTONOMOUS_SWARM"

DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_OPENROUTER_MODEL = os.getenv("ROXIRA_SWARM_MODEL", "anthropic/claude-sonnet-5")
SWARM_TIMEOUT_SECONDS = float(os.getenv("ROXIRA_SWARM_TIMEOUT", "120"))
SWARM_MAX_TOKENS = int(os.getenv("ROXIRA_SWARM_MAX_TOKENS", "4096"))
SWARM_LLM_ENABLED = os.getenv("ROXIRA_SWARM_LLM", "1") != "0"


def is_swarm_tier(tier: Optional[str]) -> bool:
    """True when ``tier`` selects the autonomous swarm pipeline."""
    return (tier or "").strip().upper() in {AUTONOMOUS_SWARM_TIER, "SWARM", "AUTONOMOUS"}


class SwarmStage(str, Enum):
    """Ordered pipeline stages of the hierarchical generator."""

    ARCHITECT_RESEARCH = "ARCHITECT_RESEARCH"
    SCHEMA_DESIGN = "SCHEMA_DESIGN"
    BACKEND_GENERATION = "BACKEND_GENERATION"
    FRONTEND_GENERATION = "FRONTEND_GENERATION"
    QA_EVALUATION = "QA_EVALUATION"
    DONE = "DONE"
    FAILED = "FAILED"


PIPELINE: tuple[SwarmStage, ...] = (
    SwarmStage.ARCHITECT_RESEARCH,
    SwarmStage.SCHEMA_DESIGN,
    SwarmStage.BACKEND_GENERATION,
    SwarmStage.FRONTEND_GENERATION,
    SwarmStage.QA_EVALUATION,
)


class SwarmError(RuntimeError):
    """Base error for the swarm orchestrator."""


class OpenRouterError(SwarmError):
    """Raised when the OpenRouter API call fails."""


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class Artifact:
    """A file produced by a worker."""

    path: str
    kind: str  # openapi | model | database | router | page | blueprint | report | requirements
    bytes: int = 0
    stage: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class SwarmBlueprint:
    """Architect output: the contract plus the folder blueprint."""

    title: str
    prompt: str
    openapi: dict[str, Any]
    folders: list[str] = field(default_factory=list)
    resources: list[str] = field(default_factory=list)
    source: str = "fallback"  # "llm" | "fallback"
    domain: str = "generic"  # "generic" | "financial"
    model: Optional[str] = None
    notes: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class QaReport:
    """Result of validating generated code against the OpenAPI contract."""

    passed: bool
    score: float
    checks: list[dict[str, Any]] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class SwarmResult:
    """Full trace of one swarm run."""

    app_id: str
    prompt: str
    tier: str
    status: str
    stage: str
    output_dir: str
    blueprint: Optional[SwarmBlueprint] = None
    artifacts: list[Artifact] = field(default_factory=list)
    qa: Optional[QaReport] = None
    stages: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    duration_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "app_id": self.app_id,
            "prompt": self.prompt,
            "tier": self.tier,
            "status": self.status,
            "stage": self.stage,
            "output_dir": self.output_dir,
            "blueprint": self.blueprint.to_dict() if self.blueprint else None,
            "artifacts": [a.to_dict() for a in self.artifacts],
            "qa": self.qa.to_dict() if self.qa else None,
            "stages": self.stages,
            "errors": self.errors,
            "duration_seconds": self.duration_seconds,
        }


# ---------------------------------------------------------------------------
# OpenRouter client
# ---------------------------------------------------------------------------


class OpenRouterClient:
    """Minimal OpenRouter chat-completions client (stdlib only)."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = DEFAULT_OPENROUTER_MODEL,
        base_url: str = DEFAULT_OPENROUTER_BASE_URL,
        timeout: float = SWARM_TIMEOUT_SECONDS,
    ) -> None:
        self.api_key = api_key if api_key is not None else os.getenv("OPENROUTER_API_KEY", "")
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key) and SWARM_LLM_ENABLED

    def _payload(self, system: str, user: str, max_tokens: int) -> dict[str, Any]:
        return {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://roxira.net",
                "X-Title": "Roxira Swarm Orchestrator",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:500]
            raise OpenRouterError(f"HTTP {exc.code}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            raise OpenRouterError(str(exc)) from exc

    async def complete_json(
        self, system: str, user: str, max_tokens: int = SWARM_MAX_TOKENS
    ) -> dict[str, Any]:
        """Call the LLM and return its reply parsed as a JSON object."""
        if not self.configured:
            raise OpenRouterError("OPENROUTER_API_KEY is not configured")
        raw = await asyncio.to_thread(self._post, self._payload(system, user, max_tokens))
        try:
            content = raw["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise OpenRouterError(f"unexpected response shape: {str(raw)[:300]}") from exc
        return extract_json_object(content)


def extract_json_object(text: str) -> dict[str, Any]:
    """Pull the first JSON object out of an LLM reply (handles ``` fences)."""
    if not isinstance(text, str):
        raise OpenRouterError("LLM reply was not text")
    cleaned = text.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        parsed = json.loads(cleaned)
    except ValueError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end <= start:
            raise OpenRouterError("no JSON object found in LLM reply")
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except ValueError as exc:
            raise OpenRouterError(f"invalid JSON from LLM: {exc}") from exc
    if not isinstance(parsed, dict):
        raise OpenRouterError("LLM reply was not a JSON object")
    return parsed


# ---------------------------------------------------------------------------
# Stage 1 — architect
# ---------------------------------------------------------------------------

_ARCHITECT_SYSTEM = (
    "You are the lead software architect of an autonomous code factory. "
    "Given a high-level product prompt, reply with ONE JSON object and nothing "
    "else, shaped as: {\"title\": str, \"folders\": [str], "
    "\"openapi\": {openapi 3.1 document}}. The OpenAPI document must contain "
    "`info`, `paths` and `components.schemas`; every path needs a `summary`, an "
    "`operationId`, and a success response with a schema reference. Use "
    "snake_case resource names, integer ids, and ISO-8601 date-time strings."
)


def _fallback_openapi(prompt: str, title: str) -> dict[str, Any]:
    """Deterministic domain blueprint used when no LLM is available."""
    lowered = prompt.lower()
    if is_financial_prompt(prompt):
        # Accounting / ERP prompts get the canonical double-entry contract.
        return _financial_openapi(title, prompt)
    if any(word in lowered for word in ("shop", "store", "commerce", "product")):
        resources = ["products", "orders", "customers"]
    elif any(word in lowered for word in ("clinic", "patient", "health", "medical")):
        resources = ["patients", "appointments", "prescriptions"]
    else:
        resources = ["items", "records", "events"]

    schemas: dict[str, Any] = {}
    paths: dict[str, Any] = {}
    for resource in resources:
        singular = resource[:-1] if resource.endswith("s") else resource
        model = "".join(part.capitalize() for part in singular.split("_"))
        schemas[model] = {
            "type": "object",
            "required": ["id", "name"],
            "properties": {
                "id": {"type": "integer", "format": "int64"},
                "name": {"type": "string", "maxLength": 200},
                "description": {"type": "string"},
                "amount": {"type": "number", "format": "float"},
                "status": {"type": "string", "enum": ["draft", "active", "closed"]},
                "created_at": {"type": "string", "format": "date-time"},
            },
        }
        paths[f"/{resource}"] = {
            "get": {
                "summary": f"List {resource}",
                "operationId": f"list_{resource}",
                "tags": [resource],
                "responses": {
                    "200": {
                        "description": f"{resource} list",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "array",
                                    "items": {"$ref": f"#/components/schemas/{model}"},
                                }
                            }
                        },
                    }
                },
            },
            "post": {
                "summary": f"Create {singular}",
                "operationId": f"create_{singular}",
                "tags": [resource],
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": f"#/components/schemas/{model}"}
                        }
                    },
                },
                "responses": {
                    "201": {
                        "description": f"Created {singular}",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": f"#/components/schemas/{model}"}
                            }
                        },
                    }
                },
            },
        }
        paths[f"/{resource}/{{item_id}}"] = {
            "get": {
                "summary": f"Read one {singular}",
                "operationId": f"get_{singular}",
                "tags": [resource],
                "parameters": [
                    {
                        "name": "item_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "integer"},
                    }
                ],
                "responses": {
                    "200": {
                        "description": singular,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": f"#/components/schemas/{model}"}
                            }
                        },
                    },
                    "404": {"description": "Not found"},
                },
            },
            "put": {
                "summary": f"Update {singular}",
                "operationId": f"update_{singular}",
                "tags": [resource],
                "parameters": [
                    {
                        "name": "item_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "integer"},
                    }
                ],
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": f"#/components/schemas/{model}"}
                        }
                    },
                },
                "responses": {
                    "200": {
                        "description": f"Updated {singular}",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": f"#/components/schemas/{model}"}
                            }
                        },
                    },
                    "404": {"description": "Not found"},
                },
            },
            "delete": {
                "summary": f"Delete {singular}",
                "operationId": f"delete_{singular}",
                "tags": [resource],
                "parameters": [
                    {
                        "name": "item_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "integer"},
                    }
                ],
                "responses": {
                    "200": {"description": f"Deleted {singular}"},
                    "404": {"description": "Not found"},
                },
            },
        }
    return {
        "openapi": "3.1.0",
        "info": {"title": title, "version": "1.0.0", "description": prompt[:400]},
        "paths": paths,
        "components": {"schemas": schemas},
    }


class ArchitectAgent:
    """Stage 1: prompt -> OpenAPI contract + folder blueprint."""

    def __init__(self, client: Optional[OpenRouterClient] = None) -> None:
        self.client = client or OpenRouterClient()

    async def research(self, prompt: str, app_id: str) -> SwarmBlueprint:
        title = _title_from_prompt(prompt)
        financial = is_financial_prompt(prompt)
        domain = FINANCIAL_DOMAIN if financial else "generic"
        if self.client.configured:
            try:
                reply = await self.client.complete_json(
                    _ARCHITECT_SYSTEM,
                    f"Product prompt: {prompt}\n\nApplication id: {app_id}\n"
                    "Design the REST contract and the folder blueprint.",
                )
                openapi = reply.get("openapi") or {}
                if _valid_openapi(openapi):
                    # Accounting products must expose the double-entry entities
                    # even when the LLM forgets them.
                    enforced = enforce_financial_entities(openapi) if financial else []
                    return SwarmBlueprint(
                        title=str(reply.get("title") or title),
                        prompt=prompt,
                        openapi=openapi,
                        folders=[str(f) for f in reply.get("folders") or []],
                        resources=sorted(resources_from_openapi(openapi)),
                        source="llm",
                        domain=domain,
                        model=self.client.model,
                        notes=(
                            "enforced double-entry entities: " + ", ".join(enforced)
                            if enforced
                            else None
                        ),
                    )
                print(
                    "[swarm][architect] LLM reply lacked a usable OpenAPI document; "
                    "falling back to the built-in blueprint",
                    file=sys.stderr,
                )
            except OpenRouterError as exc:
                print(
                    "[swarm][architect] OpenRouter unavailable (%s); using fallback" % exc,
                    file=sys.stderr,
                )
        openapi = _fallback_openapi(prompt, title)
        if financial:
            enforce_financial_entities(openapi)
        return SwarmBlueprint(
            title=title,
            prompt=prompt,
            openapi=openapi,
            folders=default_folders(),
            resources=sorted(resources_from_openapi(openapi)),
            source="fallback",
            domain=domain,
            notes=(
                "deterministic double-entry blueprint (accounting domain)"
                if financial
                else "deterministic blueprint (no LLM)"
            ),
        )


def _title_from_prompt(prompt: str) -> str:
    words = re.sub(r"\s+", " ", (prompt or "").strip()).split(" ")[:8]
    title = " ".join(words).strip(" .")
    return title.title() if title else "Generated Application"


def _valid_openapi(document: Any) -> bool:
    if not isinstance(document, dict):
        return False
    paths = document.get("paths")
    schemas = (document.get("components") or {}).get("schemas")
    return isinstance(paths, dict) and bool(paths) and isinstance(schemas, dict) and bool(schemas)


def resources_from_openapi(document: dict[str, Any]) -> set[str]:
    """Resource (first path segment) names declared by the contract."""
    resources: set[str] = set()
    for path in (document.get("paths") or {}):
        segment = str(path).strip("/").split("/")[0]
        segment = re.sub(r"[^a-zA-Z0-9_]", "", segment)
        if segment and not segment.startswith("{"):
            resources.add(segment.lower())
    return resources


def default_folders() -> list[str]:
    return [
        "app/",
        "app/models/",
        "app/routers/",
        "app/schemas/",
        "web/app/",
        "web/components/",
        "contracts/",
    ]


# ---------------------------------------------------------------------------
# Financial / ERP domain synthesis (double-entry bookkeeping)
# ---------------------------------------------------------------------------

FINANCIAL_DOMAIN = "financial"

#: Words that mark a prompt as an accounting / ERP product.
FINANCIAL_PROMPT_KEYWORDS = (
    "account",
    "accounting",
    "accountancy",
    "bookkeep",
    "ledger",
    "erp",
    "financ",
    "invoice",
    "double-entry",
    "double entry",
    "trial balance",
    "voucher",
    "حسابداری",  # accounting
    "مالی",  # financial
    "دفتر",  # ledger
    "تراز",  # balance
    "سند",  # voucher / journal
)

#: Canonical double-entry entities every accounting contract must expose.
FINANCIAL_ENTITIES: dict[str, dict[str, Any]] = {
    "Account": {
        "type": "object",
        "description": "Chart-of-accounts node (double-entry ledger account).",
        "required": ["code", "title", "type"],
        "properties": {
            "id": {"type": "integer", "format": "int64"},
            "code": {"type": "string", "maxLength": 20},
            "title": {"type": "string", "maxLength": 200},
            "type": {
                "type": "string",
                "enum": ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"],
            },
            "balance": {"type": "number", "format": "double"},
            "created_at": {"type": "string", "format": "date-time"},
        },
    },
    "JournalEntry": {
        "type": "object",
        "description": "A double-entry voucher header.",
        "required": ["entry_number", "date", "status"],
        "properties": {
            "id": {"type": "integer", "format": "int64"},
            "entry_number": {"type": "string", "maxLength": 40},
            "date": {"type": "string", "format": "date"},
            "description": {"type": "string", "maxLength": 400},
            "status": {"type": "string", "enum": ["DRAFT", "POSTED"]},
            "created_at": {"type": "string", "format": "date-time"},
        },
    },
    "JournalItem": {
        "type": "object",
        "description": "One debit or credit line of a journal entry.",
        "required": ["entry_id", "account_id"],
        "properties": {
            "id": {"type": "integer", "format": "int64"},
            "entry_id": {"type": "integer", "format": "int64"},
            "account_id": {"type": "integer", "format": "int64"},
            "debit": {"type": "number", "format": "double"},
            "credit": {"type": "number", "format": "double"},
        },
    },
    "Invoice": {
        "type": "object",
        "description": "Sales / purchase invoice.",
        "required": ["number", "total_amount"],
        "properties": {
            "id": {"type": "integer", "format": "int64"},
            "number": {"type": "string", "maxLength": 40},
            "party_name": {"type": "string", "maxLength": 200},
            "total_amount": {"type": "number", "format": "double"},
            "tax_amount": {"type": "number", "format": "double"},
            "status": {"type": "string", "enum": ["DRAFT", "ISSUED", "PAID", "CANCELLED"]},
            "created_at": {"type": "string", "format": "date-time"},
        },
    },
}

#: Ledger resource slug -> canonical schema that each one serves.
FINANCIAL_RESOURCES: dict[str, str] = {
    "accounts": "Account",
    "journal_entries": "JournalEntry",
    "journal_items": "JournalItem",
    "invoices": "Invoice",
}

#: Columns the portal relies on, injected when the contract omitted them.
FINANCIAL_REQUIRED_COLUMNS: dict[str, list[tuple[str, str, bool]]] = {
    "account": [
        ("code", "String", True),
        ("title", "String", True),
        ("type", "String", True),
        ("balance", "Float", False),
    ],
    "journalentry": [
        ("entry_number", "String", True),
        ("date", "String", True),
        ("status", "String", True),
        ("description", "String", False),
    ],
    "journalitem": [
        ("entry_id", "Integer", True),
        ("account_id", "Integer", True),
        ("debit", "Float", False),
        ("credit", "Float", False),
    ],
    "invoice": [
        ("number", "String", True),
        ("party_name", "String", False),
        ("total_amount", "Float", False),
        ("tax_amount", "Float", False),
        ("status", "String", False),
    ],
}


def is_financial_prompt(prompt: str) -> bool:
    """True when a product prompt asks for accounting / ERP functionality."""
    lowered = (prompt or "").lower()
    return any(keyword in lowered for keyword in FINANCIAL_PROMPT_KEYWORDS)


def _clone(value: Any) -> Any:
    """Deep copy of a JSON-shaped contract fragment."""
    return json.loads(json.dumps(value))


def _singular(resource: str) -> str:
    if resource.endswith("ies"):
        return resource[:-3] + "y"
    if resource.endswith("s"):
        return resource[:-1]
    return resource


def _financial_operations(resource: str, model: str, singular: str) -> dict[str, Any]:
    """Full CRUD operations for one double-entry resource."""
    ref = {"$ref": f"#/components/schemas/{model}"}
    item_param = {
        "name": "item_id",
        "in": "path",
        "required": True,
        "schema": {"type": "integer"},
    }
    return {
        f"/{resource}": {
            "get": {
                "summary": f"List {resource}",
                "operationId": f"list_{resource}",
                "tags": [resource],
                "responses": {
                    "200": {
                        "description": f"{resource} list",
                        "content": {
                            "application/json": {
                                "schema": {"type": "array", "items": ref}
                            }
                        },
                    }
                },
            },
            "post": {
                "summary": f"Create {singular}",
                "operationId": f"create_{singular}",
                "tags": [resource],
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": ref}},
                },
                "responses": {
                    "201": {
                        "description": f"Created {singular}",
                        "content": {"application/json": {"schema": ref}},
                    }
                },
            },
        },
        f"/{resource}/{{item_id}}": {
            "get": {
                "summary": f"Read one {singular}",
                "operationId": f"get_{singular}",
                "tags": [resource],
                "parameters": [item_param],
                "responses": {
                    "200": {
                        "description": singular,
                        "content": {"application/json": {"schema": ref}},
                    },
                    "404": {"description": "Not found"},
                },
            },
            "put": {
                "summary": f"Update {singular}",
                "operationId": f"update_{singular}",
                "tags": [resource],
                "parameters": [item_param],
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": ref}},
                },
                "responses": {
                    "200": {
                        "description": f"Updated {singular}",
                        "content": {"application/json": {"schema": ref}},
                    },
                    "404": {"description": "Not found"},
                },
            },
            "delete": {
                "summary": f"Delete {singular}",
                "operationId": f"delete_{singular}",
                "tags": [resource],
                "parameters": [item_param],
                "responses": {
                    "200": {"description": f"Deleted {singular}"},
                    "404": {"description": "Not found"},
                },
            },
        },
    }


def _financial_openapi(title: str, prompt: str) -> dict[str, Any]:
    """Deterministic double-entry contract for accounting / ERP prompts."""
    paths: dict[str, Any] = {}
    for resource, model in FINANCIAL_RESOURCES.items():
        paths.update(_financial_operations(resource, model, _singular(resource)))
    return {
        "openapi": "3.1.0",
        "info": {
            "title": title,
            "version": "1.0.0",
            "description": (prompt or "")[:400],
            "x-domain": FINANCIAL_DOMAIN,
        },
        "paths": paths,
        "components": {
            "schemas": {name: _clone(schema) for name, schema in FINANCIAL_ENTITIES.items()}
        },
    }


def enforce_financial_entities(openapi: dict[str, Any]) -> list[str]:
    """Inject the canonical double-entry entities into a contract, in place.

    Works on both LLM replies and fallbacks: mandatory columns and CRUD paths
    are added, while anything extra the architect produced is preserved.  The
    returned list names the fragments that were missing and had to be added.
    """
    if not isinstance(openapi, dict):
        return []
    components = openapi.setdefault("components", {})
    if not isinstance(components, dict):
        return []
    schemas = components.setdefault("schemas", {})
    paths = openapi.setdefault("paths", {})
    if not isinstance(schemas, dict) or not isinstance(paths, dict):
        return []

    added: list[str] = []
    for model, canonical in FINANCIAL_ENTITIES.items():
        existing = schemas.get(model)
        if not isinstance(existing, dict):
            schemas[model] = _clone(canonical)
            added.append(model)
            continue
        properties = existing.setdefault("properties", {})
        if not isinstance(properties, dict):
            existing["properties"] = properties = {}
        for column, spec in canonical["properties"].items():
            properties.setdefault(column, _clone(spec))
        required = existing.setdefault("required", [])
        if not isinstance(required, list):
            existing["required"] = required = []
        for column in canonical["required"]:
            if column not in required:
                required.append(column)
    for resource, model in FINANCIAL_RESOURCES.items():
        expected = _financial_operations(resource, model, _singular(resource))
        for endpoint, operations in expected.items():
            bucket = paths.get(endpoint)
            if not isinstance(bucket, dict):
                paths[endpoint] = operations
                added.append(endpoint)
                continue
            for method, operation in operations.items():
                bucket.setdefault(method, operation)
    info = openapi.setdefault("info", {})
    if isinstance(info, dict):
        info.setdefault("x-domain", FINANCIAL_DOMAIN)
    return added


# ---------------------------------------------------------------------------
# Stage 2 — schema design
# ---------------------------------------------------------------------------

_PG_TYPES = {
    "integer": "Integer",
    "number": "Float",
    "boolean": "Boolean",
    "string": "String",
    "array": "JSON",
    "object": "JSON",
}


@dataclass(slots=True)
class TableSpec:
    """A PostgreSQL table derived from one OpenAPI schema."""

    name: str
    model: str
    columns: list[tuple[str, str, bool]]  # (column, sa_type, required)

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "model": self.model, "columns": self.columns}


def pluralize(name: str) -> str:
    name = re.sub(r"(?<!s)s$", "", name)
    if name.endswith("y"):
        return name[:-1] + "ies"
    if name.endswith(("s", "x", "z", "ch", "sh")):
        return name + "es"
    return name + "s"


def snake_case(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).replace("-", "_").lower()


def _enforce_financial_columns(table: TableSpec, schema_name: str) -> TableSpec:
    """Deep schema synthesis: guarantee the double-entry columns exist."""
    canonical = FINANCIAL_REQUIRED_COLUMNS.get(schema_name.lower().replace("_", ""))
    if not canonical:
        return table
    present = {column for column, _, _ in table.columns}
    missing = [
        (column, sa_type, required)
        for column, sa_type, required in canonical
        if column not in present
    ]
    if not missing:
        return table
    return TableSpec(
        name=table.name,
        model=table.model,
        columns=list(table.columns) + missing,
    )


def _table_for_resource(resource: str, tables: list[TableSpec]) -> Optional[TableSpec]:
    """The table a contract resource should read/write through."""
    slug = snake_case(str(resource)).lower()
    for table in tables:
        if table.name.lower() == slug:
            return table
    target = pluralize(slug)
    for table in tables:
        if pluralize(table.name.lower()) == target:
            return table
    return None


def _synthetic_table(resource: str) -> TableSpec:
    """Minimal table so a path without a matching schema stays CRUD-able."""
    slug = snake_case(str(resource)).lower() or "record"
    singular = slug[:-1] if slug.endswith("s") and not slug.endswith("ss") else slug
    model = "".join(part.capitalize() for part in re.split(r"[^a-zA-Z0-9]+", singular) if part)
    return TableSpec(
        name=slug,
        model=model or "Record",
        columns=[
            ("id", "Integer", True),
            ("name", "String", True),
            ("description", "String", False),
            ("status", "String", False),
            ("amount", "Float", False),
            ("created_at", "String", False),
        ],
    )


def ensure_tables_for_resources(
    blueprint: SwarmBlueprint, tables: list[TableSpec]
) -> list[TableSpec]:
    """Guarantee every contract resource has a table its router can bind to."""
    ordered = list(tables)
    for resource in sorted(resources_from_openapi(blueprint.openapi)):
        if _table_for_resource(resource, ordered) is None:
            ordered.append(_synthetic_table(resource))
    return ordered


class SchemaDesigner:
    """Stage 2: OpenAPI ``components.schemas`` -> PostgreSQL table plan."""

    def design(self, blueprint: SwarmBlueprint) -> list[TableSpec]:
        schemas = (blueprint.openapi.get("components") or {}).get("schemas") or {}
        tables: list[TableSpec] = []
        for raw_name, schema in schemas.items():
            if not isinstance(schema, dict):
                continue
            properties = schema.get("properties") or {}
            if not isinstance(properties, dict):
                continue
            required = set(schema.get("required") or [])
            columns: list[tuple[str, str, bool]] = []
            for prop, spec in properties.items():
                spec = spec if isinstance(spec, dict) else {}
                json_type = str(spec.get("type") or "string")
                if "$ref" in spec:
                    json_type = "object"
                columns.append(
                    (
                        snake_case(str(prop)),
                        _PG_TYPES.get(json_type, "String"),
                        str(prop) in required,
                    )
                )
            if not columns:
                continue
            table = TableSpec(
                name=pluralize(snake_case(str(raw_name))),
                model=str(raw_name),
                columns=columns,
            )
            if blueprint.domain == FINANCIAL_DOMAIN:
                table = _enforce_financial_columns(table, str(raw_name))
            tables.append(table)
        return tables


# ---------------------------------------------------------------------------
# Workers
# ---------------------------------------------------------------------------


class _Worker:
    """Common file-writing behaviour for the generation workers."""

    stage: SwarmStage = SwarmStage.BACKEND_GENERATION

    def __init__(self, output_dir: Path) -> None:
        self.output_dir = Path(output_dir)
        self.artifacts: list[Artifact] = []

    def write(self, relative: str, content: str, kind: str) -> Artifact:
        target = self.output_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        artifact = Artifact(
            path=str(target),
            kind=kind,
            bytes=len(content.encode("utf-8")),
            stage=self.stage.value,
        )
        self.artifacts.append(artifact)
        return artifact


class BackendWorker(_Worker):
    """Stage 3: SQLAlchemy models + FastAPI routers from the contract."""

    stage = SwarmStage.BACKEND_GENERATION

    def run(self, blueprint: SwarmBlueprint, tables: list[TableSpec]) -> list[Artifact]:
        # A contract path without a matching schema still needs a table to bind
        # to, otherwise its router could never talk to the database.
        tables = ensure_tables_for_resources(blueprint, tables)
        self.write("contracts/openapi.json", json.dumps(blueprint.openapi, indent=2), "openapi")
        self.write("app/models/__init__.py", '"""SQLAlchemy models generated by the swarm."""\n', "model")
        self.write("app/models/base.py", _MODEL_BASE, "model")
        for table in tables:
            self.write(f"app/models/{table.name}.py", _render_model(table), "model")
        self.write("app/models/registry.py", _render_registry(tables), "model")
        # Async engine + session dependency, shared by every generated router.
        self.write("app/db.py", _render_db(), "database")
        self.write("app/routers/__init__.py", _render_router_registry(blueprint), "router")
        for resource in sorted(resources_from_openapi(blueprint.openapi)):
            self.write(
                f"app/routers/{resource}.py",
                _render_router(resource, blueprint, tables),
                "router",
            )
        # Accounting portals boot with the Iranian chart of accounts.
        if blueprint.domain == FINANCIAL_DOMAIN:
            account_table = _table_for_resource("accounts", tables)
            if account_table is not None:
                self.write("app/seed.py", _render_seed(account_table), "seed")
        self.write("app/main.py", _render_main(blueprint), "router")
        # sqlalchemy + aiosqlite must be installed by the generated image.
        self.write("requirements.txt", _render_requirements(self.output_dir), "requirements")
        return list(self.artifacts)


class FrontendWorker(_Worker):
    """Stage 4: Next.js App Router pages for every contract resource."""

    stage = SwarmStage.FRONTEND_GENERATION

    def run(self, blueprint: SwarmBlueprint, tables: list[TableSpec]) -> list[Artifact]:
        self.write("web/lib/api.ts", _render_api_client(blueprint), "page")
        for resource in sorted(resources_from_openapi(blueprint.openapi)):
            self.write(f"web/app/{resource}/page.tsx", _render_page(resource, blueprint), "page")
        self.write("web/app/layout.tsx", _render_layout(blueprint), "page")
        return list(self.artifacts)


class QaEvaluator:
    """Stage 5: verify the generated tree against the OpenAPI contract."""

    def evaluate(
        self,
        blueprint: SwarmBlueprint,
        tables: list[TableSpec],
        artifacts: list[Artifact],
        output_dir: Path,
    ) -> QaReport:
        checks: list[dict[str, Any]] = []
        issues: list[str] = []
        paths = blueprint.openapi.get("paths") or {}
        schemas = (blueprint.openapi.get("components") or {}).get("schemas") or {}
        resources = sorted(resources_from_openapi(blueprint.openapi))
        kinds = {a.kind for a in artifacts}

        def check(name: str, ok: bool, detail: str = "") -> None:
            checks.append({"check": name, "passed": bool(ok), "detail": detail})
            if not ok:
                issues.append(f"{name}: {detail or 'failed'}")

        check("contract_present", bool(paths and schemas), f"{len(paths)} paths / {len(schemas)} schemas")
        check("contract_written", "openapi" in kinds, "contracts/openapi.json")
        check("models_generated", len(tables) >= len(schemas), f"{len(tables)} tables for {len(schemas)} schemas")
        missing_models = [
            t.name for t in tables if not (output_dir / "app" / "models" / f"{t.name}.py").exists()
        ]
        check("model_files_exist", not missing_models, ", ".join(missing_models))
        missing_routers = [
            r for r in resources if not (output_dir / "app" / "routers" / f"{r}.py").exists()
        ]
        check("router_per_resource", not missing_routers, ", ".join(missing_routers))
        missing_pages = [
            r for r in resources if not (output_dir / "web" / "app" / r / "page.tsx").exists()
        ]
        check("page_per_resource", not missing_pages, ", ".join(missing_pages))

        # Every operation in the contract must appear in its resource router.
        uncovered: list[str] = []
        for path, operations in paths.items():
            resource = str(path).strip("/").split("/")[0].lower()
            router = output_dir / "app" / "routers" / f"{resource}.py"
            if not router.exists():
                uncovered.append(path)
                continue
            body = router.read_text(encoding="utf-8").lower()
            for method in operations:
                if str(method).lower() not in {"get", "post", "put", "patch", "delete"}:
                    continue
                if f"@router.{str(method).lower()}(" not in body:
                    uncovered.append(f"{method.upper()} {path}")
        check("operations_covered", not uncovered, ", ".join(uncovered[:8]))

        # Routers must be mounted, otherwise the contract is dead code.
        main = output_dir / "app" / "main.py"
        main_body = main.read_text(encoding="utf-8") if main.exists() else ""
        mounted = "include_router" in main_body
        check("routers_mounted", mounted, "app/main.py include_router")

        # Every router must resolve its rows through an injected AsyncSession
        # bound to the project SQLite file — no in-memory stand-ins.
        db_module = output_dir / "app" / "db.py"
        db_body = db_module.read_text(encoding="utf-8") if db_module.exists() else ""
        session_source = (
            "sqlite+aiosqlite" in db_body
            and "async_sessionmaker" in db_body
            and "async def get_session" in db_body
        )
        unwired: list[str] = []
        for resource in resources:
            router = output_dir / "app" / "routers" / f"{resource}.py"
            if not router.exists():
                continue
            body = router.read_text(encoding="utf-8")
            if "Depends(get_session)" not in body or "AsyncSession" not in body or "_DATA" in body:
                unwired.append(resource)
        check(
            "async_sessions_injected",
            session_source and not unwired,
            ", ".join(unwired) or ("app/db.py get_session" if session_source else "app/db.py missing"),
        )

        # Tables must exist before the first request: create_all on startup.
        tables_ready = "create_all" in db_body and (
            "init_models" in main_body or "create_all" in main_body
        )
        check("tables_created_on_startup", tables_ready, "Base.metadata.create_all via lifespan")

        # Accounting portals must ship the double-entry entities plus the
        # Iranian chart-of-accounts seed; other domains are not judged here.
        if blueprint.domain == FINANCIAL_DOMAIN:
            missing_entities = [name for name in FINANCIAL_ENTITIES if name not in schemas]
            seed_file = output_dir / "app" / "seed.py"
            seeded = seed_file.exists() and "IRANIAN_CHART_OF_ACCOUNTS" in seed_file.read_text(
                encoding="utf-8"
            )
            check(
                "financial_entities",
                not missing_entities and seeded,
                ", ".join(missing_entities)
                or ("app/seed.py chart of accounts" if seeded else "seed module missing"),
            )
        else:
            check("financial_entities", True, "n/a (generic domain)")

        total = len(checks) or 1
        passed = sum(1 for c in checks if c["passed"])
        score = round(passed / total, 3)
        return QaReport(passed=passed == total, score=score, checks=checks, issues=issues)


# ---------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------

_MODEL_BASE = '''"""Shared SQLAlchemy declarative base (swarm-generated)."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Any, Mapping

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for every generated model."""


def table_args(name: str) -> dict:
    """Common table kwargs so every table is namespaced consistently."""
    return {"schema": None, "comment": f"generated by roxira swarm: {name}"}


def column_names(model: type[Base]) -> set[str]:
    """The physical column names of a generated model."""
    return {column.name for column in model.__table__.columns}


def as_dict(instance: Any) -> dict[str, Any]:
    """JSON-ready mapping for a single row (dates become ISO-8601 strings)."""
    data: dict[str, Any] = {}
    for column in instance.__table__.columns:
        value = getattr(instance, column.name, None)
        if isinstance(value, (datetime, date, time)):
            value = value.isoformat()
        data[column.name] = value
    return data


def from_payload(model: type[Base], payload: Mapping[str, Any] | None) -> Base:
    """Instantiate ``model`` from an untrusted payload (primary key excluded)."""
    allowed = column_names(model) - {"id"}
    data = {key: value for key, value in dict(payload or {}).items() if key in allowed}
    return model(**data)


def apply_payload(instance: Any, payload: Mapping[str, Any] | None) -> Any:
    """Copy the writable fields of an untrusted payload onto an existing row."""
    allowed = column_names(type(instance)) - {"id"}
    for key, value in dict(payload or {}).items():
        if key in allowed:
            setattr(instance, key, value)
    return instance
'''


def _columns_with_primary_key(table: TableSpec) -> list[tuple[str, str, bool]]:
    """Every table needs a primary key, else ``create_all`` cannot run."""
    if any(column == "id" for column, _, _ in table.columns):
        return list(table.columns)
    return [("id", "Integer", True)] + list(table.columns)


def _render_model(table: TableSpec) -> str:
    columns = []
    for column, sa_type, required in _columns_with_primary_key(table):
        if column == "id":
            columns.append("    id: Mapped[int] = mapped_column(Integer, primary_key=True)")
            continue
        # SQLAlchemy infers nullability from the annotation, so a column that
        # the contract does not mark required must be typed as Optional.
        annotation = _py_type(sa_type) if required else f"{_py_type(sa_type)} | None"
        args = [sa_type] + (["nullable=False"] if required else [])
        columns.append(f"    {column}: Mapped[{annotation}] = mapped_column({', '.join(args)})")
    body = "\n".join(columns) or "    pass"
    return (
        '"""SQLAlchemy model generated from the OpenAPI contract."""\n\n'
        "from __future__ import annotations\n\n"
        "from sqlalchemy import Integer, String, Float, Boolean, JSON\n"
        "from sqlalchemy.orm import Mapped, mapped_column\n\n"
        "from .base import Base\n\n\n"
        f"class {table.model}(Base):\n"
        f'    """`{table.name}` table."""\n\n'
        f'    __tablename__ = "{table.name}"\n\n'
        f"{body}\n"
    )


def _py_type(sa_type: str) -> str:
    return {
        "Integer": "int",
        "Float": "float",
        "Boolean": "bool",
        "JSON": "dict",
    }.get(sa_type, "str")


def _render_registry(tables: list[TableSpec]) -> str:
    imports = "\n".join(f"from .{t.name} import {t.model}" for t in tables)
    names = ", ".join(t.model for t in tables)
    return (
        '"""Every generated model, so Alembic and the app see the metadata."""\n\n'
        "from __future__ import annotations\n\n"
        f"{imports}\n\n"
        f"__all__ = [{names!r}]\n"
    )


def _render_router_registry(blueprint: SwarmBlueprint) -> str:
    resources = sorted(resources_from_openapi(blueprint.openapi))
    imports = "\n".join(f"from . import {r}" for r in resources)
    entries = ", ".join(f"{r}.router" for r in resources)
    return (
        '"""Router registry generated from the OpenAPI contract."""\n\n'
        "from __future__ import annotations\n\n"
        f"{imports}\n\n"
        f"ROUTERS = [{entries}]\n"
    )


#: Iranian standard chart of accounts (کدینگ استاندارد حسابداری) —
#: (code, title, type, opening balance).  Group codes: 1 assets, 2 liabilities,
#: 3 equity, 4 income, 5 expenses.
IRANIAN_CHART_OF_ACCOUNTS: tuple[tuple[str, str, str, float], ...] = (
    ("1101", "موجودی نقد و صندوق", "ASSET", 0.0),
    ("1102", "بانک‌ها", "ASSET", 0.0),
    ("1103", "تنخواه‌گردان", "ASSET", 0.0),
    ("1104", "حساب‌های دریافتنی تجاری", "ASSET", 0.0),
    ("1105", "موجودی مواد و کالا", "ASSET", 0.0),
    ("1106", "پیش‌پرداخت‌ها", "ASSET", 0.0),
    ("1201", "دارایی‌های ثابت مشهود", "ASSET", 0.0),
    ("1202", "استهلاک انباشته دارایی‌های ثابت", "ASSET", 0.0),
    ("2101", "حساب‌های پرداختنی تجاری", "LIABILITY", 0.0),
    ("2102", "مالیات پرداختنی", "LIABILITY", 0.0),
    ("2103", "بیمه پرداختنی", "LIABILITY", 0.0),
    ("2104", "حقوق و دستمزد پرداختنی", "LIABILITY", 0.0),
    ("2201", "وام‌های بلندمدت", "LIABILITY", 0.0),
    ("3101", "سرمایه", "EQUITY", 0.0),
    ("3102", "سود و زیان انباشته", "EQUITY", 0.0),
    ("4101", "درآمد فروش کالا", "INCOME", 0.0),
    ("4102", "درآمد ارائه خدمات", "INCOME", 0.0),
    ("4103", "برگشت از فروش", "INCOME", 0.0),
    ("5101", "بهای تمام‌شده کالای فروش رفته", "EXPENSE", 0.0),
    ("5102", "هزینه حقوق و دستمزد", "EXPENSE", 0.0),
    ("5103", "هزینه اجاره", "EXPENSE", 0.0),
    ("5104", "هزینه استهلاک", "EXPENSE", 0.0),
    ("5105", "هزینه آب، برق و گاز", "EXPENSE", 0.0),
    ("5106", "سایر هزینه‌های عمومی و اداری", "EXPENSE", 0.0),
)


def _render_seed(account_table: TableSpec) -> str:
    """Startup seeding of the Iranian standard chart of accounts."""
    rows = "\n".join(
        "    (%r, %r, %r, %r)," % (code, title, entry_type, balance)
        for code, title, entry_type, balance in IRANIAN_CHART_OF_ACCOUNTS
    )
    model = account_table.model
    return (
        '"""Iranian standard chart of accounts seed (کدینگ استاندارد حسابداری)."""\n\n'
        "from __future__ import annotations\n\n"
        "import sys\n\n"
        "from sqlalchemy import func, select\n\n"
        "from app.db import SessionLocal\n"
        f"from app.models.{account_table.name} import {model}\n\n"
        "#: (code, title, type, balance) — Iranian accounting standard coding.\n"
        "IRANIAN_CHART_OF_ACCOUNTS: tuple[tuple[str, str, str, float], ...] = (\n"
        f"{rows}\n"
        ")\n\n\n"
        "async def seed_chart_of_accounts() -> int:\n"
        '    """Insert the standard chart once; a populated ledger is left alone."""\n'
        "    async with SessionLocal() as session:\n"
        f"        existing = await session.scalar(select(func.count()).select_from({model}))\n"
        "        if existing:\n"
        "            return 0\n"
        "        session.add_all(\n"
        "            [\n"
        f"                {model}(code=code, title=title, type=entry_type, balance=balance)\n"
        "                for code, title, entry_type, balance in IRANIAN_CHART_OF_ACCOUNTS\n"
        "            ]\n"
        "        )\n"
        "        await session.commit()\n"
        "        return len(IRANIAN_CHART_OF_ACCOUNTS)\n\n\n"
        "async def seed_database() -> int:\n"
        '    """Best-effort startup seed: never block the portal from booting."""\n'
        "    try:\n"
        "        return await seed_chart_of_accounts()\n"
        "    except Exception as exc:  # pragma: no cover - defensive\n"
        '        print(f"[seed] chart of accounts skipped: {type(exc).__name__}: {exc}",'
        " file=sys.stderr)\n"
        "        return 0\n"
    )


def _render_db() -> str:
    """Async engine + request-scoped session dependency for the generated app."""
    return '''"""Async SQLAlchemy session wiring (swarm-generated)."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import registry  # noqa: F401  importing this registers every table
from app.models.base import Base

#: Project-local file database; point DATABASE_URL elsewhere for PostgreSQL.
DATABASE_URL = "sqlite+aiosqlite:///./app.db"

engine = create_async_engine(DATABASE_URL, echo=False, future=True)
SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


async def init_models() -> None:
    """Create every table declared by the generated models."""
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def dispose_engine() -> None:
    """Release the connection pool on shutdown."""
    await engine.dispose()


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one AsyncSession per request, rolled back on error."""
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
'''


#: The generated image must install these on top of the scaffold's own pins.
#: ``[asyncio]`` pulls in greenlet, which the async engine requires.
SWARM_REQUIRED_PACKAGES = ("sqlalchemy[asyncio]>=2.0.30", "aiosqlite>=0.19.0")
SWARM_BASE_PACKAGES = ("fastapi==0.115.0", "uvicorn[standard]==0.30.6")
_PACKAGE_NAME_RE = re.compile(r"^([A-Za-z0-9_.\-]+)")


def _requirement_name(line: str) -> str:
    match = _PACKAGE_NAME_RE.match(line.strip())
    return match.group(1).lower() if match else ""


def _render_requirements(output_dir: Path) -> str:
    """Keep the scaffold pins and merge in the async SQLAlchemy stack."""
    target = Path(output_dir) / "requirements.txt"
    lines: list[str] = []
    if target.exists():
        lines = [ln.strip() for ln in target.read_text(encoding="utf-8").splitlines()]
        lines = [ln for ln in lines if ln and not ln.startswith("#")]
    if not lines:
        lines = list(SWARM_BASE_PACKAGES)
    present = {_requirement_name(ln) for ln in lines}
    for package in SWARM_REQUIRED_PACKAGES:
        if _requirement_name(package) not in present:
            lines.append(package)
    return "\n".join(lines) + "\n"


def _render_router(resource: str, blueprint: SwarmBlueprint, tables: list[TableSpec]) -> str:
    """One FastAPI router per contract resource, backed by SQLAlchemy."""
    table = _table_for_resource(resource, tables) or _synthetic_table(resource)
    lines = [
        '"""FastAPI router generated from the OpenAPI contract."""',
        "",
        "from __future__ import annotations",
        "",
        "from typing import Any",
        "",
        "from fastapi import APIRouter, Depends, HTTPException",
        "from sqlalchemy import delete, select",
        "from sqlalchemy.ext.asyncio import AsyncSession",
        "",
        "from app.db import get_session",
        f"from app.models.{table.name} import {table.model}",
        "from app.models.base import apply_payload, as_dict, from_payload",
        "",
        f'router = APIRouter(prefix="/api/v1/{resource}", tags=["{resource}"])',
        "",
        f"MODEL = {table.model}",
        "",
    ]
    for path, operations in (blueprint.openapi.get("paths") or {}).items():
        if str(path).strip("/").split("/")[0].lower() != resource:
            continue
        suffix = str(path).strip("/").split("/", 1)
        sub_path = "/" + suffix[1] if len(suffix) > 1 else ""
        sub_path = re.sub(r"\{[^}]+\}", "{item_id}", sub_path)
        item_scope = "{item_id}" in sub_path
        for method, operation in (operations or {}).items():
            method = str(method).lower()
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            operation = operation if isinstance(operation, dict) else {}
            name = str(operation.get("operationId") or f"{method}_{resource}")
            name = re.sub(r"[^a-zA-Z0-9_]", "_", name)
            summary = str(operation.get("summary") or name)
            decorator = f'@router.{method}("{sub_path}"'
            if method == "post" and not item_scope:
                decorator += ", status_code=201"
            lines.append(decorator + ")")
            if item_scope:
                if method in {"put", "patch", "post"}:
                    signature = (
                        f"async def {name}(item_id: int, payload: dict[str, Any] | None = None,"
                        " session: AsyncSession = Depends(get_session)) -> dict[str, Any]:"
                    )
                else:
                    signature = (
                        f"async def {name}(item_id: int,"
                        " session: AsyncSession = Depends(get_session)) -> dict[str, Any]:"
                    )
                lines.append(signature)
                lines.append(f'    """{summary}"""')
                lines.append("    item = await session.get(MODEL, item_id)")
                lines.append("    if item is None:")
                lines.append(
                    f'        raise HTTPException(status_code=404, detail="{resource} not found")'
                )
                if method == "get":
                    lines.append("    return as_dict(item)")
                elif method in {"put", "patch"}:
                    lines.append("    apply_payload(item, payload)")
                    lines.append("    await session.commit()")
                    lines.append("    await session.refresh(item)")
                    lines.append("    return as_dict(item)")
                else:
                    lines.append("    await session.delete(item)")
                    lines.append("    await session.commit()")
                    lines.append('    return {"deleted": int(item_id)}')
            elif method == "get":
                lines.append(
                    f"async def {name}(session: AsyncSession = Depends(get_session))"
                    " -> list[dict[str, Any]]:"
                )
                lines.append(f'    """{summary}"""')
                lines.append("    result = await session.execute(select(MODEL).order_by(MODEL.id))")
                lines.append("    return [as_dict(row) for row in result.scalars().all()]")
            elif method == "post":
                lines.append(
                    f"async def {name}(payload: dict[str, Any] | None = None,"
                    " session: AsyncSession = Depends(get_session)) -> dict[str, Any]:"
                )
                lines.append(f'    """{summary}"""')
                lines.append("    item = from_payload(MODEL, payload)")
                lines.append("    session.add(item)")
                lines.append("    await session.commit()")
                lines.append("    await session.refresh(item)")
                lines.append("    return as_dict(item)")
            elif method == "delete":
                lines.append(
                    f"async def {name}(session: AsyncSession = Depends(get_session))"
                    " -> dict[str, Any]:"
                )
                lines.append(f'    """{summary}"""')
                lines.append("    result = await session.execute(delete(MODEL))")
                lines.append("    await session.commit()")
                lines.append('    return {"deleted": int(result.rowcount or 0)}')
            else:
                lines.append(
                    f"async def {name}(session: AsyncSession = Depends(get_session))"
                    " -> dict[str, Any]:"
                )
                lines.append(f'    """{summary}"""')
                lines.append(
                    "    raise HTTPException(status_code=405,"
                    f' detail="{method.upper()} /api/v1/{resource} is not supported")'
                )
            lines.append("")
    return "\n".join(lines) + "\n"


def _render_main(blueprint: SwarmBlueprint) -> str:
    financial = blueprint.domain == FINANCIAL_DOMAIN
    seed_import = "import sys\n\nfrom app.seed import seed_database\n" if financial else ""
    seed_call = (
        "    seeded = await seed_database()\n"
        '    print(f"[startup] chart of accounts seeded: {seeded} rows", file=sys.stderr)\n'
        if financial
        else ""
    )
    return (
        '"""FastAPI entrypoint generated by the Roxira swarm orchestrator."""\n\n'
        "from __future__ import annotations\n\n"
        "from collections.abc import AsyncIterator\n"
        "from contextlib import asynccontextmanager\n"
        "from typing import Any\n\n"
        "from fastapi import Depends, FastAPI\n"
        "from sqlalchemy import text\n"
        "from sqlalchemy.ext.asyncio import AsyncSession\n\n"
        f"{seed_import}"
        "from app.db import DATABASE_URL, dispose_engine, get_session, init_models\n"
        "from app.routers import ROUTERS\n\n\n"
        "@asynccontextmanager\n"
        "async def lifespan(app: FastAPI) -> AsyncIterator[None]:\n"
        '    """Create the schema, seed the ledger, release the pool at shutdown."""\n'
        "    await init_models()\n"
        f"{seed_call}"
        "    yield\n"
        "    await dispose_engine()\n\n\n"
        f'app = FastAPI(title={blueprint.title!r}, version="1.0.0", lifespan=lifespan)\n\n'
        "for _router in ROUTERS:\n"
        "    app.include_router(_router)\n\n\n"
        '@app.get("/health")\n'
        "async def health() -> dict[str, str]:\n"
        '    return {"status": "ok", "generator": "roxira-swarm", "database": DATABASE_URL}\n\n\n'
        '@app.get("/health/db")\n'
        "async def health_db(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:\n"
        '    """Readiness probe: proves the SQLite file answers queries."""\n'
        '    await session.execute(text("SELECT 1"))\n'
        '    return {"status": "ok", "database": DATABASE_URL}\n'
    )


def _render_api_client(blueprint: SwarmBlueprint) -> str:
    resources = sorted(resources_from_openapi(blueprint.openapi))
    lines = [
        "// Typed API client generated from the OpenAPI contract.",
        "const BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000';",
        "",
        "export async function apiGet<T>(path: string): Promise<T> {",
        "  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });",
        "  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);",
        "  return (await res.json()) as T;",
        "}",
        "",
        "export async function apiPost<T>(path: string, body: unknown): Promise<T> {",
        "  const res = await fetch(`${BASE}${path}`, {",
        "    method: 'POST',",
        "    headers: { 'Content-Type': 'application/json' },",
        "    body: JSON.stringify(body),",
        "  });",
        "  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);",
        "  return (await res.json()) as T;",
        "}",
        "",
    ]
    for resource in resources:
        lines.append(f"export const {resource}Endpoint = '/api/v1/{resource}';")
    return "\n".join(lines) + "\n"


def _render_page(resource: str, blueprint: SwarmBlueprint) -> str:
    label = resource.replace("_", " ").title()
    return f'''// Next.js App Router page generated from the OpenAPI contract.
import {{ apiGet }} from '@/lib/api';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

export default async function {''.join(p.title() for p in resource.split('_'))}Page() {{
  let rows: Row[] = [];
  let error: string | null = null;
  try {{
    rows = await apiGet<Row[]>('/api/v1/{resource}');
  }} catch (err) {{
    error = err instanceof Error ? err.message : 'request failed';
  }}

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">{label}</h1>
      <p className="mt-2 text-sm text-gray-500">{blueprint.title} — generated by the Roxira swarm.</p>
      {{error ? (
        <p className="mt-6 rounded bg-red-50 p-4 text-red-700">{{error}}</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-gray-500">No records yet.</p>
      ) : (
        <table className="mt-6 w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {{Object.keys(rows[0]).map((key) => (
                <th key={{key}} className="border-b py-2 font-medium">{{key}}</th>
              ))}}
            </tr>
          </thead>
          <tbody>
            {{rows.map((row, index) => (
              <tr key={{index}}>
                {{Object.values(row).map((value, cell) => (
                  <td key={{cell}} className="border-b py-2">{{String(value)}}</td>
                ))}}
              </tr>
            ))}}
          </tbody>
        </table>
      )}}
    </main>
  );
}}
'''


def _render_layout(blueprint: SwarmBlueprint) -> str:
    return f'''// Root layout generated from the OpenAPI contract.
import type {{ ReactNode }} from 'react';

export const metadata = {{ title: {blueprint.title!r} }};

export default function RootLayout({{ children }}: {{ children: ReactNode }}) {{
  return (
    <html lang="en">
      <body>{{children}}</body>
    </html>
  );
}}
'''


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


class SwarmOrchestrator:
    """Runs the five-stage hierarchical generation pipeline."""

    def __init__(
        self,
        client: Optional[OpenRouterClient] = None,
        architect: Optional[ArchitectAgent] = None,
        designer: Optional[SchemaDesigner] = None,
        qa: Optional[QaEvaluator] = None,
        on_stage: Optional[Callable[[SwarmStage, dict[str, Any]], None]] = None,
    ) -> None:
        self.architect = architect or ArchitectAgent(client)
        self.designer = designer or SchemaDesigner()
        self.qa = qa or QaEvaluator()
        self.on_stage = on_stage

    def _record(self, result: SwarmResult, stage: SwarmStage, detail: dict[str, Any]) -> None:
        entry = {"stage": stage.value, "at": time.time(), **detail}
        result.stages.append(entry)
        result.stage = stage.value
        if self.on_stage is not None:
            try:
                self.on_stage(stage, entry)
            except Exception:  # a progress hook must never break generation
                pass

    async def run(
        self,
        prompt: str,
        output_dir: Path,
        app_id: Optional[str] = None,
        tier: str = AUTONOMOUS_SWARM_TIER,
    ) -> SwarmResult:
        """Execute the full pipeline and write the generated tree to disk."""
        started = time.time()
        output_dir = Path(output_dir)
        result = SwarmResult(
            app_id=app_id or f"swarm-{uuid.uuid4().hex[:8]}",
            prompt=prompt,
            tier=tier,
            status="running",
            stage=SwarmStage.ARCHITECT_RESEARCH.value,
            output_dir=str(output_dir),
        )
        output_dir.mkdir(parents=True, exist_ok=True)
        try:
            # 1. ARCHITECT_RESEARCH
            blueprint = await self.architect.research(prompt, result.app_id)
            result.blueprint = blueprint
            self._record(
                result,
                SwarmStage.ARCHITECT_RESEARCH,
                {
                    "title": blueprint.title,
                    "source": blueprint.source,
                    "model": blueprint.model,
                    "paths": len(blueprint.openapi.get("paths") or {}),
                    "schemas": len((blueprint.openapi.get("components") or {}).get("schemas") or {}),
                },
            )
            (output_dir / "contracts").mkdir(parents=True, exist_ok=True)
            (output_dir / "contracts" / "blueprint.json").write_text(
                json.dumps(
                    {
                        "title": blueprint.title,
                        "prompt": blueprint.prompt,
                        "folders": blueprint.folders,
                        "resources": blueprint.resources,
                        "source": blueprint.source,
                        "domain": blueprint.domain,
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            result.artifacts.append(
                Artifact(
                    path=str(output_dir / "contracts" / "blueprint.json"),
                    kind="blueprint",
                    stage=SwarmStage.ARCHITECT_RESEARCH.value,
                )
            )

            # 2. SCHEMA_DESIGN
            tables = self.designer.design(blueprint)
            self._record(
                result,
                SwarmStage.SCHEMA_DESIGN,
                {"tables": [t.to_dict() for t in tables]},
            )

            # 3. BACKEND_GENERATION
            backend = BackendWorker(output_dir)
            result.artifacts.extend(backend.run(blueprint, tables))
            self._record(
                result,
                SwarmStage.BACKEND_GENERATION,
                {"files": [a.path for a in backend.artifacts]},
            )

            # 4. FRONTEND_GENERATION
            frontend = FrontendWorker(output_dir)
            result.artifacts.extend(frontend.run(blueprint, tables))
            self._record(
                result,
                SwarmStage.FRONTEND_GENERATION,
                {"files": [a.path for a in frontend.artifacts]},
            )

            # 5. QA_EVALUATION
            report = self.qa.evaluate(blueprint, tables, result.artifacts, output_dir)
            result.qa = report
            self._record(
                result,
                SwarmStage.QA_EVALUATION,
                {"passed": report.passed, "score": report.score, "issues": report.issues},
            )
            result.status = "completed" if report.passed else "completed_with_issues"
            result.stage = SwarmStage.DONE.value
        except Exception as exc:  # never propagate: the caller records FAILED
            result.status = "failed"
            result.stage = SwarmStage.FAILED.value
            result.errors.append(f"{type(exc).__name__}: {exc}")
            self._record(result, SwarmStage.FAILED, {"error": str(exc)})
        finally:
            result.duration_seconds = round(time.time() - started, 3)
            try:
                report_dir = output_dir / ".swarm"
                report_dir.mkdir(parents=True, exist_ok=True)
                (report_dir / "report.json").write_text(
                    json.dumps(result.to_dict(), indent=2, default=str), encoding="utf-8"
                )
            except OSError as exc:
                print("[swarm] could not persist report: %s" % exc, file=sys.stderr)
        return result


async def run_swarm_blueprint(
    prompt: str,
    output_dir: Path,
    app_id: Optional[str] = None,
    tier: str = AUTONOMOUS_SWARM_TIER,
    client: Optional[OpenRouterClient] = None,
) -> SwarmResult:
    """Convenience entrypoint used by the ephemeral runner."""
    return await SwarmOrchestrator(client=client).run(
        prompt, output_dir, app_id=app_id, tier=tier
    )
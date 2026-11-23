"""Qdrant Strict Mode and Mandatory Tenant Filter Configuration (T348 / #1321).

Enforces collection-level strict mode and mandatory payload indexing across SmartJudge stores.
In Qdrant 1.9+, `strict_mode_config` prevents accidental performance degradation and unbudgeted
queries by refusing unindexed filtering and enforcing query limits/timeouts.

Per Roxira Architecture Standard (AGENTS.md §4, #1316 Review, #1300 Audit):
- Production collections stay 100% untouched until owner's sentence.
- Strict mode configuration is placed behind `QDRANT_STRICT_MODE_ENABLED` feature flag
  with zero-downtime rollback.
- Mandatory tenant isolation filter is enforced on all tenant collections.
"""
from __future__ import annotations

import dataclasses
import logging
import os
from collections.abc import Mapping
from typing import Any

from output_apps.generated_modules.smartjudge.security.vector_tenant_wrapper import (
    TenantFilterRequiredError,
    is_tenant_collection,
)

logger = logging.getLogger("smartjudge.qdrant_strict_mode")

ENV_STRICT_MODE_FLAG = "QDRANT_STRICT_MODE_ENABLED"
DEFAULT_MAX_QUERY_LIMIT = 100
DEFAULT_MAX_TIMEOUT_SECONDS = 10


def extract_tenant_id_from_filter(filter_dict: dict[str, Any] | None) -> str | None:
    """Extracts tenant_id or user_id value from a Qdrant filter structure if present."""
    if not filter_dict or not isinstance(filter_dict, dict):
        return None

    # Check top-level or must conditions
    must = filter_dict.get("must")
    candidates = must if isinstance(must, list) else [filter_dict]

    for item in candidates:
        if isinstance(item, dict):
            key = item.get("key")
            if key in ("tenant_id", "user_id"):
                match_val = item.get("match", {})
                if isinstance(match_val, dict) and "value" in match_val:
                    val = str(match_val["value"]).strip()
                    if val and val.lower() not in ("null", "undefined", "none", "0", "false"):
                        return val
    return None


class StrictModeError(Exception):
    """Base exception for Qdrant strict mode violations."""
    pass


class StrictModeLimitExceededError(StrictModeError):
    """Raised when a query limit exceeds the collection's max_query_limit."""
    pass


class StrictModeTimeoutExceededError(StrictModeError):
    """Raised when a query timeout exceeds the collection's max_timeout."""
    pass


class UnindexedFilterError(StrictModeError):
    """Raised when a query attempts to filter on a payload field lacking an index."""
    pass


@dataclasses.dataclass(frozen=True)
class PayloadIndexDef:
    field_name: str
    field_schema: str  # "keyword", "integer", "bool", "text"


@dataclasses.dataclass(frozen=True)
class CollectionProfile:
    name: str
    collection_type: str  # "public_statutory", "regulations", "tenant_documents", etc.
    is_tenant: bool
    required_indexes: list[PayloadIndexDef]
    max_query_limit: int = DEFAULT_MAX_QUERY_LIMIT
    max_timeout: int = DEFAULT_MAX_TIMEOUT_SECONDS
    unindexed_filtering_retrieve: bool = False


# Audited collection profiles matching #1300 layout and vector_tenant_wrapper
COLLECTION_PROFILES: dict[str, CollectionProfile] = {
    # 1. Primary statutory collections
    "iran_laws_v2": CollectionProfile(
        name="iran_laws_v2",
        collection_type="public_statutory",
        is_tenant=False,
        required_indexes=[
            PayloadIndexDef("is_active", "bool"),
            PayloadIndexDef("category", "keyword"),
            PayloadIndexDef("source_tier", "keyword"),
            PayloadIndexDef("law_id", "keyword"),
            PayloadIndexDef("article_no", "keyword"),
        ],
    ),
    "iran_laws_hakim_v1": CollectionProfile(
        name="iran_laws_hakim_v1",
        collection_type="public_statutory",
        is_tenant=False,
        required_indexes=[
            PayloadIndexDef("is_active", "bool"),
            PayloadIndexDef("category", "keyword"),
            PayloadIndexDef("source_tier", "keyword"),
            PayloadIndexDef("law_id", "keyword"),
            PayloadIndexDef("article_no", "keyword"),
        ],
    ),
    "iran_laws_bge_m3": CollectionProfile(
        name="iran_laws_bge_m3",
        collection_type="public_statutory",
        is_tenant=False,
        required_indexes=[
            PayloadIndexDef("is_active", "bool"),
            PayloadIndexDef("category", "keyword"),
            PayloadIndexDef("source_tier", "keyword"),
            PayloadIndexDef("law_id", "keyword"),
        ],
    ),
    # 2. Judicial rulings and precedents
    "iran_rulings_v1": CollectionProfile(
        name="iran_rulings_v1",
        collection_type="judicial_precedents",
        is_tenant=False,
        required_indexes=[
            PayloadIndexDef("sub_collection", "keyword"),
            PayloadIndexDef("category", "keyword"),
            PayloadIndexDef("ruling_type", "keyword"),
            PayloadIndexDef("year", "integer"),
            PayloadIndexDef("number", "keyword"),
        ],
    ),
    "judicial_precedents": CollectionProfile(
        name="judicial_precedents",
        collection_type="judicial_precedents",
        is_tenant=False,
        required_indexes=[
            PayloadIndexDef("sub_collection", "keyword"),
            PayloadIndexDef("category", "keyword"),
            PayloadIndexDef("ruling_type", "keyword"),
        ],
    ),
    # 3. Regulations, circulars, and executive bylaws
    "iran_regulations_v1": CollectionProfile(
        name="iran_regulations_v1",
        collection_type="regulations",
        is_tenant=False,
        required_indexes=[
            PayloadIndexDef("doc_type", "keyword"),
            PayloadIndexDef("issuer", "keyword"),
            PayloadIndexDef("is_active", "bool"),
            PayloadIndexDef("category", "keyword"),
            PayloadIndexDef("doc_id", "keyword"),
        ],
    ),
    # 4. Tenant-scoped documents and learning collections
    "tenant_case_documents": CollectionProfile(
        name="tenant_case_documents",
        collection_type="tenant_documents",
        is_tenant=True,
        required_indexes=[
            PayloadIndexDef("tenant_id", "keyword"),
            PayloadIndexDef("user_id", "keyword"),
            PayloadIndexDef("case_id", "keyword"),
            PayloadIndexDef("file_id", "keyword"),
            PayloadIndexDef("status", "keyword"),
        ],
    ),
    "tenant_documents": CollectionProfile(
        name="tenant_documents",
        collection_type="tenant_documents",
        is_tenant=True,
        required_indexes=[
            PayloadIndexDef("tenant_id", "keyword"),
            PayloadIndexDef("user_id", "keyword"),
            PayloadIndexDef("doc_id", "keyword"),
        ],
    ),
    "smartjudge_learned_experience": CollectionProfile(
        name="smartjudge_learned_experience",
        collection_type="tenant_documents",
        is_tenant=True,
        required_indexes=[
            PayloadIndexDef("tenant_id", "keyword"),
            PayloadIndexDef("domain", "keyword"),
            PayloadIndexDef("feedback_score", "integer"),
        ],
    ),
    "tenant_crm_vectors": CollectionProfile(
        name="tenant_crm_vectors",
        collection_type="tenant_documents",
        is_tenant=True,
        required_indexes=[
            PayloadIndexDef("tenant_id", "keyword"),
            PayloadIndexDef("entity_type", "keyword"),
            PayloadIndexDef("entity_id", "keyword"),
        ],
    ),
}


def is_strict_mode_enabled(environ: Mapping[str, str] | None = None) -> bool:
    """Checks if strict mode is active in the environment (default: False)."""
    env = os.environ if environ is None else environ
    val = (env.get(ENV_STRICT_MODE_FLAG) or "").strip().lower()
    return val in ("1", "true", "yes", "on")


def get_collection_profile(collection_name: str) -> CollectionProfile:
    """Returns the CollectionProfile or constructs a default profile based on tenant status."""
    if collection_name in COLLECTION_PROFILES:
        return COLLECTION_PROFILES[collection_name]

    is_tenant = is_tenant_collection(collection_name)
    if is_tenant:
        return CollectionProfile(
            name=collection_name,
            collection_type="tenant_documents",
            is_tenant=True,
            required_indexes=[
                PayloadIndexDef("tenant_id", "keyword"),
                PayloadIndexDef("user_id", "keyword"),
            ],
        )

    return CollectionProfile(
        name=collection_name,
        collection_type="public_statutory",
        is_tenant=False,
        required_indexes=[
            PayloadIndexDef("is_active", "bool"),
            PayloadIndexDef("category", "keyword"),
        ],
    )


def build_strict_mode_patch(profile: CollectionProfile) -> dict[str, Any]:
    """Generates the Qdrant REST API PATCH body to enable strict mode."""
    return {
        "strict_mode_config": {
            "enabled": True,
            "max_query_limit": profile.max_query_limit,
            "max_timeout": profile.max_timeout,
            "unindexed_filtering_retrieve": profile.unindexed_filtering_retrieve,
        }
    }


def build_rollback_patch() -> dict[str, Any]:
    """Generates the Qdrant REST API PATCH body to roll back / disable strict mode."""
    return {
        "strict_mode_config": {
            "enabled": False,
        }
    }


def build_index_creation_payload(index_def: PayloadIndexDef) -> dict[str, Any]:
    """Generates the Qdrant payload index creation request body."""
    return {
        "field_name": index_def.field_name,
        "field_schema": index_def.field_schema,
    }


def extract_filter_field_names(filter_dict: dict[str, Any] | None) -> set[str]:
    """Recursively extracts all payload field names referenced in a Qdrant filter structure."""
    if not filter_dict or not isinstance(filter_dict, dict):
        return set()

    fields: set[str] = set()

    for key, val in filter_dict.items():
        if key == "key" and isinstance(val, str):
            fields.add(val)
        elif key in ("must", "should", "must_not") and isinstance(val, list):
            for sub in val:
                fields.update(extract_filter_field_names(sub))
        elif isinstance(val, dict):
            # Handles structures like {"is_empty": {"key": "..."}}
            fields.update(extract_filter_field_names(val))
        elif isinstance(val, list):
            for item in val:
                if isinstance(item, dict):
                    fields.update(extract_filter_field_names(item))

    return fields


def validate_query_against_strict_mode(
    collection_name: str,
    limit: int,
    query_filter: dict[str, Any] | None,
    timeout: float | None = None,
    indexed_fields: set[str] | None = None,
) -> None:
    """Validates an incoming query against collection strict-mode constraints.

    Enforces:
    1. limit <= max_query_limit
    2. timeout <= max_timeout
    3. Mandatory tenant_id filter if collection is a tenant collection
    4. All fields in filter are indexed if strict mode is active
    """
    profile = get_collection_profile(collection_name)

    # 1. Limit constraint
    if limit > profile.max_query_limit:
        raise StrictModeLimitExceededError(
            f"Query limit {limit} exceeds max_query_limit {profile.max_query_limit} "
            f"for collection '{collection_name}'."
        )

    # 2. Timeout constraint
    if timeout is not None and timeout > profile.max_timeout:
        raise StrictModeTimeoutExceededError(
            f"Query timeout {timeout}s exceeds max_timeout {profile.max_timeout}s "
            f"for collection '{collection_name}'."
        )

    # 3. Mandatory tenant filter constraint
    if profile.is_tenant:
        tenant_id = extract_tenant_id_from_filter(query_filter)
        if not tenant_id:
            raise TenantFilterRequiredError(
                f"Query on tenant collection '{collection_name}' lacks mandatory tenant_id filter."
            )

    # 4. Unindexed filtering constraint
    if not profile.unindexed_filtering_retrieve and query_filter:
        known_indexes = (
            indexed_fields
            if indexed_fields is not None
            else {idx.field_name for idx in profile.required_indexes}
        )
        used_fields = extract_filter_field_names(query_filter)
        unindexed = used_fields - known_indexes
        if unindexed:
            raise UnindexedFilterError(
                f"Collection '{collection_name}' strict mode refused filter on unindexed "
                f"field(s): {sorted(unindexed)}. Create payload index before querying."
            )

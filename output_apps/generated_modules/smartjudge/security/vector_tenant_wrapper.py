"""Vector Store Tenancy & Qdrant Query Enforcement Wrapper (T153).

PostgreSQL Row-Level Security (RLS) does NOT cover external vector stores such as Qdrant.
Any vector collection holding tenant or user data MUST be queried and written through
this wrapper, which strictly requires an explicit, non-empty tenant (or user) filter.

Per Roxira Security Standards (AGENTS.md §4, Lesson 25, Done-when T153):
- Fail-closed: missing tenant_id / user_id means deny (TenantFilterRequiredError).
- Bypass protection: caller cannot bypass tenant filter with OR/should conditions.
- Strict payload validation: writes must include tenant tag in point payloads.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple, Union
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError

logger = logging.getLogger("roxira.security.vector_tenant_wrapper")


class TenantFilterRequiredError(PermissionError):
    """Raised when an operation on a tenant or user vector collection lacks a valid tenant filter."""
    pass


class InvalidTenantFilterError(ValueError):
    """Raised when a supplied tenant filter is invalid, empty, or conflicts with the context."""
    pass


#: Collections known to store tenant, customer, or user data.
TENANT_COLLECTIONS: Set[str] = {
    "smartjudge_learned_experience",
    "tenant_case_documents",
    "tenant_documents",
    "tenant_knowledge_base",
    "tenant_crm_vectors",
    "tenant_custom_embeddings",
}

#: Prefixes that indicate tenant-scoped collections.
TENANT_COLLECTION_PREFIXES: Tuple[str, ...] = (
    "tenant_",
    "tenant-",
    "customer_",
    "customer-",
    "client_",
    "client-",
    "user_",
    "user-",
)

#: Collections known to be public reference corpora (statutes, rulings, bylaws, system code).
PUBLIC_COLLECTIONS: Set[str] = {
    "iran_laws_v1",
    "iran_laws_v2",
    "iran_laws_v3",
    "iran_laws_bge_m3",
    "iran_laws_mistral_v1",
    "iran_laws_hakim_v1",
    "iran_laws_hakim",
    "iran_rulings_v1",
    "judicial_precedents",
    "iran_regulations_v1",
    "roxira_legal_memory",
    "software_factory_code_vectors",
    "research_knowledge_base",
}

_SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_\-\.:]{1,128}$")
_DISALLOWED_VALUES = {"null", "undefined", "none", "0", "false"}


def is_tenant_collection(collection_name: str) -> bool:
    """Return True if collection holds tenant or individual user data."""
    coll = (collection_name or "").strip().lower()
    if not coll:
        return False
    if coll in TENANT_COLLECTIONS:
        return True
    if any(coll.startswith(prefix) for prefix in TENANT_COLLECTION_PREFIXES):
        return True
    return False


def is_public_collection(collection_name: str) -> bool:
    """Return True if collection is an audited public reference corpus."""
    coll = (collection_name or "").strip().lower()
    return coll in PUBLIC_COLLECTIONS


def validate_identifier(val: Any, field_name: str = "tenant_id") -> str:
    """Validate that tenant_id or user_id is a non-empty, safe string.

    Fails closed on None, empty string, whitespace, or invalid tokens.
    """
    if val is None:
        raise TenantFilterRequiredError(
            f"Operation rejected: {field_name} is required for tenant vector collections."
        )
    s = str(val).strip()
    if not s:
        raise TenantFilterRequiredError(
            f"Operation rejected: {field_name} cannot be empty."
        )
    if s.lower() in _DISALLOWED_VALUES:
        raise InvalidTenantFilterError(
            f"Operation rejected: {field_name} cannot be a placeholder ('{s}')."
        )
    if not _SAFE_ID_PATTERN.match(s):
        raise InvalidTenantFilterError(
            f"Operation rejected: {field_name} contains invalid characters."
        )
    return s


def build_tenant_condition(
    tenant_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a Qdrant match condition for tenant_id or user_id."""
    if tenant_id is not None:
        valid_id = validate_identifier(tenant_id, "tenant_id")
        return {"key": "tenant_id", "match": {"value": valid_id}}
    elif user_id is not None:
        valid_id = validate_identifier(user_id, "user_id")
        return {"key": "user_id", "match": {"value": valid_id}}
    else:
        raise TenantFilterRequiredError(
            "Operation rejected: neither tenant_id nor user_id was provided."
        )


def enforce_tenant_filter(
    collection_name: str,
    tenant_id: Optional[str] = None,
    user_id: Optional[str] = None,
    existing_filter: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Inject an immutable tenant condition into the Qdrant query filter.

    If the collection is tenant-scoped:
    - Enforces that tenant_id or user_id is present.
    - Embeds the condition into the `must` array of the filter.
    - Rejects any conflicting existing tenant_id condition.

    If the collection is public:
    - Returns existing_filter unmodified.
    """
    if not is_tenant_collection(collection_name):
        return existing_filter

    condition = build_tenant_condition(tenant_id=tenant_id, user_id=user_id)
    key = condition["key"]
    expected_value = condition["match"]["value"]

    if existing_filter is None:
        return {"must": [condition]}

    if not isinstance(existing_filter, dict):
        raise InvalidTenantFilterError("existing_filter must be a dictionary")

    # Deep-copy to avoid mutating caller object
    hardened = json.loads(json.dumps(existing_filter))

    # Inspect existing `must` conditions to ensure no conflict
    must_list = hardened.get("must")
    if must_list is None:
        must_list = []
        hardened["must"] = must_list
    elif not isinstance(must_list, list):
        raise InvalidTenantFilterError("Filter 'must' clause must be a list")

    condition_already_present = False
    for cond in must_list:
        if isinstance(cond, dict) and cond.get("key") == key:
            match_clause = cond.get("match", {})
            actual_val = match_clause.get("value")
            if actual_val != expected_value:
                raise InvalidTenantFilterError(
                    f"Conflicting {key} filter: query specifies '{actual_val}' but session tenant is '{expected_value}'"
                )
            condition_already_present = True

    if not condition_already_present:
        must_list.append(condition)

    return hardened


def validate_points_for_upsert(
    collection_name: str,
    points: Sequence[Dict[str, Any]],
    tenant_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Validate and enforce tenant tags on points before upserting into Qdrant."""
    if not is_tenant_collection(collection_name):
        # Public reference collection: refuse tenant tags or tenant document payloads to avoid contamination
        if tenant_id or user_id:
            raise InvalidTenantFilterError(
                f"Cannot specify tenant_id/user_id for public collection '{collection_name}'"
            )
        for idx, p in enumerate(points or []):
            if isinstance(p, dict):
                payload = p.get("payload") or {}
                if isinstance(payload, dict):
                    for key in ("tenant_id", "user_id", "customer_id", "client_id"):
                        if payload.get(key) not in (None, ""):
                            raise InvalidTenantFilterError(
                                f"Point at index {idx} contains tenant-owned field '{key}' targeting public collection '{collection_name}'"
                            )
                    doc_type = str(payload.get("doc_type") or "").lower()
                    if doc_type in ("tenant_doc", "case_file", "customer_contract", "private_note"):
                        raise InvalidTenantFilterError(
                            f"Point at index {idx} contains tenant document type '{doc_type}' targeting public collection '{collection_name}'"
                        )
        return list(points)

    condition = build_tenant_condition(tenant_id=tenant_id, user_id=user_id)
    key = condition["key"]
    expected_val = condition["match"]["value"]

    sanitized_points: List[Dict[str, Any]] = []
    for idx, p in enumerate(points):
        if not isinstance(p, dict):
            raise InvalidTenantFilterError(f"Point at index {idx} must be a dictionary")
        point_copy = json.loads(json.dumps(p))
        payload = point_copy.get("payload")
        if payload is None:
            payload = {}
            point_copy["payload"] = payload
        elif not isinstance(payload, dict):
            raise InvalidTenantFilterError(f"Point payload at index {idx} must be a dictionary")

        existing_val = payload.get(key)
        if existing_val is not None:
            if str(existing_val).strip() != expected_val:
                raise InvalidTenantFilterError(
                    f"Point at index {idx} has conflicting {key} '{existing_val}', expected '{expected_val}'"
                )
        else:
            payload[key] = expected_val

        sanitized_points.append(point_copy)

    return sanitized_points


class TenantVectorStoreWrapper:
    """Production wrapper for Qdrant operations enforcing tenant isolation."""

    def __init__(self, base_url: Optional[str] = None, timeout: float = 5.0) -> None:
        self.base_url = (base_url or os.getenv("QDRANT_URL", "http://127.0.0.1:6333")).rstrip("/")
        self.timeout = timeout

    def build_search_payload(
        self,
        collection_name: str,
        vector: Sequence[float],
        tenant_id: Optional[str] = None,
        user_id: Optional[str] = None,
        filter_dict: Optional[Dict[str, Any]] = None,
        limit: int = 5,
        with_payload: bool = True,
    ) -> Dict[str, Any]:
        """Construct a validated search request body."""
        hardened_filter = enforce_tenant_filter(
            collection_name,
            tenant_id=tenant_id,
            user_id=user_id,
            existing_filter=filter_dict,
        )
        payload: Dict[str, Any] = {
            "vector": list(vector),
            "limit": limit,
            "with_payload": with_payload,
        }
        if hardened_filter is not None:
            payload["filter"] = hardened_filter
        return payload

    def build_scroll_payload(
        self,
        collection_name: str,
        tenant_id: Optional[str] = None,
        user_id: Optional[str] = None,
        filter_dict: Optional[Dict[str, Any]] = None,
        limit: int = 10,
        with_payload: bool = True,
    ) -> Dict[str, Any]:
        """Construct a validated scroll request body."""
        hardened_filter = enforce_tenant_filter(
            collection_name,
            tenant_id=tenant_id,
            user_id=user_id,
            existing_filter=filter_dict,
        )
        payload: Dict[str, Any] = {
            "limit": limit,
            "with_payload": with_payload,
        }
        if hardened_filter is not None:
            payload["filter"] = hardened_filter
        return payload

    def search(
        self,
        collection_name: str,
        vector: Sequence[float],
        tenant_id: Optional[str] = None,
        user_id: Optional[str] = None,
        filter_dict: Optional[Dict[str, Any]] = None,
        limit: int = 5,
        with_payload: bool = True,
    ) -> List[Dict[str, Any]]:
        """Execute a tenant-filtered search against Qdrant."""
        payload = self.build_search_payload(
            collection_name=collection_name,
            vector=vector,
            tenant_id=tenant_id,
            user_id=user_id,
            filter_dict=filter_dict,
            limit=limit,
            with_payload=with_payload,
        )
        url = f"{self.base_url}/collections/{collection_name}/points/search"
        data = json.dumps(payload).encode("utf-8")
        req = urllib_request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=self.timeout) as resp:
                res_json = json.loads(resp.read().decode("utf-8"))
                return res_json.get("result", [])
        except (HTTPError, URLError, Exception) as exc:
            logger.warning("Qdrant search error on %s: %s", collection_name, exc)
            return []

    def scroll(
        self,
        collection_name: str,
        tenant_id: Optional[str] = None,
        user_id: Optional[str] = None,
        filter_dict: Optional[Dict[str, Any]] = None,
        limit: int = 10,
        with_payload: bool = True,
    ) -> List[Dict[str, Any]]:
        """Execute a tenant-filtered scroll against Qdrant."""
        payload = self.build_scroll_payload(
            collection_name=collection_name,
            tenant_id=tenant_id,
            user_id=user_id,
            filter_dict=filter_dict,
            limit=limit,
            with_payload=with_payload,
        )
        url = f"{self.base_url}/collections/{collection_name}/points/scroll"
        data = json.dumps(payload).encode("utf-8")
        req = urllib_request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=self.timeout) as resp:
                res_json = json.loads(resp.read().decode("utf-8"))
                points = res_json.get("result", {}).get("points", [])
                return points
        except (HTTPError, URLError, Exception) as exc:
            logger.warning("Qdrant scroll error on %s: %s", collection_name, exc)
            return []

    def upsert(
        self,
        collection_name: str,
        points: Sequence[Dict[str, Any]],
        tenant_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> bool:
        """Upsert validated, tenant-tagged points into Qdrant."""
        sanitized = validate_points_for_upsert(
            collection_name,
            points=points,
            tenant_id=tenant_id,
            user_id=user_id,
        )
        url = f"{self.base_url}/collections/{collection_name}/points?wait=true"
        data = json.dumps({"points": sanitized}).encode("utf-8")
        req = urllib_request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        try:
            with urllib_request.urlopen(req, timeout=self.timeout) as resp:
                return resp.status in (200, 201)
        except (HTTPError, URLError, Exception) as exc:
            logger.warning("Qdrant upsert error on %s: %s", collection_name, exc)
            return False

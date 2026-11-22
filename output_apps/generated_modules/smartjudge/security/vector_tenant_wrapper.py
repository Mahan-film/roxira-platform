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
from pathlib import Path
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


class TenantCancelledError(PermissionError):
    """Raised when an operation is attempted on an offboarded, cancelled, or erased tenant (R25 / T269)."""
    pass


class TenantCancellationRegistry:
    """In-memory and durable file-backed registry of cancelled / erased tenants (R25 / T269).

    Ensures that any retrieval or vector operation on an offboarded tenant fails closed across all layers.
    Survives worker process restarts by persisting to durable storage.
    """
    _cancelled_tenants: Set[str] = set()
    _storage_path: Optional[Path] = None

    @classmethod
    def get_storage_path(cls) -> Path:
        if cls._storage_path:
            return cls._storage_path
        env_p = os.environ.get("TENANT_CANCELLATION_FILE") or os.environ.get("TENANT_CANCELLATION_REGISTRY_PATH")
        if env_p:
            return Path(env_p)
        base_dir = Path(__file__).resolve().parents[4]
        data_dir = base_dir / "data"
        if not data_dir.is_dir():
            data_dir = Path.cwd() / "data"
        return data_dir / "tenant_cancellations.json"

    @classmethod
    def set_storage_path(cls, p: Optional[Path]) -> None:
        cls._storage_path = p

    @classmethod
    def _load_persisted(cls) -> None:
        p = cls.get_storage_path()
        if p.is_file():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        cls._cancelled_tenants.update(data)
            except Exception as e:
                logger.warning("Failed loading cancelled tenants file %s: %s", p, e)

    @classmethod
    def _save_persisted(cls) -> None:
        p = cls.get_storage_path()
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(sorted(list(cls._cancelled_tenants)), f)
            tmp.replace(p)
        except Exception as e:
            logger.warning("Failed persisting cancelled tenants to %s: %s", p, e)

    @classmethod
    def cancel_tenant(cls, tenant_id: str, reason: str = "", authorized_by: str = "") -> Dict[str, Any]:
        """Mark a tenant as cancelled/offboarded. Subsequent queries will fail closed."""
        valid_id = validate_identifier(tenant_id, "tenant_id", check_cancelled=False)
        cls._cancelled_tenants.add(valid_id)
        cls._save_persisted()
        logger.warning(
            "Tenant %s added to cancellation registry. Reason: %s, Authorized by: %s",
            valid_id, reason, authorized_by
        )
        return {"tenant_id": valid_id, "status": "cancelled", "reason": reason}

    @classmethod
    def is_cancelled(cls, tenant_id: Optional[str]) -> bool:
        if not tenant_id:
            return False
        clean_id = str(tenant_id).strip()
        if clean_id in cls._cancelled_tenants:
            return True
        cls._load_persisted()
        return clean_id in cls._cancelled_tenants

    @classmethod
    def check_active(cls, tenant_id: Optional[str]) -> None:
        if cls.is_cancelled(tenant_id):
            raise TenantCancelledError(
                f"Operation rejected: tenant '{tenant_id}' is cancelled/offboarded. Access denied."
            )

    @classmethod
    def clear(cls) -> None:
        """Clear registry (used for tests)."""
        cls._cancelled_tenants.clear()
        p = cls.get_storage_path()
        if p.is_file():
            try:
                p.unlink()
            except OSError:
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


def validate_identifier(val: Any, field_name: str = "tenant_id", check_cancelled: bool = True) -> str:
    """Validate that tenant_id or user_id is a non-empty, safe string.

    Fails closed on None, empty string, whitespace, or invalid tokens.
    If check_cancelled is True and field_name == "tenant_id", checks TenantCancellationRegistry.
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
    if check_cancelled and field_name == "tenant_id":
        TenantCancellationRegistry.check_active(s)
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
    matter_id: Optional[str] = None,
    allowed_matters: Optional[Sequence[str]] = None,
) -> Optional[Dict[str, Any]]:
    """Inject an immutable tenant condition into the Qdrant query filter.

    If the collection is tenant-scoped:
    - Enforces that tenant_id or user_id is present and active (not cancelled).
    - Embeds the condition into the `must` array of the filter.
    - Rejects any conflicting existing tenant_id condition.
    - Supports matter-level ACL scoping via matter_id or allowed_matters within the tenant.

    If the collection is public:
    - Returns existing_filter unmodified.
    """
    if not is_tenant_collection(collection_name):
        return existing_filter

    condition = build_tenant_condition(tenant_id=tenant_id, user_id=user_id)
    key = condition["key"]
    expected_value = condition["match"]["value"]

    if existing_filter is None:
        hardened: Dict[str, Any] = {"must": [condition]}
    elif not isinstance(existing_filter, dict):
        raise InvalidTenantFilterError("existing_filter must be a dictionary")
    else:
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

    # Matter-level ACL inside tenant
    must_arr = hardened["must"]
    if matter_id is not None:
        valid_matter = validate_identifier(matter_id, "matter_id", check_cancelled=False)
        for cond in must_arr:
            if isinstance(cond, dict) and cond.get("key") == "matter_id":
                actual_val = cond.get("match", {}).get("value")
                if actual_val is not None and actual_val != valid_matter:
                    raise InvalidTenantFilterError(
                        f"Conflicting matter_id: query specifies '{actual_val}', but session matter is '{valid_matter}'"
                    )
        must_arr.append({"key": "matter_id", "match": {"value": valid_matter}})
    elif allowed_matters is not None:
        valid_matters = [validate_identifier(m, "matter_id", check_cancelled=False) for m in allowed_matters]
        if valid_matters:
            must_arr.append({"key": "matter_id", "match": {"any": valid_matters}})

    return hardened


def validate_points_for_upsert(
    collection_name: str,
    points: Sequence[Dict[str, Any]],
    tenant_id: Optional[str] = None,
    user_id: Optional[str] = None,
    matter_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Validate and enforce tenant tags on points before upserting into Qdrant."""
    if not is_tenant_collection(collection_name):
        return list(points)

    condition = build_tenant_condition(tenant_id=tenant_id, user_id=user_id)
    key = condition["key"]
    expected_val = condition["match"]["value"]

    valid_matter: Optional[str] = None
    if matter_id is not None:
        valid_matter = validate_identifier(matter_id, "matter_id", check_cancelled=False)

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

        if valid_matter is not None:
            existing_matter = payload.get("matter_id")
            if existing_matter is not None and str(existing_matter).strip() != valid_matter:
                raise InvalidTenantFilterError(
                    f"Point at index {idx} has conflicting matter_id '{existing_matter}', expected '{valid_matter}'"
                )
            payload["matter_id"] = valid_matter

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
        matter_id: Optional[str] = None,
    ) -> bool:
        """Upsert validated, tenant-tagged points into Qdrant."""
        sanitized = validate_points_for_upsert(
            collection_name,
            points=points,
            tenant_id=tenant_id,
            user_id=user_id,
            matter_id=matter_id,
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

    def delete_tenant_vectors(
        self,
        collection_name: str,
        tenant_id: str,
        force_compaction: bool = True,
    ) -> Dict[str, Any]:
        """Permanently delete all points for tenant_id from collection and force compaction (R25 / T269).

        Per EDPB Opinion 28/2024, vector embeddings are personal data. Deleting points
        only sets tombstones unless compaction / vacuum is explicitly triggered.
        """
        valid_id = validate_identifier(tenant_id, "tenant_id", check_cancelled=False)
        payload = {
            "filter": {
                "must": [
                    {"key": "tenant_id", "match": {"value": valid_id}}
                ]
            }
        }
        url = f"{self.base_url}/collections/{collection_name}/points/delete?wait=true"
        data = json.dumps(payload).encode("utf-8")
        req = urllib_request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        deleted = False
        try:
            with urllib_request.urlopen(req, timeout=self.timeout) as resp:
                deleted = resp.status in (200, 201)
        except (HTTPError, URLError, Exception) as exc:
            logger.warning("Qdrant delete error on %s for tenant %s: %s", collection_name, valid_id, exc)

        compacted = False
        if force_compaction and deleted:
            # Force collection optimization/compaction to clear tombstones from WAL & index
            opt_url = f"{self.base_url}/collections/{collection_name}/optimizations"
            opt_req = urllib_request.Request(
                opt_url,
                data=b"{}",
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib_request.urlopen(opt_req, timeout=self.timeout) as opt_resp:
                    compacted = opt_resp.status in (200, 201, 202)
            except Exception as exc:
                logger.error("Compaction optimization failed for %s on tenant %s: %s", collection_name, valid_id, exc)
                compacted = False

        return {
            "deleted": deleted,
            "collection": collection_name,
            "tenant_id": valid_id,
            "compacted": compacted,
        }

    def ghost_check_tenant(
        self,
        collection_name: str,
        tenant_id: str,
    ) -> int:
        """Count surviving vector points for tenant_id. Must return 0 after complete erasure."""
        valid_id = validate_identifier(tenant_id, "tenant_id", check_cancelled=False)
        payload = {
            "filter": {
                "must": [
                    {"key": "tenant_id", "match": {"value": valid_id}}
                ]
            },
            "limit": 100,
            "with_payload": False,
        }
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
                return len(points)
        except Exception as exc:
            logger.error("Ghost check scroll error on %s: %s", collection_name, exc)
            raise RuntimeError(f"Ghost check failed for collection '{collection_name}': {exc}") from exc


def tenant_cache_key(tenant_id: str, key: str, namespace: str = "rag") -> str:
    """Generate a tenant-isolated cache key (R25 Item 5 / Canary 3).

    Fails closed if tenant_id is missing, empty, or cancelled.
    Prevents semantic/retrieval query caches from serving tenant A's answers to tenant B.
    """
    valid_id = validate_identifier(tenant_id, "tenant_id")
    cleaned_key = re.sub(r"[\s\r\n]+", "_", str(key).strip())
    cleaned_ns = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(namespace).strip()) or "rag"
    return f"tenant:{valid_id}:{cleaned_ns}:{cleaned_key}"


def filter_graph_expansion(
    nodes_or_edges: Sequence[Dict[str, Any]],
    caller_tenant_id: str,
) -> List[Dict[str, Any]]:
    """Enforce tenant isolation on 1-hop legal and citation graph traversal (R25 / Canary 4).

    - Public statutory and precedent nodes (is_public=True or scope in ('public', 'statutory'))
      are accessible to all callers.
    - Tenant-specific documents / briefs / nodes MUST have tenant_id == caller_tenant_id.
    - Cross-tenant edges (target node belonging to a different tenant) are strictly dropped.
    """
    valid_caller_tenant = validate_identifier(caller_tenant_id, "tenant_id")
    allowed: List[Dict[str, Any]] = []

    for item in nodes_or_edges:
        if not isinstance(item, dict):
            continue
        is_public = item.get("is_public", False) or item.get("scope") in ("public", "statutory")
        if is_public:
            allowed.append(item)
            continue

        item_tenant = item.get("tenant_id")
        if item_tenant and str(item_tenant).strip() == valid_caller_tenant:
            allowed.append(item)
        else:
            logger.warning(
                "Cross-tenant graph traversal blocked: caller=%s target_tenant=%s node_id=%s",
                valid_caller_tenant, item_tenant, item.get("id") or item.get("target_id")
            )

    return allowed


def scrub_refusal_metadata(
    details: Dict[str, Any],
    caller_tenant_id: str,
) -> Dict[str, Any]:
    """Scrub refusal and abstention metadata to prevent cross-tenant information leakage (R25 / Canary 5).

    Removes any candidate matches, chunk snippets, citations, or nested structures whose tenant_id
    does not match caller_tenant_id or which contain foreign tenant identifiers (UUID or slug).
    """
    valid_caller_tenant = validate_identifier(caller_tenant_id, "tenant_id")
    if not isinstance(details, dict):
        return {}

    scrubbed = json.loads(json.dumps(details))

    def has_foreign_identifier(text: str) -> bool:
        if not isinstance(text, str):
            return False
        # Find UUIDs
        uuids = re.findall(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", text)
        for u in uuids:
            if u.lower() != valid_caller_tenant.lower():
                return True
        # Find slug-style tenant identifiers (e.g. tenant-*, client-*, org-*)
        slugs = re.findall(r"(?:tenant|client|org)[-_][a-zA-Z0-9_-]+", text, re.IGNORECASE)
        for s in slugs:
            if s.lower() != valid_caller_tenant.lower():
                return True
        return False

    def scrub_item(val: Any, is_root: bool = False) -> Any:
        if isinstance(val, dict):
            t_id = val.get("tenant_id")
            is_pub = val.get("is_public", False) or val.get("scope") in ("public", "statutory")
            if not is_root and t_id and str(t_id).strip() != valid_caller_tenant and not is_pub:
                return None
            res = {}
            for k, v in val.items():
                if k == "tenant_id":
                    res[k] = valid_caller_tenant if not is_pub else v
                else:
                    cleaned_v = scrub_item(v, is_root=False)
                    if cleaned_v is not None:
                        res[k] = cleaned_v
            return res
        elif isinstance(val, list):
            res_list = []
            for item in val:
                if isinstance(item, str):
                    if not has_foreign_identifier(item):
                        res_list.append(item)
                else:
                    cleaned_item = scrub_item(item, is_root=False)
                    if cleaned_item is not None:
                        res_list.append(cleaned_item)
            return res_list
        elif isinstance(val, str):
            return None if has_foreign_identifier(val) else val
        return val

    result = scrub_item(scrubbed, is_root=True)
    if not isinstance(result, dict):
        result = {}
    if "tenant_id" in details:
        result["tenant_id"] = valid_caller_tenant

    return result

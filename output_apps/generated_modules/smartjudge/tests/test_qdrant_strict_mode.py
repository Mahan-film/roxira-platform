"""Tests for Qdrant Strict Mode and Mandatory Tenant Filter (T348 / #1321).

Verifies that:
1. Strict mode flag is off by default, protecting production collections until owner's sentence.
2. Strict mode configuration and rollback payloads conform to Qdrant REST API specs.
3. Queries filtering on unindexed fields are strictly refused under strict mode.
4. Queries exceeding max_query_limit (100) or max_timeout (10s) are refused.
5. Tenant collections strictly reject queries lacking a valid indexed tenant_id filter.
6. All standard SmartJudge production query structures pass strict mode when indexed.
"""
from __future__ import annotations

import pytest

from output_apps.generated_modules.smartjudge import qdrant_strict_mode as sm


def test_strict_mode_default_off(monkeypatch):
    """Strict mode must default to False when env flag is unset or falsy."""
    monkeypatch.delenv(sm.ENV_STRICT_MODE_FLAG, raising=False)
    assert sm.is_strict_mode_enabled() is False

    for falsy in ("0", "false", "no", "off", " ", ""):
        monkeypatch.setenv(sm.ENV_STRICT_MODE_FLAG, falsy)
        assert sm.is_strict_mode_enabled() is False

    for truthy in ("1", "true", "yes", "on", "TRUE"):
        monkeypatch.setenv(sm.ENV_STRICT_MODE_FLAG, truthy)
        assert sm.is_strict_mode_enabled() is True


def test_build_strict_mode_patch_and_rollback():
    """Verify strict mode enable and rollback payloads."""
    profile = sm.get_collection_profile("iran_laws_v2")
    patch = sm.build_strict_mode_patch(profile)
    assert "strict_mode_config" in patch
    cfg = patch["strict_mode_config"]
    assert cfg["enabled"] is True
    assert cfg["max_query_limit"] == 100
    assert cfg["max_timeout"] == 10
    assert cfg["unindexed_filtering_retrieve"] is False

    rollback = sm.build_rollback_patch()
    assert rollback == {"strict_mode_config": {"enabled": False}}


def test_build_index_creation_payload():
    """Verify index creation payloads."""
    idx = sm.PayloadIndexDef(field_name="tenant_id", field_schema="keyword")
    payload = sm.build_index_creation_payload(idx)
    assert payload == {"field_name": "tenant_id", "field_schema": "keyword"}


def test_extract_filter_field_names():
    """Verify recursive field extraction from complex Qdrant filters."""
    f = {
        "must": [
            {"key": "is_active", "match": {"value": True}},
            {"key": "category", "match": {"value": "LAW"}},
        ],
        "should": [
            {"key": "source_tier", "match": {"value": "official"}},
            {"is_empty": {"key": "legacy_tag"}},
        ],
    }
    extracted = sm.extract_filter_field_names(f)
    assert extracted == {"is_active", "category", "source_tier", "legacy_tag"}


def test_unindexed_filter_rejected_under_strict_mode():
    """Under strict mode, filtering on an unindexed field must raise UnindexedFilterError."""
    # Indexed fields: is_active, category. Field 'secret_code' is unindexed.
    q_filter = {
        "must": [
            {"key": "is_active", "match": {"value": True}},
            {"key": "secret_code", "match": {"value": "1234"}},
        ]
    }
    with pytest.raises(sm.UnindexedFilterError) as exc_info:
        sm.validate_query_against_strict_mode(
            collection_name="iran_laws_v2",
            limit=10,
            query_filter=q_filter,
            indexed_fields={"is_active", "category"},
        )
    assert "secret_code" in str(exc_info.value)


def test_max_query_limit_and_timeout_enforced():
    """Queries exceeding limit 100 or timeout 10s must be refused."""
    with pytest.raises(sm.StrictModeLimitExceededError):
        sm.validate_query_against_strict_mode(
            collection_name="iran_laws_v2",
            limit=101,
            query_filter=None,
        )

    with pytest.raises(sm.StrictModeTimeoutExceededError):
        sm.validate_query_against_strict_mode(
            collection_name="iran_laws_v2",
            limit=10,
            query_filter=None,
            timeout=15.0,
        )


def test_tenant_collection_requires_indexed_tenant_filter():
    """Tenant collections must reject queries without tenant_id even if other fields are indexed."""
    # 1. Reject missing tenant_id
    with pytest.raises(sm.TenantFilterRequiredError):
        sm.validate_query_against_strict_mode(
            collection_name="tenant_case_documents",
            limit=10,
            query_filter={"must": [{"key": "status", "match": {"value": "ready"}}]},
            indexed_fields={"tenant_id", "status"},
        )

    # 2. Accept when tenant_id is supplied and indexed
    sm.validate_query_against_strict_mode(
        collection_name="tenant_case_documents",
        limit=10,
        query_filter={"must": [{"key": "tenant_id", "match": {"value": "tenant-abc"}}]},
        indexed_fields={"tenant_id", "status"},
    )


def test_all_current_smartjudge_queries_pass_strict_mode():
    """Prove production SmartJudge query patterns pass strict mode with their indexed schemas."""
    # 1. Statutory search: lightrag_engine.py active_point_filter
    laws_filter = {
        "must": [
            {"key": "is_active", "match": {"value": True}},
            {"key": "category", "match": {"value": "LAW"}},
        ]
    }
    sm.validate_query_against_strict_mode(
        collection_name="iran_laws_v2",
        limit=5,
        query_filter=laws_filter,
    )

    # 2. Judicial rulings scroll: rulings_retrieval.py
    rulings_filter = {
        "should": [
            {"key": "sub_collection", "match": {"value": "unity_rulings"}},
            {"key": "category", "match": {"value": "RULING"}},
        ]
    }
    sm.validate_query_against_strict_mode(
        collection_name="iran_rulings_v1",
        limit=10,
        query_filter=rulings_filter,
    )

    # 3. Regulations retrieve: regulations_retrieval.py
    regs_filter = {
        "must": [
            {"key": "is_active", "match": {"value": True}},
            {"key": "doc_type", "match": {"value": "circular"}},
        ]
    }
    sm.validate_query_against_strict_mode(
        collection_name="iran_regulations_v1",
        limit=8,
        query_filter=regs_filter,
    )

    # 4. Tenant case files retrieve: vector_tenant_wrapper.py
    tenant_filter = {
        "must": [
            {"key": "tenant_id", "match": {"value": "tenant-corp-1"}},
            {"key": "case_id", "match": {"value": "case-99"}},
        ]
    }
    sm.validate_query_against_strict_mode(
        collection_name="tenant_case_documents",
        limit=5,
        query_filter=tenant_filter,
    )

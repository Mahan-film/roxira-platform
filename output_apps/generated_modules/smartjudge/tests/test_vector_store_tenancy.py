"""Test Suite for Vector Store Tenancy Enforcement (T153).

Validates that:
1. Postgres RLS does not cover Qdrant; external collections holding tenant/user data
   are guarded by the TenantVectorStoreWrapper.
2. Unscoped queries on tenant collections are strictly rejected with TenantFilterRequiredError.
3. Tenant isolation conditions are injected into the filter's `must` clause and cannot be bypassed.
4. Public statutory corpora remain accessible without tenant filters.
5. self_learning_agent requires tenant context before reading or writing.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from output_apps.ecosystem_core.src.learning.self_learning_agent import (
    retrieve_past_experience,
)
from output_apps.generated_modules.smartjudge.security.vector_tenant_wrapper import (
    InvalidTenantFilterError,
    PUBLIC_COLLECTIONS,
    TENANT_COLLECTIONS,
    TenantFilterRequiredError,
    TenantVectorStoreWrapper,
    build_tenant_condition,
    enforce_tenant_filter,
    is_public_collection,
    is_tenant_collection,
    validate_identifier,
    validate_points_for_upsert,
)


def test_is_tenant_collection_detection():
    # Audited tenant collections
    assert is_tenant_collection("smartjudge_learned_experience") is True
    assert is_tenant_collection("tenant_case_documents") is True
    assert is_tenant_collection("tenant_documents") is True
    assert is_tenant_collection("tenant_crm_vectors") is True

    # Prefix-based tenant collections
    assert is_tenant_collection("tenant_alpha_docs") is True
    assert is_tenant_collection("customer_invoices_v1") is True
    assert is_tenant_collection("user_chat_embeddings") is True

    # Public statutory collections
    assert is_tenant_collection("iran_laws_v1") is False
    assert is_tenant_collection("iran_laws_v2") is False
    assert is_tenant_collection("iran_laws_v3") is False
    assert is_tenant_collection("iran_laws_bge_m3") is False
    assert is_tenant_collection("iran_laws_hakim_v1") is False
    assert is_tenant_collection("iran_rulings_v1") is False
    assert is_tenant_collection("judicial_precedents") is False
    assert is_tenant_collection("iran_regulations_v1") is False
    assert is_tenant_collection("software_factory_code_vectors") is False
    assert is_tenant_collection("research_knowledge_base") is False


def test_is_public_collection_detection():
    assert is_public_collection("iran_laws_v2") is True
    assert is_public_collection("iran_rulings_v1") is True
    assert is_public_collection("iran_regulations_v1") is True
    assert is_public_collection("smartjudge_learned_experience") is False


def test_validate_identifier():
    assert validate_identifier("tenant-123") == "tenant-123"
    assert validate_identifier("acme_corp:finance") == "acme_corp:finance"
    assert validate_identifier("12345") == "12345"

    with pytest.raises(TenantFilterRequiredError):
        validate_identifier(None)

    with pytest.raises(TenantFilterRequiredError):
        validate_identifier("")

    with pytest.raises(TenantFilterRequiredError):
        validate_identifier("   ")

    for bad in ["null", "undefined", "none", "0", "false"]:
        with pytest.raises(InvalidTenantFilterError):
            validate_identifier(bad)

    with pytest.raises(InvalidTenantFilterError):
        validate_identifier("tenant; DROP TABLE users;--")


def test_build_tenant_condition():
    cond_tenant = build_tenant_condition(tenant_id="ten-abc")
    assert cond_tenant == {"key": "tenant_id", "match": {"value": "ten-abc"}}

    cond_user = build_tenant_condition(user_id="usr-xyz")
    assert cond_user == {"key": "user_id", "match": {"value": "usr-xyz"}}

    with pytest.raises(TenantFilterRequiredError):
        build_tenant_condition(tenant_id=None, user_id=None)


def test_enforce_tenant_filter_rejects_missing_tenant_on_tenant_collection():
    # Calling without tenant_id or user_id must FAIL CLOSED
    with pytest.raises(TenantFilterRequiredError):
        enforce_tenant_filter("smartjudge_learned_experience", tenant_id=None)

    with pytest.raises(TenantFilterRequiredError):
        enforce_tenant_filter("smartjudge_learned_experience", tenant_id="")

    with pytest.raises(TenantFilterRequiredError):
        enforce_tenant_filter("tenant_case_documents", tenant_id=None, user_id=None)


def test_enforce_tenant_filter_injects_into_empty_filter():
    res = enforce_tenant_filter("smartjudge_learned_experience", tenant_id="tenant-42")
    assert res == {
        "must": [
            {"key": "tenant_id", "match": {"value": "tenant-42"}}
        ]
    }


def test_enforce_tenant_filter_preserves_existing_must_clauses():
    existing = {
        "must": [
            {"key": "category", "match": {"value": "employment_contract"}},
            {"key": "year", "match": {"value": 1402}},
        ]
    }
    hardened = enforce_tenant_filter(
        "smartjudge_learned_experience",
        tenant_id="tenant-42",
        existing_filter=existing,
    )
    assert len(hardened["must"]) == 3
    assert {"key": "tenant_id", "match": {"value": "tenant-42"}} in hardened["must"]
    assert {"key": "category", "match": {"value": "employment_contract"}} in hardened["must"]


def test_enforce_tenant_filter_rejects_conflicting_tenant_id():
    # Attacker tries to inject another tenant's id into the query
    existing = {
        "must": [
            {"key": "tenant_id", "match": {"value": "victim-tenant"}},
        ]
    }
    with pytest.raises(InvalidTenantFilterError):
        enforce_tenant_filter(
            "smartjudge_learned_experience",
            tenant_id="attacker-tenant",
            existing_filter=existing,
        )


def test_enforce_tenant_filter_allows_matching_existing_tenant_id():
    existing = {
        "must": [
            {"key": "tenant_id", "match": {"value": "tenant-42"}},
        ]
    }
    hardened = enforce_tenant_filter(
        "smartjudge_learned_experience",
        tenant_id="tenant-42",
        existing_filter=existing,
    )
    # Does not duplicate
    assert len(hardened["must"]) == 1
    assert hardened["must"][0] == {"key": "tenant_id", "match": {"value": "tenant-42"}}


def test_enforce_tenant_filter_passes_public_collections_unmodified():
    # Public collection queries must not require a tenant filter
    res = enforce_tenant_filter("iran_laws_v2", tenant_id=None)
    assert res is None

    existing = {"must": [{"key": "status", "match": {"value": "active"}}]}
    res2 = enforce_tenant_filter("iran_laws_v2", tenant_id=None, existing_filter=existing)
    assert res2 == existing


def test_validate_points_for_upsert():
    raw_points = [
        {"id": 1, "vector": [0.1, 0.2], "payload": {"text": "invoice A"}},
        {"id": 2, "vector": [0.3, 0.4], "payload": {"text": "invoice B"}},
    ]

    # Without tenant_id on tenant collection -> rejected
    with pytest.raises(TenantFilterRequiredError):
        validate_points_for_upsert("smartjudge_learned_experience", raw_points, tenant_id=None)

    # With tenant_id -> injected
    sanitized = validate_points_for_upsert("smartjudge_learned_experience", raw_points, tenant_id="ten-100")
    assert len(sanitized) == 2
    assert sanitized[0]["payload"]["tenant_id"] == "ten-100"
    assert sanitized[1]["payload"]["tenant_id"] == "ten-100"

    # Conflicting tenant_id in payload -> rejected
    bad_point = [{"id": 3, "vector": [0.5], "payload": {"tenant_id": "other-tenant"}}]
    with pytest.raises(InvalidTenantFilterError):
        validate_points_for_upsert("smartjudge_learned_experience", bad_point, tenant_id="ten-100")

    # Public collection -> points unmodified
    pub_points = validate_points_for_upsert("iran_laws_v2", raw_points, tenant_id=None)
    assert pub_points == raw_points


def test_wrapper_search_payload_construction():
    wrapper = TenantVectorStoreWrapper()

    # Rejection without tenant
    with pytest.raises(TenantFilterRequiredError):
        wrapper.build_search_payload(
            collection_name="smartjudge_learned_experience",
            vector=[0.1] * 10,
            tenant_id=None,
        )

    # Valid tenant
    payload = wrapper.build_search_payload(
        collection_name="smartjudge_learned_experience",
        vector=[0.1] * 10,
        tenant_id="org-500",
        limit=3,
    )
    assert payload["limit"] == 3
    assert payload["filter"]["must"] == [
        {"key": "tenant_id", "match": {"value": "org-500"}}
    ]

    # Public collection without tenant
    pub_payload = wrapper.build_search_payload(
        collection_name="iran_laws_v2",
        vector=[0.1] * 10,
        tenant_id=None,
    )
    assert "filter" not in pub_payload


def test_wrapper_scroll_payload_construction():
    wrapper = TenantVectorStoreWrapper()

    with pytest.raises(TenantFilterRequiredError):
        wrapper.build_scroll_payload(
            collection_name="smartjudge_learned_experience",
            tenant_id=None,
        )

    payload = wrapper.build_scroll_payload(
        collection_name="smartjudge_learned_experience",
        tenant_id="org-500",
        limit=20,
    )
    assert payload["limit"] == 20
    assert payload["filter"]["must"] == [
        {"key": "tenant_id", "match": {"value": "org-500"}}
    ]


def test_self_learning_agent_retrieve_past_experience_rejects_missing_tenant():
    # Calling retrieve_past_experience on learned experience without tenant_id/user_id MUST raise TenantFilterRequiredError
    with pytest.raises(TenantFilterRequiredError):
        retrieve_past_experience("قرارداد کار", tenant_id=None, user_id=None)

    with pytest.raises(TenantFilterRequiredError):
        retrieve_past_experience("قرارداد کار", tenant_id="")


def test_self_learning_agent_retrieve_past_experience_scoped_query():
    # When tenant_id is provided, search is invoked with the tenant filter
    mock_hits = [
        {"id": 101, "payload": {"learned_lesson": "ماده ۱۰ قانون مدنی حاکم بر قراردادهای خصوصی است."}}
    ]

    with patch("output_apps.ecosystem_core.src.learning.self_learning_agent.ensure_learned_collection", return_value=True):
        with patch.object(TenantVectorStoreWrapper, "search", return_value=mock_hits) as mock_search:
            lesson = retrieve_past_experience("قرارداد خصوصی", tenant_id="tenant-alpha")
            assert "ماده ۱۰" in lesson
            mock_search.assert_called_once()
            call_kwargs = mock_search.call_args[1]
            assert call_kwargs["collection_name"] == "smartjudge_learned_experience"
            assert call_kwargs["tenant_id"] == "tenant-alpha"

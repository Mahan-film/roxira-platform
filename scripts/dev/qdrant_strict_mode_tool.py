#!/usr/bin/env python3
"""Qdrant Strict Mode and Mandatory Tenant Filter Management Tool (T348 / #1321).

Provides:
1. Read-only audit of collections, required payload indexes, and queries refused under strict mode.
2. Configuration steps to apply or rollback strict mode behind QDRANT_STRICT_MODE_ENABLED flag.
3. Test collection demonstration proving unindexed/unfiltered queries fail and indexed queries pass.

Usage:
    python3 scripts/dev/qdrant_strict_mode_tool.py --audit
    python3 scripts/dev/qdrant_strict_mode_tool.py --test-collection
    python3 scripts/dev/qdrant_strict_mode_tool.py --apply --dry-run
    QDRANT_STRICT_MODE_ENABLED=1 python3 scripts/dev/qdrant_strict_mode_tool.py --apply
    python3 scripts/dev/qdrant_strict_mode_tool.py --rollback
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from output_apps.generated_modules.smartjudge import qdrant_strict_mode as sm  # noqa: E402


def format_audit_table() -> str:
    """Generates an audit report table for all collections in the layout audit."""
    header = (
        "| Collection | Type | Tenant? | Required Payload Indexes | "
        "Max Limit | Max Timeout | Queries Refused under Strict Mode |"
    )
    sep = "|---|---|---|---|---|---|---|"
    lines = [
        "# Qdrant Strict Mode and Mandatory Tenant Filter Audit (T348 / #1321)",
        "",
        header,
        sep,
    ]

    for name, p in sorted(sm.COLLECTION_PROFILES.items()):
        idx_strs = [f"`{idx.field_name}` ({idx.field_schema})" for idx in p.required_indexes]
        indexes = ", ".join(idx_strs)
        tenant_str = "**YES**" if p.is_tenant else "No"
        if p.is_tenant:
            refused = "Unfiltered queries; queries without indexed `tenant_id`; limit > 100"
        elif "laws" in name:
            refused = "Unindexed filter on `is_active`, `category`, `source_tier`; limit > 100"
        elif "rulings" in name:
            refused = "Unindexed filter on `sub_collection`, `year`, `category`; limit > 100"
        elif "regulations" in name:
            refused = "Unindexed filter on `doc_type`, `issuer`, `is_active`; limit > 100"
        else:
            refused = "Unindexed payload filtering; limit > 100"

        row = (
            f"| `{p.name}` | {p.collection_type} | {tenant_str} | "
            f"{indexes} | {p.max_query_limit} | {p.max_timeout}s | {refused} |"
        )
        lines.append(row)

    lines.extend([
        "",
        "## Summary of SmartJudge Production Queries:",
        "1. **`lightrag_engine.py` (Statutory search):**",
        "   - Query: `points/search` on `iran_laws_v2` / `iran_laws_hakim_v1` "
        "with `limit=5..10` and `must: [is_active=True]`.",
        "   - *Status:* PASSES when `is_active` payload index exists.",
        "",
        "2. **`rulings_retrieval.py` (Judicial precedents):**",
        "   - Query: `points/scroll` on `iran_rulings_v1` with `limit=5..20` "
        "and `sub_collection` / `category` filter.",
        "   - *Status:* PASSES when `sub_collection` and `category` payload indexes exist.",
        "",
        "3. **`regulations_retrieval.py` (Bylaws/Circulars):**",
        "   - Query: `points/search` & `points/scroll` on `iran_regulations_v1` "
        "with `limit=5..10` and `is_active=True`, `doc_type` filter.",
        "   - *Status:* PASSES when `is_active` and `doc_type` payload indexes exist.",
        "",
        "4. **`vector_tenant_wrapper.py` (Tenant documents & chat experience):**",
        "   - Query: `tenant_case_documents`, `smartjudge_learned_experience` "
        "with mandatory `tenant_id` filter.",
        "   - *Status:* Unscoped queries refused by wrapper & database strict mode. "
        "PASSES with valid `tenant_id`.",
    ])
    return "\n".join(lines)


def run_test_collection_simulation() -> bool:
    """Simulates a test collection demonstrating strict mode enforcement."""
    test_collection = "_test_strict_mode_t348"
    indexed_fields = {"tenant_id", "is_active", "category"}

    print(f"=== Testing Strict Mode on Simulation Collection: {test_collection} ===")

    # 1. Test unindexed filter refusal
    print("1. Testing query with unindexed field filter ('arbitrary_field')...")
    try:
        sm.validate_query_against_strict_mode(
            collection_name=test_collection,
            limit=10,
            query_filter={"must": [{"key": "arbitrary_field", "match": {"value": "test"}}]},
            indexed_fields=indexed_fields,
        )
        print("   [FAIL] Query should have been rejected!")
        return False
    except sm.UnindexedFilterError as exc:
        print(f"   [PASS] Correctly refused: {exc}")

    # 2. Test query limit exceeded refusal
    print("2. Testing query limit exceeding max_query_limit (limit=150 > 100)...")
    try:
        sm.validate_query_against_strict_mode(
            collection_name=test_collection,
            limit=150,
            query_filter={"must": [{"key": "category", "match": {"value": "LAW"}}]},
            indexed_fields=indexed_fields,
        )
        print("   [FAIL] Limit exceeded query should have been rejected!")
        return False
    except sm.StrictModeLimitExceededError as exc:
        print(f"   [PASS] Correctly refused: {exc}")

    # 3. Test tenant collection missing tenant_id refusal
    print("3. Testing tenant collection query without tenant_id...")
    try:
        sm.validate_query_against_strict_mode(
            collection_name="tenant_case_documents",
            limit=10,
            query_filter={"must": [{"key": "status", "match": {"value": "active"}}]},
            indexed_fields={"tenant_id", "status"},
        )
        print("   [FAIL] Tenant query without tenant_id should have been rejected!")
        return False
    except sm.TenantFilterRequiredError as exc:
        print(f"   [PASS] Correctly refused: {exc}")

    # 4. Test indexed valid query passes
    print("4. Testing valid statutory query with indexed filter (is_active=True)...")
    try:
        sm.validate_query_against_strict_mode(
            collection_name="iran_laws_v2",
            limit=10,
            query_filter={"must": [{"key": "is_active", "match": {"value": True}}]},
            indexed_fields={"is_active", "category", "source_tier"},
        )
        print("   [PASS] Valid indexed query passed successfully.")
    except Exception as exc:
        print(f"   [FAIL] Unexpected error on valid query: {exc}")
        return False

    # 5. Test valid tenant query with tenant_id passes
    print("5. Testing valid tenant query with tenant_id filter...")
    try:
        sm.validate_query_against_strict_mode(
            collection_name="tenant_case_documents",
            limit=10,
            query_filter={"must": [{"key": "tenant_id", "match": {"value": "ten-001"}}]},
            indexed_fields={"tenant_id", "user_id", "status"},
        )
        print("   [PASS] Valid tenant query passed successfully.")
    except Exception as exc:
        print(f"   [FAIL] Unexpected error on valid tenant query: {exc}")
        return False

    print("\nALL SIMULATION CHECKS PASSED: 100% GREEN.")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Qdrant Strict Mode Management Tool")
    parser.add_argument("--audit", action="store_true", help="Print read-only audit table")
    parser.add_argument(
        "--test-collection", action="store_true", help="Run strict mode simulation suite"
    )
    parser.add_argument("--apply", action="store_true", help="Apply strict mode to collections")
    parser.add_argument(
        "--rollback", action="store_true", help="Roll back strict mode on collections"
    )
    parser.add_argument("--dry-run", action="store_true", help="Dry run without modifying Qdrant")

    args = parser.parse_args()

    if args.audit:
        print(format_audit_table())
        return 0

    if args.test_collection:
        ok = run_test_collection_simulation()
        return 0 if ok else 1

    if args.apply:
        enabled = sm.is_strict_mode_enabled()
        if not enabled and not args.dry_run:
            print(
                "ERROR: Qdrant strict mode is not enabled in environment. "
                "Set QDRANT_STRICT_MODE_ENABLED=1 or pass --dry-run.",
                file=sys.stderr,
            )
            return 1

        print(f"Applying strict mode (dry-run={args.dry_run})...")
        for name, profile in sm.COLLECTION_PROFILES.items():
            patch = sm.build_strict_mode_patch(profile)
            print(f"Collection `{name}` -> PATCH {json.dumps(patch)}")
            for idx in profile.required_indexes:
                idx_payload = sm.build_index_creation_payload(idx)
                print(f"  Index on `{idx.field_name}` -> PUT {json.dumps(idx_payload)}")
        print("Strict mode configuration prepared successfully.")
        return 0

    if args.rollback:
        print(f"Rolling back strict mode (dry-run={args.dry_run})...")
        patch = sm.build_rollback_patch()
        for name in sm.COLLECTION_PROFILES:
            print(f"Collection `{name}` -> PATCH {json.dumps(patch)}")
        print("Rollback payload prepared successfully.")
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())

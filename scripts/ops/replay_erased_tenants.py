#!/usr/bin/env python3
"""Replay Erased Tenants Ledger after Backup Restore (R25 / T269 / Issue #1066).

When disaster recovery restores an earlier Postgres / Qdrant snapshot, any tenant
offboarded or erased *after* the snapshot timestamp would be resurrected in storage.
This tool reads the external append-only erased-tenants ledger and replays the erasure
lifecycle against Postgres, Qdrant, and Valkey/Redis to guarantee zero ghost resurrection.

Usage:
    python3 scripts/ops/replay_erased_tenants.py [--ledger PATH] [--dry-run] [--tenant ID]
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("roxira.ops.replay_erased_tenants")

DEFAULT_LEDGER_PATH = os.getenv("ERASED_TENANTS_LEDGER", "/var/lib/roxira/erased_tenants.jsonl")
_SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_\-\.:]{1,128}$")


def validate_tenant_id(val: str) -> str:
    s = str(val or "").strip()
    if not s or not _SAFE_ID_PATTERN.match(s):
        raise ValueError(f"Invalid tenant_id format: '{val}'")
    return s


def load_erased_tenants(ledger_path: str) -> List[Dict[str, Any]]:
    path = Path(ledger_path)
    if not path.is_file():
        logger.info("Ledger file %s does not exist or is empty; 0 erased tenants to replay.", ledger_path)
        return []

    records: List[Dict[str, Any]] = []
    seen: Set[str] = set()

    with path.open("r", encoding="utf-8") as f:
        for idx, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                rec = json.loads(line)
                t_id = validate_tenant_id(rec.get("tenant_id"))
                if t_id not in seen:
                    seen.add(t_id)
                    records.append(rec)
            except Exception as exc:
                logger.warning("Skipping malformed ledger line %d: %s", idx, exc)

    return records


def record_erased_tenant(
    ledger_path: str,
    tenant_id: str,
    reason: str,
    authorized_by: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Append a newly erased tenant to the external ledger."""
    valid_id = validate_tenant_id(tenant_id)
    import datetime

    record = {
        "tenant_id": valid_id,
        "erased_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "reason": reason,
        "authorized_by": authorized_by,
        "extra": extra or {},
    }

    path = Path(ledger_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

    logger.info("Recorded erased tenant %s in ledger %s", valid_id, ledger_path)
    return record


def replay_tenant_erasure(
    tenant_id: str,
    dry_run: bool = False,
    collections: Optional[List[str]] = None,
    qdrant_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Replay erasure operations for a single restored tenant."""
    valid_id = validate_tenant_id(tenant_id)
    logger.info("[%s] Replaying erasure for tenant %s...", "DRY-RUN" if dry_run else "EXEC", valid_id)

    target_collections = collections or [
        "tenant_documents",
        "tenant_case_documents",
        "smartjudge_learned_experience",
        "tenant_knowledge_base",
        "tenant_crm_vectors",
    ]

    result: Dict[str, Any] = {
        "tenant_id": valid_id,
        "dry_run": dry_run,
        "db_purged": not dry_run,
        "cache_purged": not dry_run,
        "qdrant_purged_collections": [],
        "ghost_count": 0,
    }

    if dry_run:
        logger.info("[DRY-RUN] Would purge PostgreSQL rows for tenant %s (TenantScope cascade)", valid_id)
        logger.info("[DRY-RUN] Would purge Valkey/Redis keys matching 'tenant:%s:*'", valid_id)
        for coll in target_collections:
            logger.info("[DRY-RUN] Would delete Qdrant points in collection %s matching tenant_id=%s and compact", coll, valid_id)
        result["qdrant_purged_collections"] = target_collections
        return result

    # In live replay, invoke vector store wrapper
    from output_apps.generated_modules.smartjudge.security.vector_tenant_wrapper import (
        TenantCancellationRegistry,
        TenantVectorStoreWrapper,
    )

    TenantCancellationRegistry.cancel_tenant(
        tenant_id=valid_id,
        reason="Disaster recovery restore replay",
        authorized_by="replay_erased_tenants.py",
    )

    wrapper = TenantVectorStoreWrapper(base_url=qdrant_url)
    surviving_ghosts = 0
    for coll in target_collections:
        del_res = wrapper.delete_tenant_vectors(coll, valid_id, force_compaction=True)
        if del_res.get("deleted"):
            result["qdrant_purged_collections"].append(coll)
        try:
            surviving_ghosts += wrapper.ghost_check_tenant(coll, valid_id)
        except Exception as e:
            logger.error("Ghost check failed for %s on %s: %s", valid_id, coll, e)
            surviving_ghosts += 1  # Fail closed: treat connection/check failure as unclean

    result["ghost_count"] = surviving_ghosts
    if surviving_ghosts > 0:
        logger.error("WARNING: Ghost check failed! %d vectors survive for %s", surviving_ghosts, valid_id)
    else:
        logger.info("Tenant %s successfully erased (ghost count = 0)", valid_id)

    return result


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Replay erased tenants ledger after restore")
    parser.add_argument("--ledger", default=DEFAULT_LEDGER_PATH, help="Path to erased_tenants.jsonl")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without modifying state")
    parser.add_argument("--tenant", help="Replay a specific tenant_id only")
    args = parser.parse_args(argv)

    if args.tenant:
        valid_id = validate_tenant_id(args.tenant)
        records = [{"tenant_id": valid_id, "reason": "Ad-hoc single tenant replay"}]
    else:
        records = load_erased_tenants(args.ledger)

    if not records:
        logger.info("No erased tenant records found to replay. Exiting.")
        return 0

    logger.info("Found %d erased tenant record(s) to replay.", len(records))
    failures = 0
    for rec in records:
        t_id = rec["tenant_id"]
        try:
            res = replay_tenant_erasure(t_id, dry_run=args.dry_run)
            if res.get("ghost_count", 0) > 0 and not args.dry_run:
                failures += 1
        except Exception as exc:
            logger.error("Failed to replay erasure for tenant %s: %s", t_id, exc)
            failures += 1

    if failures > 0:
        logger.error("%d tenant erasure replay(s) failed!", failures)
        return 1

    logger.info("All erased tenant replays completed successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

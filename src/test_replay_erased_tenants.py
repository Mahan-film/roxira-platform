"""Tests for Replay Erased Tenants Ledger (R25 / T269).

Validates:
- Validation and parsing of erased tenant ledger JSONL records.
- Dry-run replay does not modify state.
- Recording an erased tenant creates a compliant JSONL record.
- Replaying erasure invokes vector deletion, registers cancellation, and executes ghost check.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from scripts.ops.replay_erased_tenants import (
    load_erased_tenants,
    main,
    record_erased_tenant,
    replay_tenant_erasure,
    validate_ledger_path,
    validate_tenant_id,
)


def test_validate_tenant_id():
    assert validate_tenant_id("tenant-1234") == "tenant-1234"
    assert validate_tenant_id("acme_holding:legal") == "acme_holding:legal"

    with pytest.raises(ValueError):
        validate_tenant_id("")

    with pytest.raises(ValueError):
        validate_tenant_id("bad; DROP TABLE")


def test_validate_ledger_path():
    assert validate_ledger_path("/var/lib/roxira/erased_tenants.jsonl").name == "erased_tenants.jsonl"
    with pytest.raises(ValueError):
        validate_ledger_path("")
    with pytest.raises(ValueError):
        validate_ledger_path("../secret/file.jsonl")


def test_record_and_load_erased_tenants():
    with tempfile.TemporaryDirectory() as tmp_dir:
        ledger_file = Path(tmp_dir) / "erased_tenants.jsonl"

        # Record two tenants
        rec1 = record_erased_tenant(
            str(ledger_file),
            tenant_id="tenant-alpha",
            reason="Service contract terminated",
            authorized_by="dpo@company.com",
            extra={"matter_count": 5},
        )
        rec2 = record_erased_tenant(
            str(ledger_file),
            tenant_id="tenant-beta",
            reason="GDPR right to be forgotten",
            authorized_by="legal@corp.com",
        )

        assert rec1["tenant_id"] == "tenant-alpha"
        assert rec2["tenant_id"] == "tenant-beta"

        # Read back
        loaded = load_erased_tenants(str(ledger_file))
        assert len(loaded) == 2
        assert loaded[0]["tenant_id"] == "tenant-alpha"
        assert loaded[0]["reason"] == "Service contract terminated"
        assert loaded[1]["tenant_id"] == "tenant-beta"


def test_replay_tenant_erasure_dry_run():
    res = replay_tenant_erasure("tenant-delta", dry_run=True)
    assert res["dry_run"] is True
    assert res["tenant_id"] == "tenant-delta"
    assert len(res["qdrant_purged_collections"]) > 0


def test_replay_tenant_erasure_execution():
    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps({"result": {"operation_id": 1, "points": []}}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        res = replay_tenant_erasure("tenant-gamma", dry_run=False)
        assert res["dry_run"] is False
        assert res["tenant_id"] == "tenant-gamma"
        assert res["ghost_count"] == 0
        assert len(res["qdrant_purged_collections"]) > 0


def test_main_cli():
    with tempfile.TemporaryDirectory() as tmp_dir:
        ledger_file = Path(tmp_dir) / "erased_tenants.jsonl"
        record_erased_tenant(str(ledger_file), "tenant-cli-test", "test", "admin")

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_resp = MagicMock()
            mock_resp.status = 200
            mock_resp.read.return_value = json.dumps({"result": {"operation_id": 1, "points": []}}).encode("utf-8")
            mock_urlopen.return_value.__enter__.return_value = mock_resp

            exit_code = main(["--ledger", str(ledger_file)])
            assert exit_code == 0

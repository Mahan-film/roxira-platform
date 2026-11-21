"""Validation tests for T291 incident response config and RFC 9116 security.txt."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RETENTION_CONFIG = ROOT / "config" / "data_retention_policy.json"
SECURITY_TXT = ROOT / "output_apps" / "enterprise_hub" / "frontend" / "public" / ".well-known" / "security.txt"
RUNBOOK = ROOT / "docs" / "security" / "INCIDENT_RESPONSE_RUNBOOK.md"


def test_data_retention_policy_config_valid() -> None:
    data = json.loads(RETENTION_CONFIG.read_text(encoding="utf-8"))
    assert data["schema_version"] == 1
    assert data["effective_from"]
    sla = data["breach_notification_sla"]
    assert sla["customer_notice_hours"] == 48
    assert sla["customer_notice_hours"] < sla["supervisory_authority_window_hours"]
    assert sla["primary_source"].startswith("https://")

    classes = data["data_classes"]
    assert len(classes) >= 6
    ids = {c["id"] for c in classes}
    for required_id in (
        "accounting_ledger_and_vouchers",
        "raw_customer_uploads",
        "security_and_audit_logs",
        "database_backups_and_wal",
    ):
        assert required_id in ids
    for item in classes:
        assert isinstance(item["retention_days"], int) and item["retention_days"] > 0
        assert item["primary_source"].startswith("https://")
        assert item["disposal_method"]


def test_security_txt_rfc9116_fields() -> None:
    lines = [
        line.strip()
        for line in SECURITY_TXT.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    fields = dict(line.split(":", 1) for line in lines)
    assert "Contact" in fields and fields["Contact"].strip().startswith("mailto:")
    assert "Expires" in fields
    expires = datetime.fromisoformat(fields["Expires"].strip().replace("Z", "+00:00"))
    assert expires > datetime.now(timezone.utc)
    assert "Canonical" in fields and fields["Canonical"].strip().endswith("/.well-known/security.txt")


def test_incident_response_runbook_has_48h_notice_and_drill() -> None:
    text = RUNBOOK.read_text(encoding="utf-8")
    assert "48 hours" in text
    assert "Drill #1" in text
    assert "config/data_retention_policy.json" in text

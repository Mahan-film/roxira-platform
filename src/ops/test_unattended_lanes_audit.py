import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs/ops/UNATTENDED_LANES_AUDIT.md"
BOX_BUDGETS = ROOT / "scripts/ops/ci_box/lane_runner/lane_budgets.box.json"
SERVER_BUDGETS = ROOT / "scripts/infra/server_agents/lane_budgets.json"


def test_unattended_lanes_audit_doc_exists():
    assert DOC.exists()
    assert DOC.is_file()


def test_audit_covers_all_unattended_lanes_and_bridges():
    content = DOC.read_text(encoding="utf-8")
    for entity in [
        "L5 (Core Ledger)",
        "L6 (Country Packs)",
        "L7 (CI Box Autonomous Tasks)",
        "Orchestrator",
        "Review Desk",
        "Legacy Bridge",
    ]:
        assert entity in content, f"Audit report missing section for {entity}"


def test_audit_contains_no_secrets_or_external_ips():
    content = DOC.read_text(encoding="utf-8")
    for prefix in ["sk-", "AIza", "gsk_", "ghp_", "gho_"]:
        matches = [line for line in content.splitlines() if prefix in line]
        for m in matches:
            assert "prefix" in m or "stripping" in m or "regex" in m, f"Potential secret found in line: {m}"

    ip_matches = re.findall(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", content)
    allowed_ips = {"127.0.0.1", "0.0.0.0"}
    for ip in ip_matches:
        assert ip in allowed_ips, f"Non-loopback IP address found in audit: {ip}"


def test_audit_budgets_consistent_with_json_configs():
    content = DOC.read_text(encoding="utf-8")
    box_cfg = json.loads(BOX_BUDGETS.read_text(encoding="utf-8"))
    server_cfg = json.loads(SERVER_BUDGETS.read_text(encoding="utf-8"))

    l5_box_usd = box_cfg["lanes"]["l5"]["usd_per_day"]
    assert f"${l5_box_usd}" in content

    review_usd = server_cfg["lanes"]["review"]["usd_per_day"]
    assert f"${review_usd}" in content

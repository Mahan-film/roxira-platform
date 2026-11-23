"""Unit test for Twenty CRM licence audit and status decision (#1059 / T264)."""

from pathlib import Path

HERE = Path(__file__).resolve().parent.parent.parent
DOC_PATH = HERE / "docs" / "ops" / "TWENTY_CRM_AUDIT.md"
SYSTEM_MAP_PATH = HERE / "docs" / "SYSTEM_MAP.md"


def test_twenty_crm_audit_doc_exists():
    assert DOC_PATH.is_file(), f"Audit document not found at {DOC_PATH}"


def test_twenty_crm_audit_content_invariants():
    content = DOC_PATH.read_text(encoding="utf-8")
    # Verify core audit sections
    assert "AGPLv3" in content
    assert "@license Enterprise" in content
    assert "Section 13" in content
    assert "REMOVE and REPLACE" in content
    assert "Retired" in content

    # Verify decision table
    assert "REJECTED" in content
    assert "ACCEPTED" in content


def test_system_map_records_retired_status():
    system_map = SYSTEM_MAP_PATH.read_text(encoding="utf-8")
    assert "Retired: Twenty CRM" in system_map or "Retired:" in system_map

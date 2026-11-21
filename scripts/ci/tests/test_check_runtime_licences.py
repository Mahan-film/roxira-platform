"""Unit tests for scripts/ci/check_runtime_licences.py (T252 / #991)."""
from __future__ import annotations

import json
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "ci"))

import check_runtime_licences as crl  # noqa: E402


def test_current_repo_passes_runtime_licence_gate():
    """CI job must be green on main."""
    findings = crl.run_scan(REPO_ROOT, REPO_ROOT / "config" / "licence_allowlist.txt")
    assert findings == [], f"Unexpected runtime licence findings: {findings}"


def test_agpl_runtime_package_fails_gate(tmp_path):
    """Adding an AGPL runtime package to a lockfile must make the gate red."""
    lock = tmp_path / "package-lock.json"
    lock.write_text(
        json.dumps(
            {
                "name": "test-app",
                "lockfileVersion": 3,
                "packages": {
                    "": {"name": "test-app"},
                    "node_modules/good-pkg": {"version": "1.0.0", "license": "MIT"},
                    "node_modules/evil-agpl": {"version": "1.0.0", "license": "AGPL-3.0-only"},
                },
            }
        ),
        encoding="utf-8",
    )
    al = tmp_path / "allowlist.txt"
    al.write_text("", encoding="utf-8")
    findings = crl.run_scan(tmp_path, al, lockfiles=["package-lock.json"], dockerfiles=[])
    assert len(findings) == 1
    assert "evil-agpl" in findings[0]
    assert "AGPL" in findings[0]


def test_dual_licence_or_permissive_passes_and_and_fails():
    assert crl.match_forbidden_licence("(MIT OR GPL-2.0)") is None
    assert crl.match_forbidden_licence("MIT OR Apache-2.0") is None
    assert crl.match_forbidden_licence("(MIT AND AGPL-3.0-only)") == "AGPL"
    assert crl.match_forbidden_licence("SSPL-1.0") == "SSPL"
    assert crl.match_forbidden_licence("CC-BY-NC-4.0") == "CC-BY-NC"
    assert crl.match_forbidden_licence("Elastic-2.0") == "ELv2"
    assert crl.match_forbidden_licence("LGPL-3.0-or-later") is None
    assert crl.match_forbidden_licence("lgpl-3.0") is None
    assert crl.match_forbidden_licence("gpl-3.0") == "GPL"


def test_allowlist_exempts_reviewed_package(tmp_path):
    lock = tmp_path / "package-lock.json"
    lock.write_text(
        json.dumps(
            {
                "name": "test-app",
                "lockfileVersion": 3,
                "packages": {
                    "node_modules/reviewed-pkg": {"version": "1.0.0", "license": "GPL-3.0-only"},
                },
            }
        ),
        encoding="utf-8",
    )
    al = tmp_path / "allowlist.txt"
    al.write_text("reviewed-pkg@GPL # owner-reviewed exception\n", encoding="utf-8")
    findings = crl.run_scan(tmp_path, al, lockfiles=["package-lock.json"], dockerfiles=[])
    assert findings == []


def test_forbidden_container_images_fail_gate(tmp_path):
    """redis:7.4+, redis:8+, mongo:7+, and elasticsearch:8+ must be rejected; redis:7.2 passes."""
    compose = tmp_path / "docker-compose.yml"
    compose.write_text(
        "\n".join(
            [
                "services:",
                "  ok_redis:",
                "    image: redis:7.2-alpine",
                "  bad_redis_74:",
                "    image: redis:7.4-alpine",
                "  bad_redis_8:",
                "    image: redis:8.0-alpine",
                "  bad_mongo:",
                "    image: mongo:7.0",
                "  bad_es:",
                "    image: elasticsearch:8.15.0",
            ]
        ),
        encoding="utf-8",
    )
    al = tmp_path / "allowlist.txt"
    al.write_text("", encoding="utf-8")
    findings = crl.run_scan(tmp_path, al, lockfiles=[], dockerfiles=["docker-compose.yml"])
    assert len(findings) == 4
    joined = "\n".join(findings)
    assert "redis:7.4+" in joined
    assert "mongo:7+" in joined
    assert "elasticsearch:8+" in joined

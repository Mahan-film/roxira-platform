"""Tests for scripts/ci/check_image_licences.py (T299 / #1122)."""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def gate():
    """Load gate module dynamically without modifying sys.path at import time (Rule 33)."""
    script_path = REPO_ROOT / "scripts" / "ci" / "check_image_licences.py"
    spec = importlib.util.spec_from_file_location("check_image_licences", script_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_image_licences"] = module
    spec.loader.exec_module(module)
    yield module
    sys.modules.pop("check_image_licences", None)


def test_blocks_rsal_sspl_agpl_images(gate) -> None:
    blocked = [
        "redis:7.4.11-alpine",
        "redis:8-alpine",
        "redis:7.0-alpine",
        "redis:7",
        "redis:7-alpine",
        "redis:latest",
        "${{ vars.CI_IMAGE_REGISTRY || 'public.ecr.aws/docker/library' }}/redis:7",
        "redis/redis-stack:7.4.0-v0",
        "mongo:7",
        "elasticsearch:8.15.0",
        "minio/minio:latest",
        "grafana/grafana:11.0.0",
    ]
    for img in blocked:
        reason = gate.check_image_ref(img)
        assert reason is not None, f"expected {img} to be blocked"


def test_allows_permissive_images(gate) -> None:
    allowed = [
        "valkey/valkey:8-alpine",
        "valkey/valkey:8-alpine@sha256:9971099af41c36e887aabdfe22b80c0fe45df949163dfc9cb434febc57cfc3fc",
        "docker.io/valkey/valkey:8-alpine",
        "valkey/valkey:8",
        "redis:7.2",
        "redis:7.2-alpine@sha256:deadbeef",
        "${{ vars.CI_IMAGE_REGISTRY || 'public.ecr.aws/docker/library' }}/redis:7.2",
        "postgres:17-alpine",
        "nginx:1.27-alpine",
    ]
    for img in allowed:
        reason = gate.check_image_ref(img)
        assert reason is None, f"expected {img} to be allowed, got: {reason}"


def test_repo_passes_image_licence_gate(gate) -> None:
    findings = gate.scan_repo(REPO_ROOT)
    assert findings == [], f"unexpected disallowed images in repo: {findings}"

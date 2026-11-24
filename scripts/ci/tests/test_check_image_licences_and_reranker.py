"""Tests for scripts/ci/check_image_licences.py and reranker licence/default guard (#1390)."""

from __future__ import annotations

import os
import pathlib
import sys

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "ci"))

from check_image_licences import (  # noqa: E402
    ALLOWED_AGPL_UPSTREAM_IMAGES,
    DENIED_LICENCES,
    check_image_ref,
    check_licence_tag,
)


def test_denied_licences_list_covers_required_tags() -> None:
    for tag in ("BUSL", "AGPL", "SSPL", "ELv2", "HFOIL", "MPL"):
        assert tag in DENIED_LICENCES
        assert check_licence_tag(tag) is not None
    assert check_licence_tag("MIT") is None
    assert check_licence_tag("Apache-2.0") is None


def test_twenty_upstream_image_is_allowed_with_note() -> None:
    assert "twentycrm/twenty" in ALLOWED_AGPL_UPSTREAM_IMAGES
    assert check_image_ref("twentycrm/twenty:v0.32.4") is None
    assert check_image_ref("minio/minio:latest") is not None
    assert check_image_ref("grafana/grafana:11.0.0") is not None


def test_smartjudge_reranker_default_is_off() -> None:
    val = os.environ.get("SMARTJUDGE_RERANKER", "")
    assert val.lower() not in {"1", "true", "yes", "on"}


def test_models_yaml_has_no_reranker_without_licence() -> None:
    models_path = REPO_ROOT / "config" / "models.yaml"
    data = yaml.safe_load(models_path.read_text(encoding="utf-8"))
    for role, entry in (data or {}).items():
        if isinstance(entry, dict) and "rerank" in str(role).lower():
            assert entry.get("licence"), f"Reranker role {role} in config/models.yaml must declare a licence"

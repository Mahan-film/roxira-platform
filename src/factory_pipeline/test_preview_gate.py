"""Tests for preview environment planning limits."""

import pytest

from src.factory_pipeline.preview_gate import (
    compose_limits,
    host_port_for,
    is_expired,
    plan_action,
    validate_slug,
)


@pytest.mark.parametrize("slug", ["issue-259", "fix-preview-gate", "a1b"])
def test_validate_slug_accepts_safe_preview_slugs(slug: str) -> None:
    assert validate_slug(slug) == slug


@pytest.mark.parametrize("slug", ["Issue-259", "roxira-x", "a", "valid-"])
def test_validate_slug_rejects_unsafe_preview_slugs(slug: str) -> None:
    with pytest.raises(ValueError):
        validate_slug(slug)


def test_host_port_is_stable_and_in_preview_range() -> None:
    port = host_port_for("issue-259")

    assert port == host_port_for("issue-259")
    assert 18000 <= port < 18100
    assert port not in {80, 443, 5432, 6333, 6379, 8000}


def test_expiration_includes_the_ttl_boundary() -> None:
    assert not is_expired(100.0, 100.0 + 86400 - 0.1)
    assert is_expired(100.0, 100.0 + 86400)


def test_plan_reuses_a_live_matching_preview() -> None:
    assert plan_action({"issue-259": 100.0}, "issue-259", 200.0) == {
        "action": "reuse"
    }


def test_plan_creates_after_tearing_down_expired_previews() -> None:
    assert plan_action(
        {"old-preview": 0.0, "live-preview": 100.0},
        "issue-259",
        86400.0,
    ) == {"action": "create", "teardown": ["old-preview"]}


def test_plan_rejects_when_two_previews_are_alive() -> None:
    assert plan_action(
        {"first-preview": 100.0, "second-preview": 200.0},
        "issue-259",
        300.0,
    ) == {"action": "reject", "reason": "limit"}


def test_compose_limits_are_fixed() -> None:
    assert compose_limits() == {"cpus": "1.0", "mem_limit": "1g", "pids_limit": 256}

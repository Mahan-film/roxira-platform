import pytest

from src.factory_pipeline.capabilities import MAX_TTL_S, mint, verify


def _mint(**overrides):
    kwargs = dict(
        run_id="run-333",
        repo="Mahan-film/roxira-platform",
        branch="rx/333",
        paths=["src/a", "docs"],
        tools=["file_edit", "shell"],
        budget_usd=1.5,
        ttl_s=3600,
        now=1000.0,
    )
    kwargs.update(overrides)
    return mint(**kwargs)


def test_mint_is_deterministic_and_sets_expiry():
    grant = _mint()
    assert grant["expires_at"] == 4600.0
    assert grant["grant_id"] == _mint()["grant_id"]


def test_valid_request_is_allowed():
    grant = _mint()
    assert verify(grant, now=1000.0, path="src/a/b.py", tool="file_edit", spend_usd=0.5) == []


def test_prefix_matching_honours_component_boundary():
    grant = _mint()
    assert verify(grant, now=1000.0, path="src/a") == []
    assert verify(grant, now=1000.0, path="src/a/b.py") == []
    assert verify(grant, now=1000.0, path="docs/guide.md") == []
    assert "path outside granted prefixes" in verify(grant, now=1000.0, path="src/ab.py")
    assert "path outside granted prefixes" in verify(grant, now=1000.0, path="/etc/passwd")
    assert "path outside granted prefixes" in verify(grant, now=1000.0, path="src/a/../../etc")


@pytest.mark.parametrize(
    "overrides",
    [
        {"paths": []},
        {"tools": []},
        {"ttl_s": MAX_TTL_S + 1},
        {"budget_usd": 0},
        {"budget_usd": -0.01},
        {"budget_usd": 5.01},
        {"paths": ["src/../secret"]},
        {"paths": ["/absolute"]},
        {"paths": [""]},
        {"tools": ["Bad Tool"]},
        {"tools": [""]},
    ],
)
def test_mint_rejects_bad_authority(overrides):
    with pytest.raises(ValueError):
        _mint(**overrides)


def test_boundary_values_are_accepted():
    grant = _mint(ttl_s=MAX_TTL_S, budget_usd=5.0)
    assert grant["expires_at"] == 1000.0 + MAX_TTL_S


def test_tampered_grant_is_rejected():
    grant = _mint()
    grant["paths"] = ["*"]
    assert "grant_id mismatch" in verify(grant, now=1000.0, path="anything")

    budget = _mint()
    budget["budget_usd"] = 5.0
    assert "grant_id mismatch" in verify(budget, now=1000.0)


def test_expiry_tool_and_budget_rejections():
    grant = _mint()
    assert "expired" in verify(grant, now=4600.0)
    assert verify(grant, now=4599.0) == []
    assert "tool not granted" in verify(grant, now=1000.0, tool="deploy")
    assert "budget exceeded" in verify(grant, now=1000.0, spend_usd=1.6)
    assert verify(grant, now=1000.0, spent_so_far=1.0, spend_usd=0.5) == []

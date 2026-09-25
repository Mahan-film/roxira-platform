from __future__ import annotations

from src.factory_pipeline.allowlist import DEFAULT_ALLOWED_ACTOR, is_actor_allowed


def test_default_allows_owner_when_csv_unset():
    assert is_actor_allowed(DEFAULT_ALLOWED_ACTOR, None) is True
    assert is_actor_allowed(DEFAULT_ALLOWED_ACTOR, "") is True
    assert is_actor_allowed(DEFAULT_ALLOWED_ACTOR, "   ") is True


def test_default_rejects_others_when_csv_unset():
    assert is_actor_allowed("some-random-user", None) is False


def test_csv_allows_listed_actor():
    assert is_actor_allowed("alice", "alice,bob") is True
    assert is_actor_allowed("bob", "alice,bob") is True


def test_csv_rejects_unlisted_actor():
    assert is_actor_allowed("mallory", "alice,bob") is False


def test_no_substring_false_positive():
    # "mahan-films2" must never match an allowlist entry of "mahan-films".
    assert is_actor_allowed("mahan-films2", "mahan-films") is False
    assert is_actor_allowed("x-mahan-films", "mahan-films") is False


def test_whitespace_in_csv_entries_is_trimmed():
    assert is_actor_allowed("bob", " alice , bob ") is True


def test_empty_actor_is_never_allowed():
    assert is_actor_allowed("", "alice,bob") is False
    assert is_actor_allowed(None, "alice,bob") is False  # type: ignore[arg-type]

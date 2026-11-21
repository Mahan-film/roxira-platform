"""Unit tests for Smart Judge user-scoped RLS helper and table inventory (#929 / T215)."""
from __future__ import annotations

import pytest

from output_apps.generated_modules.smartjudge.user_rls import (
    LEGACY_DROP_CANDIDATES,
    USER_SCOPED_TABLES,
    ensure_user_scoped_rls,
    set_user_rls_context,
)


def test_user_scoped_tables_covers_all_six_tables() -> None:
    names = {spec.table for spec in USER_SCOPED_TABLES}
    assert names == {
        "chat_conversations",
        "chat_messages",
        "support_tickets",
        "payment_orders",
        "user_entitlements",
        "user_retrial_requests",
    }
    for spec in USER_SCOPED_TABLES:
        assert spec.owner_column
        assert spec.policy_name.endswith("_user_isolation")
        assert spec.app_layer_guard


def test_legacy_drop_candidates_covers_all_six_tables() -> None:
    names = {item.table for item in LEGACY_DROP_CANDIDATES}
    assert names == {
        "accounting_accounts",
        "journal_entries",
        "fin_invoices",
        "crypto_unmatched_tx",
        "email_accounts",
        "legal_statutes_temporal",
    }


def test_set_user_rls_context_executes_transaction_local_set_config() -> None:
    calls: list[tuple[str, tuple[str, ...]]] = []

    class FakeCursor:
        def execute(self, sql: str, params: tuple[str, ...]) -> None:
            calls.append((sql, params))

    set_user_rls_context(FakeCursor(), "09120000001")
    assert calls == [
        ("SELECT set_config('app.current_user_ref', %s, true);", ("09120000001",))
    ]


@pytest.mark.parametrize("bad", ["", "   ", None])
def test_set_user_rls_context_fails_closed_on_empty_user_ref(bad: object) -> None:
    class FakeCursor:
        def execute(self, sql: str, params: tuple[str, ...]) -> None:
            raise AssertionError("should not execute set_config for empty user_ref")

    with pytest.raises(ValueError, match="user_ref must be a non-empty string"):
        set_user_rls_context(FakeCursor(), bad)  # type: ignore[arg-type]


def test_ensure_user_scoped_rls_invokes_db_helper() -> None:
    calls: list[str] = []

    class FakeCursor:
        def execute(self, sql: str) -> None:
            calls.append(sql)

    ensure_user_scoped_rls(FakeCursor())
    assert calls == ["SELECT roxira_apply_user_scoped_rls();"]

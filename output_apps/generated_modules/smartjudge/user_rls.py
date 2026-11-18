"""User-scoped RLS context and table inventory for Smart Judge (#929 / T215)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class UserScopedTableSpec:
    table: str
    owner_column: str
    policy_name: str
    app_layer_guard: str


USER_SCOPED_TABLES: tuple[UserScopedTableSpec, ...] = (
    UserScopedTableSpec(
        table="chat_conversations",
        owner_column="user_phone",
        policy_name="chat_conversations_user_isolation",
        app_layer_guard="smartjudge_module._conversation_owned_by + WHERE user_phone = %s",
    ),
    UserScopedTableSpec(
        table="chat_messages",
        owner_column="conversation_id -> chat_conversations.user_phone",
        policy_name="chat_messages_user_isolation",
        app_layer_guard="smartjudge_module._conversation_owned_by(parsed_id, user.phone) before SELECT/INSERT",
    ),
    UserScopedTableSpec(
        table="support_tickets",
        owner_column="contact_info",
        policy_name="support_tickets_user_isolation",
        app_layer_guard="portal_manager.TicketManager (insert-only public form; admin read only)",
    ),
    UserScopedTableSpec(
        table="payment_orders",
        owner_column="user_ref",
        policy_name="payment_orders_user_isolation",
        app_layer_guard="payment_orders.PgOrderStore + router_payment (user_ref from verified JWT)",
    ),
    UserScopedTableSpec(
        table="user_entitlements",
        owner_column="user_ref",
        policy_name="user_entitlements_user_isolation",
        app_layer_guard="zibal_service._persist_entitlement + smartjudge_module.WHERE user_ref = %s",
    ),
    UserScopedTableSpec(
        table="user_retrial_requests",
        owner_column="user_id",
        policy_name="user_retrial_requests_user_isolation",
        app_layer_guard="scripts/setup_retrial_and_disciplinary.py (user_id scoped)",
    ),
)


@dataclass(frozen=True)
class LegacyDropCandidate:
    table: str
    code_references: tuple[str, ...]
    recommendation: str


LEGACY_DROP_CANDIDATES: tuple[LegacyDropCandidate, ...] = (
    LegacyDropCandidate(
        table="accounting_accounts",
        code_references=("output_apps/ecosystem_core/src/compliance/db_persistence.py",),
        recommendation="Verify 0 rows on prod; superseded by fin_chart_of_accounts.",
    ),
    LegacyDropCandidate(
        table="journal_entries",
        code_references=("legacy pre-enterprise_hub schema",),
        recommendation="Verify 0 rows on prod; superseded by fin_journal_entries.",
    ),
    LegacyDropCandidate(
        table="fin_invoices",
        code_references=("legacy pre-enterprise_hub schema",),
        recommendation="Verify 0 rows on prod; superseded by invoices.",
    ),
    LegacyDropCandidate(
        table="crypto_unmatched_tx",
        code_references=(
            "output_apps/ecosystem_core/src/billing/crypto_orders.py",
            "output_apps/generated_modules/smartjudge/admin_store.py",
        ),
        recommendation="Keep if crypto checkout is planned; drop only if crypto checkout is retired.",
    ),
    LegacyDropCandidate(
        table="email_accounts",
        code_references=(
            "output_apps/generated_modules/smartjudge/email_auth.py",
            "output_apps/generated_modules/smartjudge/admin_store.py",
        ),
        recommendation="Keep if Smart Judge email auth is active; drop only if email_auth is retired.",
    ),
    LegacyDropCandidate(
        table="legal_statutes_temporal",
        code_references=("output_apps/ecosystem_core/src/compliance/db_persistence.py",),
        recommendation="Verify 0 rows on prod; superseded by graph_nodes/legal_* tables.",
    ),
)


def set_user_rls_context(cursor: Any, user_ref: str) -> None:
    """Bind `app.current_user_ref` transaction-locally for Postgres RLS.

    Fails closed on empty/whitespace user_ref so a missing identity never
    inherits a permissive session setting.
    """
    cleaned = (user_ref or "").strip()
    if not cleaned:
        raise ValueError("user_ref must be a non-empty string for user-scoped RLS")
    cursor.execute("SELECT set_config('app.current_user_ref', %s, true);", (cleaned,))

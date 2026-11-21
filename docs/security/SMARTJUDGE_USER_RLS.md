# Smart Judge User-Scoped RLS & Legacy Table Audit (#929 / T215)

## 1. User-Scoped RLS Tables

Migration `1789900012500-EnableUserScopedRlsSmartJudge.ts` enables PostgreSQL Row-Level Security
with `app.current_user_ref` isolation on the 6 Smart Judge / ecosystem tables (guarded by `IF EXISTS`
so fresh-DB TypeORM runs stay clean):

| Table | Owner Column | Policy Name | App-Layer Guard |
|---|---|---|---|
| `chat_conversations` | `user_phone` | `chat_conversations_user_isolation` | `smartjudge_module._conversation_owned_by` + `WHERE user_phone = %s` |
| `chat_messages` | `conversation_id` -> `chat_conversations.user_phone` | `chat_messages_user_isolation` | `_conversation_owned_by(parsed_id, user.phone)` before SELECT/INSERT |
| `support_tickets` | `contact_info` | `support_tickets_user_isolation` | `portal_manager.TicketManager` |
| `payment_orders` | `user_ref` | `payment_orders_user_isolation` | `PgOrderStore` + `router_payment` (JWT-verified `user_ref`) |
| `user_entitlements` | `user_ref` | `user_entitlements_user_isolation` | `zibal_service._persist_entitlement` + `WHERE user_ref = %s` |
| `user_retrial_requests` | `user_id` | `user_retrial_requests_user_isolation` | `scripts/setup_retrial_and_disciplinary.py` |

Python callers that connect as a non-owner role (`roxira_app`) must call
`output_apps.generated_modules.smartjudge.user_rls.set_user_rls_context(cur, user_ref)`
inside the transaction before querying any of the tables above.

## 2. Legacy Empty Tables Listed for Reviewed Drop Migration

Verify row counts on production before generating a dedicated drop migration:

```sql
SELECT relname, n_live_tup
FROM pg_stat_user_tables
WHERE relname IN (
  'accounting_accounts',
  'journal_entries',
  'fin_invoices',
  'crypto_unmatched_tx',
  'email_accounts',
  'legal_statutes_temporal'
)
ORDER BY relname;
```

| Table | Code References | Recommendation |
|---|---|---|
| `accounting_accounts` | `output_apps/ecosystem_core/src/compliance/db_persistence.py` | Drop after confirming 0 rows (superseded by `fin_chart_of_accounts`) |
| `journal_entries` | Legacy pre-enterprise_hub schema | Drop after confirming 0 rows (superseded by `fin_journal_entries`) |
| `fin_invoices` | Legacy pre-enterprise_hub schema | Drop after confirming 0 rows (superseded by `invoices`) |
| `crypto_unmatched_tx` | `crypto_orders.py`, `admin_store.py` | Keep if crypto checkout is planned; drop only if retired |
| `email_accounts` | `email_auth.py`, `admin_store.py` | Keep if Smart Judge email auth is active; drop only if retired |
| `legal_statutes_temporal` | `output_apps/ecosystem_core/src/compliance/db_persistence.py` | Drop after confirming 0 rows (superseded by `graph_nodes`) |

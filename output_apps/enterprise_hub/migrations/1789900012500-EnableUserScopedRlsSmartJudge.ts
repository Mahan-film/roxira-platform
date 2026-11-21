import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 1789900012500: Enable user-scoped Row-Level Security (RLS) on
 * Smart Judge / ecosystem tables (#929 / T215):
 *   - chat_conversations (owner: user_phone)
 *   - chat_messages (owner: parent chat_conversations.user_phone)
 *   - support_tickets (owner: contact_info)
 *   - payment_orders (owner: user_ref)
 *   - user_entitlements (owner: user_ref)
 *   - user_retrial_requests (owner: user_id)
 *
 * These 6 tables are owned and created by the Python Smart Judge / ecosystem
 * services rather than TypeORM migrations. In fresh-DB TypeORM CI runs they do
 * not exist yet, so `roxira_apply_user_scoped_rls()` guards each table with
 * `IF EXISTS` and is invoked both here (for existing production databases) and
 * by Python's `ensure_user_scoped_rls()` in `smartjudge/user_rls.py` whenever
 * Python creates those tables on a fresh database.
 */
export class EnableUserScopedRlsSmartJudge1789900012500 implements MigrationInterface {
  name = 'EnableUserScopedRlsSmartJudge1789900012500';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION roxira_apply_user_scoped_rls() RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'chat_conversations'
        ) THEN
          ALTER TABLE "chat_conversations" ENABLE ROW LEVEL SECURITY;
          ALTER TABLE "chat_conversations" FORCE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS "chat_conversations_user_isolation" ON "chat_conversations";
          CREATE POLICY "chat_conversations_user_isolation" ON "chat_conversations"
            USING ("user_phone" = NULLIF(current_setting('app.current_user_ref', true), ''))
            WITH CHECK ("user_phone" = NULLIF(current_setting('app.current_user_ref', true), ''));
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'chat_messages'
        ) THEN
          ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;
          ALTER TABLE "chat_messages" FORCE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS "chat_messages_user_isolation" ON "chat_messages";
          CREATE POLICY "chat_messages_user_isolation" ON "chat_messages"
            USING (
              EXISTS (
                SELECT 1 FROM "chat_conversations" c
                WHERE c."id" = "chat_messages"."conversation_id"
                  AND c."user_phone" = NULLIF(current_setting('app.current_user_ref', true), '')
              )
            )
            WITH CHECK (
              EXISTS (
                SELECT 1 FROM "chat_conversations" c
                WHERE c."id" = "chat_messages"."conversation_id"
                  AND c."user_phone" = NULLIF(current_setting('app.current_user_ref', true), '')
              )
            );
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'support_tickets'
        ) THEN
          ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;
          ALTER TABLE "support_tickets" FORCE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS "support_tickets_user_isolation" ON "support_tickets";
          CREATE POLICY "support_tickets_user_isolation" ON "support_tickets"
            USING ("contact_info" = NULLIF(current_setting('app.current_user_ref', true), ''))
            WITH CHECK ("contact_info" = NULLIF(current_setting('app.current_user_ref', true), ''));
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'payment_orders'
        ) THEN
          ALTER TABLE "payment_orders" ENABLE ROW LEVEL SECURITY;
          ALTER TABLE "payment_orders" FORCE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS "payment_orders_user_isolation" ON "payment_orders";
          CREATE POLICY "payment_orders_user_isolation" ON "payment_orders"
            USING ("user_ref" = NULLIF(current_setting('app.current_user_ref', true), ''))
            WITH CHECK ("user_ref" = NULLIF(current_setting('app.current_user_ref', true), ''));
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'user_entitlements'
        ) THEN
          ALTER TABLE "user_entitlements" ENABLE ROW LEVEL SECURITY;
          ALTER TABLE "user_entitlements" FORCE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS "user_entitlements_user_isolation" ON "user_entitlements";
          CREATE POLICY "user_entitlements_user_isolation" ON "user_entitlements"
            USING ("user_ref" = NULLIF(current_setting('app.current_user_ref', true), ''))
            WITH CHECK ("user_ref" = NULLIF(current_setting('app.current_user_ref', true), ''));
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'user_retrial_requests'
        ) THEN
          ALTER TABLE "user_retrial_requests" ENABLE ROW LEVEL SECURITY;
          ALTER TABLE "user_retrial_requests" FORCE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS "user_retrial_requests_user_isolation" ON "user_retrial_requests";
          CREATE POLICY "user_retrial_requests_user_isolation" ON "user_retrial_requests"
            USING ("user_id" = NULLIF(current_setting('app.current_user_ref', true), ''))
            WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_ref', true), ''));
        END IF;
      END $$;

      SELECT roxira_apply_user_scoped_rls();
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      DECLARE
        rec RECORD;
      BEGIN
        FOR rec IN
          SELECT 'chat_conversations' AS t, 'chat_conversations_user_isolation' AS p
          UNION ALL SELECT 'chat_messages', 'chat_messages_user_isolation'
          UNION ALL SELECT 'support_tickets', 'support_tickets_user_isolation'
          UNION ALL SELECT 'payment_orders', 'payment_orders_user_isolation'
          UNION ALL SELECT 'user_entitlements', 'user_entitlements_user_isolation'
          UNION ALL SELECT 'user_retrial_requests', 'user_retrial_requests_user_isolation'
        LOOP
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = rec.t
          ) THEN
            EXECUTE format('DROP POLICY IF EXISTS %I ON %I', rec.p, rec.t);
            EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', rec.t);
            EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', rec.t);
          END IF;
        END LOOP;
      END $$;

      DROP FUNCTION IF EXISTS roxira_apply_user_scoped_rls();
    `);
  }
}

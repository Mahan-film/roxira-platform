import { and, eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";

/** Any table that follows the tenant rule: text `id` + NOT NULL `organizationId`. */
export type OrgTable = PgTable & { id: AnyPgColumn; organizationId: AnyPgColumn };

/**
 * Tenant-scoped repository helper. Every method adds `organization_id = <org>` to the query,
 * and inserts force the organization id, so callers cannot cross tenants by accident.
 * Get `organizationId` ONLY from requireOrg() (the session), never from the request body.
 */
export function orgRepo<T extends OrgTable>(table: T, organizationId: string) {
  type Row = T["$inferSelect"];
  type NewRow = Omit<T["$inferInsert"], "organizationId" | "id">;
  const t = table as PgTable & { id: AnyPgColumn; organizationId: AnyPgColumn };
  const own = (extra?: SQL) =>
    extra ? and(eq(t.organizationId, organizationId), extra) : eq(t.organizationId, organizationId);

  return {
    async list(extra?: SQL): Promise<Row[]> {
      return (await db.select().from(t).where(own(extra))) as Row[];
    },
    async get(id: string): Promise<Row | undefined> {
      const rows = (await db.select().from(t).where(own(eq(t.id, id))).limit(1)) as Row[];
      return rows[0];
    },
    async insert(values: NewRow): Promise<Row> {
      const rows = (await db
        .insert(t)
        .values({ ...values, organizationId } as never)
        .returning()) as Row[];
      return rows[0] as Row;
    },
    async update(id: string, values: Partial<NewRow>): Promise<Row | undefined> {
      const rows = (await db
        .update(t)
        .set(values as never)
        .where(own(eq(t.id, id)))
        .returning()) as Row[];
      return rows[0];
    },
    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(t).where(own(eq(t.id, id))).returning();
      return rows.length > 0;
    },
  };
}

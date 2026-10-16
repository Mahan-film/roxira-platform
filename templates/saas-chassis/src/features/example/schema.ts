import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "../../db/schema/auth";

/** Example tenant table. Copy this folder as `src/features/<name>/` for real domain logic. */
export const notes = pgTable(
  "notes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("notes_org_idx").on(t.organizationId)],
);

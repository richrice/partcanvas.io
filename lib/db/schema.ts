import { char, customType, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
import type { HostedModel } from "../models/types";

const bytea = customType<{ data: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

// Immutable content-addressed revision records (git-like object store). The id
// is the sha256-derived 24-hex content hash; the record is the HostedModel v1
// payload. Revisions are global and shared — no owner, no model FK.
export const revisions = pgTable("revisions", {
  id: char("id", { length: 24 }).primaryKey(),
  record: jsonb("record").$type<HostedModel>().notNull(),
  thumbnail: bytea("thumbnail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

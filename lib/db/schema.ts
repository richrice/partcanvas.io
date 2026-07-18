import { boolean, char, customType, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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

// Better Auth tables (D4). TS property names must match Better Auth's model
// field names exactly — the drizzle adapter resolves fields by property, the
// snake_case column names are our own convention. `username` and `bio` are the
// additionalFields from §4; username is set once via /welcome (server-side
// validation: lowercase ^[a-z0-9-]{3,30}$ + reserved list).
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  username: text("username").unique(),
  bio: text("bio"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

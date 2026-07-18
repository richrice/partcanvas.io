import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  char,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { HostedModel, License, Visibility } from "../models/types";

const bytea = customType<{ data: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
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

// Bearer API tokens for programmatic publishing (D6, P5.2). Only the sha256
// hash is stored; the plaintext is shown once at creation. `prefix` is the
// display handle in the settings UI.
export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// Mutable social objects layered over immutable revisions (§2). Addressed
// publicly by owner username + slug; `id` is a server-generated opaque string.
export const models = pgTable("models", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  license: text("license").$type<License>().notNull().default("CC-BY-4.0"),
  visibility: text("visibility").$type<Visibility>().notNull().default("public"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  headRevisionId: char("head_revision_id", { length: 24 }).notNull().references(() => revisions.id),
  forkedFromModelId: text("forked_from_model_id").references((): AnyPgColumn => models.id, { onDelete: "set null" }),
  forkedFromRevisionId: char("forked_from_revision_id", { length: 24 }).references(() => revisions.id),
  likeCount: integer("like_count").notNull().default(0),
  downloadCount: integer("download_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // immutable_tags_text is created in the same migration (drizzle does not
  // manage functions): array_to_string is only STABLE, which Postgres rejects
  // inside generated columns, so an IMMUTABLE wrapper is required.
  search: tsvector("search").generatedAlwaysAs((): SQL =>
    sql`setweight(to_tsvector('english', coalesce(${models.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${models.description}, '')), 'B') || setweight(to_tsvector('english', immutable_tags_text(${models.tags})), 'C')`),
}, (table) => [
  uniqueIndex("models_owner_slug_unique").on(table.ownerId, table.slug),
  index("models_search_index").using("gin", table.search),
]);

// Ordered publish history; the head is denormalized on models.head_revision_id.
export const modelRevisions = pgTable("model_revisions", {
  modelId: text("model_id").notNull().references(() => models.id, { onDelete: "cascade" }),
  revisionId: char("revision_id", { length: 24 }).notNull().references(() => revisions.id),
  version: integer("version").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.modelId, table.version] }),
]);

// One positive vote per user per model (D9); like_count is maintained
// transactionally alongside inserts/deletes here.
export const likes = pgTable("likes", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull().references(() => models.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.modelId] }),
]);

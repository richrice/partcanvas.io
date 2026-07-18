import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, type Database } from "../db/client.server";
import { apiTokens, user } from "../db/schema";

// Bearer API tokens (P5.2): `pc_` + 32 random bytes, stored as a sha256 hash.
// The plaintext exists only in the create response.

export interface ApiTokenSummary {
  id: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createApiToken(userId: string, db: Database = getDb()): Promise<{ token: string; summary: ApiTokenSummary }> {
  const token = `pc_${randomBytes(32).toString("base64url")}`;
  const [row] = await db.insert(apiTokens).values({
    id: randomBytes(9).toString("base64url"),
    userId,
    tokenHash: hashToken(token),
    prefix: token.slice(0, 11),
  }).returning();
  return { token, summary: { id: row.id, prefix: row.prefix, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt } };
}

export async function listApiTokens(userId: string, db: Database = getDb()): Promise<ApiTokenSummary[]> {
  return db.select({ id: apiTokens.id, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt));
}

export async function revokeApiToken(id: string, userId: string, db: Database = getDb()): Promise<boolean> {
  const rows = await db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId))).returning({ id: apiTokens.id });
  return rows.length > 0;
}

export interface TokenUser {
  id: string;
  username: string | null;
  name: string;
}

export async function resolveApiToken(token: string, db: Database = getDb()): Promise<TokenUser | null> {
  if (!token.startsWith("pc_")) return null;
  const [row] = await db.select({ tokenId: apiTokens.id, id: user.id, username: user.username, name: user.name })
    .from(apiTokens)
    .innerJoin(user, eq(apiTokens.userId, user.id))
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.tokenId));
  return { id: row.id, username: row.username, name: row.name };
}

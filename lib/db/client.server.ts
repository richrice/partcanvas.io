import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

// Driver-agnostic database type: node-postgres in production, PGlite in tests
// (see lib/db/test-db.server.ts). Store modules accept this via an optional
// `db` parameter defaulting to getDb().
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

// Cached on globalThis so dev-server module reloads reuse one pg Pool.
const globalCache = globalThis as typeof globalThis & { __partcanvasDb?: NodePgDatabase<typeof schema> };

// Route handlers resolve their database through getDb(), so tests install a
// PGlite instance here instead of standing up Postgres.
let testOverride: Database | null = null;
export function setDatabaseForTests(db: Database | null) {
  testOverride = db;
}

export function hasDatabase(): boolean {
  return testOverride !== null || Boolean(process.env.DATABASE_URL?.trim());
}

export function getDb(): Database {
  if (testOverride) return testOverride;
  return getNodeDb();
}

export interface DatabaseStatus {
  driver: "postgres";
  configured: boolean;
  reachable?: boolean;
  error?: string;
}

export async function inspectDatabase(): Promise<DatabaseStatus> {
  if (!hasDatabase()) return { driver: "postgres", configured: false };
  try {
    await getDb().execute(sql`select 1`);
    return { driver: "postgres", configured: true, reachable: true };
  } catch (error) {
    return { driver: "postgres", configured: true, reachable: false, error: error instanceof Error ? error.message : "database-unavailable" };
  }
}

export function getNodeDb(): NodePgDatabase<typeof schema> {
  if (!globalCache.__partcanvasDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const pool = new Pool({ connectionString: url, max: 10 });
    globalCache.__partcanvasDb = drizzle(pool, { schema });
  }
  return globalCache.__partcanvasDb;
}

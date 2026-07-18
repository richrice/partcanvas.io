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

export function getDb(): NodePgDatabase<typeof schema> {
  if (!globalCache.__partcanvasDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const pool = new Pool({ connectionString: url, max: 10 });
    globalCache.__partcanvasDb = drizzle(pool, { schema });
  }
  return globalCache.__partcanvasDb;
}

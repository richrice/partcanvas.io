import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

// Cached on globalThis so dev-server module reloads reuse one pg Pool.
const globalCache = globalThis as typeof globalThis & { __partcanvasDb?: Database };

export function getDb(): Database {
  if (!globalCache.__partcanvasDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const pool = new Pool({ connectionString: url, max: 10 });
    globalCache.__partcanvasDb = drizzle(pool, { schema });
  }
  return globalCache.__partcanvasDb;
}

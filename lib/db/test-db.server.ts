import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export type TestDatabase = PgliteDatabase<typeof schema>;

// Standard DB test harness (D3): every DB test creates a fresh in-memory
// PGlite database and applies the committed SQL migrations from drizzle/ —
// the exact files production runs at boot — so tests exercise the real DDL
// with no Docker or network. Usage:
//
//   let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
//   beforeAll(async () => { testDb = await createTestDatabase(); });
//   afterAll(() => testDb.close());
//   // pass testDb.db to the module under test
export async function createTestDatabase(): Promise<{ db: TestDatabase; client: PGlite; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { db, client, close: () => client.close() };
}

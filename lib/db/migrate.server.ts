import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "./client.server";

export async function migrateDatabase() {
  await migrate(getDb(), { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

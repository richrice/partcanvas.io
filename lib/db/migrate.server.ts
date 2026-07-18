import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getNodeDb } from "./client.server";

export async function migrateDatabase() {
  await migrate(getNodeDb(), { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

// Runs SQL migrations at server boot (D13: single replica makes this safe).
// Skips cleanly when DATABASE_URL is unset so `next build` and DB-less local
// runs keep working during the Postgres transition.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL) return;
  const { migrateDatabase } = await import("./lib/db/migrate.server");
  await migrateDatabase();
  console.log("[db] migrations applied");
}

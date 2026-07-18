import { CORS_HEADERS, corsPreflight } from "@/lib/api/cors";
import { PARTCANVAS_API_VERSION, PARTCANVAS_ENGINE } from "@/lib/api/meta";
import { inspectDatabase } from "@/lib/db/client.server";
import { inspectHostedModelStore } from "@/lib/models/store.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = corsPreflight;

export async function GET() {
  // D14 transition: Postgres is the readiness signal once configured; the
  // legacy filesystem store is still reported alongside it until P5.4.
  const [storage, database] = await Promise.all([inspectHostedModelStore(), inspectDatabase()]);
  const ready = database.configured ? database.reachable === true : storage.writable;
  return Response.json({
    status: ready ? "ready" : "unavailable",
    engine: PARTCANVAS_ENGINE,
    apiVersion: PARTCANVAS_API_VERSION,
    storage,
    database,
  }, {
    status: ready ? 200 : 503,
    headers: { "cache-control": "no-store", ...CORS_HEADERS },
  });
}

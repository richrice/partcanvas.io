import { CORS_HEADERS, corsPreflight } from "@/lib/api/cors";
import { PARTCANVAS_API_VERSION, PARTCANVAS_ENGINE } from "@/lib/api/meta";
import { inspectDatabase } from "@/lib/db/client.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = corsPreflight;

export async function GET() {
  // Postgres is the store of record (P5.4 removed the legacy filesystem
  // store). Without a configured database the app still serves the engine and
  // render API, so an engine-only instance reports ready.
  const database = await inspectDatabase();
  const ready = database.configured ? database.reachable === true : true;
  return Response.json({
    status: ready ? "ready" : "unavailable",
    engine: PARTCANVAS_ENGINE,
    apiVersion: PARTCANVAS_API_VERSION,
    database,
  }, {
    status: ready ? 200 : 503,
    headers: { "cache-control": "no-store", ...CORS_HEADERS },
  });
}

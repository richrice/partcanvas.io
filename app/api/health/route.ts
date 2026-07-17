import { CORS_HEADERS, corsPreflight } from "@/lib/api/cors";
import { PARTCANVAS_API_VERSION, PARTCANVAS_ENGINE } from "@/lib/api/meta";
import { inspectHostedModelStore } from "@/lib/models/store.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = corsPreflight;

export async function GET() {
  const storage = await inspectHostedModelStore();
  const ready = storage.writable;
  return Response.json({
    status: ready ? "ready" : "unavailable",
    engine: PARTCANVAS_ENGINE,
    apiVersion: PARTCANVAS_API_VERSION,
    storage,
  }, {
    status: ready ? 200 : 503,
    headers: { "cache-control": "no-store", ...CORS_HEADERS },
  });
}

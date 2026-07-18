import { CORS_HEADERS, corsPreflight } from "@/lib/api/cors";
import { hasDatabase } from "@/lib/db/client.server";
import { readRevision } from "@/lib/models/revisions.server";

export const runtime = "nodejs";
export const OPTIONS = corsPreflight;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const model = hasDatabase() ? await readRevision(id) : null;
  if (!model) return Response.json({ error: "Model not found" }, { status: 404, headers: CORS_HEADERS });
  const etag = `"${model.id}"`;
  const headers = {
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
    etag,
    ...CORS_HEADERS,
  };
  if (request.headers.get("if-none-match")?.split(",").map((value) => value.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }
  return Response.json({ model }, {
    headers,
  });
}

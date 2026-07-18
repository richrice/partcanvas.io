import { CORS_HEADERS, corsPreflight } from "@/lib/api/cors";
import { readRevisionThumbnail } from "@/lib/models/revisions.server";

export const runtime = "nodejs";
export const OPTIONS = corsPreflight;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const thumbnail = await readRevisionThumbnail(id);
  if (!thumbnail) {
    // Clients treat 404 as "render your own placeholder"; keep it briefly
    // cacheable since a thumbnail may still arrive for a fresh revision.
    return Response.json({ error: "No thumbnail for this model" }, {
      status: 404,
      headers: { "cache-control": "public, max-age=60", ...CORS_HEADERS },
    });
  }
  return new Response(new Uint8Array(thumbnail), {
    headers: {
      "content-type": "image/png",
      // Revision content is immutable, so the thumbnail is too (D8).
      "cache-control": "public, max-age=31536000, immutable",
      ...CORS_HEADERS,
    },
  });
}

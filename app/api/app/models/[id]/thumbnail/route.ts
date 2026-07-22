import { checkRateLimit, rateLimitResponse, SOCIAL_RULE } from "@/lib/api/rate-limit.server";
import { getSessionUser } from "@/lib/auth/session.server";
import { readModel } from "@/lib/models/models.server";
import { setRevisionThumbnail } from "@/lib/models/revisions.server";
import { decodeThumbnailDataUrl, THUMBNAIL_VERSION } from "@/lib/models/thumbnails.server";

// Cookie-authenticated (D5): no corsPreflight export, no permissive CORS.
export const runtime = "nodejs";

interface ThumbnailBody {
  revisionId?: string;
  thumbnail?: string;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to update thumbnails" }, { status: 401 });

  const { id } = await context.params;
  const model = await readModel(id);
  if (!model || (model.ownerId !== sessionUser.id && model.visibility === "private")) {
    return Response.json({ error: "Model not found" }, { status: 404 });
  }
  if (model.ownerId !== sessionUser.id) {
    return Response.json({ error: "Only the owner can update thumbnails" }, { status: 403 });
  }

  const decision = checkRateLimit(`thumbnail:${sessionUser.id}`, SOCIAL_RULE);
  if (!decision.allowed) return rateLimitResponse(decision);

  let body: ThumbnailBody;
  try {
    body = await request.json() as ThumbnailBody;
  } catch {
    return Response.json({ error: "Send a JSON thumbnail payload" }, { status: 400 });
  }

  if (body.revisionId !== model.headRevisionId) {
    return Response.json({ error: "The model changed before its thumbnail could be updated" }, { status: 409 });
  }

  const png = decodeThumbnailDataUrl(body.thumbnail);
  if (!png) return Response.json({ error: "Send a valid PNG thumbnail" }, { status: 422 });

  const updated = await setRevisionThumbnail(model.headRevisionId, png, THUMBNAIL_VERSION);
  return Response.json({ updated }, { headers: { "cache-control": "no-store" } });
}

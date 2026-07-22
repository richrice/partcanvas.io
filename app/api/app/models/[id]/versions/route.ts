import { checkRateLimit, PUBLISH_RULE, rateLimitResponse } from "@/lib/api/rate-limit.server";
import { getSessionUser } from "@/lib/auth/session.server";
import { getDb } from "@/lib/db/client.server";
import { publishModelVersion, readModel } from "@/lib/models/models.server";
import { saveRevision, setRevisionThumbnail } from "@/lib/models/revisions.server";
import { decodeThumbnailDataUrl, THUMBNAIL_VERSION } from "@/lib/models/thumbnails.server";
import type { HostedModelDraft } from "@/lib/models/types";

// Cookie-authenticated (D5): no corsPreflight export, no permissive CORS.
export const runtime = "nodejs";
export const maxDuration = 30;

// Publish an update to a model you own: new revision, version++, head moves.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to update models" }, { status: 401 });
  const { id } = await context.params;
  const model = await readModel(id);
  if (!model || (model.ownerId !== sessionUser.id && model.visibility === "private")) {
    return Response.json({ error: "Model not found" }, { status: 404 });
  }
  if (model.ownerId !== sessionUser.id) {
    return Response.json({ error: "Only the owner can publish updates — fork it instead" }, { status: 403 });
  }
  const decision = checkRateLimit(`publish:${sessionUser.id}`, PUBLISH_RULE);
  if (!decision.allowed) return rateLimitResponse(decision);

  let body: HostedModelDraft & { thumbnail?: string };
  try {
    body = await request.json() as HostedModelDraft & { thumbnail?: string };
  } catch {
    return Response.json({ error: "Send a JSON model payload" }, { status: 400 });
  }

  try {
    const db = getDb();
    const { record } = await saveRevision(body, db);
    if (record.id === model.headRevisionId) {
      return Response.json({ error: "This is already the current version — nothing changed" }, { status: 409 });
    }
    const thumbnail = decodeThumbnailDataUrl(body.thumbnail);
    if (thumbnail) await setRevisionThumbnail(record.id, thumbnail, THUMBNAIL_VERSION, db);
    const { version } = await publishModelVersion(model.id, record.id, db);
    return Response.json({ version, revision: { id: record.id } }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not publish the update" }, { status: 422 });
  }
}

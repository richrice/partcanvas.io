import { CORS_HEADERS, corsPreflight } from "@/lib/api/cors";
import { checkRateLimit, PUBLISH_RULE, rateLimitResponse } from "@/lib/api/rate-limit.server";
import { resolveApiToken } from "@/lib/auth/tokens.server";
import { getDb } from "@/lib/db/client.server";
import { createModel, publishModelVersion, readModel } from "@/lib/models/models.server";
import { saveRevision, setRevisionThumbnail } from "@/lib/models/revisions.server";
import { decodeThumbnailDataUrl, THUMBNAIL_VERSION } from "@/lib/models/thumbnails.server";
import type { HostedModelDraft } from "@/lib/models/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const OPTIONS = corsPreflight;

const SIGN_IN_ERROR = "Publishing requires authentication. Sign in at https://partcanvas.io, or send a bearer API token (create one under Settings) — see /docs/api.";

interface TokenPublishBody extends HostedModelDraft {
  license?: string;
  visibility?: string;
  thumbnail?: string;
  // Explicit target model to publish a new version to; omitted = new model.
  modelId?: string;
}

// Programmatic publishing with bearer API tokens (D6, P5.2). Token auth is
// CORS-safe, so this endpoint keeps the permissive public headers. Anonymous
// publishing stays retired.
export async function POST(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer) return Response.json({ error: SIGN_IN_ERROR }, { status: 401, headers: { "cache-control": "no-store", ...CORS_HEADERS } });
  const tokenUser = await resolveApiToken(bearer);
  if (!tokenUser) return Response.json({ error: "Invalid or revoked API token" }, { status: 401, headers: { "cache-control": "no-store", ...CORS_HEADERS } });
  const decision = checkRateLimit(`publish:${tokenUser.id}`, PUBLISH_RULE);
  if (!decision.allowed) return rateLimitResponse(decision, CORS_HEADERS);

  let body: TokenPublishBody;
  try {
    body = await request.json() as TokenPublishBody;
  } catch {
    return Response.json({ error: "Send a JSON model payload" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const db = getDb();
    if (body.modelId) {
      const model = await readModel(body.modelId, db);
      if (!model || (model.ownerId !== tokenUser.id && model.visibility === "private")) {
        return Response.json({ error: "Model not found" }, { status: 404, headers: CORS_HEADERS });
      }
      if (model.ownerId !== tokenUser.id) {
        return Response.json({ error: "The token's account does not own this model" }, { status: 403, headers: CORS_HEADERS });
      }
      const { record } = await saveRevision(body, db);
      if (record.id === model.headRevisionId) {
        return Response.json({ error: "This is already the current version — nothing changed" }, { status: 409, headers: CORS_HEADERS });
      }
      const thumbnail = decodeThumbnailDataUrl(body.thumbnail);
      if (thumbnail) await setRevisionThumbnail(record.id, thumbnail, THUMBNAIL_VERSION, db);
      const { version } = await publishModelVersion(model.id, record.id, db);
      return Response.json({ version, revision: { id: record.id }, url: `/m/${record.id}` }, {
        status: 201,
        headers: { "cache-control": "no-store", ...CORS_HEADERS },
      });
    }

    if (!tokenUser.username) {
      return Response.json({ error: "Choose a username at https://partcanvas.io/welcome before publishing" }, { status: 409, headers: CORS_HEADERS });
    }
    const { record } = await saveRevision(body, db);
    const thumbnail = decodeThumbnailDataUrl(body.thumbnail);
    if (thumbnail) await setRevisionThumbnail(record.id, thumbnail, THUMBNAIL_VERSION, db);
    const model = await createModel({
      ownerId: tokenUser.id,
      title: body.name,
      revisionId: record.id,
      description: body.description,
      license: body.license,
      visibility: body.visibility,
      tags: body.tags,
    }, db);
    const url = `/u/${tokenUser.username}/${model.slug}`;
    return Response.json({ model, revision: { id: record.id }, url }, {
      status: 201,
      headers: { location: url, "cache-control": "no-store", ...CORS_HEADERS },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not publish model" }, { status: 422, headers: CORS_HEADERS });
  }
}

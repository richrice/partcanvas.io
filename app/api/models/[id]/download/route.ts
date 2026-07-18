import { CORS_HEADERS, corsPreflight } from "@/lib/api/cors";
import { checkRateLimit, clientIp, rateLimitResponse, SOCIAL_RULE } from "@/lib/api/rate-limit.server";
import { getSessionUser } from "@/lib/auth/session.server";
import { readModel, recordDownload } from "@/lib/models/models.server";
import { canViewModel } from "@/lib/models/visibility";

// Download beacon (P3.6): cookie-free by design so signed-out downloads count
// too — hence it lives on the public /api/models surface rather than
// /api/app. Same-origin cookies still ride along, which is what lets an
// owner's downloads of their own private model count.
export const runtime = "nodejs";
export const OPTIONS = corsPreflight;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const decision = checkRateLimit(`download:${clientIp(request)}`, SOCIAL_RULE);
  if (!decision.allowed) return rateLimitResponse(decision, CORS_HEADERS);
  const { id } = await context.params;
  const model = await readModel(id);
  const viewer = model?.visibility === "private" ? await getSessionUser(request) : null;
  if (!model || !canViewModel(model, viewer?.id)) {
    return Response.json({ error: "Model not found" }, { status: 404, headers: CORS_HEADERS });
  }
  const downloadCount = await recordDownload(model.id);
  return Response.json({ downloadCount }, { headers: { "cache-control": "no-store", ...CORS_HEADERS } });
}

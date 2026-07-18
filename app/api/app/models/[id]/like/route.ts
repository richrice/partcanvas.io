import { checkRateLimit, rateLimitResponse, SOCIAL_RULE } from "@/lib/api/rate-limit.server";
import { getSessionUser } from "@/lib/auth/session.server";
import { toggleLike } from "@/lib/models/likes.server";
import { readModel } from "@/lib/models/models.server";
import { canViewModel } from "@/lib/models/visibility";

// Cookie-authenticated (D5): no corsPreflight export, no permissive CORS.
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to like models" }, { status: 401 });
  const decision = checkRateLimit(`social:${sessionUser.id}`, SOCIAL_RULE);
  if (!decision.allowed) return rateLimitResponse(decision);
  const { id } = await context.params;
  const model = await readModel(id);
  // Private models stay invisible to non-owners, likes included.
  if (!model || !canViewModel(model, sessionUser.id)) {
    return Response.json({ error: "Model not found" }, { status: 404 });
  }
  const result = await toggleLike(model.id, sessionUser.id);
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

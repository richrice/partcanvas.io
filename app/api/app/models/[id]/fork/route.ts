import { checkRateLimit, rateLimitResponse, SOCIAL_RULE } from "@/lib/api/rate-limit.server";
import { getSessionUser } from "@/lib/auth/session.server";
import { forkModel, readModel } from "@/lib/models/models.server";
import { canViewModel } from "@/lib/models/visibility";

// Cookie-authenticated (D5): no corsPreflight export, no permissive CORS.
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to fork models" }, { status: 401 });
  if (!sessionUser.username) return Response.json({ error: "Choose a username before forking" }, { status: 409 });
  const decision = checkRateLimit(`social:${sessionUser.id}`, SOCIAL_RULE);
  if (!decision.allowed) return rateLimitResponse(decision);
  const { id } = await context.params;
  const source = await readModel(id);
  if (!source || !canViewModel(source, sessionUser.id)) {
    return Response.json({ error: "Model not found" }, { status: 404 });
  }
  const model = await forkModel(source, sessionUser.id);
  const url = `/u/${sessionUser.username}/${model.slug}`;
  return Response.json({ model, url }, {
    status: 201,
    headers: { location: url, "cache-control": "no-store" },
  });
}

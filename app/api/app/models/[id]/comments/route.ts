import { checkRateLimit, rateLimitResponse, SOCIAL_RULE } from "@/lib/api/rate-limit.server";
import { getSessionUser } from "@/lib/auth/session.server";
import { addComment, listComments } from "@/lib/models/comments.server";
import { readModel } from "@/lib/models/models.server";
import { canViewModel } from "@/lib/models/visibility";

// Cookie-authenticated (D5): no corsPreflight export, no permissive CORS.
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(request);
  const { id } = await context.params;
  const model = await readModel(id);
  if (!model || !canViewModel(model, sessionUser?.id)) {
    return Response.json({ error: "Model not found" }, { status: 404 });
  }
  const page = Number.parseInt(new URL(request.url).searchParams.get("page") ?? "1", 10) || 1;
  const result = await listComments(model.id, { viewerId: sessionUser?.id, page });
  return Response.json({
    ...result,
    viewerCanModerate: sessionUser !== null && sessionUser.id === model.ownerId,
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to comment" }, { status: 401 });
  const decision = checkRateLimit(`social:${sessionUser.id}`, SOCIAL_RULE);
  if (!decision.allowed) return rateLimitResponse(decision);
  const { id } = await context.params;
  const model = await readModel(id);
  if (!model || !canViewModel(model, sessionUser.id)) {
    return Response.json({ error: "Model not found" }, { status: 404 });
  }
  let body: string;
  try {
    body = String((await request.json() as { body?: unknown }).body ?? "");
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const comment = await addComment({ modelId: model.id, authorId: sessionUser.id, body });
    return Response.json({ comment }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not post comment" }, { status: 400 });
  }
}

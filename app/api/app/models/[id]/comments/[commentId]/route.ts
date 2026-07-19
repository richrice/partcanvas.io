import { checkRateLimit, rateLimitResponse, SOCIAL_RULE } from "@/lib/api/rate-limit.server";
import { getSessionUser } from "@/lib/auth/session.server";
import { deleteComment } from "@/lib/models/comments.server";
import { readModel } from "@/lib/models/models.server";
import { canViewModel } from "@/lib/models/visibility";

// Cookie-authenticated (D5): no corsPreflight export, no permissive CORS.
export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; commentId: string }> }) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to manage comments" }, { status: 401 });
  const decision = checkRateLimit(`social:${sessionUser.id}`, SOCIAL_RULE);
  if (!decision.allowed) return rateLimitResponse(decision);
  const { id, commentId } = await context.params;
  const model = await readModel(id);
  if (!model || !canViewModel(model, sessionUser.id)) {
    return Response.json({ error: "Model not found" }, { status: 404 });
  }
  const result = await deleteComment({
    commentId,
    modelId: model.id,
    userId: sessionUser.id,
    isModelOwner: model.ownerId === sessionUser.id,
  });
  if (!result) return Response.json({ error: "Comment not found" }, { status: 404 });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

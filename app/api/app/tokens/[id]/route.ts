import { getSessionUser } from "@/lib/auth/session.server";
import { revokeApiToken } from "@/lib/auth/tokens.server";

// Cookie-authenticated (D5): no corsPreflight export, no permissive CORS.
export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to manage API tokens" }, { status: 401 });
  const { id } = await context.params;
  const revoked = await revokeApiToken(id, sessionUser.id);
  if (!revoked) return Response.json({ error: "Token not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}

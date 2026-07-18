import { checkRateLimit, rateLimitResponse, SOCIAL_RULE } from "@/lib/api/rate-limit.server";
import { getSessionUser } from "@/lib/auth/session.server";
import { createApiToken, listApiTokens } from "@/lib/auth/tokens.server";

// Cookie-authenticated (D5): no corsPreflight export, no permissive CORS.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to manage API tokens" }, { status: 401 });
  const tokens = await listApiTokens(sessionUser.id);
  return Response.json({ tokens }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to manage API tokens" }, { status: 401 });
  const decision = checkRateLimit(`social:${sessionUser.id}`, SOCIAL_RULE);
  if (!decision.allowed) return rateLimitResponse(decision);
  const { token, summary } = await createApiToken(sessionUser.id);
  // The plaintext token appears in this response only; afterwards only the
  // hash exists server-side.
  return Response.json({ token, summary }, { status: 201, headers: { "cache-control": "no-store" } });
}

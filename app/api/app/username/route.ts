import { and, eq, isNull } from "drizzle-orm";
import { checkRateLimit, rateLimitResponse, SOCIAL_RULE } from "@/lib/api/rate-limit.server";
import { getSessionUser } from "@/lib/auth/session.server";
import { validateUsername } from "@/lib/auth/username";
import { getDb } from "@/lib/db/client.server";
import { isUniqueViolation } from "@/lib/db/errors.server";
import { user } from "@/lib/db/schema";

// Cookie-authenticated (D5): no corsPreflight export, no permissive CORS.
export const runtime = "nodejs";

// Claims the caller's username exactly once. The guarded UPDATE plus the
// unique index close both races: a double submit and two users choosing the
// same name concurrently.
export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to choose a username" }, { status: 401 });
  if (sessionUser.username) return Response.json({ error: "Your username is already set" }, { status: 409 });
  const decision = checkRateLimit(`social:${sessionUser.id}`, SOCIAL_RULE);
  if (!decision.allowed) return rateLimitResponse(decision);

  let username = "";
  try {
    const body = await request.json() as { username?: unknown };
    if (typeof body.username === "string") username = body.username.trim().toLowerCase();
  } catch {
    return Response.json({ error: "Send a JSON body with a username" }, { status: 400 });
  }
  const problem = validateUsername(username);
  if (problem) return Response.json({ error: problem }, { status: 422 });

  try {
    const updated = await getDb().update(user)
      .set({ username, updatedAt: new Date() })
      .where(and(eq(user.id, sessionUser.id), isNull(user.username)))
      .returning({ id: user.id });
    if (updated.length === 0) return Response.json({ error: "Your username is already set" }, { status: 409 });
  } catch (error) {
    if (isUniqueViolation(error)) return Response.json({ error: "That username is taken" }, { status: 409 });
    throw error;
  }
  return Response.json({ username }, { headers: { "cache-control": "no-store" } });
}

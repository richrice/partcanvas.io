import { randomBytes } from "node:crypto";
import { CORS_HEADERS, corsPreflight } from "@/lib/api/cors";
import { checkRateLimit, clientIp, rateLimitResponse, SOCIAL_RULE } from "@/lib/api/rate-limit.server";
import { getSessionUser } from "@/lib/auth/session.server";
import { getDb } from "@/lib/db/client.server";
import { reports } from "@/lib/db/schema";
import { readModel } from "@/lib/models/models.server";
import { canViewModel } from "@/lib/models/visibility";

// Abuse reports work signed-out (reporter_id stays null), so this lives on
// the public surface like the download beacon; same-origin cookies attribute
// signed-in reporters.
export const runtime = "nodejs";
export const OPTIONS = corsPreflight;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const decision = checkRateLimit(`report:${clientIp(request)}`, SOCIAL_RULE);
  if (!decision.allowed) return rateLimitResponse(decision, CORS_HEADERS);
  const { id } = await context.params;
  const [model, reporter] = await Promise.all([readModel(id), getSessionUser(request)]);
  if (!model || !canViewModel(model, reporter?.id)) {
    return Response.json({ error: "Model not found" }, { status: 404, headers: CORS_HEADERS });
  }
  let reason = "";
  try {
    const body = await request.json() as { reason?: unknown };
    if (typeof body.reason === "string") reason = body.reason.trim().slice(0, 1_000);
  } catch {
    // Reason is optional; an empty body is still a valid report.
  }
  await getDb().insert(reports).values({
    id: randomBytes(9).toString("base64url"),
    modelId: model.id,
    reporterId: reporter?.id ?? null,
    reason: reason || "unspecified",
  });
  return Response.json({ reported: true }, { status: 201, headers: { "cache-control": "no-store", ...CORS_HEADERS } });
}

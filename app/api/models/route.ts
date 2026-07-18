import { CORS_HEADERS, corsPreflight } from "@/lib/api/cors";

export const runtime = "nodejs";
export const OPTIONS = corsPreflight;

// Anonymous publishing is retired (D6). Programmatic publishing returns in
// Phase 5 with bearer API tokens; until then this endpoint only explains where
// to go. Serverless share links remain the anonymous, no-account tier.
export async function POST() {
  return Response.json({
    error: "Publishing requires an account. Sign in at https://partcanvas.io to publish models; bearer-token API publishing for signed-in accounts is planned — see /docs/api.",
  }, { status: 401, headers: { "cache-control": "no-store", ...CORS_HEADERS } });
}

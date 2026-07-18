import { CORS_HEADERS, corsPreflight } from "@/lib/api/cors";
import { publishHostedModel } from "@/lib/models/hosted.server";
import type { HostedModelDraft } from "@/lib/models/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const OPTIONS = corsPreflight;

export async function POST(request: Request) {
  try {
    const draft = await request.json() as HostedModelDraft;
    const { model, created } = await publishHostedModel(draft);
    const url = `/m/${model.id}`;
    return Response.json({ model, url }, {
      status: created ? 201 : 200,
      headers: { location: url, "cache-control": "no-store", ...CORS_HEADERS },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not publish model" }, { status: 422, headers: CORS_HEADERS });
  }
}

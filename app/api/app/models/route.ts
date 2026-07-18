import { getSessionUser } from "@/lib/auth/session.server";
import { getDb } from "@/lib/db/client.server";
import { createModel } from "@/lib/models/models.server";
import { saveRevision } from "@/lib/models/revisions.server";
import type { HostedModelDraft } from "@/lib/models/types";

// Cookie-authenticated publish (D5): no corsPreflight export, no permissive
// CORS. Anonymous/programmatic publishing is the Phase-5 bearer-token flow.
export const runtime = "nodejs";
export const maxDuration = 30;

interface PublishBody extends HostedModelDraft {
  license?: string;
  visibility?: string;
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to publish models" }, { status: 401 });
  if (!sessionUser.username) return Response.json({ error: "Choose a username before publishing" }, { status: 409 });

  let body: PublishBody;
  try {
    body = await request.json() as PublishBody;
  } catch {
    return Response.json({ error: "Send a JSON model payload" }, { status: 400 });
  }

  try {
    const db = getDb();
    // The revision is content-addressed and global — saving it outside the
    // model transaction is safe (worst case: an orphaned shared revision).
    // Model + version-1 history row are inserted atomically in createModel.
    const { record } = await saveRevision(body, db);
    const model = await createModel({
      ownerId: sessionUser.id,
      title: body.name,
      revisionId: record.id,
      description: body.description,
      license: body.license,
      visibility: body.visibility,
      tags: body.tags,
    }, db);
    const url = `/u/${sessionUser.username}/${model.slug}`;
    return Response.json({ model, revision: { id: record.id }, url }, {
      status: 201,
      headers: { location: url, "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not publish model" }, { status: 422 });
  }
}

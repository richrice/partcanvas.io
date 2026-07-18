import { getSessionUser } from "@/lib/auth/session.server";
import { deleteModel, readModel, updateModelMetadata, type ModelMetadataPatch } from "@/lib/models/models.server";
import type { SessionUser } from "@/lib/auth/session.server";
import type { ModelRow } from "@/lib/models/models.server";

// Cookie-authenticated (D5): no corsPreflight export, no permissive CORS.
export const runtime = "nodejs";

async function requireOwnedModel(request: Request, id: string): Promise<{ model: ModelRow; sessionUser: SessionUser } | Response> {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to manage models" }, { status: 401 });
  const model = await readModel(id);
  if (!model || (model.ownerId !== sessionUser.id && model.visibility === "private")) {
    return Response.json({ error: "Model not found" }, { status: 404 });
  }
  if (model.ownerId !== sessionUser.id) {
    return Response.json({ error: "Only the owner can manage this model" }, { status: 403 });
  }
  return { model, sessionUser };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await requireOwnedModel(request, id);
  if (owned instanceof Response) return owned;
  let patch: ModelMetadataPatch;
  try {
    patch = await request.json() as ModelMetadataPatch;
  } catch {
    return Response.json({ error: "Send a JSON metadata patch" }, { status: 400 });
  }
  try {
    const model = await updateModelMetadata(owned.model.id, patch);
    return Response.json({ model }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the model" }, { status: 422 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await requireOwnedModel(request, id);
  if (owned instanceof Response) return owned;
  await deleteModel(owned.model.id);
  return new Response(null, { status: 204 });
}

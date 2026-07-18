import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setSessionUserForTests, type SessionUser } from "@/lib/auth/session.server";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { modelRevisions, models, revisions, user } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { createModel, forkModel, readModel } from "@/lib/models/models.server";
import { saveRevision } from "@/lib/models/revisions.server";
import { DELETE, PATCH } from "./route";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let modelId = "";
let forkId = "";
let revisionId = "";

const owner: SessionUser = { id: "owner-1", name: "Owner", email: "o@example.com", username: "owner", bio: null };
const other: SessionUser = { id: "other-1", name: "Other", email: "x@example.com", username: "other", bio: null };

function patchRequest(id: string, body: unknown) {
  return PATCH(new Request(`http://localhost/api/app/models/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

function deleteRequest(id: string) {
  return DELETE(new Request(`http://localhost/api/app/models/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
  await testDb.db.insert(user).values([
    { id: "owner-1", name: "Owner", email: "o@example.com", username: "owner" },
    { id: "other-1", name: "Other", email: "x@example.com", username: "other" },
  ]);
  const { record } = await saveRevision({ name: "Managed", source: "cube([5, 5, 5]);" }, testDb.db);
  revisionId = record.id;
  const model = await createModel({ ownerId: "owner-1", title: "Managed box", revisionId, tags: ["boxes"] }, testDb.db);
  modelId = model.id;
  forkId = (await forkModel(model, "other-1", testDb.db)).id;
});

afterAll(async () => {
  setSessionUserForTests(undefined);
  setDatabaseForTests(null);
  await testDb.close();
});

describe("PATCH /api/app/models/:id", () => {
  it("enforces authentication and ownership", async () => {
    setSessionUserForTests(null);
    expect((await patchRequest(modelId, { title: "X" })).status).toBe(401);
    setSessionUserForTests(other);
    expect((await patchRequest(modelId, { title: "X" })).status).toBe(403);
    expect((await patchRequest("missing", { title: "X" })).status).toBe(404);
  });

  it("updates metadata with normalization, leaving the slug alone", async () => {
    setSessionUserForTests(owner);
    const response = await patchRequest(modelId, {
      title: "  Renamed box  ",
      description: "Updated description.",
      tags: ["Boxes", "storage", "boxes"],
      license: "CC0-1.0",
      visibility: "unlisted",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).model).toMatchObject({
      title: "Renamed box",
      slug: "managed-box",
      description: "Updated description.",
      tags: ["boxes", "storage"],
      license: "CC0-1.0",
      visibility: "unlisted",
    });
  });

  it("rejects invalid explicit values", async () => {
    setSessionUserForTests(owner);
    expect((await patchRequest(modelId, { title: "   " })).status).toBe(422);
    expect((await patchRequest(modelId, { license: "WTFPL" })).status).toBe(422);
    expect((await patchRequest(modelId, { visibility: "secret" })).status).toBe(422);
    expect((await readModel(modelId, testDb.db))!.license).toBe("CC0-1.0");
  });
});

describe("DELETE /api/app/models/:id", () => {
  it("is owner-only", async () => {
    setSessionUserForTests(other);
    expect((await deleteRequest(modelId)).status).toBe(403);
  });

  it("removes the model and history but keeps shared revisions and forks", async () => {
    setSessionUserForTests(owner);
    const response = await deleteRequest(modelId);
    expect(response.status).toBe(204);
    expect(await readModel(modelId, testDb.db)).toBeNull();
    expect(await testDb.db.select().from(modelRevisions).where(eq(modelRevisions.modelId, modelId))).toHaveLength(0);
    // The revision is shared content and must survive; the fork stays, its
    // lineage pointer nulled.
    expect(await testDb.db.select({ id: revisions.id }).from(revisions).where(eq(revisions.id, revisionId))).toHaveLength(1);
    const [fork] = await testDb.db.select().from(models).where(eq(models.id, forkId));
    expect(fork.forkedFromModelId).toBeNull();
    expect(fork.headRevisionId).toBe(revisionId);

    setSessionUserForTests(owner);
    expect((await deleteRequest(modelId)).status).toBe(404);
  });
});

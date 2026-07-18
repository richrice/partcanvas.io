import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setSessionUserForTests, type SessionUser } from "@/lib/auth/session.server";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { modelRevisions, user } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { createModel } from "@/lib/models/models.server";
import { saveRevision } from "@/lib/models/revisions.server";
import { POST } from "./route";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let sourceModelId = "";
let sourceRevisionId = "";
let privateModelId = "";

const forker: SessionUser = { id: "forker-1", name: "Forker", email: "f@example.com", username: "forker", bio: null };

function forkRequest(id: string) {
  return POST(new Request(`http://localhost/api/app/models/${id}/fork`, { method: "POST" }), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
  await testDb.db.insert(user).values([
    { id: "author-1", name: "Author", email: "a@example.com", username: "author" },
    { id: "forker-1", name: "Forker", email: "f@example.com", username: "forker" },
  ]);
  const { record } = await saveRevision({ name: "Forkable", source: "cube([5, 5, 5]);" }, testDb.db);
  sourceRevisionId = record.id;
  sourceModelId = (await createModel({
    ownerId: "author-1", title: "Forkable widget", revisionId: record.id,
    description: "The original.", license: "CC-BY-SA-4.0", tags: ["widgets"],
  }, testDb.db)).id;
  privateModelId = (await createModel({ ownerId: "author-1", title: "Private widget", revisionId: record.id, visibility: "private" }, testDb.db)).id;
});

afterAll(async () => {
  setSessionUserForTests(undefined);
  setDatabaseForTests(null);
  await testDb.close();
});

describe("POST /api/app/models/:id/fork", () => {
  it("requires session and username", async () => {
    setSessionUserForTests(null);
    expect((await forkRequest(sourceModelId)).status).toBe(401);
    setSessionUserForTests({ ...forker, username: null });
    expect((await forkRequest(sourceModelId)).status).toBe(409);
  });

  it("404s for unknown and other users' private models", async () => {
    setSessionUserForTests(forker);
    expect((await forkRequest("missing")).status).toBe(404);
    expect((await forkRequest(privateModelId)).status).toBe(404);
  });

  it("creates a fork pointing at the source head with lineage and carried metadata", async () => {
    setSessionUserForTests(forker);
    const response = await forkRequest(sourceModelId);
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.url).toBe("/u/forker/forkable-widget");
    expect(payload.model).toMatchObject({
      ownerId: "forker-1",
      title: "Forkable widget",
      description: "The original.",
      license: "CC-BY-SA-4.0",
      tags: ["widgets"],
      headRevisionId: sourceRevisionId,
      forkedFromModelId: sourceModelId,
      forkedFromRevisionId: sourceRevisionId,
    });
    const history = await testDb.db.select().from(modelRevisions).where(eq(modelRevisions.modelId, payload.model.id));
    expect(history).toEqual([expect.objectContaining({ revisionId: sourceRevisionId, version: 1 })]);

    // Forking again dedupes the slug per owner.
    const again = await forkRequest(sourceModelId);
    expect((await again.json()).model.slug).toBe("forkable-widget-2");
  });
});

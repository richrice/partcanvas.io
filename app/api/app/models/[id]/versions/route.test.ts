import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSessionUserForTests, type SessionUser } from "@/lib/auth/session.server";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { user } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { createModel, listModelVersions, readModel } from "@/lib/models/models.server";
import { saveRevision } from "@/lib/models/revisions.server";
import { POST } from "./route";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let modelId = "";
let headRevisionId = "";

const owner: SessionUser = { id: "owner-1", name: "Owner", email: "o@example.com", username: "owner", bio: null };
const other: SessionUser = { id: "other-1", name: "Other", email: "x@example.com", username: "other", bio: null };

function updateRequest(id: string, body: unknown) {
  return POST(new Request(`http://localhost/api/app/models/${id}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
  await testDb.db.insert(user).values([
    { id: "owner-1", name: "Owner", email: "o@example.com", username: "owner" },
    { id: "other-1", name: "Other", email: "x@example.com", username: "other" },
  ]);
  const { record } = await saveRevision({ name: "Versioned", source: "cube([5, 5, 5]);" }, testDb.db);
  headRevisionId = record.id;
  modelId = (await createModel({ ownerId: "owner-1", title: "Versioned box", revisionId: record.id }, testDb.db)).id;
});

afterAll(async () => {
  setSessionUserForTests(undefined);
  setDatabaseForTests(null);
  await testDb.close();
});

describe("POST /api/app/models/:id/versions", () => {
  it("enforces authentication and ownership", async () => {
    setSessionUserForTests(null);
    expect((await updateRequest(modelId, { name: "V", source: "cube(6);" })).status).toBe(401);
    setSessionUserForTests(other);
    expect((await updateRequest(modelId, { name: "V", source: "cube(6);" })).status).toBe(403);
    expect((await updateRequest("missing", { name: "V", source: "cube(6);" })).status).toBe(404);
  });

  it("publishes a new version and moves the head", async () => {
    setSessionUserForTests(owner);
    const response = await updateRequest(modelId, { name: "Versioned box", source: "cube([6, 6, 6]);" });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.version).toBe(2);
    expect(payload.revision.id).not.toBe(headRevisionId);

    const model = await readModel(modelId, testDb.db);
    expect(model!.headRevisionId).toBe(payload.revision.id);
    const versions = await listModelVersions(modelId, testDb.db);
    expect(versions.map((entry) => entry.version)).toEqual([2, 1]);
    expect(versions[0].revisionId).toBe(payload.revision.id);
    expect(versions[1].revisionId).toBe(headRevisionId);
  });

  it("refuses an update identical to the current head", async () => {
    setSessionUserForTests(owner);
    const response = await updateRequest(modelId, { name: "Versioned box", source: "cube([6, 6, 6]);" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already the current version/);
    expect((await listModelVersions(modelId, testDb.db))).toHaveLength(2);
  });

  it("rejects invalid updates without touching history", async () => {
    setSessionUserForTests(owner);
    expect((await updateRequest(modelId, { name: "Versioned box", source: "nope =" })).status).toBe(422);
    expect((await listModelVersions(modelId, testDb.db))).toHaveLength(2);
  });
});

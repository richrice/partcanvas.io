import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setSessionUserForTests } from "@/lib/auth/session.server";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { reports, user } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { createModel } from "@/lib/models/models.server";
import { saveRevision } from "@/lib/models/revisions.server";
import { POST } from "./route";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let modelId = "";
let privateModelId = "";

function reportRequest(id: string, body?: unknown) {
  return POST(new Request(`http://localhost/api/models/${id}/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "" : JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
  setSessionUserForTests(null);
  await testDb.db.insert(user).values({ id: "owner-1", name: "Owner", email: "o@example.com", username: "owner" });
  const { record } = await saveRevision({ name: "Reportable", source: "cube([5, 5, 5]);" }, testDb.db);
  modelId = (await createModel({ ownerId: "owner-1", title: "Reportable", revisionId: record.id }, testDb.db)).id;
  privateModelId = (await createModel({ ownerId: "owner-1", title: "Hidden", revisionId: record.id, visibility: "private" }, testDb.db)).id;
});

afterAll(async () => {
  setSessionUserForTests(undefined);
  setDatabaseForTests(null);
  await testDb.close();
});

describe("POST /api/models/:id/report", () => {
  it("accepts anonymous reports with an optional reason", async () => {
    const withReason = await reportRequest(modelId, { reason: "  spam model  " });
    expect(withReason.status).toBe(201);
    const noBody = await reportRequest(modelId);
    expect(noBody.status).toBe(201);
    const rows = await testDb.db.select().from(reports).where(eq(reports.modelId, modelId));
    expect(rows.map((row) => row.reason).sort()).toEqual(["spam model", "unspecified"]);
    expect(rows.every((row) => row.reporterId === null && row.resolvedAt === null)).toBe(true);
  });

  it("attributes signed-in reporters", async () => {
    setSessionUserForTests({ id: "owner-1", name: "Owner", email: "o@example.com", username: "owner", bio: null });
    expect((await reportRequest(modelId, { reason: "test" })).status).toBe(201);
    setSessionUserForTests(null);
    const rows = await testDb.db.select().from(reports).where(eq(reports.reporterId, "owner-1"));
    expect(rows).toHaveLength(1);
  });

  it("hides unknown and private models from anonymous reporters", async () => {
    expect((await reportRequest("missing", {})).status).toBe(404);
    expect((await reportRequest(privateModelId, {})).status).toBe(404);
  });
});

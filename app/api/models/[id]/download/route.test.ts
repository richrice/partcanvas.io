import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setSessionUserForTests } from "@/lib/auth/session.server";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { models, user } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { createModel } from "@/lib/models/models.server";
import { saveRevision } from "@/lib/models/revisions.server";
import { POST } from "./route";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let publicModelId = "";
let privateModelId = "";

function beacon(id: string) {
  return POST(new Request(`http://localhost/api/models/${id}/download`, { method: "POST" }), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
  setSessionUserForTests(null);
  await testDb.db.insert(user).values({ id: "owner-1", name: "Owner", email: "o@example.com", username: "owner" });
  const { record } = await saveRevision({ name: "Beacon", source: "cube([5, 5, 5]);" }, testDb.db);
  publicModelId = (await createModel({ ownerId: "owner-1", title: "Beacon target", revisionId: record.id }, testDb.db)).id;
  privateModelId = (await createModel({ ownerId: "owner-1", title: "Private target", revisionId: record.id, visibility: "private" }, testDb.db)).id;
});

afterAll(async () => {
  setSessionUserForTests(undefined);
  setDatabaseForTests(null);
  await testDb.close();
});

describe("POST /api/models/:id/download", () => {
  it("increments the download count without authentication", async () => {
    const first = await beacon(publicModelId);
    expect(first.status).toBe(200);
    expect(first.headers.get("access-control-allow-origin")).toBe("*");
    expect(await first.json()).toEqual({ downloadCount: 1 });
    await beacon(publicModelId);
    const [row] = await testDb.db.select({ downloadCount: models.downloadCount }).from(models).where(eq(models.id, publicModelId));
    expect(row.downloadCount).toBe(2);
  });

  it("hides unknown and private models from anonymous callers, but counts the owner", async () => {
    expect((await beacon("missing")).status).toBe(404);
    expect((await beacon(privateModelId)).status).toBe(404);
    setSessionUserForTests({ id: "owner-1", name: "Owner", email: "o@example.com", username: "owner", bio: null });
    expect((await beacon(privateModelId)).status).toBe(200);
    setSessionUserForTests(null);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setSessionUserForTests, type SessionUser } from "@/lib/auth/session.server";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { modelRevisions, models, revisions, user } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { GET as GET_THUMBNAIL } from "../../models/[id]/thumbnail/route";
import { POST } from "./route";

// 1x1 transparent PNG.
const PNG_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;

const author: SessionUser = { id: "author-1", name: "Author", email: "author@example.com", username: "gear-smith", bio: null };

function publishRequest(body: unknown) {
  return new Request("http://localhost/api/app/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
  await testDb.db.insert(user).values({ id: "author-1", name: "Author", email: "author@example.com", username: "gear-smith" });
});

afterAll(async () => {
  setSessionUserForTests(undefined);
  setDatabaseForTests(null);
  await testDb.close();
});

describe("POST /api/app/models", () => {
  it("requires a session and a chosen username", async () => {
    setSessionUserForTests(null);
    expect((await POST(publishRequest({ name: "X", source: "cube(4);" }))).status).toBe(401);
    setSessionUserForTests({ ...author, username: null });
    expect((await POST(publishRequest({ name: "X", source: "cube(4);" }))).status).toBe(409);
  });

  it("publishes an owned model with revision and history atomically", async () => {
    setSessionUserForTests(author);
    const response = await POST(publishRequest({
      name: "Gearbox mount",
      source: "size = 20; // [5:1:60]\ncube([size, 12, 5]);",
      parameters: { size: 25 },
      description: "A mount for small gearboxes.",
      license: "CC-BY-SA-4.0",
      visibility: "unlisted",
      tags: ["Gears", "mounts"],
    }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.url).toBe("/u/gear-smith/gearbox-mount");
    expect(response.headers.get("location")).toBe(payload.url);
    expect(payload.model).toMatchObject({
      ownerId: "author-1",
      slug: "gearbox-mount",
      title: "Gearbox mount",
      license: "CC-BY-SA-4.0",
      visibility: "unlisted",
      tags: ["gears", "mounts"],
    });
    expect(payload.revision.id).toMatch(/^[a-f0-9]{24}$/);
    expect(payload.model.headRevisionId).toBe(payload.revision.id);

    const [storedRevision] = await testDb.db.select({ id: revisions.id }).from(revisions).where(eq(revisions.id, payload.revision.id));
    expect(storedRevision).toBeDefined();
    const history = await testDb.db.select().from(modelRevisions).where(eq(modelRevisions.modelId, payload.model.id));
    expect(history).toEqual([expect.objectContaining({ revisionId: payload.revision.id, version: 1 })]);
  });

  it("stores a captured thumbnail on the revision and serves it immutably", async () => {
    setSessionUserForTests(author);
    const response = await POST(publishRequest({
      name: "Thumbnailed part",
      source: "cube([9, 9, 3]);",
      thumbnail: PNG_PIXEL,
    }));
    expect(response.status).toBe(201);
    const { revision } = await response.json();

    const served = await GET_THUMBNAIL(new Request(`http://localhost/api/models/${revision.id}/thumbnail`), { params: Promise.resolve({ id: revision.id }) });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
    const bytes = new Uint8Array(await served.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("ignores invalid thumbnails and 404s when a revision has none", async () => {
    setSessionUserForTests(author);
    const response = await POST(publishRequest({
      name: "No thumbnail part",
      source: "cube([8, 3, 3]);",
      thumbnail: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    }));
    expect(response.status).toBe(201);
    const { revision } = await response.json();
    const served = await GET_THUMBNAIL(new Request(`http://localhost/api/models/${revision.id}/thumbnail`), { params: Promise.resolve({ id: revision.id }) });
    expect(served.status).toBe(404);
  });

  it("rejects drafts that fail validation or produce no solid", async () => {
    setSessionUserForTests(author);
    const invalid = await POST(publishRequest({ name: "", source: "cube(4);" }));
    expect(invalid.status).toBe(422);
    const flat = await POST(publishRequest({ name: "Flat", source: "size = 4;" }));
    expect(flat.status).toBe(422);
    expect((await flat.json()).error).toMatch(/3D solid/);
    const rows = await testDb.db.select({ id: models.id }).from(models);
    expect(rows).toHaveLength(3);
  });
});

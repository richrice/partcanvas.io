import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setSessionUserForTests, type SessionUser } from "@/lib/auth/session.server";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { likes, models, user } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { hasLiked, toggleLike } from "@/lib/models/likes.server";
import { createModel } from "@/lib/models/models.server";
import { saveRevision } from "@/lib/models/revisions.server";
import { POST } from "./route";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let publicModelId = "";
let privateModelId = "";

const liker: SessionUser = { id: "liker-1", name: "Liker", email: "liker@example.com", username: "liker", bio: null };

function likeRequest(id: string) {
  return POST(new Request(`http://localhost/api/app/models/${id}/like`, { method: "POST" }), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
  await testDb.db.insert(user).values([
    { id: "owner-1", name: "Owner", email: "owner@example.com", username: "owner" },
    { id: "liker-1", name: "Liker", email: "liker@example.com", username: "liker" },
  ]);
  const { record } = await saveRevision({ name: "Likeable", source: "cube([5, 5, 5]);" }, testDb.db);
  publicModelId = (await createModel({ ownerId: "owner-1", title: "Likeable", revisionId: record.id }, testDb.db)).id;
  privateModelId = (await createModel({ ownerId: "owner-1", title: "Hidden", revisionId: record.id, visibility: "private" }, testDb.db)).id;
});

afterAll(async () => {
  setSessionUserForTests(undefined);
  setDatabaseForTests(null);
  await testDb.close();
});

describe("toggleLike", () => {
  it("alternates like state and keeps like_count consistent", async () => {
    expect(await toggleLike(publicModelId, "liker-1", testDb.db)).toEqual({ liked: true, likeCount: 1 });
    expect(await hasLiked(publicModelId, "liker-1", testDb.db)).toBe(true);
    expect(await toggleLike(publicModelId, "liker-1", testDb.db)).toEqual({ liked: false, likeCount: 0 });
    expect(await hasLiked(publicModelId, "liker-1", testDb.db)).toBe(false);
    // A full double cycle cannot double-count: the PK forbids a second row.
    await toggleLike(publicModelId, "liker-1", testDb.db);
    const rows = await testDb.db.select().from(likes).where(eq(likes.modelId, publicModelId));
    expect(rows).toHaveLength(1);
    const [model] = await testDb.db.select({ likeCount: models.likeCount }).from(models).where(eq(models.id, publicModelId));
    expect(model.likeCount).toBe(1);
  });
});

describe("POST /api/app/models/:id/like", () => {
  it("requires a session", async () => {
    setSessionUserForTests(null);
    expect((await likeRequest(publicModelId)).status).toBe(401);
  });

  it("404s for unknown models and private models of others", async () => {
    setSessionUserForTests(liker);
    expect((await likeRequest("missing-model")).status).toBe(404);
    expect((await likeRequest(privateModelId)).status).toBe(404);
  });

  it("toggles through the endpoint", async () => {
    setSessionUserForTests(liker);
    // Store-level test above left the model liked; the endpoint unlikes it.
    const first = await likeRequest(publicModelId);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ liked: false, likeCount: 0 });
    const second = await likeRequest(publicModelId);
    expect(await second.json()).toEqual({ liked: true, likeCount: 1 });
  });
});

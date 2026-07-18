import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { models, user } from "../db/schema";
import { createTestDatabase } from "../db/test-db.server";
import { createModel, exploreModels } from "./models.server";
import { saveRevision } from "./revisions.server";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await testDb.db.insert(user).values({ id: "owner-1", name: "Owner", email: "o@example.com", username: "owner" });
  const { record } = await saveRevision({ name: "Base", source: "cube([5, 5, 5]);" }, testDb.db);

  const gearbox = await createModel({ ownerId: "owner-1", title: "Gearbox housing", revisionId: record.id, tags: ["gears", "robotics"], description: "A robust housing." }, testDb.db);
  await createModel({ ownerId: "owner-1", title: "Phone dock", revisionId: record.id, tags: ["desk"] }, testDb.db);
  await createModel({ ownerId: "owner-1", title: "Hidden gadget", revisionId: record.id, visibility: "unlisted", tags: ["gears"] }, testDb.db);
  await createModel({ ownerId: "owner-1", title: "Private gadget", revisionId: record.id, visibility: "private" }, testDb.db);
  await testDb.db.update(models).set({ likeCount: 5 }).where(eq(models.id, gearbox.id));
  // Force distinct created_at ordering: Phone dock is the newest.
  await testDb.db.update(models).set({ createdAt: sql`now() + interval '1 hour'` }).where(eq(models.slug, "phone-dock"));
});

afterAll(() => testDb.close());

describe("exploreModels", () => {
  it("lists only public models, newest first by default", async () => {
    const result = await exploreModels({}, testDb.db);
    expect(result.models.map((model) => model.title)).toEqual(["Phone dock", "Gearbox housing"]);
    expect(result.models[0].ownerUsername).toBe("owner");
    expect(result.hasMore).toBe(false);
  });

  it("sorts by likes when requested", async () => {
    const result = await exploreModels({ sort: "liked" }, testDb.db);
    expect(result.models.map((model) => model.title)).toEqual(["Gearbox housing", "Phone dock"]);
  });

  it("filters by tag (public only) and searches via FTS", async () => {
    const tagged = await exploreModels({ tag: "gears" }, testDb.db);
    expect(tagged.models.map((model) => model.title)).toEqual(["Gearbox housing"]);
    const searched = await exploreModels({ query: "robust housing" }, testDb.db);
    expect(searched.models.map((model) => model.title)).toEqual(["Gearbox housing"]);
    const none = await exploreModels({ query: "nonexistent-thing" }, testDb.db);
    expect(none.models).toEqual([]);
  });

  it("paginates with hasMore", async () => {
    const first = await exploreModels({ pageSize: 1 }, testDb.db);
    expect(first.models).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = await exploreModels({ pageSize: 1, page: 2 }, testDb.db);
    expect(second.models).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(first.models[0].id).not.toBe(second.models[0].id);
  });
});

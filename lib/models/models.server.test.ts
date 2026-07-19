import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { modelRevisions, user } from "../db/schema";
import { createTestDatabase } from "../db/test-db.server";
import { createModel, findModelForRevision, findPublicModelByHeadRevision, getForkLineage, getModelByOwnerSlug, listModelsByOwner, publishModelVersion, readModel, slugify } from "./models.server";
import { saveRevision } from "./revisions.server";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let revisionId = "";

beforeAll(async () => {
  testDb = await createTestDatabase();
  await testDb.db.insert(user).values([
    { id: "owner-1", name: "Owner One", email: "one@example.com", username: "owner-one" },
    { id: "owner-2", name: "Owner Two", email: "two@example.com", username: "owner-two" },
  ]);
  const saved = await saveRevision({ name: "Base cube", source: "cube([6, 6, 6]);" }, testDb.db);
  revisionId = saved.record.id;
});

afterAll(() => testDb.close());

describe("slugify", () => {
  it("produces url-safe slugs", () => {
    expect(slugify("Parametric Phone Stand!")).toBe("parametric-phone-stand");
    expect(slugify("Crème brûlée holder")).toBe("creme-brulee-holder");
    expect(slugify("---")).toBe("model");
    expect(slugify("x".repeat(90)).length).toBeLessThanOrEqual(60);
  });
});

describe("model store", () => {
  it("creates a model with defaults and a version-1 history row", async () => {
    const model = await createModel({ ownerId: "owner-1", title: "  Phone Stand  ", revisionId }, testDb.db);
    expect(model).toMatchObject({
      ownerId: "owner-1",
      slug: "phone-stand",
      title: "Phone Stand",
      license: "CC-BY-4.0",
      visibility: "public",
      tags: [],
      headRevisionId: revisionId,
      likeCount: 0,
      downloadCount: 0,
    });
    const history = await testDb.db.select().from(modelRevisions).where(eq(modelRevisions.modelId, model.id));
    expect(history).toEqual([expect.objectContaining({ revisionId, version: 1 })]);
    expect(await readModel(model.id, testDb.db)).toEqual(model);
    expect(await readModel("missing", testDb.db)).toBeNull();
  });

  it("dedupes slugs with numeric suffixes", async () => {
    const second = await createModel({ ownerId: "owner-1", title: "Phone stand", revisionId }, testDb.db);
    const third = await createModel({ ownerId: "owner-1", title: "phone Stand", revisionId }, testDb.db);
    expect(second.slug).toBe("phone-stand-2");
    expect(third.slug).toBe("phone-stand-3");
    // A different owner is free to use the original slug.
    const otherOwner = await createModel({ ownerId: "owner-2", title: "Phone stand", revisionId }, testDb.db);
    expect(otherOwner.slug).toBe("phone-stand");
  });

  it("validates and normalizes metadata", async () => {
    const model = await createModel({
      ownerId: "owner-1",
      title: "Tagged model",
      revisionId,
      description: "  A described model.  ",
      license: "CC0-1.0",
      visibility: "unlisted",
      tags: ["Gears", "gears", " Robotics ", ""],
    }, testDb.db);
    expect(model).toMatchObject({ description: "A described model.", license: "CC0-1.0", visibility: "unlisted", tags: ["gears", "robotics"] });
    const bogus = await createModel({ ownerId: "owner-1", title: "Bogus meta", revisionId, license: "WTFPL", visibility: "secret" }, testDb.db);
    expect(bogus).toMatchObject({ license: "CC-BY-4.0", visibility: "public" });
    await expect(createModel({ ownerId: "owner-1", title: "   ", revisionId }, testDb.db)).rejects.toThrow(/title is required/i);
  });

  it("resolves owner/slug and filters listings by visibility", async () => {
    const found = await getModelByOwnerSlug("owner-one", "phone-stand", testDb.db);
    expect(found?.model.slug).toBe("phone-stand");
    expect(found?.owner).toMatchObject({ id: "owner-1", username: "owner-one" });
    expect(await getModelByOwnerSlug("owner-one", "nope", testDb.db)).toBeNull();
    expect(await getModelByOwnerSlug("ghost", "phone-stand", testDb.db)).toBeNull();

    await createModel({ ownerId: "owner-1", title: "Secret thing", revisionId, visibility: "private" }, testDb.db);
    const publicView = await listModelsByOwner("owner-one", {}, testDb.db);
    expect(publicView?.models.every((row) => row.visibility === "public")).toBe(true);
    const ownerView = await listModelsByOwner("owner-one", { viewerId: "owner-1" }, testDb.db);
    expect(ownerView!.models.length).toBeGreaterThan(publicView!.models.length);
    expect(await listModelsByOwner("ghost", {}, testDb.db)).toBeNull();
  });

  it("maps a head revision back to the oldest public model", async () => {
    const found = await findPublicModelByHeadRevision(revisionId, testDb.db);
    // Oldest model with this head: the very first "Phone Stand" (public).
    expect(found).toEqual({ title: "Phone Stand", slug: "phone-stand", ownerUsername: "owner-one" });
    const saved = await saveRevision({ name: "Unreferenced", source: "cube([7, 7, 7]);" }, testDb.db);
    expect(await findPublicModelByHeadRevision(saved.record.id, testDb.db)).toBeNull();
  });

  it("resolves historical revisions through the publish history", async () => {
    const model = await createModel({ ownerId: "owner-2", title: "Versioned box", revisionId }, testDb.db);
    const v2 = await saveRevision({ name: "Versioned box", source: "cube([8, 8, 8]);" }, testDb.db);
    await publishModelVersion(model.id, v2.record.id, testDb.db);
    // The new head resolves with version null; the superseded v1 revision
    // resolves through model_revisions with its version number.
    expect(await findModelForRevision(v2.record.id, testDb.db)).toMatchObject({ slug: "versioned-box", version: null });
    const historical = await findModelForRevision(revisionId, testDb.db);
    // revisionId is still the head of older public models — the head lookup
    // wins there, so assert via a revision that is *only* historical.
    expect(historical).not.toBeNull();
    const v3 = await saveRevision({ name: "Versioned box", source: "cube([9, 9, 9]);" }, testDb.db);
    await publishModelVersion(model.id, v3.record.id, testDb.db);
    expect(await findModelForRevision(v2.record.id, testDb.db)).toEqual({ title: "Versioned box", slug: "versioned-box", ownerUsername: "owner-two", version: 2 });
    expect(await findModelForRevision("ffffffffffffffffffffffff", testDb.db)).toBeNull();
  });

  it("records fork lineage and searches via the generated tsvector", async () => {
    const source = await getModelByOwnerSlug("owner-one", "phone-stand", testDb.db);
    const fork = await createModel({
      ownerId: "owner-2",
      title: "Phone stand remix",
      revisionId,
      forkedFromModelId: source!.model.id,
      forkedFromRevisionId: source!.model.headRevisionId,
    }, testDb.db);
    expect(fork.forkedFromModelId).toBe(source!.model.id);
    expect(fork.forkedFromRevisionId).toBe(revisionId);

    const hits = await testDb.client.query(
      "select id from models where search @@ websearch_to_tsquery('english', $1)",
      ["remix"],
    );
    expect(hits.rows).toEqual([{ id: fork.id }]);
  });

  it("reports fork lineage in both directions, public forks only", async () => {
    const source = await getModelByOwnerSlug("owner-one", "phone-stand", testDb.db);
    const fork = await getModelByOwnerSlug("owner-two", "phone-stand-remix", testDb.db);

    const forkLineage = await getForkLineage(fork!.model, testDb.db);
    expect(forkLineage.forkedFrom).toEqual({ title: "Phone Stand", slug: "phone-stand", ownerUsername: "owner-one" });

    const sourceLineage = await getForkLineage(source!.model, testDb.db);
    expect(sourceLineage.forkCount).toBe(1);
    expect(sourceLineage.forks).toEqual([{ title: "Phone stand remix", slug: "phone-stand-remix", ownerUsername: "owner-two" }]);

    // A private fork disappears from counts and listings.
    await createModel({
      ownerId: "owner-2", title: "Secret remix", revisionId,
      visibility: "private", forkedFromModelId: source!.model.id, forkedFromRevisionId: revisionId,
    }, testDb.db);
    const after = await getForkLineage(source!.model, testDb.db);
    expect(after.forkCount).toBe(1);
    expect(after.forks).toHaveLength(1);
  });
});

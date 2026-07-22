import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetRateLimitsForTests } from "@/lib/api/rate-limit.server";
import { setSessionUserForTests, type SessionUser } from "@/lib/auth/session.server";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { user } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { createModel } from "@/lib/models/models.server";
import { readRevisionThumbnail, readRevisionThumbnailState, saveRevision, setRevisionThumbnail } from "@/lib/models/revisions.server";
import { decodeThumbnailDataUrl, THUMBNAIL_VERSION } from "@/lib/models/thumbnails.server";
import { PUT } from "./route";

// 1x1 transparent PNG.
const PNG_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let publicModelId = "";
let publicRevisionId = "";
let privateModelId = "";
let refreshModelId = "";
let refreshRevisionId = "";
let currentModelId = "";
let currentRevisionId = "";

const owner: SessionUser = { id: "owner-1", name: "Owner", email: "owner@example.com", username: "owner", bio: null };
const other: SessionUser = { id: "other-1", name: "Other", email: "other@example.com", username: "other", bio: null };

function thumbnailRequest(id: string, body: unknown) {
  return PUT(new Request(`http://localhost/api/app/models/${id}/thumbnail`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
  resetRateLimitsForTests();
  await testDb.db.insert(user).values([
    { id: owner.id, name: owner.name, email: owner.email, username: owner.username },
    { id: other.id, name: other.name, email: other.email, username: other.username },
  ]);

  const { record: publicRevision } = await saveRevision({ name: "Public", source: "cube([5, 5, 5]);" }, testDb.db);
  publicRevisionId = publicRevision.id;
  publicModelId = (await createModel({ ownerId: owner.id, title: "Public", revisionId: publicRevision.id }, testDb.db)).id;
  privateModelId = (await createModel({
    ownerId: owner.id,
    title: "Private",
    revisionId: publicRevision.id,
    visibility: "private",
  }, testDb.db)).id;

  const { record: refreshRevision } = await saveRevision({ name: "Refresh", source: "cube([6, 6, 6]);" }, testDb.db);
  refreshRevisionId = refreshRevision.id;
  refreshModelId = (await createModel({ ownerId: owner.id, title: "Refresh", revisionId: refreshRevision.id }, testDb.db)).id;
  const oldBytes = Uint8Array.from(decodeThumbnailDataUrl(PNG_PIXEL)!);
  oldBytes[oldBytes.length - 1] ^= 0xff;
  await setRevisionThumbnail(refreshRevision.id, oldBytes, 0, testDb.db);

  const { record: currentRevision } = await saveRevision({ name: "Current", source: "cube([7, 7, 7]);" }, testDb.db);
  currentRevisionId = currentRevision.id;
  currentModelId = (await createModel({ ownerId: owner.id, title: "Current", revisionId: currentRevision.id }, testDb.db)).id;
  await setRevisionThumbnail(currentRevision.id, decodeThumbnailDataUrl(PNG_PIXEL)!, THUMBNAIL_VERSION, testDb.db);
});

afterAll(async () => {
  setSessionUserForTests(undefined);
  setDatabaseForTests(null);
  resetRateLimitsForTests();
  await testDb.close();
});

describe("PUT /api/app/models/:id/thumbnail", () => {
  it("requires a session", async () => {
    setSessionUserForTests(null);
    const response = await thumbnailRequest(publicModelId, { revisionId: publicRevisionId, thumbnail: PNG_PIXEL });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to update thumbnails" });
  });

  it("rejects a non-owner of a visible model", async () => {
    setSessionUserForTests(other);
    expect((await thumbnailRequest(publicModelId, { revisionId: publicRevisionId, thumbnail: PNG_PIXEL })).status).toBe(403);
  });

  it("404s for an unknown model", async () => {
    setSessionUserForTests(owner);
    expect((await thumbnailRequest("missing-model", { revisionId: publicRevisionId, thumbnail: PNG_PIXEL })).status).toBe(404);
  });

  it("hides a private model from a non-owner", async () => {
    setSessionUserForTests(other);
    expect((await thumbnailRequest(privateModelId, { revisionId: publicRevisionId, thumbnail: PNG_PIXEL })).status).toBe(404);
  });

  it("rejects a capture for a stale head revision", async () => {
    setSessionUserForTests(owner);
    expect((await thumbnailRequest(publicModelId, { revisionId: refreshRevisionId, thumbnail: PNG_PIXEL })).status).toBe(409);
  });

  it("rejects a malformed thumbnail data URL", async () => {
    setSessionUserForTests(owner);
    const response = await thumbnailRequest(publicModelId, {
      revisionId: publicRevisionId,
      thumbnail: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    });
    expect(response.status).toBe(422);
  });

  it("updates stale thumbnail bytes and stamps the current version", async () => {
    setSessionUserForTests(owner);
    const beforeBytes = await readRevisionThumbnail(refreshRevisionId, testDb.db);
    expect(await readRevisionThumbnailState(refreshRevisionId, testDb.db)).toEqual({ present: true, version: 0 });

    const response = await thumbnailRequest(refreshModelId, { revisionId: refreshRevisionId, thumbnail: PNG_PIXEL });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ updated: true });
    const afterBytes = await readRevisionThumbnail(refreshRevisionId, testDb.db);
    expect(afterBytes).toEqual(decodeThumbnailDataUrl(PNG_PIXEL));
    expect(afterBytes).not.toEqual(beforeBytes);
    expect(await readRevisionThumbnailState(refreshRevisionId, testDb.db)).toEqual({
      present: true,
      version: THUMBNAIL_VERSION,
    });
  });

  it("returns updated:false when the thumbnail is already current", async () => {
    setSessionUserForTests(owner);
    const response = await thumbnailRequest(currentModelId, { revisionId: currentRevisionId, thumbnail: PNG_PIXEL });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ updated: false });
    expect(await readRevisionThumbnailState(currentRevisionId, testDb.db)).toEqual({
      present: true,
      version: THUMBNAIL_VERSION,
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setSessionUserForTests, type SessionUser } from "@/lib/auth/session.server";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { comments, models, user } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { addComment, deleteComment, listComments } from "@/lib/models/comments.server";
import { createModel } from "@/lib/models/models.server";
import { saveRevision } from "@/lib/models/revisions.server";
import { DELETE } from "./[commentId]/route";
import { GET, POST } from "./route";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let publicModelId = "";
let privateModelId = "";

const commenter: SessionUser = { id: "commenter-1", name: "Commenter", email: "commenter@example.com", username: "commenter", bio: null };
const owner: SessionUser = { id: "owner-1", name: "Owner", email: "owner@example.com", username: "owner", bio: null };

function getRequest(id: string) {
  return GET(new Request(`http://localhost/api/app/models/${id}/comments`), { params: Promise.resolve({ id }) });
}

function postRequest(id: string, body: unknown) {
  return POST(new Request(`http://localhost/api/app/models/${id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

function deleteRequest(id: string, commentId: string) {
  return DELETE(new Request(`http://localhost/api/app/models/${id}/comments/${commentId}`, { method: "DELETE" }), { params: Promise.resolve({ id, commentId }) });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
  await testDb.db.insert(user).values([
    { id: "owner-1", name: "Owner", email: "owner@example.com", username: "owner" },
    { id: "commenter-1", name: "Commenter", email: "commenter@example.com", username: "commenter" },
  ]);
  const { record } = await saveRevision({ name: "Discussable", source: "cube([5, 5, 5]);" }, testDb.db);
  publicModelId = (await createModel({ ownerId: "owner-1", title: "Discussable", revisionId: record.id }, testDb.db)).id;
  privateModelId = (await createModel({ ownerId: "owner-1", title: "Hidden", revisionId: record.id, visibility: "private" }, testDb.db)).id;
});

afterAll(async () => {
  setSessionUserForTests(undefined);
  setDatabaseForTests(null);
  await testDb.close();
});

describe("comments store", () => {
  it("adds, lists newest-first, and keeps comment_count in step", async () => {
    const first = await addComment({ modelId: publicModelId, authorId: "commenter-1", body: "  Nice bracket!  " }, testDb.db);
    expect(first.body).toBe("Nice bracket!");
    expect(first.author.username).toBe("commenter");
    const second = await addComment({ modelId: publicModelId, authorId: "owner-1", body: "Thanks" }, testDb.db);
    const page = await listComments(publicModelId, { viewerId: "commenter-1" }, testDb.db);
    expect(page.commentCount).toBe(2);
    expect(page.comments.map((comment) => comment.id)).toEqual([second.id, first.id]);
    expect(page.comments[1].viewerIsAuthor).toBe(true);
    expect(page.comments[0].viewerIsAuthor).toBe(false);
    const [model] = await testDb.db.select({ commentCount: models.commentCount }).from(models).where(eq(models.id, publicModelId));
    expect(model.commentCount).toBe(2);
  });

  it("rejects empty and oversized bodies", async () => {
    await expect(addComment({ modelId: publicModelId, authorId: "commenter-1", body: "   " }, testDb.db)).rejects.toThrow(/empty/);
    await expect(addComment({ modelId: publicModelId, authorId: "commenter-1", body: "x".repeat(2_001) }, testDb.db)).rejects.toThrow(/longer/);
  });

  it("lets the author and the model owner delete, and nobody else", async () => {
    const target = await addComment({ modelId: publicModelId, authorId: "commenter-1", body: "delete me" }, testDb.db);
    // A third party (not author, not owner) cannot delete.
    expect(await deleteComment({ commentId: target.id, modelId: publicModelId, userId: "owner-2", isModelOwner: false }, testDb.db)).toBeNull();
    // The model owner can moderate someone else's comment.
    const result = await deleteComment({ commentId: target.id, modelId: publicModelId, userId: "owner-1", isModelOwner: true }, testDb.db);
    expect(result?.commentCount).toBe(2);
    const remaining = await testDb.db.select({ id: comments.id }).from(comments).where(eq(comments.modelId, publicModelId));
    expect(remaining).toHaveLength(2);
  });
});

describe("comments API", () => {
  it("lists without a session on public models, 404s on private", async () => {
    setSessionUserForTests(null);
    const response = await getRequest(publicModelId);
    expect(response.status).toBe(200);
    const payload = await response.json() as { comments: unknown[]; commentCount: number; viewerCanModerate: boolean };
    expect(payload.commentCount).toBe(2);
    expect(payload.viewerCanModerate).toBe(false);
    expect((await getRequest(privateModelId)).status).toBe(404);
  });

  it("requires a session to post", async () => {
    setSessionUserForTests(null);
    expect((await postRequest(publicModelId, { body: "anon" })).status).toBe(401);
  });

  it("posts and deletes through the endpoints", async () => {
    setSessionUserForTests(commenter);
    const created = await postRequest(publicModelId, { body: "Printed great at 0.2mm" });
    expect(created.status).toBe(201);
    const { comment } = await created.json() as { comment: { id: string; body: string } };
    expect(comment.body).toBe("Printed great at 0.2mm");
    expect((await postRequest(publicModelId, { body: "  " })).status).toBe(400);

    // The model owner moderates it away even though they didn't write it.
    setSessionUserForTests(owner);
    const moderated = await deleteRequest(publicModelId, comment.id);
    expect(moderated.status).toBe(200);
    expect(await moderated.json()).toEqual({ commentCount: 2 });
    expect((await deleteRequest(publicModelId, comment.id)).status).toBe(404);
    const listed = await getRequest(publicModelId);
    expect(((await listed.json()) as { viewerCanModerate: boolean }).viewerCanModerate).toBe(true);
  });
});

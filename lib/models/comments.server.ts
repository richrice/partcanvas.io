import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "../db/client.server";
import { comments, models, user } from "../db/schema";

// Flat per-model discussion. Inserts and deletes move comment_count on the
// model in the same transaction (the likes.server.ts pattern); deletion is
// allowed to the comment author and to the model owner (moderation).

export const COMMENT_MAX_LENGTH = 2_000;
export const COMMENT_PAGE_SIZE = 50;

export interface CommentView {
  id: string;
  body: string;
  createdAt: string;
  author: { username: string | null; name: string; image: string | null };
  viewerIsAuthor: boolean;
}

export interface CommentPage {
  comments: CommentView[];
  commentCount: number;
  hasMore: boolean;
}

function toView(row: {
  id: string;
  body: string;
  createdAt: Date;
  authorId: string;
  authorUsername: string | null;
  authorName: string;
  authorImage: string | null;
}, viewerId: string | null): CommentView {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: { username: row.authorUsername, name: row.authorName, image: row.authorImage },
    viewerIsAuthor: viewerId !== null && viewerId === row.authorId,
  };
}

export async function addComment(
  input: { modelId: string; authorId: string; body: string },
  db: Database = getDb(),
): Promise<CommentView> {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) throw new Error("Comment cannot be empty");
  if (body.length > COMMENT_MAX_LENGTH) throw new Error(`Comment is longer than ${COMMENT_MAX_LENGTH} characters`);
  const id = randomBytes(12).toString("base64url");
  return db.transaction(async (tx) => {
    await tx.insert(comments).values({ id, modelId: input.modelId, authorId: input.authorId, body });
    await tx.update(models)
      .set({ commentCount: sql`${models.commentCount} + 1` })
      .where(eq(models.id, input.modelId));
    const [row] = await tx.select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      authorId: comments.authorId,
      authorUsername: user.username,
      authorName: user.name,
      authorImage: user.image,
    }).from(comments).innerJoin(user, eq(comments.authorId, user.id)).where(eq(comments.id, id));
    return toView(row, input.authorId);
  });
}

// Newest first, offset-paged like exploreModels. viewerId only marks the
// viewer's own comments (for the delete affordance) — visibility of the model
// itself is the caller's responsibility.
export async function listComments(
  modelId: string,
  options: { viewerId?: string | null; page?: number } = {},
  db: Database = getDb(),
): Promise<CommentPage> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const rows = await db.select({
    id: comments.id,
    body: comments.body,
    createdAt: comments.createdAt,
    authorId: comments.authorId,
    authorUsername: user.username,
    authorName: user.name,
    authorImage: user.image,
  }).from(comments)
    .innerJoin(user, eq(comments.authorId, user.id))
    .where(eq(comments.modelId, modelId))
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .limit(COMMENT_PAGE_SIZE + 1)
    .offset((page - 1) * COMMENT_PAGE_SIZE);
  const [model] = await db.select({ commentCount: models.commentCount }).from(models).where(eq(models.id, modelId));
  return {
    comments: rows.slice(0, COMMENT_PAGE_SIZE).map((row) => toView(row, options.viewerId ?? null)),
    commentCount: model?.commentCount ?? rows.length,
    hasMore: rows.length > COMMENT_PAGE_SIZE,
  };
}

// Returns the new comment count, or null when the comment does not exist or
// the caller may not delete it (author or model owner only).
export async function deleteComment(
  input: { commentId: string; modelId: string; userId: string; isModelOwner: boolean },
  db: Database = getDb(),
): Promise<{ commentCount: number } | null> {
  return db.transaction(async (tx) => {
    const scope = and(eq(comments.id, input.commentId), eq(comments.modelId, input.modelId));
    const deleted = await tx.delete(comments)
      .where(input.isModelOwner ? scope : and(scope, eq(comments.authorId, input.userId)))
      .returning({ id: comments.id });
    if (deleted.length === 0) return null;
    const [row] = await tx.update(models)
      .set({ commentCount: sql`greatest(${models.commentCount} - 1, 0)` })
      .where(eq(models.id, input.modelId))
      .returning({ commentCount: models.commentCount });
    return { commentCount: row.commentCount };
  });
}

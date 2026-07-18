import { and, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "../db/client.server";
import { likes, models } from "../db/schema";

// One positive vote per user per model (D9). The toggle and the denormalized
// like_count move in one transaction; the likes PK makes double-likes
// impossible, so repeated calls simply alternate the state.
export async function toggleLike(modelId: string, userId: string, db: Database = getDb()): Promise<{ liked: boolean; likeCount: number }> {
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(likes).values({ modelId, userId }).onConflictDoNothing().returning({ modelId: likes.modelId });
    if (inserted.length > 0) {
      const [row] = await tx.update(models)
        .set({ likeCount: sql`${models.likeCount} + 1` })
        .where(eq(models.id, modelId))
        .returning({ likeCount: models.likeCount });
      return { liked: true, likeCount: row.likeCount };
    }
    await tx.delete(likes).where(and(eq(likes.modelId, modelId), eq(likes.userId, userId)));
    const [row] = await tx.update(models)
      .set({ likeCount: sql`greatest(${models.likeCount} - 1, 0)` })
      .where(eq(models.id, modelId))
      .returning({ likeCount: models.likeCount });
    return { liked: false, likeCount: row.likeCount };
  });
}

export async function hasLiked(modelId: string, userId: string, db: Database = getDb()): Promise<boolean> {
  const rows = await db.select({ modelId: likes.modelId }).from(likes)
    .where(and(eq(likes.modelId, modelId), eq(likes.userId, userId))).limit(1);
  return rows.length > 0;
}

import { randomBytes } from "node:crypto";
import { and, arrayContains, desc, eq, sql, type SQL } from "drizzle-orm";
import { getDb, type Database } from "../db/client.server";
import { isUniqueViolation } from "../db/errors.server";
import { modelRevisions, models, user } from "../db/schema";
import { LICENSES, VISIBILITIES, type License, type Visibility } from "./types";

// Store for the mutable social object layered over immutable revisions (§2).

export type ModelRow = typeof models.$inferSelect;

export interface ModelOwner {
  id: string;
  username: string | null;
  name: string;
  bio: string | null;
}

export interface CreateModelInput {
  ownerId: string;
  title: string;
  revisionId: string;
  description?: string;
  license?: string;
  visibility?: string;
  tags?: string[];
  forkedFromModelId?: string;
  forkedFromRevisionId?: string;
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "model";
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

// Creates the model row plus its version-1 history row atomically. Slug
// collisions retry with -2..-9 suffixes, then a random suffix; each attempt is
// its own transaction because a unique violation aborts the enclosing one.
export async function createModel(input: CreateModelInput, db: Database = getDb()): Promise<ModelRow> {
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 80) : "";
  if (!title) throw new Error("Model title is required");
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 1_000) : "";
  const license: License = LICENSES.includes(input.license as License) ? input.license as License : "CC-BY-4.0";
  const visibility: Visibility = VISIBILITIES.includes(input.visibility as Visibility) ? input.visibility as Visibility : "public";
  const tags = normalizeTags(input.tags);
  const base = slugify(title);

  for (let attempt = 0; ; attempt += 1) {
    const slug = attempt === 0 ? base
      : attempt <= 8 ? `${base}-${attempt + 1}`
      : `${base}-${randomBytes(3).toString("hex")}`;
    try {
      return await db.transaction(async (tx) => {
        const [created] = await tx.insert(models).values({
          id: randomBytes(12).toString("base64url"),
          ownerId: input.ownerId,
          slug,
          title,
          description,
          license,
          visibility,
          tags,
          headRevisionId: input.revisionId,
          forkedFromModelId: input.forkedFromModelId,
          forkedFromRevisionId: input.forkedFromRevisionId,
        }).returning();
        await tx.insert(modelRevisions).values({ modelId: created.id, revisionId: input.revisionId, version: 1 });
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 12) continue;
      throw error;
    }
  }
}

export async function readModel(id: string, db: Database = getDb()): Promise<ModelRow | null> {
  const [row] = await db.select().from(models).where(eq(models.id, id)).limit(1);
  return row ?? null;
}

export async function getModelByOwnerSlug(username: string, slug: string, db: Database = getDb()): Promise<{ model: ModelRow; owner: ModelOwner } | null> {
  const [row] = await db.select({ model: models, owner: { id: user.id, username: user.username, name: user.name, bio: user.bio } })
    .from(models)
    .innerJoin(user, eq(models.ownerId, user.id))
    .where(and(eq(user.username, username), eq(models.slug, slug)))
    .limit(1);
  return row ?? null;
}

// Revision permalinks link back to the community page when the revision is
// the head of some public model (P3.7). Oldest model wins for determinism
// when forks share a head revision.
export async function findPublicModelByHeadRevision(revisionId: string, db: Database = getDb()): Promise<{ title: string; slug: string; ownerUsername: string | null } | null> {
  const [row] = await db.select({ title: models.title, slug: models.slug, ownerUsername: user.username })
    .from(models)
    .innerJoin(user, eq(models.ownerId, user.id))
    .where(and(eq(models.headRevisionId, revisionId), eq(models.visibility, "public")))
    .orderBy(models.createdAt)
    .limit(1);
  return row ?? null;
}

// Fire-and-forget download counter (P3.6) — no dedup in v1.
export async function recordDownload(modelId: string, db: Database = getDb()): Promise<number | null> {
  const [row] = await db.update(models)
    .set({ downloadCount: sql`${models.downloadCount} + 1` })
    .where(eq(models.id, modelId))
    .returning({ downloadCount: models.downloadCount });
  return row?.downloadCount ?? null;
}

export type ExploreSort = "newest" | "liked";

export interface ExploreOptions {
  sort?: ExploreSort;
  tag?: string;
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface ExploreResult {
  models: (ModelRow & { ownerUsername: string | null })[];
  page: number;
  hasMore: boolean;
}

// Browse/search over public models only (D11): Postgres FTS via the generated
// tsvector, tag filter over the array column, newest/most-liked sorts, and
// fetch-one-extra pagination.
export async function exploreModels(options: ExploreOptions = {}, db: Database = getDb()): Promise<ExploreResult> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(48, Math.max(1, Math.floor(options.pageSize ?? 24)));
  const conditions: SQL[] = [eq(models.visibility, "public")];
  const tag = options.tag?.trim().toLowerCase();
  if (tag) conditions.push(arrayContains(models.tags, [tag]));
  const query = options.query?.trim();
  if (query) conditions.push(sql`${models.search} @@ websearch_to_tsquery('english', ${query})`);
  const rows = await db.select({ model: models, ownerUsername: user.username })
    .from(models)
    .innerJoin(user, eq(models.ownerId, user.id))
    .where(and(...conditions))
    .orderBy(...(options.sort === "liked"
      ? [desc(models.likeCount), desc(models.createdAt)]
      : [desc(models.createdAt)]))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return {
    models: rows.slice(0, pageSize).map((row) => ({ ...row.model, ownerUsername: row.ownerUsername })),
    page,
    hasMore: rows.length > pageSize,
  };
}

// Profile listing: public models only, unless the viewer is the owner —
// unlisted/private models never appear in another user's view of a profile
// (D10: unlisted resolves by direct link only).
export async function listModelsByOwner(username: string, options: { viewerId?: string } = {}, db: Database = getDb()): Promise<{ owner: ModelOwner; models: ModelRow[] } | null> {
  const [owner] = await db.select({ id: user.id, username: user.username, name: user.name, bio: user.bio }).from(user).where(eq(user.username, username)).limit(1);
  if (!owner) return null;
  const rows = await db.select().from(models)
    .where(options.viewerId === owner.id
      ? eq(models.ownerId, owner.id)
      : and(eq(models.ownerId, owner.id), eq(models.visibility, "public")))
    .orderBy(desc(models.updatedAt), desc(models.createdAt));
  return { owner, models: rows };
}

import { randomBytes } from "node:crypto";
import { and, arrayContains, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { getDb, type Database } from "../db/client.server";
import { isUniqueViolation } from "../db/errors.server";
import { modelRevisions, models, revisions, user } from "../db/schema";
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

// Forking (§2): a new model owned by the caller pointing at the same head
// revision — zero bytes copied. Metadata carries over; the per-owner slug
// dedup in createModel handles forking into a name you already use.
export async function forkModel(source: ModelRow, ownerId: string, db: Database = getDb()): Promise<ModelRow> {
  return createModel({
    ownerId,
    title: source.title,
    revisionId: source.headRevisionId,
    description: source.description,
    license: source.license,
    tags: source.tags,
    forkedFromModelId: source.id,
    forkedFromRevisionId: source.headRevisionId,
  }, db);
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

export interface ModelMetadataPatch {
  title?: unknown;
  description?: unknown;
  tags?: unknown;
  license?: unknown;
  visibility?: unknown;
}

// Owner-managed metadata (P4.4). Slug stays immutable (D7). Unlike create —
// where bad metadata falls back to defaults — an explicit patch with an
// invalid value is an error.
export async function updateModelMetadata(modelId: string, patch: ModelMetadataPatch, db: Database = getDb()): Promise<ModelRow | null> {
  const changes: Record<string, unknown> = { updatedAt: sql`now()` };
  if (patch.title !== undefined) {
    const title = typeof patch.title === "string" ? patch.title.trim().slice(0, 80) : "";
    if (!title) throw new Error("Model title is required");
    changes.title = title;
  }
  if (patch.description !== undefined) {
    changes.description = typeof patch.description === "string" ? patch.description.trim().slice(0, 1_000) : "";
  }
  if (patch.tags !== undefined) changes.tags = normalizeTags(patch.tags);
  if (patch.license !== undefined) {
    if (!LICENSES.includes(patch.license as License)) throw new Error(`License must be one of: ${LICENSES.join(", ")}`);
    changes.license = patch.license;
  }
  if (patch.visibility !== undefined) {
    if (!VISIBILITIES.includes(patch.visibility as Visibility)) throw new Error(`Visibility must be one of: ${VISIBILITIES.join(", ")}`);
    changes.visibility = patch.visibility;
  }
  const [row] = await db.update(models).set(changes).where(eq(models.id, modelId)).returning();
  return row ?? null;
}

// Deleting a model removes the social object and its history rows (cascade);
// revisions remain — content-addressed and possibly shared with forks, whose
// forked_from_model_id goes null (§2, P4.4).
export async function deleteModel(modelId: string, db: Database = getDb()): Promise<boolean> {
  const rows = await db.delete(models).where(eq(models.id, modelId)).returning({ id: models.id });
  return rows.length > 0;
}

// Publishing an update (§2): insert the next history row and move the head
// pointer atomically. Callers pass an already-saved revision id.
export async function publishModelVersion(modelId: string, revisionId: string, db: Database = getDb()): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ max: sql<number>`coalesce(max(${modelRevisions.version}), 0)` })
      .from(modelRevisions).where(eq(modelRevisions.modelId, modelId));
    const version = Number(current.max) + 1;
    await tx.insert(modelRevisions).values({ modelId, revisionId, version });
    await tx.update(models).set({ headRevisionId: revisionId, updatedAt: sql`now()` }).where(eq(models.id, modelId));
    return { version };
  });
}

export async function listModelVersions(modelId: string, db: Database = getDb()): Promise<{ version: number; revisionId: string; publishedAt: Date }[]> {
  return db.select({ version: modelRevisions.version, revisionId: modelRevisions.revisionId, publishedAt: modelRevisions.publishedAt })
    .from(modelRevisions)
    .where(eq(modelRevisions.modelId, modelId))
    .orderBy(desc(modelRevisions.version));
}

export interface ForkLink {
  title: string;
  slug: string;
  ownerUsername: string | null;
}

export interface ForkLineage {
  forkedFrom: ForkLink | null;
  forkCount: number;
  forks: ForkLink[];
}

// Lineage for the model page (P4.2). The forked-from link is hidden if the
// source has since gone private; fork counts and the fork list are public
// forks only, most-liked first.
export async function getForkLineage(model: ModelRow, db: Database = getDb()): Promise<ForkLineage> {
  let forkedFrom: ForkLink | null = null;
  if (model.forkedFromModelId) {
    const [row] = await db.select({ title: models.title, slug: models.slug, ownerUsername: user.username, visibility: models.visibility })
      .from(models)
      .innerJoin(user, eq(models.ownerId, user.id))
      .where(eq(models.id, model.forkedFromModelId))
      .limit(1);
    if (row && row.visibility !== "private") forkedFrom = { title: row.title, slug: row.slug, ownerUsername: row.ownerUsername };
  }
  const publicForks = and(eq(models.forkedFromModelId, model.id), eq(models.visibility, "public"));
  const forks = await db.select({ title: models.title, slug: models.slug, ownerUsername: user.username })
    .from(models)
    .innerJoin(user, eq(models.ownerId, user.id))
    .where(publicForks)
    .orderBy(desc(models.likeCount), desc(models.createdAt))
    .limit(12);
  const [total] = await db.select({ count: count() }).from(models).where(publicForks);
  return { forkedFrom, forkCount: total.count, forks };
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

// Full lookup for /m/:id banners: head revisions resolve as before, and
// historical versions resolve through the publish-history table so old
// version permalinks aren't dead ends. `version` is null for the head.
export async function findModelForRevision(revisionId: string, db: Database = getDb()): Promise<{ title: string; slug: string; ownerUsername: string | null; version: number | null } | null> {
  const head = await findPublicModelByHeadRevision(revisionId, db);
  if (head) return { ...head, version: null };
  const [row] = await db.select({ title: models.title, slug: models.slug, ownerUsername: user.username, version: modelRevisions.version })
    .from(modelRevisions)
    .innerJoin(models, eq(modelRevisions.modelId, models.id))
    .innerJoin(user, eq(models.ownerId, user.id))
    .where(and(eq(modelRevisions.revisionId, revisionId), eq(models.visibility, "public")))
    .orderBy(models.createdAt, desc(modelRevisions.version))
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

// Fire-and-forget view counter, incremented on model-page render for
// non-owner viewers. No dedup or bot filtering in v1 — same posture as
// downloads.
export async function recordView(modelId: string, db: Database = getDb()): Promise<void> {
  await db.update(models)
    .set({ viewCount: sql`${models.viewCount} + 1` })
    .where(eq(models.id, modelId));
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
  models: (ModelRow & { ownerUsername: string | null; thumbnailVersion: number | null })[];
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
  const rows = await db.select({ model: models, ownerUsername: user.username, thumbnailVersion: revisions.thumbnailVersion })
    .from(models)
    .innerJoin(revisions, eq(models.headRevisionId, revisions.id))
    .innerJoin(user, eq(models.ownerId, user.id))
    .where(and(...conditions))
    .orderBy(...(options.sort === "liked"
      ? [desc(models.likeCount), desc(models.createdAt)]
      : [desc(models.createdAt)]))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return {
    models: rows.slice(0, pageSize).map((row) => ({
      ...row.model,
      ownerUsername: row.ownerUsername,
      thumbnailVersion: row.thumbnailVersion,
    })),
    page,
    hasMore: rows.length > pageSize,
  };
}

// Profile listing: public models only, unless the viewer is the owner —
// unlisted/private models never appear in another user's view of a profile
// (D10: unlisted resolves by direct link only).
export async function listModelsByOwner(username: string, options: { viewerId?: string } = {}, db: Database = getDb()): Promise<{ owner: ModelOwner; models: (ModelRow & { thumbnailVersion: number | null })[] } | null> {
  const [owner] = await db.select({ id: user.id, username: user.username, name: user.name, bio: user.bio }).from(user).where(eq(user.username, username)).limit(1);
  if (!owner) return null;
  const rows = await db.select({ model: models, thumbnailVersion: revisions.thumbnailVersion }).from(models)
    .innerJoin(revisions, eq(models.headRevisionId, revisions.id))
    .where(options.viewerId === owner.id
      ? eq(models.ownerId, owner.id)
      : and(eq(models.ownerId, owner.id), eq(models.visibility, "public")))
    .orderBy(desc(models.updatedAt), desc(models.createdAt));
  return { owner, models: rows.map((row) => ({ ...row.model, thumbnailVersion: row.thumbnailVersion })) };
}

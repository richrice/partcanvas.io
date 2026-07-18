import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Database } from "../db/client.server";
import { revisions } from "../db/schema";
import { compileScad } from "../scad/compiler";
import { CONTENT_ID, hashDraft, validateDraft } from "./draft.server";
import type { HostedModel, HostedModelDraft } from "./types";

// Postgres-backed revision store: immutable content-addressed records, the
// git-like object layer under mutable models. Dedup is `ON CONFLICT DO
// NOTHING` + read-back (the filesystem store's hard-link trick, in SQL).
// Tests pass a PGlite database via the optional `db` parameter.

export async function saveRevision(input: HostedModelDraft, db: Database = getDb()): Promise<{ record: HostedModel; created: boolean }> {
  const draft = validateDraft(input);
  const id = hashDraft(draft);
  const existing = await readRevision(id, db);
  if (existing) return { record: existing, created: false };

  const compiled = compileScad(draft.source, { files: draft.files, parameters: draft.parameters });
  if (!compiled.geometry) throw new Error("The model must produce a 3D solid before it can be published");
  const record: HostedModel = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    ...draft,
    parameterSchema: compiled.parameters,
    metrics: compiled.metrics,
  };
  const inserted = await db.insert(revisions).values({ id, record }).onConflictDoNothing().returning({ id: revisions.id });
  if (inserted.length > 0) return { record, created: true };
  const winner = await readRevision(id, db);
  if (!winner) throw new Error(`Revision '${id}' could not be saved`);
  return { record: winner, created: false };
}

export async function readRevision(id: string, db: Database = getDb()): Promise<HostedModel | null> {
  if (!CONTENT_ID.test(id)) return null;
  const [row] = await db.select({ record: revisions.record }).from(revisions).where(eq(revisions.id, id)).limit(1);
  if (!row) return null;
  const record = row.record;
  return record?.version === 1 && record.id === id && typeof record.source === "string" ? record : null;
}

// Thumbnails are immutable once set, like the revision content they belong to
// (D8): the guarded update keeps the first capture and ignores later ones.
export async function setRevisionThumbnail(id: string, png: Uint8Array, db: Database = getDb()): Promise<boolean> {
  if (!CONTENT_ID.test(id)) return false;
  const updated = await db.update(revisions)
    .set({ thumbnail: png })
    .where(and(eq(revisions.id, id), isNull(revisions.thumbnail)))
    .returning({ id: revisions.id });
  return updated.length > 0;
}

export async function readRevisionThumbnail(id: string, db: Database = getDb()): Promise<Uint8Array | null> {
  if (!CONTENT_ID.test(id)) return null;
  const [row] = await db.select({ thumbnail: revisions.thumbnail }).from(revisions).where(eq(revisions.id, id)).limit(1);
  return row?.thumbnail ?? null;
}

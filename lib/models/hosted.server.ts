import { hasDatabase } from "../db/client.server";
import { readRevision, saveRevision } from "./revisions.server";
import { readHostedModel, saveHostedModel } from "./store.server";
import type { HostedModel, HostedModelDraft } from "./types";

// D14 transition layer: Postgres is the store of record when a database is
// configured; reads fall back to the legacy filesystem store so pre-migration
// records keep resolving until the production import (P1.3) lands. Without a
// database the filesystem store handles everything, as before. This module
// and the fallback are deleted in P5.4.

export async function publishHostedModel(draft: HostedModelDraft): Promise<{ model: HostedModel; created: boolean }> {
  if (!hasDatabase()) return saveHostedModel(draft);
  const { record, created } = await saveRevision(draft);
  return { model: record, created };
}

export async function resolveHostedModel(id: string): Promise<HostedModel | null> {
  if (hasDatabase()) {
    const record = await readRevision(id);
    if (record) return record;
  }
  return readHostedModel(id);
}

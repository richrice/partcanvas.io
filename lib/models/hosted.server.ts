import { hasDatabase } from "../db/client.server";
import { readRevision } from "./revisions.server";
import { readHostedModel } from "./store.server";
import type { HostedModel } from "./types";

// D14 transition layer: reads resolve from Postgres first when a database is
// configured, then fall back to the legacy filesystem store so pre-migration
// records keep resolving until the production import (P1.3) lands. This
// module and the fallback are deleted in P5.4.

export async function resolveHostedModel(id: string): Promise<HostedModel | null> {
  if (hasDatabase()) {
    const record = await readRevision(id);
    if (record) return record;
  }
  return readHostedModel(id);
}

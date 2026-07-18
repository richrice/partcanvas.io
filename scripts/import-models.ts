// One-shot import of legacy filesystem model records into the Postgres
// revisions table (P1.3). Standalone on purpose — only Node built-ins and pg —
// so Node 24 runs it directly: no bundler, no path aliases.
//
//   PARTCANVAS_DATA_DIR=/data/models DATABASE_URL=... node scripts/import-models.ts
//   (production: railway run node scripts/import-models.ts)
//
// Idempotent: rows insert with ON CONFLICT DO NOTHING, so re-runs and records
// already published through the API are counted as "existing" and left alone.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

const RECORD_FILE = /^[a-f0-9]{24}\.json$/;

// Matches the shape check readHostedModel/readRevision apply on read.
function isImportableRecord(id: string, record: unknown): record is { version: 1; id: string; source: string; createdAt?: unknown } {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const candidate = record as { version?: unknown; id?: unknown; source?: unknown };
  return candidate.version === 1 && candidate.id === id && typeof candidate.source === "string";
}

export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rowCount?: number | null; affectedRows?: number }>;
}

export interface ImportSummary {
  directory: string;
  scanned: number;
  imported: number;
  existing: number;
  invalid: string[];
}

export async function importModels(directory: string, client: SqlClient): Promise<ImportSummary> {
  const entries = (await readdir(directory)).filter((name) => RECORD_FILE.test(name)).sort();
  const summary: ImportSummary = { directory, scanned: entries.length, imported: 0, existing: 0, invalid: [] };
  for (const entry of entries) {
    const id = entry.slice(0, 24);
    let record: unknown;
    try {
      record = JSON.parse(await readFile(path.join(directory, entry), "utf8"));
    } catch {
      summary.invalid.push(entry);
      continue;
    }
    if (!isImportableRecord(id, record)) {
      summary.invalid.push(entry);
      continue;
    }
    const createdAt = typeof record.createdAt === "string" && Number.isFinite(Date.parse(record.createdAt)) ? record.createdAt : null;
    const result = await client.query(
      "insert into revisions (id, record, created_at) values ($1, $2::jsonb, coalesce($3::timestamptz, now())) on conflict (id) do nothing",
      [id, JSON.stringify(record), createdAt],
    );
    if ((result.rowCount ?? result.affectedRows ?? 0) > 0) summary.imported += 1;
    else summary.existing += 1;
  }
  return summary;
}

async function main() {
  const directory = path.resolve(process.env.PARTCANVAS_DATA_DIR || path.join(process.cwd(), ".data", "models"));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const summary = await importModels(directory, client);
    console.log(`Scanned ${summary.scanned} record file(s) in ${summary.directory}`);
    console.log(`Imported ${summary.imported}, already present ${summary.existing}, invalid ${summary.invalid.length}`);
    for (const name of summary.invalid) console.warn(`  invalid record skipped: ${name}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

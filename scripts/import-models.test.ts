import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { revisions } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { importModels } from "./import-models";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let directory = "";

const validId = "ab12cd34ef56ab12cd34ef56";
const validRecord = {
  version: 1,
  id: validId,
  createdAt: "2025-03-01T12:00:00.000Z",
  name: "Legacy record",
  description: "",
  source: "cube([4, 4, 4]);",
  files: {},
  parameters: {},
  tags: [],
  parameterSchema: [],
  metrics: { bounds: null, dimensions: null, volume: null, area: null, triangles: 12, compileMs: 1 },
};

beforeAll(async () => {
  testDb = await createTestDatabase();
  directory = await mkdtemp(path.join(os.tmpdir(), "partcanvas-import-"));
  await writeFile(path.join(directory, `${validId}.json`), JSON.stringify(validRecord));
  // Not 24-hex .json → ignored entirely, not counted as invalid.
  await writeFile(path.join(directory, "notes.txt"), "ignore me");
  // Well-named but unparseable / mismatched → counted invalid, skipped.
  await writeFile(path.join(directory, `${"0".repeat(24)}.json`), "{broken");
  await writeFile(path.join(directory, `${"1".repeat(24)}.json`), JSON.stringify({ ...validRecord, id: validId }));
});

afterAll(async () => {
  await testDb.close();
  await rm(directory, { recursive: true, force: true });
});

describe("import-models script", () => {
  it("imports valid records, skips invalid ones, and is idempotent", async () => {
    const first = await importModels(directory, testDb.client);
    expect(first).toMatchObject({ scanned: 3, imported: 1, existing: 0 });
    expect(first.invalid.sort()).toEqual([`${"0".repeat(24)}.json`, `${"1".repeat(24)}.json`]);

    const [row] = await testDb.db.select().from(revisions).where(eq(revisions.id, validId));
    expect(row.record).toEqual(validRecord);
    expect(row.createdAt.toISOString()).toBe(validRecord.createdAt);

    const second = await importModels(directory, testDb.client);
    expect(second).toMatchObject({ scanned: 3, imported: 0, existing: 1 });
    const rows = await testDb.db.select({ id: revisions.id }).from(revisions);
    expect(rows).toHaveLength(1);
  });
});

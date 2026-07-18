import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revisions } from "../db/schema";
import { createTestDatabase } from "../db/test-db.server";
import { readRevision, readRevisionThumbnail, saveRevision, setRevisionThumbnail } from "./revisions.server";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(() => testDb.close());

const draft = {
  name: "Test bracket",
  description: "A parametric bracket.",
  source: "width = 18; // [5:1:60]\ncube([width, 10, 4]);",
  parameters: { width: 24 },
  tags: ["Brackets", "brackets", "3d-printing"],
};

describe("revision store", () => {
  it("saves, reads back, and deduplicates a revision", async () => {
    const first = await saveRevision(draft, testDb.db);
    expect(first.created).toBe(true);
    expect(first.record.id).toMatch(/^[a-f0-9]{24}$/);
    expect(first.record).toMatchObject({
      version: 1,
      name: "Test bracket",
      tags: ["brackets", "3d-printing"],
      parameters: { width: 24 },
      parameterSchema: [{ name: "width", type: "number" }],
    });
    expect(first.record.metrics.triangles).toBeGreaterThan(0);

    const read = await readRevision(first.record.id, testDb.db);
    expect(read).toEqual(first.record);

    const second = await saveRevision({ ...draft }, testDb.db);
    expect(second.created).toBe(false);
    expect(second.record).toEqual(first.record);

    const rows = await testDb.db.select({ id: revisions.id }).from(revisions);
    expect(rows.filter((row) => row.id === first.record.id)).toHaveLength(1);
  });

  it("converges concurrent identical saves onto one record", async () => {
    const concurrent = { name: "Concurrent block", source: "cube([17, 9, 3]);" };
    const results = await Promise.all([
      saveRevision(concurrent, testDb.db),
      saveRevision(concurrent, testDb.db),
      saveRevision(concurrent, testDb.db),
    ]);
    expect(new Set(results.map((result) => result.record.id)).size).toBe(1);
    expect(new Set(results.map((result) => result.record.createdAt)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
  });

  it("rejects invalid drafts before touching the database", async () => {
    await expect(saveRevision({ name: "", source: "cube(5);" }, testDb.db)).rejects.toThrow(/name is required/i);
    await expect(saveRevision({ name: "No source", source: "  " }, testDb.db)).rejects.toThrow(/source is required/i);
    await expect(saveRevision({ name: "Huge", source: `cube(5);${"/".repeat(2_000_001)}` }, testDb.db)).rejects.toThrow(/2 MB/);
    await expect(
      saveRevision({ name: "Bad file", source: "cube(5);", files: { "lib.scad": 7 as unknown as string } }, testDb.db),
    ).rejects.toThrow(/must contain text/);
  });

  it("rejects sources that produce no 3D solid", async () => {
    await expect(saveRevision({ name: "Empty", source: "width = 20;" }, testDb.db)).rejects.toThrow(/3D solid/);
  });

  it("returns null for malformed and unknown ids", async () => {
    expect(await readRevision("not-an-id", testDb.db)).toBeNull();
    expect(await readRevision("ABCDEF", testDb.db)).toBeNull();
    expect(await readRevision("a".repeat(24), testDb.db)).toBeNull();
  });

  it("sets a thumbnail exactly once and reads it back", async () => {
    const { record } = await saveRevision({ name: "Thumbed", source: "cube([2, 2, 2]);" }, testDb.db);
    const first = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    expect(await setRevisionThumbnail(record.id, first, testDb.db)).toBe(true);
    expect(await setRevisionThumbnail(record.id, new Uint8Array([0x00]), testDb.db)).toBe(false);
    const stored = await readRevisionThumbnail(record.id, testDb.db);
    expect([...stored!]).toEqual([...first]);
    expect(await readRevisionThumbnail("b".repeat(24), testDb.db)).toBeNull();
    expect(await readRevisionThumbnail("bogus", testDb.db)).toBeNull();
  });
});

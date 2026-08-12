import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revisions } from "../db/schema";
import { createTestDatabase } from "../db/test-db.server";
import type { ModelMetrics } from "../scad/compiler";
import {
  readRevision,
  readRevisionThumbnail,
  readRevisionThumbnailState,
  saveRevision,
  setRevisionThumbnail,
} from "./revisions.server";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(() => testDb.close());

const draft = {
  name: "Test bracket",
  description: "A parametric bracket.",
  source: "WIDTH = 18; // [5:1:60]\ncube([WIDTH, 10, 4]);",
  parameters: { WIDTH: 24 },
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
      parameters: { WIDTH: 24 },
      parameterSchema: [{ name: "WIDTH", type: "number" }],
    });
    // Publishing does not compile, so an unmeasured draft stores null metrics.
    expect(first.record.metrics).toBeNull();

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

  it("rejects a project whose include is missing", async () => {
    await expect(
      saveRevision({ name: "Dangling", source: "include <missing.scad>\ncube(5);" }, testDb.db),
    ).rejects.toThrow(/was not provided/);
  });

  it("keeps publisher metrics out of the content hash", async () => {
    const measured: ModelMetrics = {
      bounds: { min: [0, 0, 0], max: [4, 4, 4] },
      dimensions: [4, 4, 4],
      volume: 64,
      area: 96,
      triangles: 12,
      compileMs: 3.5,
    };
    const source = { name: "Measured", source: "cube([4, 4, 4]);", metrics: measured };
    const first = await saveRevision(source, testDb.db);
    expect(first.created).toBe(true);
    expect(first.record.metrics).toEqual(measured);

    // Same draft, different measurements: one record, first metrics kept.
    const second = await saveRevision({ ...source, metrics: { ...measured, triangles: 99 } }, testDb.db);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.metrics?.triangles).toBe(12);
  });

  it("records null metrics when the publisher sends none or sends junk", async () => {
    const none = await saveRevision({ name: "No metrics", source: "cube([11, 11, 11]);" }, testDb.db);
    expect(none.record.metrics).toBeNull();

    const junk = await saveRevision({
      name: "Junk metrics",
      source: "cube([12, 12, 12]);",
      metrics: { bounds: { min: [0, 0], max: "big" }, triangles: "many" } as never,
    }, testDb.db);
    expect(junk.record.metrics).toBeNull();
  });

  it("returns null for malformed and unknown ids", async () => {
    expect(await readRevision("not-an-id", testDb.db)).toBeNull();
    expect(await readRevision("ABCDEF", testDb.db)).toBeNull();
    expect(await readRevision("a".repeat(24), testDb.db)).toBeNull();
  });

  it("stores thumbnails by generation and reads their state", async () => {
    const { record } = await saveRevision({ name: "Thumbed", source: "cube([2, 2, 2]);" }, testDb.db);
    const first = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const second = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]);

    expect(await readRevisionThumbnailState(record.id, testDb.db)).toEqual({ present: false, version: null });
    expect(await setRevisionThumbnail(record.id, first, 1, testDb.db)).toBe(true);
    expect(await readRevisionThumbnailState(record.id, testDb.db)).toEqual({ present: true, version: 1 });
    expect([...((await readRevisionThumbnail(record.id, testDb.db))!)]).toEqual([...first]);

    expect(await setRevisionThumbnail(record.id, second, 1, testDb.db)).toBe(false);
    expect([...((await readRevisionThumbnail(record.id, testDb.db))!)]).toEqual([...first]);

    expect(await setRevisionThumbnail(record.id, second, 2, testDb.db)).toBe(true);
    expect([...((await readRevisionThumbnail(record.id, testDb.db))!)]).toEqual([...second]);
    expect(await readRevisionThumbnailState(record.id, testDb.db)).toEqual({ present: true, version: 2 });

    expect(await readRevisionThumbnailState("b".repeat(24), testDb.db)).toBeNull();
    expect(await readRevisionThumbnailState("bogus", testDb.db)).toBeNull();
    expect(await readRevisionThumbnail("b".repeat(24), testDb.db)).toBeNull();
    expect(await readRevisionThumbnail("bogus", testDb.db)).toBeNull();
  });

  it("overwrites a legacy thumbnail whose version is null", async () => {
    const { record: seed } = await saveRevision({ name: "Legacy thumbnail", source: "cube([3, 3, 3]);" }, testDb.db);
    const id = "d".repeat(24);
    const legacy = new Uint8Array([1, 2, 3]);
    const current = new Uint8Array([4, 5, 6]);
    await testDb.db.insert(revisions).values({
      id,
      record: { ...seed, id },
      thumbnail: legacy,
    });

    expect(await readRevisionThumbnailState(id, testDb.db)).toEqual({ present: true, version: null });
    expect(await setRevisionThumbnail(id, current, 1, testDb.db)).toBe(true);
    expect([...((await readRevisionThumbnail(id, testDb.db))!)]).toEqual([...current]);
    expect(await readRevisionThumbnailState(id, testDb.db)).toEqual({ present: true, version: 1 });
  });
});

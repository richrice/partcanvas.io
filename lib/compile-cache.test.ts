import { beforeEach, describe, expect, it } from "vitest";
import { clearCompileMemoryCache, compileCacheKey, compileScadCached } from "./compile-cache";

// Node has no indexedDB, so these tests cover the memory tier and the key
// semantics; the persistent tier degrades to a no-op here by design.

describe("compileCacheKey", () => {
  it("is stable across parameter and file insertion order", () => {
    const a = compileCacheKey("cube(1);", { parameters: { x: 1, y: 2 }, files: { "a.scad": "1", "b.scad": "2" } });
    const b = compileCacheKey("cube(1);", { parameters: { y: 2, x: 1 }, files: { "b.scad": "2", "a.scad": "1" } });
    expect(a).toBe(b);
  });

  it("distinguishes source, parameters, files, and output dimension", () => {
    const base = compileCacheKey("cube(1);", { parameters: { x: 1 } });
    expect(compileCacheKey("cube(2);", { parameters: { x: 1 } })).not.toBe(base);
    expect(compileCacheKey("cube(1);", { parameters: { x: 2 } })).not.toBe(base);
    expect(compileCacheKey("cube(1);", { parameters: { x: 1 }, files: { "lib.scad": "" } })).not.toBe(base);
    expect(compileCacheKey("cube(1);", { parameters: { x: 1 }, outputDimension: "auto" })).not.toBe(base);
  });
});

describe("compileScadCached", () => {
  beforeEach(() => clearCompileMemoryCache());

  it("compiles on first call and serves the identical result from memory after", async () => {
    const first = await compileScadCached("cube(10);", { outputDimension: "auto" });
    expect(first.fromCache).toBe(false);
    expect(first.result.geometry).not.toBeNull();
    const second = await compileScadCached("cube(10);", { outputDimension: "auto" });
    expect(second.fromCache).toBe("memory");
    expect(second.result).toBe(first.result);
  });

  it("misses when parameters change, then hits again on flip-back", async () => {
    const source = "size = 10;\ncube(size);";
    await compileScadCached(source, { parameters: { size: 10 } });
    const changed = await compileScadCached(source, { parameters: { size: 20 } });
    expect(changed.fromCache).toBe(false);
    const flippedBack = await compileScadCached(source, { parameters: { size: 10 } });
    expect(flippedBack.fromCache).toBe("memory");
  });

  it("evicts least-recently-used entries beyond capacity", async () => {
    for (let size = 1; size <= 20; size += 1) {
      await compileScadCached(`cube(${size});`);
    }
    // Capacity is 16, so the oldest entries recompile while recent ones hit.
    expect((await compileScadCached("cube(1);")).fromCache).toBe(false);
    expect((await compileScadCached("cube(20);")).fromCache).toBe("memory");
  });

  it("propagates compile errors instead of caching them", async () => {
    await expect(compileScadCached("cube(")).rejects.toThrow();
    await expect(compileScadCached("cube(")).rejects.toThrow();
  });
});

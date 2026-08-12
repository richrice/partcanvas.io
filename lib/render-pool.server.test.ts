import { afterAll, describe, expect, it } from "vitest";
import { runRender, shutdownRenderPool } from "./render-pool.server";

afterAll(() => shutdownRenderPool());

const job = (source: string) => ({
  source,
  options: { outputDimension: "3d" as const },
  format: "stl" as const,
  filename: "pool-test",
  maxTriangles: 2_000_000,
  hardWarnings: false,
  presetWarnings: [],
});

describe("render pool", () => {
  it("compiles and serializes in a worker", async () => {
    const rendered = await runRender(job("cube([10, 20, 3]);"));
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.extension).toBe("stl");
    expect(rendered.mimeType).toBe("model/stl");
    expect(rendered.metrics.triangles).toBe(12);
    expect(rendered.metrics.dimensions).toEqual([10, 20, 3]);
    expect(rendered.dimension).toBe(3);
    // 80-byte binary STL header + 4-byte count + 50 bytes per triangle.
    expect(rendered.data.byteLength).toBe(84 + 12 * 50);
  });

  it("reports compile failures as data, not as a thrown error", async () => {
    const broken = await runRender(job("cube("));
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.error).toBeTruthy();

    const empty = await runRender(job("size = 4;"));
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error).toMatch(/did not produce a 3D solid/);
  });

  it("rejects a model over the triangle limit before serializing", async () => {
    const rendered = await runRender({ ...job("sphere(r = 20, $fn = 64);"), maxTriangles: 1_000 });
    expect(rendered.ok).toBe(false);
    if (rendered.ok) return;
    expect(rendered.error).toMatch(/exceeding the 1000 triangle limit/);
  });

  it("runs concurrent jobs and reuses its workers", async () => {
    const sizes = [4, 5, 6, 7, 8, 9, 10, 11];
    const results = await Promise.all(sizes.map((size) => runRender(job(`cube(${size});`))));
    expect(results.every((result) => result.ok)).toBe(true);
    for (const [index, result] of results.entries()) {
      if (!result.ok) continue;
      expect(result.metrics.dimensions).toEqual([sizes[index], sizes[index], sizes[index]]);
    }
    // A second wave proves parked workers still answer after their first job.
    const again = await runRender(job("cube(3);"));
    expect(again.ok).toBe(true);
  });
});

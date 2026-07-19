import { describe, expect, it } from "vitest";
import { encodeProjectAsset } from "@/lib/project-assets";
import { compileScad, geometryToBinaryStl } from "@/lib/scad/compiler";
import { POST } from "./route";

function renderRequest(body: unknown) {
  return new Request("http://localhost/api/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/render", () => {
  it.each([
    ["stl", "model/stl", [0, 0]],
    ["obj", "text/plain; charset=utf-8", [35, 32]],
    ["3mf", "model/3mf", [0x50, 0x4b]],
    ["step", "model/step", [0x49, 0x53]],
  ] as const)("renders %s with CLI-like defines and transforms", async (format, mimeType, magic) => {
    const response = await POST(renderRequest({
      source: "size = 4; cube([size, dimensions[0], dimensions[1]]);",
      defines: { size: 8, dimensions: [6, 2] },
      format,
      filename: "api-part",
      options: { scale: 2, origin: "bed", maxTriangles: 100_000 },
    }));
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(mimeType);
    expect(response.headers.get("content-disposition")).toContain(`api-part.${format}`);
    if (format !== "stl") expect([...bytes.slice(0, 2)]).toEqual([...magic]);
    expect(Number(response.headers.get("x-partcanvas-triangles"))).toBeGreaterThan(0);
    expect(Number(response.headers.get("x-partcanvas-volume-mm3"))).toBeCloseTo(8 * 6 * 2 * 8, 4);
  });

  it("rejects unsupported formats and models over a caller-specified triangle limit", async () => {
    const unsupported = await POST(renderRequest({ source: "cube(1);", format: "ply" }));
    expect(unsupported.status).toBe(400);

    const limited = await POST(renderRequest({ source: "sphere(10, $fn=64);", options: { maxTriangles: 1000 } }));
    expect(limited.status).toBe(422);
    expect(await limited.json()).toMatchObject({ error: expect.stringContaining("triangle limit") });
  });

  it("renders a project containing a binary STL import", async () => {
    const block = compileScad("cube([10, 20, 3]);").geometry!;
    const response = await POST(renderRequest({
      source: 'import("block.stl");',
      files: { "block.stl": encodeProjectAsset("block.stl", geometryToBinaryStl(block)) },
      format: "stl",
    }));
    expect(response.status).toBe(200);
    expect(Number(response.headers.get("x-partcanvas-volume-mm3"))).toBeCloseTo(600, 1);
  });

  it("maps CLI-style animation time to $t", async () => {
    const response = await POST(renderRequest({
      source: "cube([10 + 10 * $t, 4, 2]);",
      format: "stl",
      options: { time: 0.5 },
    }));
    expect(response.status).toBe(200);
    expect(Number(response.headers.get("x-partcanvas-volume-mm3"))).toBeCloseTo(120, 3);
  });

  it("exposes parameter warnings and can fail them as hard warnings", async () => {
    const body = {
      source: "WIDTH = 20; // [10:1:40]\ncube(WIDTH);",
      parameters: { WIDTH: 80 },
      options: { checkParameterRanges: true },
    };
    const warned = await POST(renderRequest(body));
    expect(warned.status).toBe(200);
    expect(warned.headers.get("x-partcanvas-warning-count")).toBe("1");
    expect(decodeURIComponent(warned.headers.get("x-partcanvas-warnings") ?? "")).toContain("between 10 and 40");

    const rejected = await POST(renderRequest({ ...body, options: { ...body.options, hardWarnings: true } }));
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ warnings: [expect.stringContaining("between 10 and 40")] });
  });

  it("renders scripts using forward assignments and expression assertions", async () => {
    const response = await POST(renderRequest({
      source: "function positive(v) = assert(v > 0, \"positive required\") v; cube([width, positive(5), 2]); width = 9;",
      format: "stl",
    }));
    expect(response.status).toBe(200);
    expect(Number(response.headers.get("x-partcanvas-volume-mm3"))).toBeCloseTo(90, 4);
  });

  it("renders straight-skeleton roof geometry to printable STL", async () => {
    const response = await POST(renderRequest({
      source: 'roof(method = "straight") square(10, center = true);',
      format: "stl",
      filename: "pyramid-roof",
    }));
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("pyramid-roof.stl");
    expect(response.headers.get("x-partcanvas-dimension")).toBe("3");
    expect(Number(response.headers.get("x-partcanvas-volume-mm3"))).toBeCloseTo(500 / 3, 3);
    expect(Number(response.headers.get("x-partcanvas-triangles"))).toBeGreaterThanOrEqual(6);
    expect(bytes.byteLength).toBeGreaterThan(84);
  });

  it("mirrors OpenSCAD -p/-P customizer presets with explicit override precedence", async () => {
    const response = await POST(renderRequest({
      source: "WIDTH = 10; // [5:1:100]\nDEPTH = 8; // [2:1:40]\nHEIGHT = 2; // [1:1:20]\ncube([WIDTH, DEPTH, HEIGHT]);",
      files: {
        "presets.json": JSON.stringify({
          parameterSets: { Production: { WIDTH: "40", DEPTH: "20", HEIGHT: "6" } },
          fileFormatVersion: "1",
        }),
      },
      parameterFile: "presets.json",
      parameterSet: "Production",
      parameters: { HEIGHT: 8 },
      format: "stl",
    }));
    expect(response.status).toBe(200);
    expect(decodeURIComponent(response.headers.get("x-partcanvas-parameter-set") ?? "")).toBe("Production");
    expect(Number(response.headers.get("x-partcanvas-volume-mm3"))).toBeCloseTo(40 * 20 * 8, 3);
  });

  it("supports compact p/P aliases and rejects incomplete or unknown preset selection", async () => {
    const preset = { parameterSets: { Small: { WIDTH: "12" } }, fileFormatVersion: "1" };
    const rendered = await POST(renderRequest({
      source: "WIDTH = 10; // [5:1:100]\ncube(WIDTH);",
      p: preset,
      P: "Small",
    }));
    expect(rendered.status).toBe(200);
    expect(Number(rendered.headers.get("x-partcanvas-volume-mm3"))).toBeCloseTo(12 ** 3, 3);

    const incomplete = await POST(renderRequest({ source: "cube(1);", parameterSet: "Small" }));
    expect(incomplete.status).toBe(400);
    expect(await incomplete.json()).toMatchObject({ error: expect.stringContaining("supplied together") });

    const missing = await POST(renderRequest({ source: "WIDTH=10; cube(WIDTH);", p: preset, P: "Missing" }));
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ error: expect.stringContaining("was not found") });
  });

  it("returns a machine-readable all-category render summary", async () => {
    const response = await POST(renderRequest({
      source: 'WIDTH = 10; // [5:1:40]\necho("ready", WIDTH); cube([WIDTH, 4, 2]);',
      parameters: { WIDTH: 12 },
      format: "stl",
      filename: "summary-part",
      summary: true,
      options: { origin: "bed" },
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(body).toMatchObject({
      engine: "partcanvas-typescript",
      categories: ["cache", "time", "camera", "geometry", "bounding-box", "area"],
      output: { format: "stl", filename: "summary-part.stl", mimeType: "model/stl" },
      parameters: { parameterSet: null, values: { WIDTH: 12 } },
      geometry: {
        dimensions: 3,
        facets: 12,
        triangles: 12,
        bounding_box: { min: [-6, -2, 0], max: [6, 2, 2], size: [12, 4, 2] },
      },
      measurements: { area_mm2: 160, volume_mm3: 96 },
      cache: { enabled: false, scope: "stateless-request" },
      camera: null,
    });
    expect(body.output.bytes).toBeGreaterThan(84);
    expect(body.diagnostics.messages.some((message: string) => message.includes("ready"))).toBe(true);
    expect(body.time.compile_ms).toBeGreaterThanOrEqual(0);
    expect(body.time.serialize_ms).toBeGreaterThanOrEqual(0);
    expect(body.time.total_ms).toBeGreaterThanOrEqual(body.time.compile_ms);
  });

  it("supports selective OpenSCAD summary categories for 2D output", async () => {
    const response = await POST(renderRequest({
      source: "square([30, 20]);",
      format: "svg",
      summary: ["geometry", "bounding-box", "area", "time"],
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.categories).toEqual(["geometry", "bounding-box", "area", "time"]);
    expect(body.geometry).toMatchObject({
      dimensions: 2,
      facets: 0,
      bounding_box: { min: [0, 0], max: [30, 20], size: [30, 20] },
    });
    expect(body.measurements).toEqual({ area_mm2: 600, volume_mm3: null });
    expect(body.output).toMatchObject({ format: "svg", mimeType: "image/svg+xml; charset=utf-8" });
    expect(body).not.toHaveProperty("cache");
    expect(body).not.toHaveProperty("camera");
  });

  it("reports selected presets and effective overrides in summaries", async () => {
    const response = await POST(renderRequest({
      source: "WIDTH = 10; // [5:1:100]\nDEPTH = 8; // [2:1:40]\ncube([WIDTH, DEPTH, 2]);",
      p: { parameterSets: { Production: { WIDTH: "40", DEPTH: "20" } }, fileFormatVersion: "1" },
      P: "Production",
      parameters: { DEPTH: 24 },
      summary: "geometry,bounding-box,area",
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.parameters).toEqual({ parameterSet: "Production", values: { WIDTH: 40, DEPTH: 24 } });
    expect(body.geometry.bounding_box.size).toEqual([40, 24, 2]);
    expect(body.measurements.volume_mm3).toBeCloseTo(1920, 4);
  });

  it("rejects unsupported summary categories", async () => {
    const response = await POST(renderRequest({ source: "cube(1);", summary: ["geometry", "memory"] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("memory") });
  });

  it("surfaces invalid preset entries and honors hardWarnings", async () => {
    const body = {
      source: "WIDTH = 10; // [5:1:100]\ncube(WIDTH);",
      parameterFile: {
        parameterSets: { Legacy: { WIDTH: "wide", removed_option: "1" } },
        fileFormatVersion: "1",
      },
      parameterSet: "Legacy",
    };
    const warned = await POST(renderRequest(body));
    expect(warned.status).toBe(200);
    expect(warned.headers.get("x-partcanvas-warning-count")).toBe("2");
    expect(decodeURIComponent(warned.headers.get("x-partcanvas-warnings") ?? "")).toContain("invalid value for 'WIDTH'");

    const stopped = await POST(renderRequest({ ...body, options: { hardWarnings: true } }));
    expect(stopped.status).toBe(422);
    expect(await stopped.json()).toMatchObject({ warnings: expect.arrayContaining([expect.stringContaining("removed_option")]) });
  });

  it.each([
    ["svg", "image/svg+xml; charset=utf-8", "<svg"],
    ["dxf", "application/dxf; charset=utf-8", "LWPOLYLINE"],
  ] as const)("renders native 2D %s output", async (format, mimeType, marker) => {
    const response = await POST(renderRequest({
      source: "difference() { square([30,20]); translate([15,10]) circle(4); }",
      format,
      filename: "laser-panel",
    }));
    const output = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(mimeType);
    expect(response.headers.get("content-disposition")).toContain(`laser-panel.${format}`);
    expect(response.headers.get("x-partcanvas-dimension")).toBe("2");
    expect(Number(response.headers.get("x-partcanvas-area-mm2"))).toBeGreaterThan(540);
    expect(output).toContain(marker);
  });

  it("rejects geometry with the wrong output dimension", async () => {
    const stlFrom2d = await POST(renderRequest({ source: "square(10);", format: "stl" }));
    const svgFrom3d = await POST(renderRequest({ source: "cube(10);", format: "svg" }));
    expect(stlFrom2d.status).toBe(422);
    expect(await stlFrom2d.json()).toMatchObject({ error: expect.stringContaining("3D solid") });
    expect(svgFrom3d.status).toBe(422);
    expect(await svgFrom3d.json()).toMatchObject({ error: expect.stringContaining("2D geometry") });
  });
});

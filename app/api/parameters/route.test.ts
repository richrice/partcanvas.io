import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/parameters", () => {
  it("validates multi-file projects and includes public parameters", async () => {
    const response = await POST(new Request("http://localhost/api/parameters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "include <settings.scad>\nuse <part.scad>\npart(width);",
        files: {
          "settings.scad": "width = 30; // [10:1:80]",
          "part.scad": "module part(size) { cube(size); }",
        },
      }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      valid: true,
      defaults: { width: 30 },
      parameters: [{ name: "width", min: 10, step: 1, max: 80 }],
    });
  });

  it("returns structured diagnostics for candidate customizer values", async () => {
    const response = await POST(new Request("http://localhost/api/parameters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "size = [20, 10, 4]; // [1:1:50]\nstyle = \"round\"; // [round,square]\ncube(size);",
        values: { size: [60, 10, 4], style: "triangle", unknown: 1 },
        checkRanges: true,
      }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "out-of-range", parameter: "size" }),
      expect.objectContaining({ code: "invalid-option", parameter: "style" }),
      expect.objectContaining({ code: "unknown-parameter", parameter: "unknown" }),
    ]));
  });

  it("discovers and resolves OpenSCAD customizer parameter sets", async () => {
    const response = await POST(new Request("http://localhost/api/parameters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "width = 20; // [10:1:80]\nenabled = true;\ncube(width);",
        parameterFile: {
          parameterSets: {
            Small: { width: "12", enabled: "false" },
            Large: { width: "70", enabled: "true" },
          },
          fileFormatVersion: "1",
        },
        parameterSet: "Large",
        values: { width: 75 },
      }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      selectedParameterSet: "Large",
      values: { width: 75, enabled: true },
      parameterSets: [
        { name: "Small", values: { width: 12, enabled: false } },
        { name: "Large", values: { width: 70, enabled: true } },
      ],
    });
  });
});

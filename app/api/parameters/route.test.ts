import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/parameters", () => {
  it("validates multi-file projects and includes public parameters", async () => {
    const response = await POST(new Request("http://localhost/api/parameters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "include <settings.scad>\nuse <part.scad>\npart(WIDTH);",
        files: {
          "settings.scad": "WIDTH = 30; // [10:1:80]",
          "part.scad": "module part(size) { cube(size); }",
        },
      }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      valid: true,
      defaults: { WIDTH: 30 },
      parameters: [{ name: "WIDTH", min: 10, step: 1, max: 80 }],
    });
  });

  it("returns structured diagnostics for candidate customizer values", async () => {
    const response = await POST(new Request("http://localhost/api/parameters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "SIZE = [20, 10, 4]; // [1:1:50]\nSTYLE = \"round\"; // [round,square]\ncube(SIZE);",
        values: { SIZE: [60, 10, 4], STYLE: "triangle", unknown: 1 },
        checkRanges: true,
      }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "out-of-range", parameter: "SIZE" }),
      expect.objectContaining({ code: "invalid-option", parameter: "STYLE" }),
      expect.objectContaining({ code: "unknown-parameter", parameter: "unknown" }),
    ]));
  });

  it("discovers and resolves OpenSCAD customizer parameter sets", async () => {
    const response = await POST(new Request("http://localhost/api/parameters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "WIDTH = 20; // [10:1:80]\nENABLED = true;\ncube(WIDTH);",
        parameterFile: {
          parameterSets: {
            Small: { WIDTH: "12", ENABLED: "false" },
            Large: { WIDTH: "70", ENABLED: "true" },
          },
          fileFormatVersion: "1",
        },
        parameterSet: "Large",
        values: { WIDTH: 75 },
      }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      selectedParameterSet: "Large",
      values: { WIDTH: 75, ENABLED: true },
      parameterSets: [
        { name: "Small", values: { WIDTH: 12, ENABLED: false } },
        { name: "Large", values: { WIDTH: 70, ENABLED: true } },
      ],
    });
  });
});

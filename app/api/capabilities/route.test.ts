import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/capabilities", () => {
  it("reports native roof support without claiming a compiled OpenSCAD engine", async () => {
    const response = await GET();
    const capabilities = await response.json();
    expect(capabilities.openScadBinary).toBe(false);
    expect(capabilities.operations).toContain("roof");
    expect(capabilities.threeMf).toMatchObject({ dialect: "BambuStudio", assignment: "per-volume-extruder" });
    expect(capabilities.roofMethods).toEqual({ straight: "native", voronoi: "straight-skeleton-fallback" });
    expect(capabilities.renderOptions).toEqual(expect.arrayContaining(["parameterFile", "parameterSet"]));
    expect(capabilities.parameterSetFiles).toMatchObject({ cliAliases: ["p", "P"], fileFormatVersion: "1" });
  });
});

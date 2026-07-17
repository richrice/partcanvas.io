import { describe, expect, it } from "vitest";
import { encodeProjectAsset } from "../project-assets";
import { extractParameters } from "./parameters";
import { inspectOpenScadParameterSets, loadOpenScadParameterFile, resolveOpenScadParameterSet } from "./parameter-sets";

const source = `
width = 20; // [10:1:80]
enabled = true;
dimensions = [10, 8, 2]; // [1:1:50]
style = "round"; // [round:Rounded,square:Square]
label = "PART";
`;

const officialStyleFile = {
  parameterSets: {
    Large: {
      width: "100",
      enabled: "false",
      dimensions: "[30, 20, 4]",
      style: "square",
      label: "LARGE PART",
      obsolete: "ignored",
    },
    Broken: { width: "wide", dimensions: "[1, 2]" },
  },
  fileFormatVersion: "1",
};

describe("OpenSCAD customizer parameter sets", () => {
  it("loads official string-encoded JSON and coerces values from the source schema", () => {
    const file = loadOpenScadParameterFile(officialStyleFile);
    const result = resolveOpenScadParameterSet(file, "Large", extractParameters(source));
    expect(result.values).toEqual({
      width: 80,
      enabled: false,
      dimensions: [30, 20, 4],
      style: "square",
      label: "LARGE PART",
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "unknown-preset-parameter", parameter: "obsolete" }),
    ]);
  });

  it("reports invalid preset values and lists all named sets", () => {
    const inspected = inspectOpenScadParameterSets(loadOpenScadParameterFile(officialStyleFile), extractParameters(source));
    expect(inspected.map((preset) => preset.name)).toEqual(["Large", "Broken"]);
    expect(inspected[1].values).toEqual({});
    expect(inspected[1].diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "invalid-preset-value",
      "invalid-preset-value",
    ]);
  });

  it("loads a base64-encoded project JSON file and rejects unknown sets", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(officialStyleFile));
    const file = loadOpenScadParameterFile("presets/model.json", {
      "presets/model.json": encodeProjectAsset("presets/model.json", bytes),
    });
    expect(() => resolveOpenScadParameterSet(file, "Missing", extractParameters(source))).toThrow(/Available: Large, Broken/);
  });
});

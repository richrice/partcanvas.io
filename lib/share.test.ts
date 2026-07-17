import { describe, expect, it } from "vitest";
import { decodeSharedModel, encodeSharedModel } from "./share";

describe("compressed model links", () => {
  it("round-trips source and customizer values", () => {
    const model = {
      source: "label = \"München 🔧\"; // printable unicode\ncube([20, 10, 4]);",
      parameters: { width: 42, dimensions: [80, 45, 3], enabled: true, label: "prototype" },
      files: { "lib/label.scad": "module label() { cube(2); }" },
    };
    const encoded = encodeSharedModel(model);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded.length).toBeLessThan(1_000);
    expect(decodeSharedModel(encoded)).toEqual(model);
  });

  it("rejects corrupt payloads", () => {
    expect(() => decodeSharedModel("not-a-model")).toThrow();
  });
});

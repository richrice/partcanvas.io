import { describe, expect, it } from "vitest";
import { decodeProjectAsset, encodeProjectAsset, extensionOf, isEditableProjectFile } from "./project-assets";

describe("project assets", () => {
  it("round-trips arbitrary binary bytes through a typed data URL", () => {
    const input = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);
    const encoded = encodeProjectAsset("part.stl", input);
    const decoded = decodeProjectAsset("part.stl", encoded);
    expect(encoded).toMatch(/^data:model\/stl;base64,/);
    expect([...decoded.bytes]).toEqual([...input]);
    expect(decoded.mimeType).toBe("model/stl");
  });

  it("distinguishes editable SCAD files from imported assets", () => {
    expect(extensionOf("nested/Part.SVG")).toBe("svg");
    expect(isEditableProjectFile("lib/module.scad")).toBe(true);
    expect(isEditableProjectFile("mesh.obj")).toBe(false);
  });
});

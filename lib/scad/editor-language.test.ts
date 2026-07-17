import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { openScadCompletionSource } from "./editor-language";

function complete(source: string, explicit = false, options: Parameters<typeof openScadCompletionSource>[1] = {}) {
  const state = EditorState.create({ doc: source });
  return openScadCompletionSource(new CompletionContext(state, source.length, explicit), options);
}

describe("OpenSCAD editor completion", () => {
  it("offers supported built-ins and symbols declared in the project", () => {
    const source = "module peg(size = 2) {}\nsp";
    const result = complete(source, false, {
      sources: ["function spacing(value) = value * 2;"],
    });
    const labels = result?.options.map((option) => option.label);

    expect(result?.from).toBe(source.length - 2);
    expect(labels).toContain("sphere");
    expect(labels).toContain("spacing");
    expect(labels).toContain("peg");
  });

  it("completes library and asset paths from project files", () => {
    const files = ["lib/shapes.scad", "mesh.stl", "heightmap.png"];
    const library = complete("include <lib/", false, { files });
    const asset = complete('import(file = "me', false, { files });

    expect(library?.options.map((option) => option.label)).toEqual(["lib/shapes.scad"]);
    expect(asset?.options.map((option) => option.label)).toEqual(["mesh.stl", "heightmap.png"]);
  });

  it("does not interrupt typing inside comments or strings", () => {
    expect(complete("// sph")).toBeNull();
    expect(complete('label = "sph')).toBeNull();
  });
});

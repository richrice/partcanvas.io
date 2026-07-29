import { describe, expect, it } from "vitest";
import { primitives } from "@jscad/modeling";
import { strFromU8, unzipSync } from "fflate";
import { serializeBambu3mf, type PlateSpec } from "./bambu-3mf";

const readEntry = (archive: Uint8Array, path: string) => strFromU8(unzipSync(archive)[path]);

const cube = (size: number, center: [number, number, number]) => primitives.cuboid({ size: [size, size, size], center });

const plate: PlateSpec = { printable: [100, 100, 100], stride: 120 };

describe("serializeBambu3mf", () => {
  it("keeps a single solid as one component assembly with one untransformed item", () => {
    const archive = serializeBambu3mf([cube(20, [0, 0, 10])], "solo");
    const model = readEntry(archive, "3D/3dmodel.model");
    expect(model).toContain('<object id="2" type="model" name="solo"><components><component objectid="1"/></components></object>');
    expect(model).toContain('<build><item objectid="2" printable="1"/></build>');
    expect(readEntry(archive, "Metadata/model_settings.config")).not.toContain("<plate>");
  });

  it("groups overlapping solids into one piece", () => {
    const archive = serializeBambu3mf([cube(20, [0, 0, 10]), cube(10, [5, 5, 20])], "colors");
    const model = readEntry(archive, "3D/3dmodel.model");
    expect(model).toContain('<components><component objectid="1"/><component objectid="2"/></components>');
    expect(model.match(/<item /g)).toHaveLength(1);
  });

  it("exports disjoint solids as separate build items without moving them when they fit", () => {
    const archive = serializeBambu3mf([cube(20, [-20, 0, 10]), cube(20, [20, 0, 10])], "pair", plate);
    const model = readEntry(archive, "3D/3dmodel.model");
    expect(model.match(/<item /g)).toHaveLength(2);
    expect(model).not.toContain("transform=");
    expect(readEntry(archive, "Metadata/model_settings.config")).not.toContain("<plate>");
  });

  it("packs an overflowing layout onto numbered plates with transforms", () => {
    const archive = serializeBambu3mf([cube(80, [0, 0, 40]), cube(80, [300, 0, 40])], "split", plate);
    const model = readEntry(archive, "3D/3dmodel.model");
    const settings = readEntry(archive, "Metadata/model_settings.config");
    const transforms = [...model.matchAll(/transform="1 0 0 0 1 0 0 0 1 ([-\d.]+) ([-\d.]+) 0"/g)]
      .map((match) => [Number(match[1]), Number(match[2])]);
    expect(transforms).toHaveLength(2);
    // Piece one stays centered on plate 0; piece two moves to plate 1 at one stride along +X.
    expect(transforms[0][0]).toBeCloseTo(0);
    expect(transforms[1][0]).toBeCloseTo(120 - 300);
    expect(settings.match(/<plate>/g)).toHaveLength(2);
    expect(settings).toContain('<metadata key="plater_id" value="1"/>');
    expect(settings).toContain('<metadata key="plater_id" value="2"/>');
    expect(settings.match(/<model_instance>/g)).toHaveLength(2);
    expect(settings).toContain('<metadata key="object_id" value="3"/>');
    expect(settings).toContain('<metadata key="object_id" value="4"/>');
  });

  it("names disjoint pieces distinctly in resources and settings", () => {
    const archive = serializeBambu3mf([cube(80, [0, 0, 40]), cube(80, [300, 0, 40])], "split", plate);
    const model = readEntry(archive, "3D/3dmodel.model");
    expect(model).toContain('name="split piece 1"');
    expect(model).toContain('name="split piece 2"');
    expect(readEntry(archive, "Metadata/model_settings.config")).toContain('value="split piece 1"');
  });
});

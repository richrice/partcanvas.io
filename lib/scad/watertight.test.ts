import { describe, expect, it } from "vitest";
import { geometries, measurements, primitives } from "@jscad/modeling";
import type { Geom3 } from "@jscad/modeling/src/geometries/types";
import { strFromU8, unzipSync } from "fflate";
import { compileScad, geometryToBinaryStl, serializeGeometry } from "./compiler";
import { makeWatertight } from "./watertight";

type Vec3 = [number, number, number];

function solidFrom(polygons: Vec3[][]): Geom3 {
  return geometries.geom3.create(polygons.map((vertices) => geometries.poly3.create(vertices)));
}

// The watertight check slicers run: every directed edge must cancel against
// its reverse. Keys use exact coordinates, so any crack fails the check.
function openDirectedEdges(geometry: Geom3): number {
  const counts = new Map<string, number>();
  for (const polygon of geometries.geom3.toPolygons(geometry)) {
    const tags = polygon.vertices.map((vertex) => `${vertex[0]},${vertex[1]},${vertex[2]}`);
    for (let index = 0; index < tags.length; index++) {
      const key = `${tags[index]}|${tags[(index + 1) % tags.length]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [key, count] of counts) {
    const [start, end] = key.split("|");
    open += Math.max(0, count - (counts.get(`${end}|${start}`) ?? 0));
  }
  return open;
}

function openDirectedEdgesInStl(stl: Uint8Array): number {
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const triangles = view.getUint32(80, true);
  const counts = new Map<string, number>();
  for (let index = 0; index < triangles; index++) {
    const base = 84 + index * 50 + 12;
    const tags: string[] = [];
    for (let vertex = 0; vertex < 3; vertex++) {
      const offset = base + vertex * 12;
      tags.push(`${view.getFloat32(offset, true)},${view.getFloat32(offset + 4, true)},${view.getFloat32(offset + 8, true)}`);
    }
    for (let edge = 0; edge < 3; edge++) {
      const key = `${tags[edge]}|${tags[(edge + 1) % 3]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [key, count] of counts) {
    const [start, end] = key.split("|");
    open += Math.max(0, count - (counts.get(`${end}|${start}`) ?? 0));
  }
  return open;
}

// A 10mm cube whose +X face is split into two rectangles. The split vertices
// (10, 0, 5) and (10, 10, 5) sit in the middle of the front and back face
// edges: two T-junctions. Each leaves three directed edges without a reverse
// (the long face edge plus the two half edges).
function tJunctionCube(): Geom3 {
  const polygons: Vec3[][] = [
    [[0, 0, 0], [0, 10, 0], [10, 10, 0], [10, 0, 0]],
    [[0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]],
    [[0, 0, 0], [0, 0, 10], [0, 10, 10], [0, 10, 0]],
    [[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]],
    [[0, 10, 0], [0, 10, 10], [10, 10, 10], [10, 10, 0]],
    [[10, 0, 0], [10, 10, 0], [10, 10, 5], [10, 0, 5]],
    [[10, 0, 5], [10, 10, 5], [10, 10, 10], [10, 0, 10]],
  ];
  return solidFrom(polygons);
}

describe("makeWatertight", () => {
  it("returns an already conforming solid unchanged", () => {
    const cube = primitives.cuboid({ size: [10, 10, 10] });
    expect(makeWatertight(cube)).toBe(cube);
  });

  it("resolves T-junctions by splitting the long edges", () => {
    const cracked = tJunctionCube();
    expect(openDirectedEdges(cracked)).toBe(6);
    const repaired = makeWatertight(cracked);
    expect(openDirectedEdges(repaired)).toBe(0);
    expect(measurements.measureVolume(repaired)).toBeCloseTo(1000, 6);
  });

  it("welds hairline cracks left by float noise", () => {
    const nudged = geometries.geom3.toPolygons(primitives.cuboid({ size: [10, 10, 10] })).map((polygon, index) => {
      const vertices = polygon.vertices.map((vertex) => [...vertex] as Vec3);
      if (index === 0) vertices[0][0] += 1e-9;
      return vertices;
    });
    const cracked = solidFrom(nudged);
    expect(openDirectedEdges(cracked)).toBeGreaterThan(0);
    const repaired = makeWatertight(cracked);
    expect(openDirectedEdges(repaired)).toBe(0);
    expect(measurements.measureVolume(repaired)).toBeCloseTo(1000, 3);
  });

  it("patches a pinhole left by a dropped triangle", () => {
    const triangles: Vec3[][] = [];
    for (const polygon of geometries.geom3.toPolygons(primitives.cuboid({ size: [10, 10, 10] }))) {
      const vertices = polygon.vertices as unknown as Vec3[];
      triangles.push([vertices[0], vertices[1], vertices[2]], [vertices[0], vertices[2], vertices[3]]);
    }
    const holed = solidFrom(triangles.slice(1));
    expect(openDirectedEdges(holed)).toBe(3);
    const repaired = makeWatertight(holed);
    expect(openDirectedEdges(repaired)).toBe(0);
    expect(measurements.measureVolume(repaired)).toBeCloseTo(1000, 3);
  });
});

// Directed index edges of triangles must cancel pairwise, like the
// coordinate-based checks above but for indexed mesh formats.
function openDirectedIndexEdges(faces: number[][]): number {
  const counts = new Map<string, number>();
  for (const face of faces) {
    for (let index = 0; index < face.length; index++) {
      const key = `${face[index]}|${face[(index + 1) % face.length]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [key, count] of counts) {
    const [start, end] = key.split("|");
    open += Math.max(0, count - (counts.get(`${end}|${start}`) ?? 0));
  }
  return open;
}

describe("export watertightness", () => {
  // Boolean-heavy twisted geometry: JSCAD's booleans crack this mesh, so
  // every format must run the repair to export it watertight.
  const result = compileScad(`
    $fn = 48;
    difference() {
      cylinder(h = 20, d = 20);
      translate([0, 0, 1]) cylinder(h = 20, d = 16);
      linear_extrude(height = 20, twist = 300)
        translate([9, 0]) circle(d = 3, $fn = 4);
    }
  `);
  const parts = result.parts.length ? result.parts : [result.geometry!];

  it("compiles the fixture with cracks to repair", () => {
    expect(result.geometry).not.toBeNull();
    expect(openDirectedEdges(result.geometry as Geom3)).toBeGreaterThan(0);
  });

  it("exports STL with zero open edges", () => {
    expect(openDirectedEdgesInStl(geometryToBinaryStl(parts))).toBe(0);
  });

  it("exports OBJ with zero open index edges", () => {
    const text = new TextDecoder().decode(serializeGeometry(parts, "obj").data);
    const faces = text.split("\n")
      .filter((line) => line.startsWith("f "))
      .map((line) => line.slice(2).trim().split(/\s+/).map((token) => Number(token.split("/")[0])));
    expect(faces.length).toBeGreaterThan(0);
    expect(openDirectedIndexEdges(faces)).toBe(0);
  });

  it("exports 3MF meshes with shared vertices and zero open index edges", () => {
    const archive = unzipSync(serializeGeometry(parts, "3mf").data);
    const model = strFromU8(archive["3D/3dmodel.model"]);
    const meshes = [...model.matchAll(/<mesh>.*?<\/mesh>/gs)];
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      const faces = [...mesh[0].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)]
        .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])]);
      const vertexCount = [...mesh[0].matchAll(/<vertex /g)].length;
      expect(faces.length).toBeGreaterThan(0);
      expect(vertexCount).toBeLessThan(faces.length * 3);
      expect(openDirectedIndexEdges(faces)).toBe(0);
    }
  });

  it("exports STEP loops whose only unpaired edges come from dropped zero-area faces", () => {
    // STEP cannot emit a zero-area face (a PLANE face needs a normal), so
    // serializeStep drops them. Each dropped triangle strands at most three
    // partner edges; those overlap collinearly and CAD sewing closes them.
    // Any unpairedness beyond that bound would mean unrepaired cracks.
    const text = new TextDecoder().decode(serializeGeometry(parts, "step").data);
    const loops = [...text.matchAll(/POLY_LOOP\('',\((#\d+(?:,#\d+)*)\)\)/g)]
      .map((match) => match[1].split(",").map((id) => Number(id.slice(1))));
    const repairedTriangles = geometries.geom3.toPolygons(makeWatertight(parts[0] as Geom3)).length;
    const droppedFaces = repairedTriangles - loops.length;
    expect(loops.length).toBeGreaterThan(0.9 * repairedTriangles);
    expect(openDirectedIndexEdges(loops)).toBeLessThanOrEqual(3 * droppedFaces);
  });
});

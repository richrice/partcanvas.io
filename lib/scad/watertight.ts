import { geometries, measurements } from "@jscad/modeling";
import type { Geom3 } from "@jscad/modeling/src/geometries/types";

// JSCAD's BSP booleans compute split points per polygon, so neighbor polygons
// disagree at the last float bits, stop at T-junction vertices the neighbor
// does not have, and rarely drop sliver polygons. Slicers reject the result as
// non-watertight, while OpenSCAD's CGAL/Manifold output is exactly conforming.
// This module rebuilds a solid into a conforming triangle mesh:
//   1. weld vertices that sit within epsilon of each other,
//   2. split each unmatched edge at welded vertices that lie on it,
//   3. patch the remaining unmatched-edge loops (pinholes),
//   4. triangulate without dropping any boundary edge.

type Vec3 = [number, number, number];

// Vertex ids stay below 2^25, so a directed edge packs into one safe integer.
const EDGE_KEY_BASE = 0x2000000;
const edgeKey = (a: number, b: number) => a * EDGE_KEY_BASE + b;
// A pathological unmatched-edge chain stops the loop walk at this length.
const MAX_LOOP = 100_000;

function distanceSquared(a: Vec3, b: Vec3) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

// A mesh whose directed edges already cancel exactly needs no repair.
function isConforming(polygons: { vertices: number[][] }[]): boolean {
  const counts = new Map<string, number>();
  for (const polygon of polygons) {
    const tags = polygon.vertices.map((vertex) => `${vertex[0]},${vertex[1]},${vertex[2]}`);
    for (let index = 0; index < tags.length; index++) {
      counts.set(`${tags[index]}|${tags[(index + 1) % tags.length]}`, 1);
    }
  }
  for (const key of counts.keys()) {
    const [start, end] = key.split("|");
    if (!counts.has(`${end}|${start}`)) return false;
  }
  return true;
}

export function makeWatertight(geometry: Geom3): Geom3 {
  const inputPolygons = geometries.geom3.toPolygons(geometry);
  if (!inputPolygons.length || isConforming(inputPolygons)) return geometry;
  const epsilon = measurements.measureEpsilon(geometry) as number;
  const epsilonSquared = epsilon * epsilon;

  // 1. Weld: map each vertex to the first representative within epsilon.
  const representatives: Vec3[] = [];
  const weldCells = new Map<string, number[]>();
  const weldId = (vertex: number[]): number => {
    const cellX = Math.round(vertex[0] / epsilon);
    const cellY = Math.round(vertex[1] / epsilon);
    const cellZ = Math.round(vertex[2] / epsilon);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const bucket = weldCells.get(`${cellX + dx},${cellY + dy},${cellZ + dz}`);
      if (!bucket) continue;
      for (const id of bucket) {
        if (distanceSquared(representatives[id], vertex as Vec3) <= epsilonSquared) return id;
      }
    }
    const id = representatives.length;
    representatives.push([vertex[0], vertex[1], vertex[2]]);
    const selfKey = `${cellX},${cellY},${cellZ}`;
    const bucket = weldCells.get(selfKey);
    if (bucket) bucket.push(id);
    else weldCells.set(selfKey, [id]);
    return id;
  };

  const polygons: number[][] = [];
  for (const polygon of inputPolygons) {
    const ids: number[] = [];
    for (const vertex of polygon.vertices) {
      const id = weldId(vertex);
      if (ids.length && ids[ids.length - 1] === id) continue;
      ids.push(id);
    }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    if (new Set(ids).size < 3) continue;
    polygons.push(ids);
  }

  // 2. Census of directed edges; an edge is open when its reverse is absent.
  const countEdges = (source: number[][]) => {
    const counts = new Map<number, number>();
    for (const polygon of source) {
      for (let index = 0; index < polygon.length; index++) {
        const key = edgeKey(polygon[index], polygon[(index + 1) % polygon.length]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  };
  let edgeCounts = countEdges(polygons);
  const isOpen = (a: number, b: number) => !edgeCounts.has(edgeKey(b, a));

  // Index the endpoints of open edges; only they can be T-junction vertices.
  const openVertices = new Set<number>();
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      if (isOpen(a, b)) { openVertices.add(a); openVertices.add(b); }
    }
  }
  if (openVertices.size) {
    const cellSize = epsilon * 512;
    const vertexCells = new Map<string, number[]>();
    for (const id of openVertices) {
      const point = representatives[id];
      const key = `${Math.floor(point[0] / cellSize)},${Math.floor(point[1] / cellSize)},${Math.floor(point[2] / cellSize)}`;
      const bucket = vertexCells.get(key);
      if (bucket) bucket.push(id);
      else vertexCells.set(key, [id]);
    }

    // Welded vertices that lie on the open edge, ordered along it.
    const verticesOnEdge = (a: number, b: number): number[] => {
      const start = representatives[a], end = representatives[b];
      const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
      const lengthSquared = delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2;
      if (lengthSquared === 0) return [];
      const length = Math.sqrt(lengthSquared);
      const steps = Math.max(1, Math.ceil(length / (cellSize / 2)));
      const seen = new Set<number>();
      const found: { id: number; t: number }[] = [];
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const sampleX = Math.floor((start[0] + delta[0] * t) / cellSize);
        const sampleY = Math.floor((start[1] + delta[1] * t) / cellSize);
        const sampleZ = Math.floor((start[2] + delta[2] * t) / cellSize);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const bucket = vertexCells.get(`${sampleX + dx},${sampleY + dy},${sampleZ + dz}`);
          if (!bucket) continue;
          for (const id of bucket) {
            if (id === a || id === b || seen.has(id)) continue;
            seen.add(id);
            const point = representatives[id];
            const along = ((point[0] - start[0]) * delta[0] + (point[1] - start[1]) * delta[1] + (point[2] - start[2]) * delta[2]) / lengthSquared;
            if (along <= 0 || along >= 1) continue;
            const foot: Vec3 = [start[0] + delta[0] * along, start[1] + delta[1] * along, start[2] + delta[2] * along];
            if (distanceSquared(point, foot) > epsilonSquared) continue;
            found.push({ id, t: along });
          }
        }
      }
      found.sort((left, right) => left.t - right.t);
      return found.map((entry) => entry.id);
    };

    // 3. Insert the on-edge vertices so both sides of each crack agree.
    for (let index = 0; index < polygons.length; index++) {
      const polygon = polygons[index];
      let expanded: number[] | null = null;
      for (let edge = 0; edge < polygon.length; edge++) {
        const a = polygon[edge], b = polygon[(edge + 1) % polygon.length];
        const inserts = isOpen(a, b) ? verticesOnEdge(a, b) : [];
        if (inserts.length && !expanded) expanded = polygon.slice(0, edge + 1);
        if (expanded) expanded.push(...inserts, ...(edge + 1 < polygon.length ? [polygon[edge + 1]] : []));
      }
      if (expanded) polygons[index] = expanded;
    }
  }

  // 4. Patch remaining open loops (pinholes left by dropped slivers).
  edgeCounts = countEdges(polygons);
  const successors = new Map<number, number[]>();
  let openCount = 0;
  for (const [key, count] of edgeCounts) {
    const a = Math.floor(key / EDGE_KEY_BASE), b = key % EDGE_KEY_BASE;
    const excess = count - (edgeCounts.get(edgeKey(b, a)) ?? 0);
    for (let copy = 0; copy < excess; copy++) {
      const bucket = successors.get(a);
      if (bucket) bucket.push(b);
      else successors.set(a, [b]);
      openCount++;
    }
  }
  if (openCount) {
    for (const [startVertex, ends] of successors) {
      while (ends.length) {
        const path = [startVertex];
        let current = ends.pop() as number;
        let closed = false;
        while (path.length < MAX_LOOP) {
          if (current === startVertex) { closed = true; break; }
          const nextBucket = successors.get(current);
          if (!nextBucket || !nextBucket.length) break;
          path.push(current);
          current = nextBucket.pop() as number;
        }
        if (closed && path.length >= 3) polygons.push(path.reverse());
      }
    }
  }

  // 5. Triangulate while keeping every boundary edge, then rebuild the solid.
  // Zero-area triangles from collinear insertions stay: removal would reopen
  // the very edges the repair matched (OpenSCAD emits such triangles too).
  const triangles: Vec3[][] = [];
  for (const polygon of polygons) {
    const count = polygon.length;
    if (count === 3) {
      triangles.push(polygon.map((id) => representatives[id]));
    } else if (count === 4) {
      const [a, b, c, d] = polygon.map((id) => representatives[id]);
      triangles.push([a, b, c], [a, c, d]);
    } else {
      const midpoint: Vec3 = [0, 0, 0];
      for (const id of polygon) {
        const point = representatives[id];
        midpoint[0] += point[0] / count; midpoint[1] += point[1] / count; midpoint[2] += point[2] / count;
      }
      for (let index = 0; index < count; index++) {
        triangles.push([midpoint, representatives[polygon[index]], representatives[polygon[(index + 1) % count]]]);
      }
    }
  }
  const repaired = geometries.geom3.create(triangles.map((vertices) => geometries.poly3.create(vertices)));
  // The color drives 3MF filament assignment, so it must survive the rebuild.
  if (geometry.color) repaired.color = geometry.color;
  return repaired;
}

import earcut from "earcut";
import { extrusions, geometries } from "@jscad/modeling";
import type { Geom2, Geom3 } from "@jscad/modeling/src/geometries/types";
import { SkeletonBuilder, type GeoJSONMultipolygon } from "straight-skeleton";

type Point2 = [number, number];
type Point3 = [number, number, number];

interface Ring {
  points: Point2[];
  area: number;
  parent: number | null;
  depth: number;
}

const EPSILON = 1e-9;

function samePoint(left: Point2, right: Point2) {
  return Math.abs(left[0] - right[0]) <= EPSILON && Math.abs(left[1] - right[1]) <= EPSILON;
}

function cleanRing(points: readonly (readonly number[])[]): Point2[] {
  const clean: Point2[] = [];
  for (const point of points) {
    const next: Point2 = [Number(point[0]), Number(point[1])];
    if (Number.isFinite(next[0]) && Number.isFinite(next[1]) && (!clean.length || !samePoint(clean[clean.length - 1], next))) {
      clean.push(next);
    }
  }
  if (clean.length > 1 && samePoint(clean[0], clean[clean.length - 1])) clean.pop();
  return clean;
}

function signedArea(points: Point2[]) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function pointInRing(point: Point2, ring: Point2[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if ((currentPoint[1] > point[1]) !== (previousPoint[1] > point[1])
      && point[0] < (previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])
        / (previousPoint[1] - currentPoint[1]) + currentPoint[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonHierarchy(shape: Geom2): GeoJSONMultipolygon {
  const rings: Ring[] = geometries.geom2.toOutlines(shape)
    .map(cleanRing)
    .filter((points) => points.length >= 3 && Math.abs(signedArea(points)) > EPSILON)
    .map((points) => ({ points, area: Math.abs(signedArea(points)), parent: null, depth: 0 }));

  for (let index = 0; index < rings.length; index += 1) {
    let parent: number | null = null;
    for (let candidate = 0; candidate < rings.length; candidate += 1) {
      if (candidate === index || rings[candidate].area <= rings[index].area || !pointInRing(rings[index].points[0], rings[candidate].points)) continue;
      if (parent === null || rings[candidate].area < rings[parent].area) parent = candidate;
    }
    rings[index].parent = parent;
  }

  const depthOf = (index: number): number => {
    const parent = rings[index].parent;
    return parent === null ? 0 : depthOf(parent) + 1;
  };
  rings.forEach((ring, index) => { ring.depth = depthOf(index); });

  return rings.flatMap((ring, index) => ring.depth % 2 === 0
    ? [[ring.points, ...rings.filter((candidate) => candidate.parent === index && candidate.depth === ring.depth + 1).map((candidate) => candidate.points)]]
    : []) as GeoJSONMultipolygon;
}

function newellNormal(points: Point3[]): Point3 {
  return points.reduce<Point3>((normal, point, index) => {
    const next = points[(index + 1) % points.length];
    normal[0] += (point[1] - next[1]) * (point[2] + next[2]);
    normal[1] += (point[2] - next[2]) * (point[0] + next[0]);
    normal[2] += (point[0] - next[0]) * (point[1] + next[1]);
    return normal;
  }, [0, 0, 0]);
}

function triangleNormal(points: Point3[]): Point3 {
  const first = points[1].map((value, index) => value - points[0][index]) as Point3;
  const second = points[2].map((value, index) => value - points[0][index]) as Point3;
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function triangulateFace(points: Point3[]) {
  const indices = earcut(points.flatMap((point) => [point[0], point[1]]));
  const faceNormal = newellNormal(points);
  return Array.from({ length: Math.floor(indices.length / 3) }, (_, triangle) => {
    const vertices = indices.slice(triangle * 3, triangle * 3 + 3).map((index) => points[index]);
    const normal = triangleNormal(vertices);
    const dot = normal[0] * faceNormal[0] + normal[1] * faceNormal[1] + normal[2] * faceNormal[2];
    return geometries.poly3.create(dot < 0 ? [vertices[0], vertices[2], vertices[1]] : vertices);
  });
}

/** Build OpenSCAD's 45-degree straight-skeleton roof over a closed 2D region. */
export function buildStraightRoof(shape: Geom2): Geom3 {
  const polygons = polygonHierarchy(shape);
  if (!polygons.length) throw new Error("roof() requires non-empty closed 2D child geometry");

  const skeleton = SkeletonBuilder.BuildFromGeoJSON(polygons);
  const roofPolygons = skeleton.Edges.flatMap((edge) => {
    const points = cleanRing(edge.Polygon.map((point) => [point.X, point.Y])).map((point): Point3 => {
      const source = edge.Polygon.find((candidate) => samePoint(point, [candidate.X, candidate.Y]));
      return [point[0], point[1], source ? skeleton.Distances.get(source) ?? 0 : 0];
    });
    return points.length >= 3 ? triangulateFace(points) : [];
  });

  if (!roofPolygons.length) throw new Error("roof() could not construct a straight skeleton for its child geometry");
  const floorSource = extrusions.extrudeLinear({ height: 1 }, shape);
  const floorPolygons = geometries.geom3.toPolygons(floorSource)
    .filter((polygon) => polygon.vertices.every((point) => Math.abs(point[2]) <= EPSILON));
  return geometries.geom3.create([...roofPolygons, ...floorPolygons]);
}

import { geometries, modifiers } from "@jscad/modeling";
import type { Geom3 } from "@jscad/modeling/src/geometries/types";

function stepString(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/'/g, "''");
}

function stepReal(value: number) {
  if (!Number.isFinite(value)) throw new Error("STEP export encountered a non-finite coordinate");
  const normalized = Math.abs(value) < 1e-12 ? 0 : Number(value.toPrecision(15));
  const [coefficient, exponent] = String(normalized).toUpperCase().split("E");
  const real = coefficient.includes(".") ? coefficient : `${coefficient}.`;
  return exponent === undefined ? real : `${real}E${Number(exponent) >= 0 ? "+" : ""}${Number(exponent)}`;
}

type Point3 = [number, number, number];

function unitVector(vector: Point3): Point3 | null {
  const length = Math.hypot(...vector);
  return length > 1e-12 ? vector.map((value) => value / length) as Point3 : null;
}

function faceNormal(vertices: Point3[]): Point3 | null {
  const normal: Point3 = [0, 0, 0];
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
    normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
    normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
  }
  return unitVector(normal);
}

/** Serialize JSCAD's polygonal solid as an ISO 10303-21 faceted B-rep in millimeters. */
export function serializeStep(geometry: Geom3, name: string): Uint8Array {
  // STEP shells require matching face boundaries, so resolve polygon T-junctions
  // before emitting topology and triangulate the resulting conforming mesh.
  // JSCAD's declaration exposes this CommonJS function as a module namespace.
  const generalize = modifiers.generalize as unknown as (options: { snap: boolean; triangulate: boolean }, input: Geom3) => Geom3;
  const faceted = generalize({ snap: true, triangulate: true }, geometry);
  const polygons = geometries.geom3.toPolygons(faceted);
  if (!polygons.length) throw new Error("STEP export requires at least one face");

  const entities: string[] = [];
  const add = (entity: string) => {
    entities.push(entity);
    return entities.length;
  };

  const applicationContext = add("APPLICATION_CONTEXT('automotive design')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${applicationContext})`);
  const productContext = add(`PRODUCT_CONTEXT('',#${applicationContext},'mechanical')`);
  const safeName = stepString(name || "partcanvas-model");
  const product = add(`PRODUCT('${safeName}','${safeName}','',(#${productContext}))`);
  const formation = add(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
  const designContext = add(`DESIGN_CONTEXT('',#${applicationContext},'design')`);
  const definition = add(`PRODUCT_DEFINITION('design','',#${formation},#${designContext})`);
  const definitionShape = add(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`);
  const lengthUnit = add("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
  const angleUnit = add("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
  const solidAngleUnit = add("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
  const uncertainty = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),#${lengthUnit},'distance_accuracy_value','confusion accuracy')`);
  const representationContext = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angleUnit},#${solidAngleUnit}))REPRESENTATION_CONTEXT('PartCanvas 3D context','3D'))`);

  const points = new Map<string, number>();
  const directions = new Map<string, number>();
  const direction = (vector: Point3) => {
    const coordinates = vector.map(stepReal).join(",");
    let id = directions.get(coordinates);
    if (id === undefined) {
      id = add(`DIRECTION('',(${coordinates}))`);
      directions.set(coordinates, id);
    }
    return id;
  };
  const faceIds: number[] = [];
  for (const polygon of polygons) {
    const pointIds: number[] = [];
    const vertices: Point3[] = [];
    for (const vertex of polygon.vertices) {
      const coordinates = vertex.map(stepReal).join(",");
      let pointId = points.get(coordinates);
      if (pointId === undefined) {
        pointId = add(`CARTESIAN_POINT('',(${coordinates}))`);
        points.set(coordinates, pointId);
      }
      if (pointIds.at(-1) !== pointId) {
        pointIds.push(pointId);
        vertices.push([...vertex] as Point3);
      }
    }
    if (pointIds.length > 2 && pointIds[0] === pointIds.at(-1)) {
      pointIds.pop();
      vertices.pop();
    }
    if (new Set(pointIds).size < 3) continue;
    const normal = faceNormal(vertices);
    const reference = vertices.slice(1).map((vertex) => unitVector([
      vertex[0] - vertices[0][0],
      vertex[1] - vertices[0][1],
      vertex[2] - vertices[0][2],
    ])).find((vector) => vector !== null);
    if (!normal || !reference) continue;
    const loop = add(`POLY_LOOP('',(${pointIds.map((id) => `#${id}`).join(",")}))`);
    const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    const placement = add(`AXIS2_PLACEMENT_3D('',#${pointIds[0]},#${direction(normal)},#${direction(reference)})`);
    const plane = add(`PLANE('',#${placement})`);
    faceIds.push(add(`FACE_SURFACE('',(#${bound}),#${plane},.T.)`));
  }
  if (!faceIds.length) throw new Error("STEP export requires at least one non-degenerate face");

  const shell = add(`CLOSED_SHELL('',(${faceIds.map((id) => `#${id}`).join(",")}))`);
  const brep = add(`FACETED_BREP('${safeName}',#${shell})`);
  const representation = add(`FACETED_BREP_SHAPE_REPRESENTATION('${safeName}',(#${brep}),#${representationContext})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(#${definitionShape},#${representation})`);

  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const body = entities.map((entity, index) => `#${index + 1}=${entity};`).join("\n");
  const output = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Faceted boundary representation'),'2;1');
FILE_NAME('${safeName}.step','${timestamp}',('PartCanvas'),('partcanvas.io'),'PartCanvas TypeScript CAD engine','PartCanvas','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN_CC2'));
ENDSEC;
DATA;
${body}
ENDSEC;
END-ISO-10303-21;
`;
  return new TextEncoder().encode(output);
}

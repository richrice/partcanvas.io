import { booleans, geometries, measurements, transforms } from "@jscad/modeling";
import { serialize as serializeStl } from "@jscad/stl-serializer";
import { serialize as serializeObj } from "@jscad/obj-serializer";
import { serialize as serializeSvg } from "@jscad/svg-serializer";
import { serialize as serializeDxf } from "@jscad/dxf-serializer";
import { evaluate, isGeom2, isGeom3, type CadGeometry } from "./evaluator";
import { extractParameters, validateParameterOverrides, type ModelParameter, type ParameterInput } from "./parameters";
import { parse } from "./parser";
import { resolveSourceFiles } from "./files";
import { serializeBambu3mf } from "./bambu-3mf";
import { serializeStep } from "./step";

export interface ModelMetrics {
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
  dimensions: [number, number, number] | null;
  volume: number | null;
  area: number | null;
  triangles: number;
  compileMs: number;
}

export interface CompileResult {
  geometry: CadGeometry | null;
  parts: CadGeometry[];
  dimension: 2 | 3 | null;
  parameters: ModelParameter[];
  messages: string[];
  warnings: string[];
  metrics: ModelMetrics;
}

export interface CompileOptions {
  parameters?: Record<string, ParameterInput>;
  fn?: number;
  time?: number;
  preview?: boolean;
  checkParameters?: boolean;
  checkParameterRanges?: boolean;
  outputDimension?: "2d" | "3d" | "auto";
  files?: Record<string, string>;
  transform?: {
    scale?: number | [number, number, number];
    rotate?: [number, number, number];
    translate?: [number, number, number];
    origin?: "source" | "center" | "bed";
  };
}

export type ExportFormat = "stl" | "obj" | "3mf" | "step" | "svg" | "dxf";

export interface SerializedModel {
  data: Uint8Array;
  extension: ExportFormat;
  mimeType: string;
}

function emptyMetrics(compileMs: number): ModelMetrics {
  return { bounds: null, dimensions: null, volume: null, area: null, triangles: 0, compileMs };
}

export function compileScad(source: string, options: CompileOptions = {}): CompileResult {
  const start = performance.now();
  const overrides = { ...(options.parameters ?? {}) };
  if (options.time !== undefined) overrides.$t = options.time;
  if (options.preview !== undefined) overrides.$preview = options.preview;
  const resolved = resolveSourceFiles(source, options.files);
  const parameters = extractParameters(resolved.source);
  const program = parse(resolved.source);
  for (const library of resolved.libraries) {
    const libraryProgram = parse(library);
    program.body.unshift(...libraryProgram.body.filter((statement) => statement.type === "module" || statement.type === "function"));
  }
  if (options.fn !== undefined) {
    program.body.unshift({
      type: "assignment",
      name: "$fn",
      value: { type: "literal", value: options.fn, loc: { line: 1, column: 1 } },
      loc: { line: 1, column: 1 },
    });
  }
  const parameterWarnings = validateParameterOverrides(parameters, overrides, {
    checkParameters: options.checkParameters,
    checkRanges: options.checkParameterRanges,
  }).map((diagnostic) => diagnostic.message);
  const evaluated = evaluate(program, overrides, options.files);
  const solids = evaluated.geometries.filter(isGeom3);
  const shapes = evaluated.geometries.filter(isGeom2);
  const warnings = [...parameterWarnings, ...evaluated.warnings];
  const requested = options.outputDimension ?? "3d";
  const dimension = requested === "auto" ? (solids.length ? 3 : shapes.length ? 2 : null) : requested === "2d" ? 2 : 3;
  if (dimension === 3 && shapes.length) warnings.push(`${shapes.length} top-level 2D object${shapes.length === 1 ? "" : "s"} ignored for 3D output.`);
  if (dimension === 2 && solids.length) warnings.push(`${solids.length} top-level 3D object${solids.length === 1 ? "" : "s"} ignored for 2D output; use projection() to flatten solids.`);
  const selected = dimension === 3 ? solids : dimension === 2 ? shapes : [];
  if (!selected.length || dimension === null) {
    return { geometry: null, parts: [], dimension: null, parameters, messages: evaluated.messages, warnings, metrics: emptyMetrics(performance.now() - start) };
  }
  let parts = [...selected];
  const finalTransform = options.transform;
  if (finalTransform?.scale !== undefined) {
    const factor = finalTransform.scale;
    const scale3 = Array.isArray(factor) ? factor : [factor, factor, factor] as [number, number, number];
    parts = parts.map((part) => transforms.scale(dimension === 2 ? [scale3[0], scale3[1]] : scale3, part) as CadGeometry);
  }
  if (finalTransform?.rotate) {
    const rotation = finalTransform.rotate;
    parts = parts.map((part) => dimension === 2
      ? transforms.rotateZ(rotation[2] * Math.PI / 180, part) as CadGeometry
      : transforms.rotate(rotation.map((angle) => angle * Math.PI / 180) as [number, number, number], part) as CadGeometry);
  }
  if (finalTransform?.translate) {
    const translation: [number, number] | [number, number, number] = dimension === 2
      ? [finalTransform.translate[0], finalTransform.translate[1]]
      : finalTransform.translate;
    parts = parts.map((part) => transforms.translate(translation, part) as CadGeometry);
  }
  if (finalTransform?.origin && finalTransform.origin !== "source") {
    const positioned = dimension === 3
      ? (parts.length === 1 ? parts[0] : booleans.union(parts.filter(isGeom3)))
      : (parts.length === 1 ? parts[0] : booleans.union(parts.filter(isGeom2)));
    const currentBounds = measurements.measureBoundingBox(positioned) as [[number, number, number], [number, number, number]];
    const center = currentBounds[0].map((minimum, index) => (minimum + currentBounds[1][index]) / 2) as [number, number, number];
    const offset: [number, number] | [number, number, number] = dimension === 2
      ? [-center[0], -center[1]]
      : finalTransform.origin === "center"
        ? [-center[0], -center[1], -center[2]]
        : [-center[0], -center[1], -currentBounds[0][2]];
    parts = parts.map((part) => transforms.translate(offset, part) as CadGeometry);
  }
  const geometry: CadGeometry = dimension === 3
    ? (parts.length === 1 ? parts[0] : booleans.union(parts.filter(isGeom3)))
    : (parts.length === 1 ? parts[0] : booleans.union(parts.filter(isGeom2)));
  const bounds = measurements.measureBoundingBox(geometry) as [[number, number, number], [number, number, number]];
  const triangles = isGeom3(geometry)
    ? geometries.geom3.toPolygons(geometry).reduce((total, polygon) => total + Math.max(0, polygon.vertices.length - 2), 0)
    : 0;
  return {
    geometry,
    parts,
    dimension,
    parameters,
    messages: evaluated.messages,
    warnings,
    metrics: {
      bounds: { min: bounds[0], max: bounds[1] },
      dimensions: [bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], bounds[1][2] - bounds[0][2]],
      volume: dimension === 3 ? Math.abs(measurements.measureVolume(geometry)) : null,
      area: Math.abs(measurements.measureArea(geometry)),
      triangles,
      compileMs: performance.now() - start,
    },
  };
}

export function geometryToBinaryStl(geometry: CadGeometry, name = "partcanvas-model"): Uint8Array {
  if (!isGeom3(geometry)) throw new Error("STL export requires 3D geometry");
  const chunks = serializeStl({ binary: true, name }, geometry);
  return chunksToBytes(chunks);
}

function chunksToBytes(chunks: ArrayBuffer[] | Uint8Array[] | string[]): Uint8Array {
  const binaryChunks = chunks.map((chunk) => typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
  const length = binaryChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of binaryChunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function serializeGeometry(input: CadGeometry | CadGeometry[], format: ExportFormat, name = "partcanvas-model"): SerializedModel {
  const items = Array.isArray(input) ? input : [input];
  const geometry = items.length === 1
    ? items[0]
    : items.every(isGeom3) ? booleans.union(items) : booleans.union(items.filter(isGeom2));
  if (format === "svg") {
    if (!isGeom2(geometry)) throw new Error("SVG export requires 2D geometry");
    return { data: chunksToBytes(serializeSvg({ unit: "mm" }, geometry)), extension: "svg", mimeType: "image/svg+xml; charset=utf-8" };
  }
  if (format === "dxf") {
    if (!isGeom2(geometry)) throw new Error("DXF export requires 2D geometry");
    return { data: chunksToBytes(serializeDxf({ geom2To: "lwpolyline" }, geometry)), extension: "dxf", mimeType: "application/dxf; charset=utf-8" };
  }
  if (!isGeom3(geometry)) throw new Error(`${format.toUpperCase()} export requires 3D geometry`);
  if (format === "stl") return { data: geometryToBinaryStl(geometry, name), extension: "stl", mimeType: "model/stl" };
  if (format === "obj") {
    return { data: chunksToBytes(serializeObj({ triangulate: true }, geometry)), extension: "obj", mimeType: "text/plain; charset=utf-8" };
  }
  if (format === "step") {
    return { data: serializeStep(geometry, name), extension: "step", mimeType: "model/step" };
  }
  return {
    data: serializeBambu3mf(items.filter(isGeom3), name),
    extension: "3mf",
    mimeType: "model/3mf",
  };
}

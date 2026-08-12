import { parentPort } from "node:worker_threads";
import { compileScad, serializeGeometry, type CompileOptions, type ExportFormat, type ModelMetrics } from "./scad/compiler";
import type { ModelParameter } from "./scad/parameters";

// Node worker entry for /api/render. The engine is isomorphic, so the same
// compileScad the browser runs in a Web Worker (lib/compile-worker.ts) loads
// here unchanged. The route talks to this file through lib/render-pool.server.
//
// The worker compiles AND serializes. Geometry never crosses the thread
// boundary: cloning a 173,000-triangle solid costs more than the pool saves.
// It also applies the rejection rules, so a model over the triangle limit is
// never serialized.

export interface RenderWorkerRequest {
  source: string;
  options: CompileOptions;
  format: ExportFormat;
  filename: string;
  maxTriangles: number;
  hardWarnings: boolean;
  presetWarnings: string[];
}

export interface RenderWorkerSuccess {
  ok: true;
  data: Uint8Array;
  extension: ExportFormat;
  mimeType: string;
  metrics: ModelMetrics;
  dimension: 2 | 3;
  parameters: ModelParameter[];
  warnings: string[];
  messages: string[];
  serializeMs: number;
}

export interface RenderWorkerFailure {
  ok: false;
  error: string;
  warnings?: string[];
}

export type RenderWorkerResponse = RenderWorkerSuccess | RenderWorkerFailure;

export function renderModel(request: RenderWorkerRequest): RenderWorkerResponse {
  const result = compileScad(request.source, request.options);
  const warnings = [...request.presetWarnings, ...result.warnings];
  if (!result.geometry) {
    const expected = request.format === "svg" || request.format === "dxf" ? "2D geometry" : "a 3D solid";
    return { ok: false, error: `The script did not produce ${expected}`, warnings };
  }
  if (request.hardWarnings && warnings.length) {
    return { ok: false, error: "Render stopped because hardWarnings is enabled", warnings };
  }
  if (result.dimension === 3 && result.metrics.triangles > request.maxTriangles) {
    return { ok: false, error: `Model has ${result.metrics.triangles} triangles, exceeding the ${request.maxTriangles} triangle limit` };
  }
  const serializeStart = performance.now();
  const serialized = serializeGeometry(result.parts.length ? result.parts : result.geometry, request.format, request.filename);
  return {
    ok: true,
    data: serialized.data,
    extension: serialized.extension,
    mimeType: serialized.mimeType,
    metrics: result.metrics,
    dimension: result.dimension as 2 | 3,
    parameters: result.parameters,
    warnings,
    messages: result.messages,
    serializeMs: performance.now() - serializeStart,
  };
}

const port = parentPort;
if (port) {
  port.on("message", (request: RenderWorkerRequest) => {
    let response: RenderWorkerResponse;
    try {
      response = renderModel(request);
    } catch (error) {
      response = { ok: false, error: error instanceof Error ? error.message : "Render failed" };
    }
    port.postMessage(response, response.ok ? [response.data.buffer as ArrayBuffer] : []);
  });
}

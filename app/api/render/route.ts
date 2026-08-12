import { type ExportFormat } from "@/lib/scad/compiler";
import { defaultParameterValues, extractParameters, type ParameterInput } from "@/lib/scad/parameters";
import { loadOpenScadParameterFile, resolveOpenScadParameterSet } from "@/lib/scad/parameter-sets";
import { resolveSourceFiles } from "@/lib/scad/files";
import { CORS_HEADERS, corsPreflight } from "@/lib/api/cors";
import { PARTCANVAS_API_VERSION, PARTCANVAS_ENGINE } from "@/lib/api/meta";
import { checkRateLimit, clientIp, COMPILE_RULE, rateLimitResponse } from "@/lib/api/rate-limit.server";
import { RenderBudgetError, RenderBusyError, RENDER_BUDGET_MS, runRender } from "@/lib/render-pool.server";
import type { RenderWorkerResponse } from "@/lib/render-worker.server";

export const runtime = "nodejs";
export const maxDuration = 30;
export const OPTIONS = corsPreflight;

interface RenderRequest {
  source?: unknown;
  parameters?: unknown;
  defines?: unknown;
  parameterFile?: unknown;
  parameterSet?: unknown;
  p?: unknown;
  P?: unknown;
  files?: unknown;
  format?: unknown;
  summary?: unknown;
  options?: {
    fn?: unknown;
    time?: unknown;
    preview?: unknown;
    checkParameters?: unknown;
    checkParameterRanges?: unknown;
    scale?: unknown;
    rotate?: unknown;
    translate?: unknown;
    origin?: unknown;
    hardWarnings?: unknown;
    maxTriangles?: unknown;
  };
  filename?: unknown;
}

const SUMMARY_CATEGORIES = ["cache", "time", "camera", "geometry", "bounding-box", "area"] as const;
type SummaryCategory = typeof SUMMARY_CATEGORIES[number];

function summaryCategories(value: unknown): Set<SummaryCategory> | null {
  if (value === undefined || value === false) return null;
  const requested = value === true ? ["all"] : typeof value === "string" ? [value] : value;
  if (!Array.isArray(requested) || requested.some((item) => typeof item !== "string")) {
    throw new Error("summary must be true, an OpenSCAD summary category, or an array of categories");
  }
  const normalized = requested.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  const invalid = normalized.filter((item) => item !== "all" && !(SUMMARY_CATEGORIES as readonly string[]).includes(item));
  if (invalid.length) {
    throw new Error(`Unsupported summary categor${invalid.length === 1 ? "y" : "ies"}: ${invalid.join(", ")}. Supported: all, ${SUMMARY_CATEGORIES.join(", ")}`);
  }
  return new Set(normalized.includes("all") || normalized.length === 0 ? SUMMARY_CATEGORIES : normalized as SummaryCategory[]);
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", ...CORS_HEADERS },
  });
}

function safeParameterValue(value: unknown, depth = 0): ParameterInput | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && depth < 8 && value.length <= 10_000) {
    const items = value.map((item) => safeParameterValue(item, depth + 1));
    return items.every((item) => item !== undefined) ? items as ParameterInput[] : undefined;
  }
  return undefined;
}

function safeParameters(value: unknown): Record<string, ParameterInput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, ParameterInput> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    const item = safeParameterValue(raw);
    if (item !== undefined) output[name] = item;
  }
  return output;
}

function safeVector(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return undefined;
  return value as [number, number, number];
}

function safeFiles(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value);
  if (entries.length > 128) throw new Error("A render can contain at most 128 model files");
  let totalSize = 0;
  const output: Record<string, string> = {};
  for (const [name, contents] of entries) {
    if (typeof contents !== "string") throw new Error(`Model file '${name}' must contain text`);
    totalSize += contents.length;
    if (totalSize > 2_000_000) throw new Error("Model files exceed the combined 2 MB limit");
    output[name] = contents;
  }
  return output;
}

export async function POST(request: Request) {
  const requestStart = performance.now();
  const decision = checkRateLimit(`render:${clientIp(request)}`, COMPILE_RULE);
  if (!decision.allowed) return rateLimitResponse(decision, CORS_HEADERS);
  try {
    const body = await request.json() as RenderRequest;
    let requestedSummary: Set<SummaryCategory> | null;
    try {
      requestedSummary = summaryCategories(body.summary);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invalid summary categories" }, 400);
    }
    if (typeof body.source !== "string" || !body.source.trim()) {
      return json({ error: "source must be a non-empty OpenSCAD-compatible script" }, 400);
    }
    if (body.source.length > 2_000_000) return json({ error: "source exceeds the 2 MB limit" }, 413);
    const format = body.format ?? "stl";
    if (!(["stl", "obj", "3mf", "step", "svg", "dxf"] as unknown[]).includes(format)) {
      return json({ error: `Unsupported format '${String(format)}'. Supported: stl, obj, 3mf, step, svg, dxf` }, 400);
    }
    const fn = typeof body.options?.fn === "number" ? Math.min(256, Math.max(3, Math.round(body.options.fn))) : undefined;
    const time = typeof body.options?.time === "number" && Number.isFinite(body.options.time)
      ? Math.min(1, Math.max(0, body.options.time))
      : undefined;
    const scalarScale = typeof body.options?.scale === "number" && Number.isFinite(body.options.scale) ? body.options.scale : undefined;
    const vectorScale = safeVector(body.options?.scale);
    const origin = ["source", "center", "bed"].includes(String(body.options?.origin))
      ? body.options?.origin as "source" | "center" | "bed"
      : undefined;
    const files = safeFiles(body.files);
    const parameterFileInput = body.parameterFile ?? body.p;
    const parameterSetInput = body.parameterSet ?? body.P;
    const hasParameterFile = parameterFileInput !== undefined;
    const hasParameterSet = parameterSetInput !== undefined;
    if (hasParameterFile !== hasParameterSet) {
      return json({ error: "parameterFile (-p) and parameterSet (-P) must be supplied together" }, 400);
    }
    if (hasParameterSet && (typeof parameterSetInput !== "string" || !parameterSetInput.trim())) {
      return json({ error: "parameterSet must be a non-empty string" }, 400);
    }
    const preset = hasParameterFile
      ? resolveOpenScadParameterSet(
        loadOpenScadParameterFile(parameterFileInput, files),
        (parameterSetInput as string).trim(),
        extractParameters(resolveSourceFiles(body.source, files).source),
      )
      : undefined;
    const overrides = { ...preset?.values, ...safeParameters(body.defines), ...safeParameters(body.parameters) };
    const requestedLimit = typeof body.options?.maxTriangles === "number" && Number.isFinite(body.options.maxTriangles)
      ? Math.round(body.options.maxTriangles)
      : 2_000_000;
    const maxTriangles = Math.min(5_000_000, Math.max(1_000, requestedLimit));
    const filename = typeof body.filename === "string" && body.filename.trim()
      ? body.filename.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/\.(?:stl|obj|3mf|step|stp|svg|dxf)$/i, "")
      : "partcanvas-model";
    // The compile runs in a worker thread. It is unbounded CPU work, so on the
    // request thread it would block every other request on this instance.
    let rendered: RenderWorkerResponse;
    try {
      rendered = await runRender({
        source: body.source,
        options: {
          parameters: overrides,
          fn,
          time,
          preview: typeof body.options?.preview === "boolean" ? body.options.preview : false,
          checkParameters: body.options?.checkParameters === true || body.options?.checkParameterRanges === true,
          checkParameterRanges: body.options?.checkParameterRanges === true,
          outputDimension: format === "svg" || format === "dxf" ? "2d" : "3d",
          files,
          transform: {
            scale: vectorScale ?? scalarScale,
            rotate: safeVector(body.options?.rotate),
            translate: safeVector(body.options?.translate),
            origin,
          },
        },
        format: format as ExportFormat,
        filename,
        maxTriangles,
        hardWarnings: body.options?.hardWarnings === true,
        presetWarnings: preset?.diagnostics.map((diagnostic) => diagnostic.message) ?? [],
      });
    } catch (error) {
      if (error instanceof RenderBusyError) {
        return Response.json({ error: error.message }, {
          status: 429,
          headers: { "retry-after": "5", "cache-control": "no-store", ...CORS_HEADERS },
        });
      }
      if (error instanceof RenderBudgetError) {
        return Response.json({ error: error.message }, {
          status: 503,
          headers: { "retry-after": String(Math.ceil(RENDER_BUDGET_MS / 1000)), "cache-control": "no-store", ...CORS_HEADERS },
        });
      }
      return json({ error: error instanceof Error ? error.message : "The render worker failed" }, 500);
    }
    if (!rendered.ok) {
      return json(rendered.warnings ? { error: rendered.error, warnings: rendered.warnings } : { error: rendered.error }, 422);
    }
    const { warnings, serializeMs } = rendered;
    if (requestedSummary) {
      const dimension = rendered.dimension;
      const categories = [...requestedSummary];
      const includeGeometry = requestedSummary.has("geometry") || requestedSummary.has("bounding-box") || requestedSummary.has("area");
      const bounds = rendered.metrics.bounds;
      const summary = {
        engine: PARTCANVAS_ENGINE,
        apiVersion: PARTCANVAS_API_VERSION,
        categories,
        output: {
          format: rendered.extension,
          filename: `${filename}.${rendered.extension}`,
          mimeType: rendered.mimeType,
          bytes: rendered.data.byteLength,
        },
        parameters: {
          parameterSet: preset?.name ?? null,
          values: { ...defaultParameterValues(rendered.parameters), ...overrides },
        },
        diagnostics: { warnings, messages: rendered.messages },
        ...(includeGeometry ? {
          geometry: {
            dimensions: dimension,
            facets: rendered.metrics.triangles,
            triangles: rendered.metrics.triangles,
            ...(requestedSummary.has("bounding-box") && bounds ? {
              bounding_box: {
                min: bounds.min.slice(0, dimension),
                max: bounds.max.slice(0, dimension),
                size: rendered.metrics.dimensions?.slice(0, dimension) ?? null,
              },
            } : {}),
          },
        } : {}),
        ...(requestedSummary.has("area") ? {
          measurements: {
            area_mm2: rendered.metrics.area,
            volume_mm3: rendered.metrics.volume,
          },
        } : {}),
        ...(requestedSummary.has("time") ? {
          time: {
            compile_ms: rendered.metrics.compileMs,
            serialize_ms: serializeMs,
            total_ms: performance.now() - requestStart,
          },
        } : {}),
        ...(requestedSummary.has("cache") ? {
          cache: { enabled: false, scope: "stateless-request" },
        } : {}),
        ...(requestedSummary.has("camera") ? {
          camera: null,
        } : {}),
      };
      return json(summary);
    }
    return new Response(Buffer.from(rendered.data), {
      headers: {
        "content-type": rendered.mimeType,
        "content-disposition": `attachment; filename="${filename}.${rendered.extension}"`,
        "x-partcanvas-triangles": String(rendered.metrics.triangles),
        "x-partcanvas-compile-ms": rendered.metrics.compileMs.toFixed(1),
        "x-partcanvas-volume-mm3": rendered.metrics.volume?.toFixed(3) ?? "0",
        "x-partcanvas-area-mm2": rendered.metrics.area?.toFixed(3) ?? "0",
        "x-partcanvas-dimension": String(rendered.dimension),
        "x-partcanvas-warning-count": String(warnings.length),
        ...(warnings.length ? { "x-partcanvas-warnings": encodeURIComponent(warnings.slice(0, 10).join(" | ")).slice(0, 4_000) } : {}),
        ...(preset ? { "x-partcanvas-parameter-set": encodeURIComponent(preset.name).slice(0, 1_000) } : {}),
        "cache-control": "no-store",
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed";
    return json({ error: message }, 422);
  }
}

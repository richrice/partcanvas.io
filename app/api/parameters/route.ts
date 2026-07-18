import { parse } from "@/lib/scad/parser";
import { defaultParameterValues, extractParameters, validateParameterOverrides, type ParameterInput } from "@/lib/scad/parameters";
import { corsPreflight } from "@/lib/api/cors";
import { checkRateLimit, clientIp, COMPILE_RULE, rateLimitResponse } from "@/lib/api/rate-limit.server";
import { resolveSourceFiles } from "@/lib/scad/files";
import { inspectOpenScadParameterSets, loadOpenScadParameterFile, resolveOpenScadParameterSet } from "@/lib/scad/parameter-sets";

export const OPTIONS = corsPreflight;

function safeValue(value: unknown): ParameterInput | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 4) {
    const items = value.map(safeValue);
    if (items.every((item) => item !== undefined)) return items as ParameterInput[];
  }
  return undefined;
}

function safeValues(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, ParameterInput> = {};
  for (const [name, item] of Object.entries(value)) {
    const safe = safeValue(item);
    if (/^[A-Za-z_$][\w$]*$/.test(name) && safe !== undefined) output[name] = safe;
  }
  return output;
}

export async function POST(request: Request) {
  const decision = checkRateLimit(`parameters:${clientIp(request)}`, COMPILE_RULE);
  if (!decision.allowed) return rateLimitResponse(decision);
  try {
    const body = await request.json() as {
      source?: unknown;
      files?: unknown;
      values?: unknown;
      parameters?: unknown;
      parameterFile?: unknown;
      parameterSet?: unknown;
      p?: unknown;
      P?: unknown;
      checkRanges?: unknown;
    };
    if (typeof body.source !== "string") return Response.json({ error: "source must be a string" }, { status: 400 });
    if (body.source.length > 2_000_000) return Response.json({ error: "source exceeds the 2 MB limit" }, { status: 413 });
    const files = body.files && typeof body.files === "object" && !Array.isArray(body.files)
      ? Object.fromEntries(Object.entries(body.files).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
    if (Object.keys(files).length > 128) return Response.json({ error: "A project can contain at most 128 model files" }, { status: 413 });
    if (Object.values(files).reduce((total, contents) => total + contents.length, 0) > 2_000_000) {
      return Response.json({ error: "Model files exceed the combined 2 MB limit" }, { status: 413 });
    }
    const resolved = resolveSourceFiles(body.source, files);
    parse(resolved.source);
    for (const library of resolved.libraries) parse(library);
    const parameters = extractParameters(resolved.source);
    const parameterFileInput = body.parameterFile ?? body.p;
    const parameterSetInput = body.parameterSet ?? body.P;
    if (parameterSetInput !== undefined && parameterFileInput === undefined) {
      return Response.json({ error: "parameterSet (-P) requires parameterFile (-p)" }, { status: 400 });
    }
    if (parameterSetInput !== undefined && (typeof parameterSetInput !== "string" || !parameterSetInput.trim())) {
      return Response.json({ error: "parameterSet must be a non-empty string" }, { status: 400 });
    }
    const presetFile = parameterFileInput === undefined ? undefined : loadOpenScadParameterFile(parameterFileInput, files);
    const parameterSets = presetFile ? inspectOpenScadParameterSets(presetFile, parameters) : [];
    const selected = presetFile && typeof parameterSetInput === "string"
      ? resolveOpenScadParameterSet(presetFile, parameterSetInput.trim(), parameters)
      : undefined;
    const values = { ...selected?.values, ...safeValues(body.values ?? body.parameters) };
    const diagnostics = [...(selected?.diagnostics ?? []), ...validateParameterOverrides(parameters, values, {
      checkParameters: true,
      checkRanges: body.checkRanges === true,
    })];
    return Response.json({
      parameters,
      defaults: defaultParameterValues(parameters),
      parameterSets,
      selectedParameterSet: selected?.name ?? null,
      values,
      diagnostics,
      valid: true,
    });
  } catch (error) {
    return Response.json({ valid: false, error: error instanceof Error ? error.message : "Could not inspect script" }, { status: 422 });
  }
}

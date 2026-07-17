import { decodeProjectAsset } from "../project-assets";
import { canonicalProjectPath } from "./files";
import type { ModelParameter, ParameterScalar, ParameterValue } from "./parameters";

export interface OpenScadParameterFile {
  fileFormatVersion: "1";
  parameterSets: Record<string, Record<string, unknown>>;
}

export interface ParameterSetDiagnostic {
  code: "unknown-preset-parameter" | "invalid-preset-value";
  parameter: string;
  parameterSet: string;
  message: string;
}

export interface ResolvedParameterSet {
  name: string;
  values: Record<string, ParameterValue>;
  diagnostics: ParameterSetDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedParameterFile(input: unknown): OpenScadParameterFile {
  let parsed = input;
  if (typeof input === "string") {
    if (input.length > 2_000_000) throw new Error("Customizer parameter file exceeds the 2 MB limit");
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid customizer parameter JSON: ${detail}`);
    }
  }
  if (!isRecord(parsed) || !isRecord(parsed.parameterSets)) {
    throw new Error("Customizer parameter file must contain a 'parameterSets' object");
  }
  const version = parsed.fileFormatVersion === undefined ? "1" : String(parsed.fileFormatVersion);
  if (version !== "1") throw new Error(`Unsupported customizer parameter file version '${version}'`);
  const entries = Object.entries(parsed.parameterSets);
  if (entries.length > 500) throw new Error("Customizer parameter file can contain at most 500 parameter sets");
  const parameterSets: Record<string, Record<string, unknown>> = {};
  for (const [name, values] of entries) {
    if (!name || name.length > 256 || !isRecord(values)) throw new Error(`Invalid customizer parameter set '${name}'`);
    if (Object.keys(values).length > 500) throw new Error(`Parameter set '${name}' can contain at most 500 values`);
    parameterSets[name] = values;
  }
  return { fileFormatVersion: "1", parameterSets };
}

export function loadOpenScadParameterFile(
  input: unknown,
  projectFiles: Record<string, string> = {},
): OpenScadParameterFile {
  if (typeof input !== "string") {
    const encoded = JSON.stringify(input);
    if (encoded.length > 2_000_000) throw new Error("Customizer parameter file exceeds the 2 MB limit");
    return normalizedParameterFile(input);
  }
  const filename = canonicalProjectPath(input);
  const files = new Map(Object.entries(projectFiles).map(([name, contents]) => [canonicalProjectPath(name), contents]));
  const contents = files.get(filename);
  if (contents === undefined) throw new Error(`Customizer parameter file '${filename}' was not provided`);
  return normalizedParameterFile(decodeProjectAsset(filename, contents).text);
}

function numberValue(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, parameter: ModelParameter) {
  return Math.min(parameter.max ?? Infinity, Math.max(parameter.min ?? -Infinity, value));
}

function scalarPresetValue(parameter: ModelParameter, raw: unknown): ParameterScalar | undefined {
  if (parameter.type === "string") {
    return typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? String(raw) : undefined;
  }
  if (parameter.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string" && ["true", "1"].includes(raw.trim().toLowerCase())) return true;
    if (typeof raw === "string" && ["false", "0"].includes(raw.trim().toLowerCase())) return false;
    return undefined;
  }
  if (parameter.type === "number") {
    const value = numberValue(raw);
    return value === undefined ? undefined : clamp(value, parameter);
  }
  if (parameter.type === "select") {
    const options = parameter.options ?? [];
    const direct = options.find((option) => option.value === raw)?.value;
    if (direct !== undefined) return direct;
    const numeric = numberValue(raw);
    const numericOption = numeric === undefined ? undefined : options.find((option) => option.value === numeric)?.value;
    if (numericOption !== undefined) return numericOption;
    return typeof raw === "string" ? options.find((option) => String(option.value) === raw)?.value : undefined;
  }
  return undefined;
}

function presetValue(parameter: ModelParameter, raw: unknown): ParameterValue | undefined {
  if (parameter.type === "color") {
    if (typeof raw === "string") return raw;
    if (!Array.isArray(raw) || (raw.length !== 3 && raw.length !== 4)) return undefined;
    const values = raw.map(numberValue);
    return values.every((value) => value !== undefined && value >= 0 && value <= 1)
      ? values as number[]
      : undefined;
  }
  if (parameter.type !== "vector") return scalarPresetValue(parameter, raw);
  let values: unknown = raw;
  if (typeof raw === "string") {
    try {
      values = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(values) || values.length !== (parameter.defaultValue as number[]).length) return undefined;
  const numbers = values.map(numberValue);
  return numbers.every((value) => value !== undefined)
    ? numbers.map((value) => clamp(value!, parameter))
    : undefined;
}

export function resolveOpenScadParameterSet(
  file: OpenScadParameterFile,
  name: string,
  parameters: ModelParameter[],
): ResolvedParameterSet {
  const rawValues = file.parameterSets[name];
  if (!rawValues) {
    const available = Object.keys(file.parameterSets);
    throw new Error(`Customizer parameter set '${name}' was not found${available.length ? `. Available: ${available.join(", ")}` : ""}`);
  }
  const definitions = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const values: Record<string, ParameterValue> = {};
  const diagnostics: ParameterSetDiagnostic[] = [];
  for (const [parameterName, raw] of Object.entries(rawValues)) {
    const parameter = definitions.get(parameterName);
    if (!parameter) {
      diagnostics.push({
        code: "unknown-preset-parameter",
        parameter: parameterName,
        parameterSet: name,
        message: `Parameter set '${name}' contains unknown parameter '${parameterName}'`,
      });
      continue;
    }
    const value = presetValue(parameter, raw);
    if (value === undefined) {
      diagnostics.push({
        code: "invalid-preset-value",
        parameter: parameterName,
        parameterSet: name,
        message: `Parameter set '${name}' contains an invalid value for '${parameterName}'`,
      });
      continue;
    }
    values[parameterName] = value;
  }
  return { name, values, diagnostics };
}

export function inspectOpenScadParameterSets(file: OpenScadParameterFile, parameters: ModelParameter[]) {
  return Object.keys(file.parameterSets).map((name) => resolveOpenScadParameterSet(file, name, parameters));
}

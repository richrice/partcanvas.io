export type ParameterScalar = number | string | boolean;
export type ParameterValue = ParameterScalar | number[];
export type ParameterInput = ParameterScalar | null | ParameterInput[];

export interface ParameterOption {
  label: string;
  value: ParameterScalar;
}

export interface ModelParameter {
  name: string;
  label: string;
  description?: string;
  section: string;
  type: "number" | "string" | "boolean" | "select" | "vector";
  defaultValue: ParameterValue;
  min?: number;
  max?: number;
  step?: number;
  options?: ParameterOption[];
  unit?: "mm" | "°" | "";
  line: number;
}

function parseLiteral(raw: string): ParameterValue | undefined {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return Number(value);
  const string = value.match(/^"((?:\\.|[^"])*)"$/);
  if (string) return string[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
  const vector = value.match(/^\[([^\]]*)]$/);
  if (vector) {
    const items = vector[1].split(",").map((item) => Number(item.trim()));
    if (items.length >= 1 && items.length <= 4 && items.every(Number.isFinite)) return items;
  }
  return undefined;
}

function titleCase(name: string) {
  return name.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function extractParameters(source: string): ModelParameter[] {
  const parameters: ModelParameter[] = [];
  let section = "Parameters";
  let depth = 0;
  let pendingDescription = "";
  const lines = source.split(/\r?\n/);

  lines.forEach((line, lineIndex) => {
    let matchedAssignment = false;
    const sectionMatch = line.match(/^\s*\/\*\s*\[([^\]]+)]\s*\*\/\s*$/);
    if (sectionMatch && depth === 0) {
      section = sectionMatch[1].trim();
      pendingDescription = "";
      return;
    }

    const descriptionMatch = depth === 0 ? line.match(/^\s*\/\/\s*(.+?)\s*$/) : null;
    if (descriptionMatch) {
      pendingDescription = descriptionMatch[1];
      return;
    }

    if (depth === 0) {
      const assignment = line.match(/^\s*([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*;\s*(?:\/\/\s*(.*))?$/);
      if (assignment) {
        matchedAssignment = true;
        const [, name, rawValue, rawComment = ""] = assignment;
        const defaultValue = parseLiteral(rawValue);
        if (defaultValue !== undefined && !name.startsWith("$") && section.toLowerCase() !== "hidden") {
          const controlMatch = rawComment.match(/\[([^\]]+)]/);
          const prose = rawComment.replace(/\s*\[[^\]]+]\s*/, "").trim();
          const parameter: ModelParameter = {
            name,
            label: titleCase(name),
            description: prose || pendingDescription || undefined,
            section,
            type: Array.isArray(defaultValue) ? "vector" : typeof defaultValue as "number" | "string" | "boolean",
            defaultValue,
            line: lineIndex + 1,
          };
          if (typeof defaultValue === "number") {
            parameter.unit = /angle|rotate|rotation|twist/i.test(name)
              ? "°"
              : /count|copies|quantity|segments|facets|quality|resolution/i.test(name) ? "" : "mm";
          }
          if (controlMatch) {
            const control = controlMatch[1].trim();
            const numericParts = control.split(":").map(Number);
            if (numericParts.every(Number.isFinite) && (numericParts.length === 2 || numericParts.length === 3)) {
              parameter.min = numericParts[0];
              if (numericParts.length === 2) {
                parameter.max = numericParts[1];
                const defaultNumbers = Array.isArray(defaultValue) ? defaultValue : [defaultValue];
                parameter.step = Number.isInteger(parameter.min) && Number.isInteger(parameter.max)
                  && defaultNumbers.every((item) => typeof item === "number" && Number.isInteger(item))
                  ? 1
                  : Math.max((parameter.max - parameter.min) / 100, 0.01);
              } else {
                parameter.step = numericParts[1];
                parameter.max = numericParts[2];
              }
              if (!Array.isArray(defaultValue)) parameter.type = "number";
            } else if (control.includes(",") && !Array.isArray(defaultValue)) {
              parameter.options = control.split(",").map((option) => {
                const [rawOptionValue, rawLabel] = option.split(":");
                const candidate = parseLiteral(rawOptionValue) ?? rawOptionValue.trim();
                const parsed = Array.isArray(candidate) ? rawOptionValue.trim() : candidate;
                return { value: parsed, label: rawLabel?.trim() || String(parsed) };
              });
              parameter.type = "select";
            }
          }
          parameters.push(parameter);
        }
        pendingDescription = "";
      }
    }

    const withoutComments = line.replace(/\/\/.*$/, "").replace(/"(?:\\.|[^"])*"/g, "");
    depth += (withoutComments.match(/{/g) ?? []).length;
    depth -= (withoutComments.match(/}/g) ?? []).length;
    depth = Math.max(depth, 0);
    if (line.trim() && !matchedAssignment && !sectionMatch) pendingDescription = "";
  });
  return parameters;
}

export interface ParameterValidationOptions {
  checkParameters?: boolean;
  checkRanges?: boolean;
}

export interface ParameterDiagnostic {
  code: "unknown-parameter" | "type-mismatch" | "invalid-option" | "out-of-range";
  parameter: string;
  message: string;
}

function scalarType(value: ParameterInput) {
  if (value === null) return "undef";
  if (Array.isArray(value)) return "vector";
  return typeof value;
}

export function validateParameterOverrides(
  parameters: ModelParameter[],
  overrides: Record<string, ParameterInput>,
  options: ParameterValidationOptions = {},
): ParameterDiagnostic[] {
  const definitions = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const diagnostics: ParameterDiagnostic[] = [];
  for (const [name, value] of Object.entries(overrides)) {
    if (name.startsWith("$")) continue;
    const definition = definitions.get(name);
    if (!definition) {
      if (options.checkParameters) diagnostics.push({ code: "unknown-parameter", parameter: name, message: `Unknown parameter override '${name}'` });
      continue;
    }
    const expected = definition.type === "select" ? typeof definition.defaultValue : definition.type;
    const actual = scalarType(value);
    const validVector = expected === "vector" && Array.isArray(value) && value.length === (definition.defaultValue as number[]).length
      && value.every((item) => typeof item === "number" && Number.isFinite(item));
    const validScalar = expected !== "vector" && actual === expected;
    if (options.checkParameters && !(validVector || validScalar)) {
      diagnostics.push({ code: "type-mismatch", parameter: name, message: `Parameter '${name}' expects ${expected}, received ${actual}` });
      continue;
    }
    if (options.checkParameters && definition.options && !definition.options.some((option) => option.value === value)) {
      diagnostics.push({ code: "invalid-option", parameter: name, message: `Parameter '${name}' must be one of: ${definition.options.map((option) => String(option.value)).join(", ")}` });
    }
    if (options.checkRanges && definition.min !== undefined && definition.max !== undefined) {
      const values = Array.isArray(value) ? value : [value];
      const invalid = values.findIndex((item) => typeof item !== "number" || !Number.isFinite(item) || item < definition.min! || item > definition.max!);
      if (invalid >= 0) {
        const suffix = Array.isArray(value) ? `[${invalid}]` : "";
        diagnostics.push({ code: "out-of-range", parameter: name, message: `Parameter '${name}${suffix}' must be between ${definition.min} and ${definition.max}` });
      }
    }
  }
  return diagnostics;
}

export function defaultParameterValues(parameters: ModelParameter[]): Record<string, ParameterValue> {
  return Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.defaultValue]));
}

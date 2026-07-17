import {
  booleans,
  colors,
  expansions,
  extrusions,
  geometries,
  hulls,
  maths,
  measurements,
  primitives,
  text as modelingText,
  transforms,
} from "@jscad/modeling";
import { deserialize as deserializeDxf } from "@jscad/dxf-deserializer";
import { deserialize as deserializeObj } from "@jscad/obj-deserializer";
import { deserialize as deserializeStl } from "@jscad/stl-deserializer";
import { deserialize as deserializeSvg } from "@jscad/svg-deserializer";
import { decode as decodePng } from "fast-png";
import type { Geom2, Geom3 } from "@jscad/modeling/src/geometries/types";
import { decodeProjectAsset, extensionOf } from "../project-assets";
import type { Argument, Binding, Expression, ModuleParameter, Program, Statement } from "./ast";
import { canonicalProjectPath } from "./files";
import type { ParameterInput } from "./parameters";
import { buildStraightRoof } from "./roof";

export type CadGeometry = Geom2 | Geom3;
export type ScadValue = number | string | boolean | null | ScadValue[];

export interface EvaluationResult {
  geometries: CadGeometry[];
  messages: string[];
  warnings: string[];
}

interface ModuleDefinition {
  parameters: ModuleParameter[];
  body: Statement[];
}

interface FunctionDefinition {
  parameters: ModuleParameter[];
  body: Expression;
}

interface ChildScope {
  statements: Statement[];
  environment: Environment;
}

class Environment {
  readonly values = new Map<string, ScadValue>();
  readonly modules = new Map<string, ModuleDefinition>();
  readonly functions = new Map<string, FunctionDefinition>();
  childScope?: ChildScope;
  constructor(public readonly parent?: Environment) {}
  get(name: string): ScadValue {
    if (this.values.has(name)) return this.values.get(name) ?? null;
    return this.parent?.get(name) ?? null;
  }
  set(name: string, value: ScadValue) {
    this.values.set(name, value);
  }
  getModule(name: string): ModuleDefinition | undefined {
    return this.modules.get(name) ?? this.parent?.getModule(name);
  }
  getFunction(name: string): FunctionDefinition | undefined {
    return this.functions.get(name) ?? this.parent?.getFunction(name);
  }
}

const deg = (value: number) => (value * Math.PI) / 180;
const num = (value: ScadValue, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const bool = (value: ScadValue) => Array.isArray(value) ? value.length > 0 : Boolean(value);
const vector = (value: ScadValue, length: number, fallback = 0): number[] => {
  const values = Array.isArray(value) ? value.map((item) => num(item, fallback)) : [num(value, fallback)];
  return Array.from({ length }, (_, index) => values[index] ?? values[values.length - 1] ?? fallback);
};

function signedArea2d(points: [number, number][]) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function parseTextHeightmap(input: string, filename: string) {
  const rows = input.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/[\s,]+/).map(Number));
  if (rows.length < 2 || rows[0].length < 2) throw new Error(`Heightmap '${filename}' must contain at least 2 rows and 2 columns`);
  const width = rows[0].length;
  if (rows.some((row) => row.length !== width || row.some((value) => !Number.isFinite(value)))) {
    throw new Error(`Heightmap '${filename}' must be a rectangular grid of finite numbers`);
  }
  return rows;
}

function parsePngHeightmap(bytes: Uint8Array, invert: boolean) {
  const image = decodePng(bytes);
  if (image.width < 2 || image.height < 2) throw new Error("PNG heightmap must be at least 2 × 2 pixels");
  const maximum = image.depth === 16 ? 65_535 : 255;
  return Array.from({ length: image.height }, (_, y) => Array.from({ length: image.width }, (_, x) => {
    const offset = (y * image.width + x) * image.channels;
    const luminance = image.channels <= 2
      ? Number(image.data[offset]) / maximum
      : (0.2126 * Number(image.data[offset]) + 0.7152 * Number(image.data[offset + 1]) + 0.0722 * Number(image.data[offset + 2])) / maximum;
    return (invert ? 1 - luminance : luminance) * 100;
  }));
}

function heightmapGeometry(rows: number[][], center: boolean): Geom3 {
  const height = rows.length;
  const width = rows[0].length;
  const points: [number, number, number][] = rows.flatMap((row, y) => row.map((z, x): [number, number, number] => [x, height - 1 - y, z]));
  const faces: number[][] = [];
  const topIndex = (x: number, y: number) => y * width + x;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const a = topIndex(x, y);
      const b = topIndex(x + 1, y);
      const c = topIndex(x, y + 1);
      const d = topIndex(x + 1, y + 1);
      faces.push([a, c, d], [a, d, b]);
    }
  }
  const perimeter: number[] = [];
  for (let x = 0; x < width; x += 1) perimeter.push(topIndex(x, 0));
  for (let y = 1; y < height; y += 1) perimeter.push(topIndex(width - 1, y));
  for (let x = width - 2; x >= 0; x -= 1) perimeter.push(topIndex(x, height - 1));
  for (let y = height - 2; y > 0; y -= 1) perimeter.push(topIndex(0, y));
  const floor = Math.min(0, ...rows.flat());
  const bottom = perimeter.map((top) => {
    const [x, y] = points[top];
    points.push([x, y, floor]);
    return points.length - 1;
  });
  for (let index = 0; index < perimeter.length; index += 1) {
    const next = (index + 1) % perimeter.length;
    faces.push([perimeter[index], bottom[index], bottom[next], perimeter[next]]);
  }
  faces.push([...bottom].reverse());
  const geometry = primitives.polyhedron({ points, faces, orientation: "outward" });
  return center ? transforms.translate([-(width - 1) / 2, -(height - 1) / 2, 0], geometry) : geometry;
}

function binary(operator: string, left: ScadValue, right: ScadValue): ScadValue {
  if (operator === "==" || operator === "!=") {
    const equal = deepEqual(left, right);
    return operator === "==" ? equal : !equal;
  }
  if (operator === "*" && Array.isArray(left) && Array.isArray(right)) {
    const leftMatrix = left.every(Array.isArray);
    const rightMatrix = right.every(Array.isArray);
    if (leftMatrix && rightMatrix) {
      const rows = left as ScadValue[][];
      const columns = right as ScadValue[][];
      const width = columns.reduce((maximum, row) => Math.max(maximum, row.length), 0);
      return rows.map((row) => Array.from({ length: width }, (_, column) => row.reduce<number>(
        (sum, value, index) => sum + num(value) * num(columns[index]?.[column] ?? null),
        0,
      )));
    }
    if (leftMatrix) {
      return (left as ScadValue[][]).map((row) => row.reduce<number>((sum, value, index) => sum + num(value) * num(right[index] ?? null), 0));
    }
    if (rightMatrix) {
      const matrix = right as ScadValue[][];
      const width = matrix.reduce((maximum, row) => Math.max(maximum, row.length), 0);
      return Array.from({ length: width }, (_, column) => left.reduce<number>((sum, value, index) => sum + num(value) * num(matrix[index]?.[column] ?? null), 0));
    }
    return left.reduce<number>((sum, value, index) => sum + num(value) * num(right[index] ?? null), 0);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    const lhs = Array.isArray(left) ? left : Array.from({ length: (right as ScadValue[]).length }, () => left);
    const rhs = Array.isArray(right) ? right : Array.from({ length: lhs.length }, () => right);
    return lhs.map((value, index) => binary(operator, value, rhs[index] ?? null));
  }
  switch (operator) {
    case "+": return typeof left === "string" || typeof right === "string" ? `${left ?? ""}${right ?? ""}` : num(left) + num(right);
    case "-": return num(left) - num(right);
    case "*": return num(left) * num(right);
    case "/": return num(left) / num(right);
    case "%": return num(left) % num(right);
    case "^": return num(left) ** num(right);
    case "<": return (left as number | string) < (right as number | string);
    case "<=": return (left as number | string) <= (right as number | string);
    case ">": return (left as number | string) > (right as number | string);
    case ">=": return (left as number | string) >= (right as number | string);
    case "&&": return bool(left) && bool(right);
    case "||": return bool(left) || bool(right);
    default: return null;
  }
}

function deepEqual(left: ScadValue, right: ScadValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  return left === right;
}

export function isGeom2(geometry: CadGeometry): geometry is Geom2 {
  return geometries.geom2.isA(geometry);
}

export function isGeom3(geometry: CadGeometry): geometry is Geom3 {
  return geometries.geom3.isA(geometry);
}

function unionAll(items: CadGeometry[]): CadGeometry[] {
  if (items.length <= 1) return items;
  const twoD = items.filter(isGeom2);
  const threeD = items.filter(isGeom3);
  const output: CadGeometry[] = [];
  if (twoD.length) output.push(booleans.union(twoD) as CadGeometry);
  if (threeD.length) output.push(booleans.union(threeD) as CadGeometry);
  return output;
}

export function evaluate(
  program: Program,
  overrides: Record<string, ParameterInput> = {},
  projectFiles: Record<string, string> = {},
): EvaluationResult {
  const messages: string[] = [];
  const warnings: string[] = [];
  const root = new Environment();
  root.set("$fn", 32);
  root.set("$fa", 12);
  root.set("$fs", 2);
  root.set("$t", 0);
  root.set("$preview", false);
  root.set("PI", Math.PI);
  for (const [name, value] of Object.entries(overrides)) root.set(name, value);
  const files = new Map(Object.entries(projectFiles).map(([name, content]) => [canonicalProjectPath(name), content]));

  let functionDepth = 0;

  function bindValues(bindings: Binding[], parent: Environment): Environment {
    const scope = new Environment(parent);
    for (const binding of bindings) scope.set(binding.name, evalExpression(binding.value, scope));
    return scope;
  }

  function evalComprehensionBody(expression: Expression, env: Environment): ScadValue[] {
    if (expression.type === "filter") {
      if (bool(evalExpression(expression.test, env))) return evalComprehensionBody(expression.consequent, env);
      return expression.alternate ? evalComprehensionBody(expression.alternate, env) : [];
    }
    if (expression.type === "each") {
      const value = evalExpression(expression.value, env);
      return Array.isArray(value) ? value : [value];
    }
    const value = evalExpression(expression, env);
    return [value];
  }

  function evalComprehension(bindings: Binding[], body: Expression, env: Environment, index = 0): ScadValue[] {
    if (index >= bindings.length) return evalComprehensionBody(body, env);
    const binding = bindings[index];
    const iterable = evalExpression(binding.value, env);
    if (!Array.isArray(iterable)) return [];
    return iterable.flatMap((value) => {
      const scope = new Environment(env);
      scope.set(binding.name, value);
      return evalComprehension(bindings, body, scope, index + 1);
    });
  }

  function evalExpression(expression: Expression, env: Environment): ScadValue {
    switch (expression.type) {
      case "literal": return expression.value;
      case "identifier": return env.get(expression.name);
      case "vector": return expression.items.flatMap((item) => {
        const value = evalExpression(item, env);
        return item.type === "each" && Array.isArray(value) ? value : [value];
      });
      case "range": {
        const start = num(evalExpression(expression.start, env));
        const end = num(evalExpression(expression.end, env));
        const step = expression.step ? num(evalExpression(expression.step, env), 1) : start <= end ? 1 : -1;
        if (step === 0) return [];
        const output: number[] = [];
        const direction = Math.sign(step);
        for (let value = start; direction > 0 ? value <= end + 1e-9 : value >= end - 1e-9; value += step) {
          output.push(value);
          if (output.length > 100_000) throw new Error("Range contains more than 100,000 values");
        }
        return output;
      }
      case "unary": {
        const value = evalExpression(expression.argument, env);
        if (expression.operator === "!") return !bool(value);
        if (Array.isArray(value)) return value.map((item) => expression.operator === "-" ? -num(item) : num(item));
        return expression.operator === "-" ? -num(value) : num(value);
      }
      case "binary": return binary(expression.operator, evalExpression(expression.left, env), evalExpression(expression.right, env));
      case "ternary": return evalExpression(bool(evalExpression(expression.test, env)) ? expression.consequent : expression.alternate, env);
      case "index": {
        const object = evalExpression(expression.object, env);
        const index = Math.trunc(num(evalExpression(expression.index, env)));
        return Array.isArray(object) ? object[index] ?? null : typeof object === "string" ? object[index] ?? null : null;
      }
      case "call": return evalFunction(expression.name, expression.args, env);
      case "assert-expression": {
        const args = evaluatedArguments(expression.args, env);
        if (!bool(args.positional[0] ?? args.named.get("condition") ?? false)) {
          const detail = args.positional[1] ?? args.named.get("message") ?? "Assertion failed";
          throw new Error(`Assertion failed at ${expression.loc.line}:${expression.loc.column}: ${String(detail)}`);
        }
        return evalExpression(expression.body, env);
      }
      case "echo-expression": {
        const args = evaluatedArguments(expression.args, env);
        messages.push(args.ordered.map(({ name, value }) => `${name ? `${name} = ` : ""}${typeof value === "string" ? value : JSON.stringify(value)}`).join(" "));
        return evalExpression(expression.body, env);
      }
      case "let": return evalExpression(expression.body, bindValues(expression.bindings, env));
      case "comprehension": return evalComprehension(expression.bindings, expression.body, env);
      case "filter": return bool(evalExpression(expression.test, env))
        ? evalExpression(expression.consequent, env)
        : expression.alternate ? evalExpression(expression.alternate, env) : null;
      case "each": return evalExpression(expression.value, env);
    }
  }

  function evalFunction(name: string, args: Argument[], env: Environment): ScadValue {
    const { positional: values, named } = evaluatedArguments(args, env);
    const first = values[0] ?? 0;
    const numbers = values.flatMap((value) => Array.isArray(value) ? value.map((item) => num(item)) : [num(value)]);
    switch (name) {
      case "abs": return Math.abs(num(first));
      case "sign": return Math.sign(num(first));
      case "sin": return Math.sin(deg(num(first)));
      case "cos": return Math.cos(deg(num(first)));
      case "tan": return Math.tan(deg(num(first)));
      case "asin": return Math.asin(num(first)) * 180 / Math.PI;
      case "acos": return Math.acos(num(first)) * 180 / Math.PI;
      case "atan": return Math.atan(num(first)) * 180 / Math.PI;
      case "atan2": return Math.atan2(num(first), num(values[1])) * 180 / Math.PI;
      case "floor": return Math.floor(num(first));
      case "ceil": return Math.ceil(num(first));
      case "round": return Math.round(num(first));
      case "sqrt": return Math.sqrt(num(first));
      case "exp": return Math.exp(num(first));
      case "ln": return Math.log(num(first));
      case "log": return Math.log10(num(first));
      case "pow": return num(first) ** num(values[1]);
      case "min": return Math.min(...numbers);
      case "max": return Math.max(...numbers);
      case "len": return Array.isArray(first) || typeof first === "string" ? first.length : 0;
      case "norm": return Math.hypot(...numbers);
      case "str": return values.map((value) => Array.isArray(value) ? `[${value.join(", ")}]` : String(value ?? "undef")).join("");
      case "concat": return values.flatMap((value) => Array.isArray(value) ? value : [value]);
      case "cross": {
        const a = vector(first, 3);
        const b = vector(values[1] ?? [], 3);
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      }
      case "is_undef": return first === null;
      case "is_bool": return typeof first === "boolean";
      case "is_num": return typeof first === "number";
      case "is_string": return typeof first === "string";
      case "is_list": return Array.isArray(first);
      case "chr": return String.fromCodePoint(...numbers);
      case "ord": return typeof first === "string" && first.length ? first.codePointAt(0) ?? null : null;
      case "sum": return numbers.reduce((sum, value) => sum + value, 0);
      case "product": return numbers.reduce((product, value) => product * value, 1);
      case "all": return Array.isArray(first) ? first.every(bool) : bool(first);
      case "any": return Array.isArray(first) ? first.some(bool) : bool(first);
      case "lookup": {
        const key = num(first);
        const table = Array.isArray(values[1]) ? values[1].filter(Array.isArray).map((pair) => vector(pair, 2)) : [];
        if (!table.length) return null;
        table.sort((a, b) => a[0] - b[0]);
        if (key <= table[0][0]) return table[0][1];
        if (key >= table[table.length - 1][0]) return table[table.length - 1][1];
        const upperIndex = table.findIndex((pair) => pair[0] >= key);
        const lower = table[upperIndex - 1];
        const upper = table[upperIndex];
        const ratio = (key - lower[0]) / (upper[0] - lower[0]);
        return lower[1] + (upper[1] - lower[1]) * ratio;
      }
      case "rands": {
        const minimum = num(first);
        const maximum = num(values[1]);
        const count = Math.min(100_000, Math.max(0, Math.trunc(num(values[2]))));
        const seedValue = values[3];
        let random = Math.random;
        if (typeof seedValue === "number" && Number.isFinite(seedValue)) {
          let seed = Math.trunc(seedValue) >>> 0;
          random = () => {
            seed = (seed + 0x6d2b79f5) >>> 0;
            let value = seed;
            value = Math.imul(value ^ value >>> 15, value | 1);
            value ^= value + Math.imul(value ^ value >>> 7, value | 61);
            return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
          };
        }
        return Array.from({ length: count }, () => minimum + random() * (maximum - minimum));
      }
      case "version": return [2026, 7, 16];
      case "version_num": return 20260716;
    }
    const definition = env.getFunction(name);
    if (!definition) {
      warnings.push(`Unknown function '${name}' returned undef`);
      return null;
    }
    if (functionDepth >= 256) throw new Error(`Maximum function recursion depth exceeded in '${name}'`);
    const callEnv = new Environment(env);
    definition.parameters.forEach((parameter, index) => {
      const value = named.get(parameter.name) ?? values[index] ?? (parameter.defaultValue ? evalExpression(parameter.defaultValue, callEnv) : null);
      callEnv.set(parameter.name, value);
    });
    functionDepth += 1;
    try {
      return evalExpression(definition.body, callEnv);
    } finally {
      functionDepth -= 1;
    }
  }

  function evaluatedArguments(args: Argument[], env: Environment) {
    const positional: ScadValue[] = [];
    const named = new Map<string, ScadValue>();
    const ordered: { name?: string; value: ScadValue }[] = [];
    for (const argument of args) {
      const value = evalExpression(argument.value, env);
      if (argument.name) named.set(argument.name, value);
      else positional.push(value);
      ordered.push({ name: argument.name, value });
    }
    const get = (name: string, position: number, fallback: ScadValue): ScadValue => named.get(name) ?? positional[position] ?? fallback;
    return { positional, named, ordered, get };
  }

  function evalBuiltin(statement: Extract<Statement, { type: "call" }>, env: Environment): CadGeometry[] | undefined {
    const { name } = statement;
    if (name === "let" || name === "assign") {
      const scope = new Environment(env);
      for (const argument of statement.args) {
        if (!argument.name) continue;
        scope.set(argument.name, evalExpression(argument.value, scope));
      }
      return evalStatements(statement.children, scope);
    }
    const { positional, named, ordered, get } = evaluatedArguments(statement.args, env);
    const segments = Math.max(3, Math.round(num(named.get("$fn") ?? env.get("$fn"), 32)));
    if (name === "echo") {
      messages.push(ordered.map(({ name: argumentName, value }) => `${argumentName ? `${argumentName} = ` : ""}${typeof value === "string" ? value : JSON.stringify(value)}`).join(" "));
      return [];
    }
    if (name === "assert") {
      if (!bool(positional[0] ?? named.get("condition") ?? false)) {
        const detail = positional[1] ?? named.get("message") ?? "Assertion failed";
        throw new Error(`Assertion failed at ${statement.loc.line}:${statement.loc.column}: ${String(detail)}`);
      }
      return evalStatements(statement.children, env);
    }
    if (name === "children") {
      const scope = env.childScope ?? env.parent?.childScope;
      if (!scope) return [];
      const selection = positional[0];
      if (selection === undefined) return evalStatements(scope.statements, scope.environment);
      const indexes = Array.isArray(selection) ? selection.map((value) => Math.trunc(num(value))) : [Math.trunc(num(selection))];
      return evalStatements(indexes.map((index) => scope.statements[index]).filter((child): child is Statement => Boolean(child)), scope.environment);
    }
    if (name === "import") {
      const rawFilename = get("file", 0, "");
      if (typeof rawFilename !== "string" || !rawFilename.trim()) throw new Error("import() requires a project-relative file name");
      const filename = canonicalProjectPath(rawFilename.trim());
      const content = files.get(filename);
      if (content === undefined) throw new Error(`Imported asset '${filename}' was not provided`);
      const extension = extensionOf(filename);
      if (!["stl", "obj", "svg", "dxf"].includes(extension)) {
        throw new Error(`Unsupported import format '.${extension || "unknown"}' for '${filename}'`);
      }
      if (extension === "dxf" && named.has("layer")) warnings.push("import(layer=…) is not yet supported; all DXF layers were imported");
      try {
        const asset = decodeProjectAsset(filename, content);
        const binary = asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength) as ArrayBuffer;
        const imported = extension === "stl"
          ? deserializeStl({ output: "geometry", filename }, content.startsWith("data:") ? binary : asset.text)
          : extension === "obj"
            ? deserializeObj({ output: "geometry", filename }, asset.text)
            : extension === "svg"
              ? deserializeSvg({ output: "geometry", filename }, asset.text)
              : deserializeDxf({ output: "geometry", filename, strict: false }, asset.text);
        const output: CadGeometry[] = [];
        for (const item of imported.flat(Infinity)) {
          if (geometries.geom2.isA(item) || geometries.geom3.isA(item)) output.push(item as CadGeometry);
          else if (geometries.path2.isA(item)) {
            if (item.isClosed) output.push(geometries.geom2.fromPoints(geometries.path2.toPoints(item)));
            else warnings.push(`Open path in '${filename}' was ignored because it does not enclose a 2D face`);
          }
        }
        if (!output.length) warnings.push(`Import '${filename}' did not contain usable closed 2D or 3D geometry`);
        return output;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not import '${filename}': ${detail}`);
      }
    }
    if (name === "surface") {
      const rawFilename = get("file", 0, "");
      if (typeof rawFilename !== "string" || !rawFilename.trim()) throw new Error("surface() requires a project-relative file name");
      const filename = canonicalProjectPath(rawFilename.trim());
      const content = files.get(filename);
      if (content === undefined) throw new Error(`Heightmap '${filename}' was not provided`);
      try {
        const asset = decodeProjectAsset(filename, content);
        const invert = bool(get("invert", 3, false));
        let rows = extensionOf(filename) === "png" ? parsePngHeightmap(asset.bytes, invert) : parseTextHeightmap(asset.text, filename);
        if (invert && extensionOf(filename) !== "png") rows = rows.map((row) => row.map((value) => -value));
        return [heightmapGeometry(rows, bool(get("center", 1, false)))];
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not create surface from '${filename}': ${detail}`);
      }
    }
    if (name === "cube") {
      const size = vector(get("size", 0, 1), 3, 1);
      const centered = bool(get("center", 1, false));
      return [primitives.cuboid({ size: size as [number, number, number], center: centered ? [0, 0, 0] : [size[0] / 2, size[1] / 2, size[2] / 2] })];
    }
    if (name === "sphere") {
      const radius = num(named.get("d") ?? get("r", 0, 1), 1) / (named.has("d") ? 2 : 1);
      return [primitives.sphere({ radius, segments })];
    }
    if (name === "cylinder") {
      const height = num(get("h", 0, 1), 1);
      const baseRadius = num(named.get("d1") ?? named.get("r1") ?? named.get("d") ?? named.get("r") ?? positional[1] ?? 1, 1) / (named.has("d1") || named.has("d") ? 2 : 1);
      const topRadius = num(named.get("d2") ?? named.get("r2") ?? named.get("d") ?? named.get("r") ?? positional[2] ?? baseRadius, baseRadius) / (named.has("d2") || named.has("d") ? 2 : 1);
      const centerZ = bool(get("center", 3, false)) ? 0 : height / 2;
      if (Math.abs(baseRadius - topRadius) < 1e-9) return [primitives.cylinder({ height, radius: baseRadius, segments, center: [0, 0, centerZ] })];
      return [primitives.cylinderElliptic({ height, startRadius: [baseRadius, baseRadius], endRadius: [topRadius, topRadius], segments, center: [0, 0, centerZ] })];
    }
    if (name === "square") {
      const size = vector(get("size", 0, 1), 2, 1);
      const centered = bool(get("center", 1, false));
      return [primitives.rectangle({ size: size as [number, number], center: centered ? [0, 0] : [size[0] / 2, size[1] / 2] })];
    }
    if (name === "circle") {
      const radius = num(named.get("d") ?? get("r", 0, 1), 1) / (named.has("d") ? 2 : 1);
      return [primitives.circle({ radius, segments })];
    }
    if (name === "text") {
      const input = String(get("text", 0, ""));
      const size = Math.max(0.01, num(get("size", 1, 10), 10));
      const font = get("font", 2, "");
      const horizontal = String(get("halign", 3, "left"));
      const vertical = String(get("valign", 4, "baseline"));
      const spacing = Math.max(0.01, num(get("spacing", 5, 1), 1));
      const direction = String(get("direction", 6, "ltr"));
      if (typeof font === "string" && font && !/simplex/i.test(font)) {
        warnings.push(`Font '${font}' is not bundled; text() used the built-in printable simplex font`);
      }
      const content = direction === "rtl" ? [...input].reverse().join("") : input;
      const strokes = modelingText.vectorText({ input: content, height: size, letterSpacing: spacing, align: "left" });
      const strokeWidth = Math.max(size / 11, 0.2);
      const glyphParts = strokes
        .filter((stroke) => stroke.length >= 2)
        .map((stroke) => expansions.expand({ delta: strokeWidth / 2, corners: "round", segments }, geometries.path2.fromPoints({ closed: false }, stroke)));
      if (!glyphParts.length) return [];
      let shape = booleans.union(glyphParts);
      const bounds = measurements.measureBoundingBox(shape) as [[number, number, number], [number, number, number]];
      const offsetX = horizontal === "center" ? -(bounds[0][0] + bounds[1][0]) / 2 : horizontal === "right" ? -bounds[1][0] : -bounds[0][0];
      const offsetY = vertical === "center" ? -(bounds[0][1] + bounds[1][1]) / 2
        : vertical === "top" ? -bounds[1][1]
          : vertical === "bottom" ? -bounds[0][1] : 0;
      shape = transforms.translate([offsetX, offsetY, 0], shape);
      return [shape];
    }
    if (name === "polygon") {
      const rawPoints = get("points", 0, []);
      const points = Array.isArray(rawPoints) ? rawPoints.map((point) => vector(point, 2) as [number, number]) : [];
      // OpenSCAD accepts either winding for a simple polygon. JSCAD requires an
      // outer contour to be counter-clockwise or subsequent extrusions become
      // inside-out and can corrupt boolean operations.
      const normalizedPoints = signedArea2d(points) < 0 ? [...points].reverse() : points;
      return [primitives.polygon({ points: normalizedPoints })];
    }
    if (name === "polyhedron") {
      const rawPoints = get("points", 0, []);
      const rawFaces = named.get("faces") ?? named.get("triangles") ?? positional[1] ?? [];
      const points = Array.isArray(rawPoints) ? rawPoints.map((point) => vector(point, 3) as [number, number, number]) : [];
      const faces = Array.isArray(rawFaces) ? rawFaces.map((face) => Array.isArray(face) ? face.map((index) => num(index)) : []) : [];
      return [primitives.polyhedron({ points, faces, orientation: "outward" })];
    }
    if (name === "torus") {
      return [primitives.torus({ innerRadius: num(get("r1", 0, 1)), outerRadius: num(get("r2", 1, 4)), innerSegments: segments, outerSegments: segments })];
    }

    if (name === "intersection_for") {
      const bindings = statement.args.filter((argument): argument is Argument & { name: string } => Boolean(argument.name));
      const iterate = (index: number, scope: Environment): CadGeometry[] => {
        if (index >= bindings.length) return evalStatements(statement.children, scope);
        const binding = bindings[index];
        const iterable = evalExpression(binding.value, scope);
        if (!Array.isArray(iterable)) return [];
        return iterable.flatMap((value) => {
          const next = new Environment(scope);
          next.set(binding.name, value);
          return iterate(index + 1, next);
        });
      };
      const generated = iterate(0, env);
      if (!generated.length) return [];
      if (isGeom2(generated[0])) return [booleans.intersect(generated.filter(isGeom2))];
      return [booleans.intersect(generated.filter(isGeom3))];
    }

    const children = evalStatements(statement.children, env);
    if (["union", "difference", "intersection", "hull", "minkowski"].includes(name)) {
      if (!children.length) return [];
      if (name === "union") return unionAll(children);
      if (isGeom2(children[0])) {
        const matching = children.filter(isGeom2);
        if (name === "difference") return [booleans.subtract(matching[0], ...matching.slice(1))];
        if (name === "intersection") return [booleans.intersect(matching)];
        if (name === "hull") return [hulls.hull(matching)];
        warnings.push("minkowski() currently requires 3D children");
        return [];
      }
      const matching = children.filter(isGeom3);
      if (name === "difference") return [booleans.subtract(matching[0], ...matching.slice(1))];
      if (name === "intersection") return [booleans.intersect(matching)];
      if (name === "minkowski") return [booleans.minkowski(...matching)];
      return [hulls.hull(matching)];
    }
    if (name === "translate") {
      const offset = vector(get("v", 0, [0, 0, 0]), 3) as [number, number, number];
      return children.map((child) => transforms.translate(offset, child) as CadGeometry);
    }
    if (name === "scale") {
      const factors = vector(get("v", 0, [1, 1, 1]), 3, 1) as [number, number, number];
      return children.map((child) => transforms.scale(factors, child) as CadGeometry);
    }
    if (name === "rotate") {
      const rawAngle = get("a", 0, [0, 0, 0]);
      const axis = named.get("v");
      if (!Array.isArray(rawAngle) && axis !== undefined) {
        const matrix = maths.mat4.fromRotation(maths.mat4.create(), deg(num(rawAngle)), vector(axis, 3) as [number, number, number]);
        return children.map((child) => transforms.transform(matrix, child) as CadGeometry);
      }
      const angles = (Array.isArray(rawAngle) ? vector(rawAngle, 3) : [0, 0, num(rawAngle)]).map(deg) as [number, number, number];
      return children.map((child) => transforms.rotate(angles, child) as CadGeometry);
    }
    if (name === "mirror") {
      const normal = vector(get("v", 0, [1, 0, 0]), 3) as [number, number, number];
      return children.map((child) => transforms.mirror({ normal }, child) as CadGeometry);
    }
    if (name === "color") {
      const raw = get("c", 0, [0.18, 0.75, 0.66, 1]);
      let rgba: number[];
      if (typeof raw === "string") rgba = colors.colorNameToRgb(raw) ?? [0.18, 0.75, 0.66];
      else rgba = vector(raw, 4, 1);
      rgba[3] = num(get("alpha", 1, rgba[3] ?? 1), 1);
      return children.map((child) => colors.colorize(rgba as [number, number, number, number], child) as CadGeometry);
    }
    if (name === "multmatrix") {
      const raw = get("m", 0, []);
      const rows = Array.isArray(raw) ? raw.map((row) => vector(row, 4)) : [];
      while (rows.length < 4) rows.push(rows.length === 3 ? [0, 0, 0, 1] : [0, 0, 0, 0]);
      const matrix = maths.mat4.fromValues(
        rows[0][0], rows[1][0], rows[2][0], rows[3][0],
        rows[0][1], rows[1][1], rows[2][1], rows[3][1],
        rows[0][2], rows[1][2], rows[2][2], rows[3][2],
        rows[0][3], rows[1][3], rows[2][3], rows[3][3],
      );
      return children.map((child) => transforms.transform(matrix, child) as CadGeometry);
    }
    if (name === "resize") {
      const requested = vector(get("newsize", 0, [0, 0, 0]), 3);
      const auto = get("auto", 1, false);
      return children.map((child) => {
        const bounds = measurements.measureBoundingBox(child) as [[number, number, number], [number, number, number]];
        const current = bounds[1].map((value, index) => value - bounds[0][index]);
        let factors = requested.map((value, index) => value > 0 && current[index] > 0 ? value / current[index] : 1);
        if (bool(auto) || Array.isArray(auto)) {
          const autoAxes = Array.isArray(auto) ? vector(auto, 3).map(Boolean) : [true, true, true];
          const reference = factors.find((factor, index) => requested[index] > 0 && !autoAxes[index])
            ?? factors.find((factor, index) => requested[index] > 0)
            ?? 1;
          factors = factors.map((factor, index) => autoAxes[index] && requested[index] === 0 ? reference : factor);
        }
        return transforms.scale(factors as [number, number, number], child) as CadGeometry;
      });
    }
    if (name === "offset") {
      const delta = num(named.get("delta") ?? positional[0] ?? 1, 1);
      const radius = named.get("r");
      const chamfer = bool(named.get("chamfer") ?? false);
      const effectiveDelta = radius !== undefined ? num(radius) : delta;
      const corners = radius !== undefined ? "round" : chamfer ? "chamfer" : "edge";
      return children.filter(isGeom2).map((child) => expansions.offset({ delta: effectiveDelta, corners, segments }, child));
    }
    if (name === "projection") {
      if (bool(get("cut", 0, false))) warnings.push("projection(cut=true) currently uses full orthographic projection");
      return children.filter(isGeom3).map((child) => extrusions.project({ axis: [0, 0, 1], origin: [0, 0, 0] }, child));
    }
    if (name === "linear_extrude") {
      const height = num(get("height", 0, 1), 1);
      const twist = deg(num(get("twist", 3, 0)));
      const slices = Math.max(1, Math.round(num(get("slices", 4, segments), segments)));
      return children.filter(isGeom2).map((child) => {
        const solid = extrusions.extrudeLinear({ height, twistAngle: twist, twistSteps: slices }, child as ReturnType<typeof primitives.square>);
        return bool(get("center", 1, false)) ? transforms.translateZ(-height / 2, solid) : solid;
      });
    }
    if (name === "rotate_extrude") {
      const angle = deg(num(get("angle", 0, 360), 360));
      return children.filter(isGeom2).map((child) => extrusions.extrudeRotate({ angle, segments }, child as ReturnType<typeof primitives.square>));
    }
    if (name === "roof") {
      const shapes = children.filter(isGeom2);
      if (!shapes.length) return [];
      const requestedMethod = String(get("method", 0, "voronoi"));
      const method = requestedMethod === "straight" || requestedMethod === "voronoi" ? requestedMethod : "voronoi";
      if (requestedMethod !== method) warnings.push(`Unknown roof method '${requestedMethod}'; using 'voronoi'.`);
      if (method === "voronoi") {
        warnings.push("roof(method=\"voronoi\") currently uses straight-skeleton topology; convex outlines match OpenSCAD, while concave corner rounding can differ.");
      }
      const shape = shapes.length === 1 ? shapes[0] : booleans.union(shapes);
      try {
        return [buildStraightRoof(shape)];
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not create roof: ${detail}`);
      }
    }
    if (name === "render") return children;
    return undefined;
  }

  function evalCall(statement: Extract<Statement, { type: "call" }>, env: Environment): CadGeometry[] {
    if (statement.modifier === "*" || statement.modifier === "%") return [];
    const builtin = evalBuiltin(statement, env);
    if (builtin) return builtin;
    const definition = env.getModule(statement.name);
    if (!definition) {
      warnings.push(`Unknown module '${statement.name}' at ${statement.loc.line}:${statement.loc.column}`);
      return [];
    }
    const callEnv = new Environment(env);
    const args = evaluatedArguments(statement.args, env);
    definition.parameters.forEach((parameter, index) => {
      const value = args.named.get(parameter.name) ?? args.positional[index] ?? (parameter.defaultValue ? evalExpression(parameter.defaultValue, callEnv) : null);
      callEnv.set(parameter.name, value);
    });
    callEnv.childScope = { statements: statement.children, environment: env };
    return evalStatements(definition.body, callEnv);
  }

  function evalStatement(statement: Statement, env: Environment): CadGeometry[] {
    switch (statement.type) {
      case "noop":
      case "module":
      case "function": return [];
      case "assignment": {
        const overridden = env === root && Object.prototype.hasOwnProperty.call(overrides, statement.name);
        env.set(statement.name, overridden ? overrides[statement.name] : evalExpression(statement.value, env));
        return [];
      }
      case "call": return evalCall(statement, env);
      case "block": return evalStatements(statement.body, new Environment(env));
      case "if": return evalStatements(bool(evalExpression(statement.test, env)) ? statement.consequent : statement.alternate, new Environment(env));
      case "for": {
        const loop = (bindingIndex: number, scope: Environment): CadGeometry[] => {
          if (bindingIndex >= statement.bindings.length) return evalStatements(statement.body, scope);
          const binding = statement.bindings[bindingIndex];
          const iterable = evalExpression(binding.value, scope);
          if (!Array.isArray(iterable)) return [];
          return iterable.flatMap((value) => {
            const loopEnv = new Environment(scope);
            loopEnv.set(binding.name, value);
            return loop(bindingIndex + 1, loopEnv);
          });
        };
        return loop(0, env);
      }
    }
  }

  function evalStatements(statements: Statement[], env: Environment): CadGeometry[] {
    for (const statement of statements) {
      if (statement.type === "module") env.modules.set(statement.name, { parameters: statement.parameters, body: statement.body });
      if (statement.type === "function") env.functions.set(statement.name, { parameters: statement.parameters, body: statement.body });
    }
    for (const statement of statements) {
      if (statement.type === "assignment") evalStatement(statement, env);
    }
    return statements.flatMap((statement) => statement.type === "assignment" ? [] : evalStatement(statement, env));
  }

  return { geometries: evalStatements(program.body, root), messages, warnings };
}

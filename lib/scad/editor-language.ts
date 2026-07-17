import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { StreamLanguage, type StreamParser } from "@codemirror/language";

const KEYWORDS = new Set([
  "assert", "assign", "each", "echo", "else", "for", "function", "if", "include", "let", "module", "use",
]);
const ATOMS = new Set(["false", "true", "undef"]);
const BUILTIN_MODULES = new Set([
  "assert", "assign", "children", "circle", "color", "cube", "cylinder", "difference", "echo", "hull", "import",
  "intersection", "intersection_for", "let", "linear_extrude", "minkowski", "mirror", "multmatrix", "offset", "polygon",
  "polyhedron", "projection", "render", "resize", "roof", "rotate", "rotate_extrude", "scale", "sphere", "square",
  "surface", "text", "torus", "translate", "union",
]);
const BUILTIN_FUNCTIONS = new Set([
  "abs", "acos", "all", "any", "asin", "atan", "atan2", "ceil", "chr", "concat", "cos", "cross", "exp", "floor",
  "is_bool", "is_list", "is_num", "is_string", "is_undef", "len", "ln", "log", "lookup", "max", "min", "norm", "ord",
  "pow", "product", "rands", "round", "sign", "sin", "sqrt", "str", "sum", "tan", "version", "version_num",
]);
const SPECIAL_VARIABLES = new Set(["$fa", "$fn", "$fs", "$preview", "$t"]);

interface OpenScadState {
  blockComment: boolean;
  definitionPending: boolean;
  pathPending: boolean;
  depth: number;
  indentUnit: number;
}

function finishBlockComment(stream: Parameters<StreamParser<OpenScadState>["token"]>[0], state: OpenScadState) {
  let previous = "";
  while (!stream.eol()) {
    const character = stream.next();
    if (previous === "*" && character === "/") {
      state.blockComment = false;
      break;
    }
    previous = character ?? "";
  }
  return "blockComment";
}

const openScadParser: StreamParser<OpenScadState> = {
  name: "OpenSCAD",
  startState: (indentUnit) => ({
    blockComment: false,
    definitionPending: false,
    pathPending: false,
    depth: 0,
    indentUnit,
  }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (state.blockComment) return finishBlockComment(stream, state);
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "lineComment";
    }
    if (stream.match("/*")) {
      state.blockComment = true;
      return finishBlockComment(stream, state);
    }
    if (state.pathPending && stream.peek() === "<") {
      state.pathPending = false;
      stream.next();
      while (!stream.eol() && stream.next() !== ">") { /* Consume the project path. */ }
      return "string";
    }
    if (stream.peek() === '"') {
      stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const character = stream.next();
        if (character === '"' && !escaped) break;
        escaped = character === "\\" && !escaped;
        if (character !== "\\") escaped = false;
      }
      return "string";
    }
    if (stream.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)) {
      const word = stream.current();
      if (state.definitionPending) {
        state.definitionPending = false;
        return "variableName.definition";
      }
      if (word === "module" || word === "function") state.definitionPending = true;
      if (word === "include" || word === "use") state.pathPending = true;
      if (KEYWORDS.has(word)) return "keyword";
      if (ATOMS.has(word)) return word === "undef" ? "null" : "bool";
      if (SPECIAL_VARIABLES.has(word)) return "variableName.special";
      if (word === "PI") return "variableName.constant";
      if (BUILTIN_MODULES.has(word) || BUILTIN_FUNCTIONS.has(word)) return "variableName.standard";
      if (stream.match(/^\s*(?=\()/, false)) return "variableName.function";
      return "variableName";
    }
    const character = stream.next() ?? "";
    if ("([{".includes(character)) state.depth += 1;
    if (")]}".includes(character)) state.depth = Math.max(0, state.depth - 1);
    if ("=+-*/%^!<>?:&|#".includes(character)) {
      stream.eatWhile(/[=+\-*/%^!<>?:&|]/);
      return "operator";
    }
    return "punctuation";
  },
  indent(state, textAfter) {
    const closesScope = /^\s*[}\])]/.test(textAfter);
    return Math.max(0, state.depth - (closesScope ? 1 : 0)) * state.indentUnit;
  },
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", "\""] },
    indentOnInput: /^\s*[}\])];?$/,
  },
};

export const openScadLanguage = StreamLanguage.define(openScadParser);

const completion = (label: string, detail: string, type: Completion["type"] = "function"): Completion => ({
  label,
  detail,
  type,
});

const STATIC_COMPLETIONS: readonly Completion[] = [
  completion("module", "module name(parameters) { … }", "keyword"),
  completion("function", "function name(parameters) = expression;", "keyword"),
  completion("if", "conditional", "keyword"),
  completion("else", "conditional branch", "keyword"),
  completion("for", "iteration", "keyword"),
  completion("let", "local bindings", "keyword"),
  completion("each", "flatten a comprehension", "keyword"),
  completion("include", "include a project library", "keyword"),
  completion("use", "use a project library", "keyword"),
  completion("true", "boolean", "constant"),
  completion("false", "boolean", "constant"),
  completion("undef", "undefined value", "constant"),
  completion("PI", "π", "constant"),
  completion("$fn", "fragment count", "variable"),
  completion("$fa", "minimum fragment angle", "variable"),
  completion("$fs", "minimum fragment size", "variable"),
  completion("$t", "animation time", "variable"),
  completion("$preview", "preview mode", "variable"),
  completion("cube", "(size, center = false)"),
  completion("sphere", "(r | d)"),
  completion("cylinder", "(h, r | d, r1, r2, center = false)"),
  completion("polyhedron", "(points, faces)"),
  completion("torus", "(r1, r2)"),
  completion("square", "(size, center = false)"),
  completion("circle", "(r | d)"),
  completion("polygon", "(points)"),
  completion("text", "(text, size, font, halign, valign, spacing)"),
  completion("translate", "(v) { … }"),
  completion("rotate", "(a, v) { … }"),
  completion("scale", "(v) { … }"),
  completion("mirror", "(v) { … }"),
  completion("resize", "(newsize, auto = false) { … }"),
  completion("multmatrix", "(m) { … }"),
  completion("color", "(c, alpha) { … }"),
  completion("union", "() { … }"),
  completion("difference", "() { … }"),
  completion("intersection", "() { … }"),
  completion("hull", "() { … }"),
  completion("minkowski", "() { … }"),
  completion("offset", "(r | delta, chamfer = false) { … }"),
  completion("projection", "(cut = false) { … }"),
  completion("linear_extrude", "(height, center, twist, slices) { … }"),
  completion("rotate_extrude", "(angle = 360) { … }"),
  completion("roof", "(method) { … }"),
  completion("import", "(file)"),
  completion("surface", "(file, center, invert)"),
  completion("children", "(index)"),
  completion("render", "() { … }"),
  completion("echo", "(values)"),
  completion("assert", "(condition, message)"),
  ...[...BUILTIN_FUNCTIONS].sort().map((name) => completion(name, "built-in function")),
];

function documentCompletions(sources: readonly string[]): Completion[] {
  const output = new Map<string, Completion>();
  for (const source of sources) {
    for (const match of source.matchAll(/\b(module|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/g)) {
      const [, kind, label, parameters] = match;
      output.set(label, completion(label, `${kind}(${parameters.trim()})`));
    }
    for (const match of source.matchAll(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=/gm)) {
      const label = match[1];
      if (!output.has(label)) output.set(label, completion(label, "variable", "variable"));
    }
  }
  return [...output.values()];
}

export interface OpenScadCompletionOptions {
  sources?: readonly string[];
  files?: readonly string[];
}

export function openScadCompletionSource(
  context: CompletionContext,
  { sources = [], files = [] }: OpenScadCompletionOptions = {},
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);
  const projectPath = /\b(?:include|use)\s*<([^>\n]*)$/.exec(beforeCursor);
  if (projectPath) {
    return {
      from: context.pos - projectPath[1].length,
      options: files.filter((file) => file.endsWith(".scad")).map((file) => completion(file, "project library", "text")),
      validFor: /^[^>\n]*$/,
    };
  }
  const assetPath = /\b(?:import|surface)\s*\(\s*(?:file\s*=\s*)?"([^"\n]*)$/.exec(beforeCursor);
  if (assetPath) {
    return {
      from: context.pos - assetPath[1].length,
      options: files.filter((file) => !file.endsWith(".scad")).map((file) => completion(file, "project asset", "text")),
      validFor: /^[^"\n]*$/,
    };
  }

  const word = context.matchBefore(/[A-Za-z0-9_$]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  if (/\/\/[^\n]*$/.test(beforeCursor) || (beforeCursor.match(/"/g)?.length ?? 0) % 2 === 1) return null;
  return {
    from: word.from,
    options: [...documentCompletions([context.state.doc.toString(), ...sources]), ...STATIC_COMPLETIONS],
    validFor: /^[A-Za-z0-9_$]*$/,
  };
}

import type { Location } from "./ast";

export type TokenKind = "number" | "string" | "identifier" | "symbol" | "eof";

export interface Token {
  kind: TokenKind;
  value: string;
  loc: Location;
}

export class ScadSyntaxError extends Error {
  constructor(message: string, public readonly loc: Location) {
    super(`${message} (${loc.line}:${loc.column})`);
    this.name = "ScadSyntaxError";
  }
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const loc = (): Location => ({ line, column });
  const advance = () => {
    const char = source[index++];
    if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return char;
  };

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      advance();
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && advance() !== "\n") {
        // Skip line comment.
      }
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const start = loc();
      advance();
      advance();
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) advance();
      if (index >= source.length) throw new ScadSyntaxError("Unterminated block comment", start);
      advance();
      advance();
      continue;
    }

    const start = loc();
    if (/[A-Za-z_$]/.test(char)) {
      let value = "";
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) value += advance();
      tokens.push({ kind: "identifier", value, loc: start });
      continue;
    }
    if (/\d/.test(char) || (char === "." && /\d/.test(source[index + 1] ?? ""))) {
      let value = "";
      while (index < source.length && /[0-9.]/.test(source[index])) value += advance();
      if (/[eE]/.test(source[index] ?? "")) {
        value += advance();
        if (/[+-]/.test(source[index] ?? "")) value += advance();
        while (index < source.length && /\d/.test(source[index])) value += advance();
      }
      if (!Number.isFinite(Number(value))) throw new ScadSyntaxError(`Invalid number '${value}'`, start);
      tokens.push({ kind: "number", value, loc: start });
      continue;
    }
    if (char === '"') {
      advance();
      let value = "";
      while (index < source.length && source[index] !== '"') {
        if (source[index] === "\\") {
          advance();
          const escaped = advance();
          value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
        } else value += advance();
      }
      if (source[index] !== '"') throw new ScadSyntaxError("Unterminated string", start);
      advance();
      tokens.push({ kind: "string", value, loc: start });
      continue;
    }

    const pair = source.slice(index, index + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(pair)) {
      advance();
      advance();
      tokens.push({ kind: "symbol", value: pair, loc: start });
      continue;
    }
    if ("{}()[];,:?=+-*/%^!<>#%&|".includes(char)) {
      tokens.push({ kind: "symbol", value: advance(), loc: start });
      continue;
    }
    throw new ScadSyntaxError(`Unexpected character '${char}'`, start);
  }
  tokens.push({ kind: "eof", value: "", loc: loc() });
  return tokens;
}

import type { Argument, Binding, Expression, ModuleParameter, Program, Statement } from "./ast";
import { ScadSyntaxError, tokenize } from "./lexer";

const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  "^": 7,
};

export function parse(source: string): Program {
  const tokens = tokenize(source);
  let current = 0;
  const peek = (offset = 0) => tokens[Math.min(current + offset, tokens.length - 1)];
  const take = () => tokens[current++];
  const match = (value: string) => {
    if (peek().value !== value) return false;
    current += 1;
    return true;
  };
  const expect = (value: string) => {
    const token = take();
    if (token.value !== value) throw new ScadSyntaxError(`Expected '${value}', found '${token.value || "end of input"}'`, token.loc);
    return token;
  };
  const expectIdentifier = () => {
    const token = take();
    if (token.kind !== "identifier") throw new ScadSyntaxError("Expected an identifier", token.loc);
    return token;
  };

  function parseArguments(): Argument[] {
    const args: Argument[] = [];
    expect("(");
    if (match(")")) return args;
    while (true) {
      if (peek().kind === "identifier" && peek(1).value === "=") {
        const name = take().value;
        take();
        args.push({ name, value: parseExpression() });
      } else args.push({ value: parseExpression() });
      if (match(")")) break;
      expect(",");
      if (match(")")) break;
    }
    return args;
  }

  function parseBindings(): Binding[] {
    const bindings: Binding[] = [];
    expect("(");
    if (match(")")) return bindings;
    while (true) {
      const name = expectIdentifier();
      expect("=");
      bindings.push({ name: name.value, value: parseExpression() });
      if (match(")")) break;
      expect(",");
    }
    return bindings;
  }

  function parseParameters(): ModuleParameter[] {
    const parameters: ModuleParameter[] = [];
    expect("(");
    if (match(")")) return parameters;
    while (true) {
      const parameter = expectIdentifier();
      parameters.push({ name: parameter.value, defaultValue: match("=") ? parseExpression() : undefined });
      if (match(")")) break;
      expect(",");
    }
    return parameters;
  }

  function parseComprehension(loc: { line: number; column: number }): Expression {
    return { type: "comprehension", bindings: parseBindings(), body: parseExpression(), loc };
  }

  function parseFilter(loc: { line: number; column: number }): Expression {
    expect("(");
    const test = parseExpression();
    expect(")");
    const consequent = parseExpression();
    const alternate = match("else") ? parseExpression() : undefined;
    return { type: "filter", test, consequent, alternate, loc };
  }

  function parsePrimary(): Expression {
    const token = take();
    if (token.kind === "number") return { type: "literal", value: Number(token.value), loc: token.loc };
    if (token.kind === "string") return { type: "literal", value: token.value, loc: token.loc };
    if (token.kind === "identifier") {
      if (["true", "false", "undef"].includes(token.value)) {
        return { type: "literal", value: token.value === "true" ? true : token.value === "false" ? false : null, loc: token.loc };
      }
      if (token.value === "let" && peek().value === "(") {
        return { type: "let", bindings: parseBindings(), body: parseExpression(), loc: token.loc };
      }
      if (token.value === "assert" && peek().value === "(") {
        return { type: "assert-expression", args: parseArguments(), body: parseExpression(), loc: token.loc };
      }
      if (token.value === "echo" && peek().value === "(") {
        return { type: "echo-expression", args: parseArguments(), body: parseExpression(), loc: token.loc };
      }
      if (token.value === "for" && peek().value === "(") return parseComprehension(token.loc);
      if (token.value === "if" && peek().value === "(") return parseFilter(token.loc);
      if (token.value === "each") return { type: "each", value: parseExpression(8), loc: token.loc };
      let expression: Expression = peek().value === "("
        ? { type: "call", name: token.value, args: parseArguments(), loc: token.loc }
        : { type: "identifier", name: token.value, loc: token.loc };
      while (match("[")) {
        const index = parseExpression();
        expect("]");
        expression = { type: "index", object: expression, index, loc: token.loc };
      }
      return expression;
    }
    if (token.value === "(") {
      const expression = parseExpression();
      expect(")");
      return expression;
    }
    if (token.value === "[") {
      if (match("]")) return { type: "vector", items: [], loc: token.loc };
      if (match("for")) {
        const comprehension = parseComprehension(token.loc);
        expect("]");
        return comprehension;
      }
      if (match("if")) {
        const filter = parseFilter(token.loc);
        expect("]");
        return filter;
      }
      const first = parseExpression();
      if (match(":")) {
        const second = parseExpression();
        if (match(":")) {
          const end = parseExpression();
          expect("]");
          return { type: "range", start: first, step: second, end, loc: token.loc };
        }
        expect("]");
        return { type: "range", start: first, end: second, loc: token.loc };
      }
      const items = [first];
      while (match(",")) {
        if (match("]")) return { type: "vector", items, loc: token.loc };
        items.push(parseExpression());
      }
      expect("]");
      return { type: "vector", items, loc: token.loc };
    }
    if (["-", "+", "!"].includes(token.value)) {
      return { type: "unary", operator: token.value, argument: parseExpression(8), loc: token.loc };
    }
    throw new ScadSyntaxError(`Expected an expression, found '${token.value || "end of input"}'`, token.loc);
  }

  function parseExpression(minPrecedence = 0): Expression {
    let left = parsePrimary();
    while ((PRECEDENCE[peek().value] ?? -1) >= minPrecedence) {
      const operator = take();
      const precedence = PRECEDENCE[operator.value];
      const right = parseExpression(precedence + (operator.value === "^" ? 0 : 1));
      left = { type: "binary", operator: operator.value, left, right, loc: operator.loc };
    }
    if (minPrecedence === 0 && match("?")) {
      const consequent = parseExpression();
      expect(":");
      const alternate = parseExpression();
      left = { type: "ternary", test: left, consequent, alternate, loc: left.loc };
    }
    return left;
  }

  function parseBody(): Statement[] {
    if (match("{")) {
      const body: Statement[] = [];
      while (!match("}")) {
        if (peek().kind === "eof") throw new ScadSyntaxError("Unterminated block", peek().loc);
        body.push(parseStatement());
      }
      return body;
    }
    return [parseStatement()];
  }

  function parseStatement(): Statement {
    if (match(";")) return { type: "noop", loc: peek(-1).loc };
    const modifier = ["#", "%", "!", "*"].includes(peek().value) ? take().value : undefined;
    const start = peek().loc;
    if (match("module")) {
      const name = expectIdentifier().value;
      const parameters = parseParameters();
      return { type: "module", name, parameters, body: parseBody(), loc: start };
    }
    if (match("function")) {
      const name = expectIdentifier().value;
      const parameters = parseParameters();
      expect("=");
      const body = parseExpression();
      expect(";");
      return { type: "function", name, parameters, body, loc: start };
    }
    if (match("if")) {
      expect("(");
      const test = parseExpression();
      expect(")");
      const consequent = parseBody();
      const alternate = match("else") ? parseBody() : [];
      return { type: "if", test, consequent, alternate, loc: start };
    }
    if (match("for")) {
      return { type: "for", bindings: parseBindings(), body: parseBody(), loc: start };
    }
    if (match("{")) {
      current -= 1;
      return { type: "block", body: parseBody(), loc: start };
    }
    const name = expectIdentifier();
    if (match("=")) {
      const value = parseExpression();
      expect(";");
      return { type: "assignment", name: name.value, value, loc: start };
    }
    if (peek().value !== "(") throw new ScadSyntaxError(`Expected assignment or module call after '${name.value}'`, peek().loc);
    const args = parseArguments();
    const children = match(";") ? [] : parseBody();
    return { type: "call", name: name.value, args, children, modifier, loc: start };
  }

  const body: Statement[] = [];
  while (peek().kind !== "eof") body.push(parseStatement());
  return { type: "program", body };
}

export interface Location {
  line: number;
  column: number;
}

export type LiteralValue = number | string | boolean | null;

export type Expression =
  | { type: "literal"; value: LiteralValue; loc: Location }
  | { type: "identifier"; name: string; loc: Location }
  | { type: "vector"; items: Expression[]; loc: Location }
  | { type: "range"; start: Expression; step?: Expression; end: Expression; loc: Location }
  | { type: "unary"; operator: string; argument: Expression; loc: Location }
  | { type: "binary"; operator: string; left: Expression; right: Expression; loc: Location }
  | { type: "ternary"; test: Expression; consequent: Expression; alternate: Expression; loc: Location }
  | { type: "call"; name: string; args: Argument[]; loc: Location }
  | { type: "assert-expression"; args: Argument[]; body: Expression; loc: Location }
  | { type: "echo-expression"; args: Argument[]; body: Expression; loc: Location }
  | { type: "index"; object: Expression; index: Expression; loc: Location }
  | { type: "let"; bindings: Binding[]; body: Expression; loc: Location }
  | { type: "comprehension"; bindings: Binding[]; body: Expression; loc: Location }
  | { type: "filter"; test: Expression; consequent: Expression; alternate?: Expression; loc: Location }
  | { type: "each"; value: Expression; loc: Location };

export interface Argument {
  name?: string;
  value: Expression;
}

export interface ModuleParameter {
  name: string;
  defaultValue?: Expression;
}

export interface Binding {
  name: string;
  value: Expression;
}

export type Statement =
  | { type: "assignment"; name: string; value: Expression; loc: Location }
  | { type: "call"; name: string; args: Argument[]; children: Statement[]; modifier?: string; loc: Location }
  | { type: "module"; name: string; parameters: ModuleParameter[]; body: Statement[]; loc: Location }
  | { type: "function"; name: string; parameters: ModuleParameter[]; body: Expression; loc: Location }
  | { type: "if"; test: Expression; consequent: Statement[]; alternate: Statement[]; loc: Location }
  | { type: "for"; bindings: Binding[]; body: Statement[]; loc: Location }
  | { type: "block"; body: Statement[]; loc: Location }
  | { type: "noop"; loc: Location };

export interface Program {
  type: "program";
  body: Statement[];
}

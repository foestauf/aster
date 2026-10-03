import type { Span } from '../diagnostics/source.js';

/** A type as written: a name (`int`, `Point`), optionally applied to type arguments (`Option[int]`), or an array (`[T]`). */
export type TypeExpr =
  | { kind: 'named'; name: string; args: TypeExpr[]; span: Span }
  | { kind: 'array'; elem: TypeExpr; span: Span };

export interface Program {
  functions: FnDecl[];
  structs: StructDecl[];
  enums: EnumDecl[];
}

export interface FieldDecl {
  name: string;
  nameSpan: Span;
  type: TypeExpr;
}

export interface StructDecl {
  kind: 'struct';
  name: string;
  nameSpan: Span;
  fields: FieldDecl[];
  span: Span;
}

export interface VariantDecl {
  name: string;
  nameSpan: Span;
  /** Payload slot types in order; empty for a unit variant. */
  payload: TypeExpr[];
}

export interface EnumDecl {
  kind: 'enum';
  name: string;
  nameSpan: Span;
  typeParams: { name: string; nameSpan: Span }[];
  variants: VariantDecl[];
  span: Span;
}

export interface Param {
  name: string;
  nameSpan: Span;
  type: TypeExpr;
}

export interface FnDecl {
  kind: 'fn';
  name: string;
  nameSpan: Span;
  params: Param[];
  /** null means the function returns void. */
  returnType: TypeExpr | null;
  body: Block;
  span: Span;
}

export interface Block {
  kind: 'block';
  statements: Stmt[];
  span: Span;
}

export interface LetStmt {
  kind: 'let';
  /** true for `var`, false for `let`. */
  mutable: boolean;
  name: string;
  nameSpan: Span;
  type: TypeExpr;
  init: Expr;
  span: Span;
}

export type CompoundOp = '+=' | '-=' | '*=' | '/=' | '%=';
export type AssignOp = '=' | CompoundOp;

/** The binary operator a compound assignment applies, e.g. `+` for `+=`. */
export const binaryOpOf = (op: CompoundOp): BinaryOp => op.slice(0, -1) as BinaryOp;

/** `target op value;`. The checker rejects targets that are not places (a name, `e.f` or `e[i]`). */
export interface AssignStmt {
  kind: 'assign';
  target: Expr;
  op: AssignOp;
  value: Expr;
  span: Span;
}

export interface IfStmt {
  kind: 'if';
  cond: Expr;
  then: Block;
  else: Block | IfStmt | null;
  span: Span;
}

export interface WhileStmt {
  kind: 'while';
  cond: Expr;
  body: Block;
  span: Span;
}

export interface BreakStmt {
  kind: 'break';
  span: Span;
}

export interface ContinueStmt {
  kind: 'continue';
  span: Span;
}

export interface ReturnStmt {
  kind: 'return';
  value: Expr | null;
  span: Span;
}

export interface ExprStmt {
  kind: 'expr';
  expr: Expr;
  span: Span;
}

/** `for name in start..end body`: start and end are evaluated once, start first; `name` runs over [start, end). */
export interface ForRangeStmt {
  kind: 'forRange';
  name: string;
  nameSpan: Span;
  start: Expr;
  end: Expr;
  body: Block;
  span: Span;
}

/** `for name in iterable body`, where iterable is an array. */
export interface ForEachStmt {
  kind: 'forEach';
  name: string;
  nameSpan: Span;
  iterable: Expr;
  body: Block;
  span: Span;
}

/** A name bound by a pattern. In `Pattern.binders`, null stands for `_`. */
export interface Binder {
  name: string;
  span: Span;
}

/** One alternative of a pattern. Literal `raw` fields hold the source text (`-5`, `'a'`, `"x"`). */
export type Alternative =
  | { kind: 'variant'; enumName: string; enumSpan: Span; variant: string; variantSpan: Span; binders: (Binder | null)[]; span: Span }
  | { kind: 'intPat'; value: bigint; raw: string; span: Span }
  | { kind: 'charPat'; value: bigint; raw: string; span: Span }
  | { kind: 'stringPat'; value: string; raw: string; span: Span }
  | { kind: 'boolPat'; value: boolean; span: Span };

/** `_`, one alternative, or two or more alternatives joined by `|`. Patterns are flat. */
export type Pattern =
  | { kind: 'wildcard'; span: Span }
  | { kind: 'or'; alternatives: Alternative[]; span: Span }
  | Alternative;

export interface MatchStmtArm {
  pattern: Pattern;
  body: Block | Expr;
}

/** `match` in statement position. `keywordSpan` is where a non-exhaustive match is reported. */
export interface MatchStmt {
  kind: 'match';
  keywordSpan: Span;
  scrutinee: Expr;
  arms: MatchStmtArm[];
  span: Span;
}

export type Stmt = LetStmt | AssignStmt | IfStmt | WhileStmt | ForRangeStmt | ForEachStmt | MatchStmt | BreakStmt | ContinueStmt | ReturnStmt | Block | ExprStmt;

export type UnaryOp = '-' | '!';
export type BinaryOp = '||' | '&&' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '%';

export interface IntExpr {
  kind: 'int';
  value: bigint;
  span: Span;
}

export interface StringExpr {
  kind: 'string';
  value: string;
  span: Span;
}

/** `'a'`: an int-valued literal. `raw` is the source text, quotes included. */
export interface CharExpr {
  kind: 'char';
  value: bigint;
  raw: string;
  span: Span;
}

export interface BoolExpr {
  kind: 'bool';
  value: boolean;
  span: Span;
}

export interface NameExpr {
  kind: 'name';
  name: string;
  span: Span;
}

export interface UnaryExpr {
  kind: 'unary';
  op: UnaryOp;
  operand: Expr;
  span: Span;
}

export interface BinaryExpr {
  kind: 'binary';
  op: BinaryOp;
  left: Expr;
  right: Expr;
  span: Span;
}

export interface CallExpr {
  kind: 'call';
  callee: Expr;
  args: Expr[];
  span: Span;
}

/** `if c { a } else { b }` in expression position; each branch block holds exactly one expression. */
export interface IfExpr {
  kind: 'ifExpr';
  cond: Expr;
  then: Expr;
  else: Expr;
  span: Span;
}

export interface FieldExpr {
  kind: 'field';
  object: Expr;
  field: string;
  fieldSpan: Span;
  span: Span;
}

export interface FieldInit {
  name: string;
  nameSpan: Span;
  value: Expr;
}

/** `Name { f: e, ... }`. Fields appear in the order written. */
export interface StructLitExpr {
  kind: 'structLit';
  name: string;
  nameSpan: Span;
  fields: FieldInit[];
  span: Span;
}

export interface IndexExpr {
  kind: 'index';
  array: Expr;
  index: Expr;
  span: Span;
}

/** `operand?`: unwraps a `Result`/`Option`, or returns early from the enclosing function. */
export interface TryExpr {
  kind: 'try';
  operand: Expr;
  span: Span;
}

export interface ArrayLitExpr {
  kind: 'arrayLit';
  elements: Expr[];
  span: Span;
}

/** `Enum::Variant` or `Enum::Variant(args)`. `args` is empty when there are no parentheses (`V()` is a syntax error). */
export interface VariantExpr {
  kind: 'variant';
  enumName: string;
  enumSpan: Span;
  variant: string;
  variantSpan: Span;
  args: Expr[];
  span: Span;
}

export interface MatchExprArm {
  pattern: Pattern;
  body: Expr;
}

/** `match` in expression position: at least one arm, each a single expression. */
export interface MatchExpr {
  kind: 'matchExpr';
  keywordSpan: Span;
  scrutinee: Expr;
  arms: MatchExprArm[];
  span: Span;
}

export type Expr =
  | IntExpr | CharExpr | StringExpr | BoolExpr | NameExpr | UnaryExpr | BinaryExpr | CallExpr | IfExpr | FieldExpr | StructLitExpr | IndexExpr | ArrayLitExpr
  | VariantExpr | MatchExpr | TryExpr;

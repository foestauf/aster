import type { Span } from '../diagnostics/source.js';

export interface TypeRef {
  name: string;
  span: Span;
}

export interface Program {
  functions: FnDecl[];
  structs: StructDecl[];
}

export interface FieldDecl {
  name: string;
  nameSpan: Span;
  type: TypeRef;
}

export interface StructDecl {
  kind: 'struct';
  name: string;
  nameSpan: Span;
  fields: FieldDecl[];
  span: Span;
}

export interface Param {
  name: string;
  nameSpan: Span;
  type: TypeRef;
}

export interface FnDecl {
  kind: 'fn';
  name: string;
  nameSpan: Span;
  params: Param[];
  /** null means the function returns void. */
  returnType: TypeRef | null;
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
  type: TypeRef;
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

export type Stmt = LetStmt | AssignStmt | IfStmt | WhileStmt | BreakStmt | ContinueStmt | ReturnStmt | Block | ExprStmt;

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

export type Expr =
  | IntExpr | StringExpr | BoolExpr | NameExpr | UnaryExpr | BinaryExpr | CallExpr | IfExpr | FieldExpr | StructLitExpr;

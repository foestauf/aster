import type { AssignOp, BinaryOp, UnaryOp } from '../ast/ast.js';
import type { Type } from '../types/type.js';

export type BuiltinName = 'print' | 'len' | 'byte_at' | 'substring' | 'int_to_string' | 'panic' | 'push' | 'pop';

export interface Local {
  /** Unique within its function; params come first. */
  id: number;
  name: string;
  type: Type;
  mutable: boolean;
}

export interface TField {
  name: string;
  type: Type;
}

export interface TStruct {
  name: string;
  /** In declaration order. */
  fields: TField[];
}

export interface TypedProgram {
  structs: TStruct[];
  functions: TFunction[];
}

export interface TFunction {
  name: string;
  params: Local[];
  /** Every local including params, indexed by id. */
  locals: Local[];
  returnType: Type;
  body: TBlock;
}

export interface TBlock {
  kind: 'block';
  statements: TStmt[];
}

/** Something that can be assigned to. */
export type TPlace =
  | { kind: 'local'; type: Type; local: Local }
  | { kind: 'field'; type: Type; object: TExpr; field: string }
  | { kind: 'index'; type: Type; array: TExpr; index: TExpr };

export type TStmt =
  | { kind: 'let'; local: Local; init: TExpr }
  | { kind: 'assign'; place: TPlace; op: AssignOp; value: TExpr }
  | { kind: 'if'; cond: TExpr; then: TBlock; else: TBlock | null }
  | { kind: 'while'; cond: TExpr; body: TBlock }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'return'; value: TExpr | null }
  | TBlock
  | { kind: 'expr'; expr: TExpr };

export type TExpr =
  | { kind: 'int'; type: Type; value: bigint }
  | { kind: 'string'; type: Type; value: string }
  | { kind: 'bool'; type: Type; value: boolean }
  | { kind: 'local'; type: Type; local: Local }
  | { kind: 'unary'; type: Type; op: UnaryOp; operand: TExpr }
  | { kind: 'binary'; type: Type; op: BinaryOp; left: TExpr; right: TExpr }
  | { kind: 'call'; type: Type; fn: string; args: TExpr[] }
  | { kind: 'builtin'; type: Type; builtin: BuiltinName; args: TExpr[] }
  | { kind: 'if'; type: Type; cond: TExpr; then: TExpr; else: TExpr }
  | { kind: 'field'; type: Type; object: TExpr; field: string }
  | { kind: 'index'; type: Type; array: TExpr; index: TExpr }
  | { kind: 'arrayLit'; type: Type; elements: TExpr[] }
  /** Initialisers in the order written; lowering evaluates them in this order. */
  | { kind: 'structLit'; type: Type; struct: string; fields: { field: string; value: TExpr }[] };

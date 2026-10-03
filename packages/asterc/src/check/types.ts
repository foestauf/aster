import type { AssignOp, BinaryOp, UnaryOp } from '../ast/ast.js';
import type { Type } from '../types/type.js';

export type BuiltinName = 'print' | 'eprint' | 'exit' | 'len' | 'byte_at' | 'substring' | 'int_to_string' | 'panic' | 'push' | 'pop' | 'read_stdin' | 'read_file';

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

export interface TVariant {
  name: string;
  /** The variant's index in declaration order. */
  tag: number;
  payload: Type[];
}

export interface TEnum {
  name: string;
  /** True when no variant has a payload; such enums are plain integer tags at runtime. */
  payloadFree: boolean;
  /** In declaration order, so variants[i].tag === i. */
  variants: TVariant[];
}

export interface TypedProgram {
  structs: TStruct[];
  enums: TEnum[];
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

/** What a match arm accepts. Unresolved alternatives contribute no values; an arm with none is never taken. */
export type TPattern =
  | { kind: 'wildcard' }
  /** Enum variants. `binders` has one entry per payload slot when there is exactly one variant, else it is empty. */
  | { kind: 'variants'; variants: { name: string; tag: number }[]; binders: (Local | null)[] }
  /** int and char literals; bool patterns as 0n (false) and 1n (true). */
  | { kind: 'ints'; values: bigint[] }
  | { kind: 'strings'; values: string[] };

export type TStmt =
  | { kind: 'let'; local: Local; init: TExpr }
  | { kind: 'assign'; place: TPlace; op: AssignOp; value: TExpr }
  | { kind: 'if'; cond: TExpr; then: TBlock; else: TBlock | null }
  | { kind: 'while'; cond: TExpr; body: TBlock }
  | { kind: 'forRange'; local: Local; start: TExpr; end: TExpr; body: TBlock }
  | { kind: 'forEach'; local: Local; array: TExpr; body: TBlock }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'return'; value: TExpr | null }
  | { kind: 'match'; scrutinee: TExpr; arms: { pattern: TPattern; body: TBlock }[] }
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
  | { kind: 'structLit'; type: Type; struct: string; fields: { field: string; value: TExpr }[] }
  /** Builds the variant `tag` of `enum`; `args` are its payload values in slot order. */
  | { kind: 'variant'; type: Type; enum: string; variant: string; tag: number; args: TExpr[] }
  /** `==` / `!=` on a payload-free enum: compares tags. */
  | { kind: 'enumCompare'; type: Type; op: '==' | '!='; left: TExpr; right: TExpr }
  | { kind: 'match'; type: Type; scrutinee: TExpr; arms: { pattern: TPattern; body: TExpr }[] };

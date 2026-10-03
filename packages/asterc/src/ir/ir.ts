import type { Type } from '../types/type.js';
/**
 * A deliberately non-SSA IR: every value lives in a typed, mutable local slot
 * (maps 1:1 onto LLVM alloca/load/store later), and control flow is explicit
 * basic blocks ending in exactly one terminator.
 */

/** Every Aster type except the checker-only `error`. */
export type IrType = Exclude<Type, { kind: 'error' }>;

export interface IrLocal {
  id: number;
  /** Source name for user variables and params; null for compiler temporaries. */
  name: string | null;
  type: IrType;
}

export interface IrStruct {
  name: string;
  /** In declaration order. */
  fields: { name: string; type: IrType }[];
}

export interface IrEnum {
  name: string;
  /** True when no variant has a payload: values are plain int64 tags, not heap objects. */
  payloadFree: boolean;
  /** In declaration order; variants[i].tag === i. */
  variants: { name: string; tag: number; payload: IrType[] }[];
}

export type Operand =
  | { kind: 'local'; id: number }
  | { kind: 'int'; value: bigint }
  | { kind: 'bool'; value: boolean }
  | { kind: 'string'; index: number };

export type IrBinOp =
  | 'add' | 'sub' | 'mul' | 'div' | 'mod'
  | 'lt' | 'le' | 'gt' | 'ge' | 'eq' | 'ne'
  | 'concat' | 'str_eq' | 'str_ne';

export type IrUnOp = 'neg' | 'not';

export type IrBuiltin =
  | 'print_int' | 'print_bool' | 'print_string' | 'eprint_int' | 'eprint_bool' | 'eprint_string' | 'exit'
  | 'len' | 'byte_at' | 'substring' | 'int_to_string' | 'panic' | 'read_stdin';

export type Instr =
  | { kind: 'copy'; dst: number; src: Operand }
  | { kind: 'unop'; dst: number; op: IrUnOp; operand: Operand }
  | { kind: 'binop'; dst: number; op: IrBinOp; left: Operand; right: Operand }
  | { kind: 'call'; dst: number | null; fn: string; args: Operand[] }
  | { kind: 'call_builtin'; dst: number | null; builtin: IrBuiltin; args: Operand[] }
  /** Allocates a struct; `fields` are in declaration order. */
  | { kind: 'struct_new'; dst: number; struct: string; fields: { name: string; value: Operand }[] }
  | { kind: 'field_get'; dst: number; object: Operand; field: string }
  | { kind: 'field_set'; object: Operand; field: string; value: Operand }
  | { kind: 'array_new'; dst: number; elem: IrType; elements: Operand[] }
  /** Bounds-checked; panics outside [0, len). */
  | { kind: 'index_get'; dst: number; array: Operand; index: Operand }
  | { kind: 'index_set'; array: Operand; index: Operand; value: Operand }
  | { kind: 'array_len'; dst: number; array: Operand }
  | { kind: 'array_push'; array: Operand; value: Operand }
  /** Panics when the array is empty. */
  | { kind: 'array_pop'; dst: number; array: Operand }
  /** Builds a variant value; `args` are its payload values in slot order, already evaluated left to right. */
  | { kind: 'enum_new'; dst: number; enum: string; variant: string; tag: number; args: Operand[] }
  /** Reads an enum value's tag as an int. */
  | { kind: 'enum_tag'; dst: number; value: Operand }
  /** Reads payload slot `index` of a value whose tag is known to be `tag`. */
  | { kind: 'enum_field'; dst: number; value: Operand; enum: string; variant: string; tag: number; index: number }
  /** Reads the file at `path`. Sets `ok`, and sets `text` to the contents when `ok` is true, else to the error message. */
  | { kind: 'read_file'; ok: number; text: number; path: Operand };

export type Terminator =
  | { kind: 'jmp'; target: string }
  | { kind: 'br'; cond: Operand; then: string; else: string }
  /** Jumps to the case whose value equals `value` (an int), else to `default`. A null default means no other value can occur. */
  | { kind: 'switch'; value: Operand; cases: { value: bigint; target: string }[]; default: string | null }
  | { kind: 'ret'; value: Operand | null }
  | { kind: 'unreachable' };

export interface BasicBlock {
  label: string;
  instrs: Instr[];
  term: Terminator;
}

export interface IrFunction {
  name: string;
  /** Params are locals[0 .. paramCount). */
  paramCount: number;
  /** Indexed by id. */
  locals: IrLocal[];
  returnType: IrType;
  /** blocks[0] is the entry block. */
  blocks: BasicBlock[];
}

export interface IrProgram {
  structs: IrStruct[];
  enums: IrEnum[];
  functions: IrFunction[];
  /** Interned string literals, referenced by index. */
  strings: string[];
}

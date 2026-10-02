/**
 * A deliberately non-SSA IR: every value lives in a typed, mutable local slot
 * (maps 1:1 onto LLVM alloca/load/store later), and control flow is explicit
 * basic blocks ending in exactly one terminator.
 */

export type IrType = 'int' | 'bool' | 'string' | 'void';

export interface IrLocal {
  id: number;
  /** Source name for user variables and params; null for compiler temporaries. */
  name: string | null;
  type: IrType;
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
  | 'print_int' | 'print_bool' | 'print_string'
  | 'len' | 'byte_at' | 'substring' | 'int_to_string' | 'panic';

export type Instr =
  | { kind: 'copy'; dst: number; src: Operand }
  | { kind: 'unop'; dst: number; op: IrUnOp; operand: Operand }
  | { kind: 'binop'; dst: number; op: IrBinOp; left: Operand; right: Operand }
  | { kind: 'call'; dst: number | null; fn: string; args: Operand[] }
  | { kind: 'call_builtin'; dst: number | null; builtin: IrBuiltin; args: Operand[] };

export type Terminator =
  | { kind: 'jmp'; target: string }
  | { kind: 'br'; cond: Operand; then: string; else: string }
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
  functions: IrFunction[];
  /** Interned string literals, referenced by index. */
  strings: string[];
}

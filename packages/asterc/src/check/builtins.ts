import { INT, NEVER, STRING, VOID, type Type } from '../types/type.js';
import type { BuiltinName } from './types.js';

export interface Signature {
  params: Type[];
  returnType: Type;
}

/** Builtins the checker types by hand: `print`/`eprint` (int, bool or string), `len` (string or array), `push`/`pop` (any array). */
export type SpecialBuiltin = 'print' | 'eprint' | 'len' | 'push' | 'pop';
const SPECIAL_BUILTINS: ReadonlySet<string> = new Set<SpecialBuiltin>(['print', 'eprint', 'len', 'push', 'pop']);

export type SignatureBuiltin = Exclude<BuiltinName, SpecialBuiltin>;

/** The predeclared generic enums. Their names are reserved. */
export const OPTION = 'Option';
export const RESULT = 'Result';
/** Checked as if every program began with it. */
export const PRELUDE_SOURCE = 'enum Option[T] { Some(T), None }\nenum Result[T, E] { Ok(T), Err(E) }\n';

export const BUILTIN_SIGNATURES: Record<SignatureBuiltin, Signature> = {
  byte_at: { params: [STRING, INT], returnType: INT },
  substring: { params: [STRING, INT, INT], returnType: STRING },
  int_to_string: { params: [INT], returnType: STRING },
  panic: { params: [STRING], returnType: NEVER },
  exit: { params: [INT], returnType: NEVER },
  read_stdin: { params: [], returnType: STRING },
  // The checker types read_file's call as Result[string, string].
  read_file: { params: [STRING], returnType: VOID },
  // Likewise: write_file, remove_path and run_process return Result[int, string], make_temp_dir Result[string, string].
  write_file: { params: [STRING, STRING], returnType: VOID },
  make_temp_dir: { params: [STRING], returnType: VOID },
  remove_path: { params: [STRING], returnType: VOID },
  run_process: { params: [{ kind: 'array', elem: STRING }], returnType: VOID },
};

export function isSignatureBuiltin(name: string): name is SignatureBuiltin {
  return Object.hasOwn(BUILTIN_SIGNATURES, name);
}

export function isBuiltin(name: string): name is BuiltinName {
  return SPECIAL_BUILTINS.has(name) || isSignatureBuiltin(name);
}

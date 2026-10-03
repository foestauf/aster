import { INT, STRING, VOID, type Type } from '../types/type.js';
import type { BuiltinName, TEnum } from './types.js';

export interface Signature {
  params: Type[];
  returnType: Type;
}

/** Builtins the checker types by hand: `print`/`eprint` (int, bool or string), `len` (string or array), `push`/`pop` (any array). */
export type SpecialBuiltin = 'print' | 'eprint' | 'len' | 'push' | 'pop';
const SPECIAL_BUILTINS: ReadonlySet<string> = new Set<SpecialBuiltin>(['print', 'eprint', 'len', 'push', 'pop']);

export type SignatureBuiltin = Exclude<BuiltinName, SpecialBuiltin>;

/** The predeclared `enum ReadResult { Ok(string), Err(string) }` that `read_file` returns. */
export const READ_RESULT = 'ReadResult';
export const READ_RESULT_TYPE: Type = { kind: 'enum', name: READ_RESULT };

export const BUILTIN_SIGNATURES: Record<SignatureBuiltin, Signature> = {
  byte_at: { params: [STRING, INT], returnType: INT },
  substring: { params: [STRING, INT, INT], returnType: STRING },
  int_to_string: { params: [INT], returnType: STRING },
  panic: { params: [STRING], returnType: VOID },
  exit: { params: [INT], returnType: VOID },
  read_stdin: { params: [], returnType: STRING },
  read_file: { params: [STRING], returnType: READ_RESULT_TYPE },
};

export function isSignatureBuiltin(name: string): name is SignatureBuiltin {
  return Object.hasOwn(BUILTIN_SIGNATURES, name);
}

export function isBuiltin(name: string): name is BuiltinName {
  return SPECIAL_BUILTINS.has(name) || isSignatureBuiltin(name);
}

/** A fresh copy of ReadResult's declaration, for one program's enum table. */
export function readResultEnum(): TEnum {
  return {
    name: READ_RESULT,
    payloadFree: false,
    variants: [
      { name: 'Ok', tag: 0, payload: [STRING] },
      { name: 'Err', tag: 1, payload: [STRING] },
    ],
  };
}

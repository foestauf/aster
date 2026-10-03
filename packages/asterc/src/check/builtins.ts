import { INT, STRING, VOID, type Type } from '../types/type.js';
import type { BuiltinName } from './types.js';

export interface Signature {
  params: Type[];
  returnType: Type;
}

/** Builtins the checker types by hand: `print` (int, bool or string), `len` (string or array), `push`/`pop` (any array). */
export type SpecialBuiltin = 'print' | 'len' | 'push' | 'pop';
const SPECIAL_BUILTINS: ReadonlySet<string> = new Set<SpecialBuiltin>(['print', 'len', 'push', 'pop']);

export type SignatureBuiltin = Exclude<BuiltinName, SpecialBuiltin>;

export const BUILTIN_SIGNATURES: Record<SignatureBuiltin, Signature> = {
  byte_at: { params: [STRING, INT], returnType: INT },
  substring: { params: [STRING, INT, INT], returnType: STRING },
  int_to_string: { params: [INT], returnType: STRING },
  panic: { params: [STRING], returnType: VOID },
};

export function isSignatureBuiltin(name: string): name is SignatureBuiltin {
  return Object.hasOwn(BUILTIN_SIGNATURES, name);
}

export function isBuiltin(name: string): name is BuiltinName {
  return SPECIAL_BUILTINS.has(name) || isSignatureBuiltin(name);
}

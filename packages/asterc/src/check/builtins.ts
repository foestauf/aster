import { INT, STRING, VOID, type Type } from '../types/type.js';
import type { BuiltinName } from './types.js';

export interface Signature {
  params: Type[];
  returnType: Type;
}

/** Builtins with an ordinary signature. `print` is special-cased by the checker (int, bool or string). */
export type SignatureBuiltin = Exclude<BuiltinName, 'print'>;

export const BUILTIN_SIGNATURES: Record<SignatureBuiltin, Signature> = {
  len: { params: [STRING], returnType: INT },
  byte_at: { params: [STRING, INT], returnType: INT },
  substring: { params: [STRING, INT, INT], returnType: STRING },
  int_to_string: { params: [INT], returnType: STRING },
  panic: { params: [STRING], returnType: VOID },
};

export function isSignatureBuiltin(name: string): name is SignatureBuiltin {
  return Object.hasOwn(BUILTIN_SIGNATURES, name);
}

export function isBuiltin(name: string): name is BuiltinName {
  return name === 'print' || isSignatureBuiltin(name);
}

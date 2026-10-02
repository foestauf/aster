import type { BuiltinName, Type } from './types.js';

export interface Signature {
  params: Type[];
  returnType: Type;
}

/** Builtins with an ordinary signature. `print` is special-cased by the checker (int, bool or string). */
export type SignatureBuiltin = Exclude<BuiltinName, 'print'>;

export const BUILTIN_SIGNATURES: Record<SignatureBuiltin, Signature> = {
  len: { params: ['string'], returnType: 'int' },
  byte_at: { params: ['string', 'int'], returnType: 'int' },
  substring: { params: ['string', 'int', 'int'], returnType: 'string' },
  int_to_string: { params: ['int'], returnType: 'string' },
  panic: { params: ['string'], returnType: 'void' },
};

export function isSignatureBuiltin(name: string): name is SignatureBuiltin {
  return Object.hasOwn(BUILTIN_SIGNATURES, name);
}

export function isBuiltin(name: string): name is BuiltinName {
  return name === 'print' || isSignatureBuiltin(name);
}

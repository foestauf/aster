/**
 * Aster types, shared by the checker and the IR. `error` marks an expression whose type could not be
 * determined; the checker suppresses rules involving it, and it never reaches lowering. A struct type is a
 * reference to a heap object.
 */
export type Type =
  | { kind: 'int' }
  | { kind: 'bool' }
  | { kind: 'string' }
  | { kind: 'void' }
  | { kind: 'struct'; name: string }
  | { kind: 'error' };

export const INT: Type = { kind: 'int' };
export const BOOL: Type = { kind: 'bool' };
export const STRING: Type = { kind: 'string' };
export const VOID: Type = { kind: 'void' };
export const ERROR: Type = { kind: 'error' };

export function typeEquals(a: Type, b: Type): boolean {
  if (a.kind === 'struct' && b.kind === 'struct') return a.name === b.name;
  return a.kind === b.kind;
}

/** How a type is written in Aster source and named in diagnostics. */
export function typeToString(t: Type): string {
  switch (t.kind) {
    case 'struct':
      return t.name;
    default:
      return t.kind;
  }
}

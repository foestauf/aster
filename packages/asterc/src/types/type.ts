/**
 * Aster types, shared by the checker and the IR. `error` marks an expression whose type could not be
 * determined; the checker suppresses rules involving it, and it never reaches lowering. Struct and array types are
 * references to heap objects. An enum is a plain tag when no variant has a payload, and a heap reference otherwise.
 * An instantiation of a generic enum is named by its full type string (`Option[int]`), and `generic` keeps its parts.
 */
export type Type =
  | { kind: 'int' }
  | { kind: 'bool' }
  | { kind: 'string' }
  | { kind: 'void' }
  | { kind: 'struct'; name: string }
  | { kind: 'enum'; name: string; generic?: { base: string; args: Type[] } }
  | { kind: 'array'; elem: Type }
  | { kind: 'error' };

export const INT: Type = { kind: 'int' };
export const BOOL: Type = { kind: 'bool' };
export const STRING: Type = { kind: 'string' };
export const VOID: Type = { kind: 'void' };
export const ERROR: Type = { kind: 'error' };

/** The type string of an instantiation; it is injective, so names alone identify instantiations. */
export function instanceName(base: string, args: readonly Type[]): string {
  return `${base}[${args.map(typeToString).join(', ')}]`;
}

export function typeEquals(a: Type, b: Type): boolean {
  if (a.kind === 'struct' && b.kind === 'struct') return a.name === b.name;
  if (a.kind === 'enum' && b.kind === 'enum') return a.name === b.name;
  if (a.kind === 'array' && b.kind === 'array') return typeEquals(a.elem, b.elem);
  return a.kind === b.kind;
}

/** How a type is written in Aster source and named in diagnostics. */
export function typeToString(t: Type): string {
  switch (t.kind) {
    case 'struct':
    case 'enum':
      return t.name;
    case 'array':
      return `[${typeToString(t.elem)}]`;
    default:
      return t.kind;
  }
}

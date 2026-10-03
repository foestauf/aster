import { describe, expect, it } from 'vitest';
import { BOOL, ERROR, INT, STRING, VOID, instanceName, typeEquals, typeToString } from './type.js';

describe('types', () => {
  it('compares primitive types by kind', () => {
    expect(typeEquals(INT, { kind: 'int' })).toBe(true);
    expect(typeEquals(INT, BOOL)).toBe(false);
    expect(typeEquals(STRING, STRING)).toBe(true);
  });

  it('renders types the way diagnostics name them', () => {
    expect([INT, BOOL, STRING, VOID, ERROR].map(typeToString)).toEqual(['int', 'bool', 'string', 'void', 'error']);
  });

  it('compares array types structurally and struct types by name', () => {
    expect(typeEquals({ kind: 'array', elem: { kind: 'array', elem: INT } }, { kind: 'array', elem: { kind: 'array', elem: INT } })).toBe(true);
    expect(typeEquals({ kind: 'array', elem: INT }, { kind: 'array', elem: BOOL })).toBe(false);
    expect(typeEquals({ kind: 'struct', name: 'P' }, { kind: 'struct', name: 'Q' })).toBe(false);
    expect(typeToString({ kind: 'array', elem: { kind: 'array', elem: { kind: 'struct', name: 'P' } } })).toBe('[[P]]');
  });

  it('compares enum types by name', () => {
    expect(typeEquals({ kind: 'enum', name: 'E' }, { kind: 'enum', name: 'E' })).toBe(true);
    expect(typeEquals({ kind: 'enum', name: 'E' }, { kind: 'enum', name: 'F' })).toBe(false);
    expect(typeEquals({ kind: 'enum', name: 'E' }, { kind: 'struct', name: 'E' })).toBe(false);
    expect(typeToString({ kind: 'array', elem: { kind: 'enum', name: 'Kind' } })).toBe('[Kind]');
  });

  it('names instantiations by their type string', () => {
    expect(instanceName('Result', [{ kind: 'array', elem: INT }, { kind: 'struct', name: 'P' }])).toBe('Result[[int], P]');
    expect(instanceName('Option', [INT])).toBe('Option[int]');
  });
});

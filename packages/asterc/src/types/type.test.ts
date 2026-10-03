import { describe, expect, it } from 'vitest';
import { BOOL, ERROR, INT, STRING, VOID, typeEquals, typeToString } from './type.js';

describe('types', () => {
  it('compares primitive types by kind', () => {
    expect(typeEquals(INT, { kind: 'int' })).toBe(true);
    expect(typeEquals(INT, BOOL)).toBe(false);
    expect(typeEquals(STRING, STRING)).toBe(true);
  });

  it('renders types the way diagnostics name them', () => {
    expect([INT, BOOL, STRING, VOID, ERROR].map(typeToString)).toEqual(['int', 'bool', 'string', 'void', 'error']);
  });
});

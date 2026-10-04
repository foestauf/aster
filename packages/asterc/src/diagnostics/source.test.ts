import { describe, expect, it } from 'vitest';
import { lex } from '../lexer/lexer.js';
import { lineCol, makeSource, nextBase, sourceAt, sourceMapOf } from './source.js';

describe('source map', () => {
  const a = makeSource('a', 'fn a() {}\n');
  const b = makeSource('b', 'x', nextBase(a));
  const map = sourceMapOf([a, b]);

  it('computes the next base with a one-character gap', () => {
    expect(a.base).toBe(0);
    expect(nextBase(a)).toBe(a.text.length + 1);
    expect(b.base).toBe(11);
  });

  it('finds the containing file, giving EOF to its own file', () => {
    expect(sourceAt(map, a.text.length)).toBe(a);
    expect(sourceAt(map, b.base)).toBe(b);
    expect(sourceAt(a, 5)).toBe(a);
  });

  it('subtracts the file base in lineCol', () => {
    expect(lineCol(map, b.base)).toEqual({ line: 1, col: 1 });
    expect(lineCol(map, 3)).toEqual({ line: 1, col: 4 });
  });

  it('rejects a bad layout', () => {
    expect(() => sourceMapOf([])).toThrow(/at least one/);
    expect(() => sourceMapOf([a, makeSource('c', 'y', 3)])).toThrow(/overlaps/);
  });

  it('offsets lexer spans by the file base', () => {
    const toks = lex(makeSource('b', 'fn', 100)).tokens;
    expect(toks[0].span).toEqual({ start: 100, end: 102 });
    expect(toks[1].span.start).toBe(102);
  });
});

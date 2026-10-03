import { describe, expect, it } from 'vitest';
import { formatDiagnostic, formatShort, sortDiagnostics } from './diagnostic.js';
import { lineCol, lineText, makeSource, nextBase, sourceMapOf } from './source.js';

describe('lineCol', () => {
  const src = makeSource('t.aster', 'ab\ncd\n\nef');

  it('maps offsets to 1-based line and column', () => {
    expect(lineCol(src, 0)).toEqual({ line: 1, col: 1 });
    expect(lineCol(src, 1)).toEqual({ line: 1, col: 2 });
    expect(lineCol(src, 3)).toEqual({ line: 2, col: 1 });
    expect(lineCol(src, 7)).toEqual({ line: 4, col: 1 });
  });

  it('maps the end-of-file offset to the last line', () => {
    expect(lineCol(src, 9)).toEqual({ line: 4, col: 3 });
  });
});

describe('lineText', () => {
  it('returns a line without its newline', () => {
    const src = makeSource('t.aster', 'ab\ncd\n');
    expect(lineText(src, 2)).toBe('cd');
    expect(lineText(src, 3)).toBe('');
  });

  it('strips CR from CRLF lines', () => {
    const src = makeSource('t.aster', 'let a\r\nlet b\r\n');
    expect(lineText(src, 1)).toBe('let a');
    expect(lineCol(src, 9)).toEqual({ line: 2, col: 3 });
  });
});

describe('formatDiagnostic', () => {
  it('prints location, source line and caret under the span', () => {
    const src = makeSource('dir/x.aster', 'fn main(): int {\n    return "s";\n}\n');
    const d = { message: 'type mismatch: expected int, found string', span: { start: 28, end: 31 } };
    expect(formatDiagnostic(src, d)).toBe(
      'dir/x.aster:2:12: error: type mismatch: expected int, found string\n' +
        '      return "s";\n' +
        '             ^^^',
    );
  });

  it('uses at least one caret for empty spans and clamps to the line end', () => {
    const src = makeSource('x.aster', 'ab\ncd');
    expect(formatDiagnostic(src, { message: 'm', span: { start: 5, end: 5 } })).toBe(
      'x.aster:2:3: error: m\n  cd\n    ^',
    );
    expect(formatDiagnostic(src, { message: 'm', span: { start: 1, end: 5 } })).toBe(
      'x.aster:1:2: error: m\n  ab\n   ^',
    );
  });

  it('keeps tabs in the caret padding so carets line up', () => {
    const src = makeSource('x.aster', '\tx');
    expect(formatDiagnostic(src, { message: 'm', span: { start: 1, end: 2 } })).toBe(
      'x.aster:1:2: error: m\n  \tx\n  \t^',
    );
  });
});

describe('formatShort', () => {
  it('prints line:col and message', () => {
    const src = makeSource('x.aster', 'a\nbc');
    expect(formatShort(src, { message: 'oops', span: { start: 3, end: 4 } })).toBe('2:2 oops');
  });
});

const mk = (rootPath: string, libPath: string) => {
  const a = makeSource(rootPath, 'fn a() {}\n');
  const b = makeSource(libPath, 'x\ny', nextBase(a));
  return { a, b, map: sourceMapOf([a, b]) };
};

describe('multi-file formatting', () => {
  it('formatShort omits the path for the root and relativises others', () => {
    const { b, map } = mk('/r/main.aster', '/r/lib/b.aster');
    expect(formatShort(map, { message: 'm', span: { start: b.base, end: b.base + 1 } })).toBe('lib/b.aster:1:1 m');
    expect(formatShort(map, { message: 'm', span: { start: 0, end: 1 } })).toBe('1:1 m');
  });

  it('formatShort works with relative paths and parent directories', () => {
    const { b, map } = mk('prog/main.aster', 'prog/lib.aster');
    expect(formatShort(map, { message: 'm', span: { start: b.base + 2, end: b.base + 3 } })).toBe('lib.aster:2:1 m');
    const up = mk('/r/sub/main.aster', '/r/lib.aster');
    expect(formatShort(up.map, { message: 'm', span: { start: up.b.base, end: up.b.base } })).toBe('../lib.aster:1:1 m');
  });

  it('formatDiagnostic prints the containing file path and its own line', () => {
    const { b, map } = mk('/r/main.aster', '/r/lib/b.aster');
    expect(formatDiagnostic(map, { message: 'm', span: { start: b.base + 2, end: b.base + 3 } })).toBe(
      '/r/lib/b.aster:2:1: error: m\n  y\n  ^',
    );
  });
});

describe('sortDiagnostics', () => {
  it('sorts by position and removes exact duplicates', () => {
    const a = { message: 'a', span: { start: 5, end: 6 } };
    const b = { message: 'b', span: { start: 1, end: 2 } };
    const c = { message: 'c', span: { start: 5, end: 9 } };
    expect(sortDiagnostics([a, b, c, { ...a }])).toEqual([b, a, c]);
  });
});

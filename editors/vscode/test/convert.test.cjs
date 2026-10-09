const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const convert = require('../src/convert.cjs');

const bytes = (s) => Buffer.from(s, 'utf8');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

test('byteOffset walks lines and UTF-16 units over the saved bytes', () => {
  assert.deepEqual(convert.byteOffset(bytes('ab\ncd'), 1, 1), { offset: 4 });
  assert.deepEqual(convert.byteOffset(Buffer.concat([BOM, bytes('ab')]), 0, 1), { offset: 4 });
  assert.deepEqual(convert.byteOffset(bytes('ab\r\ncd'), 1, 0), { offset: 4 });
  // é is 2 bytes and 1 unit, € is 3 bytes and 1 unit, 📐 is 4 bytes and 2 units.
  assert.deepEqual(convert.byteOffset(bytes('é€x'), 0, 2), { offset: 5 });
  assert.deepEqual(convert.byteOffset(bytes('a📐b'), 0, 3), { offset: 5 });
});

test('byteOffset inside a surrogate pair names the start of the code point', () => {
  assert.deepEqual(convert.byteOffset(bytes('a📐b'), 0, 2), { offset: 1 });
});

test('byteOffset past the end of a line is the line end, and past the last line the file end', () => {
  assert.deepEqual(convert.byteOffset(bytes('ab\r\ncd'), 0, 9), { offset: 2 });
  assert.deepEqual(convert.byteOffset(bytes('ab\ncd'), 0, 9), { offset: 2 });
  assert.deepEqual(convert.byteOffset(bytes('ab\ncd\n'), 7, 0), { offset: 6 });
  assert.deepEqual(convert.byteOffset(bytes(''), 0, 0), { offset: 0 });
});

test('byteOffset refuses a file with a lone carriage return', () => {
  assert.ok(convert.byteOffset(bytes('a\rb\n'), 0, 0).error);
  assert.ok(convert.byteOffset(bytes('a\n\r'), 0, 0).error);
});

test('editorRange turns 1-based compiler lines and columns into 0-based editor ones', () => {
  const r = { start: 3, end: 7, start_line: 2, start_col_utf16: 5, end_line: 2, end_col_utf16: 9 };
  assert.deepEqual(convert.editorRange(r), { start: { line: 1, character: 4 }, end: { line: 1, character: 8 } });
});

test('renderType spells types the way Aster source does', () => {
  const int = { kind: 'int' };
  assert.equal(convert.renderType(int), 'int');
  assert.equal(convert.renderType({ kind: 'array', element: { kind: 'array', element: int } }), '[[int]]');
  assert.equal(convert.renderType({ kind: 'map', key: { kind: 'string' }, value: int }), 'Map[string, int]');
  assert.equal(convert.renderType({ kind: 'set', element: int }), 'Set[int]');
  assert.equal(convert.renderType({ kind: 'enum', name: 'Option[int]', decl: 41, args: [int] }), 'Option[int]');
  assert.equal(convert.renderType({ kind: 'struct', name: 'Point', decl: 3 }), 'Point');
  assert.equal(convert.renderType({ kind: 'param', name: 'T' }), 'T');
  assert.equal(convert.renderType({ kind: 'tuple' }), 'tuple');
});

const int = { kind: 'int' };
const areaSig = { params: [{ name: 'side', type: int, decl: 3 }], ret: int };
const loc = (file, p, start_line, start_col_utf16, len) => ({
  file, path: p,
  range: { start: 0, end: len, start_line, start_col_utf16, end_line: start_line, end_col_utf16: start_col_utf16 + len },
});
const decls = [
  { id: 0, kind: 'fn', name: 'main', origin: 'source', location: loc(0, 'main.aster', 4, 4, 4), signature: { params: [], ret: int } },
  { id: 1, kind: 'local', name: 'side', origin: 'source', location: loc(0, 'main.aster', 5, 9, 4), type: int },
  { id: 2, kind: 'fn', name: 'area', origin: 'source', location: loc(1, './shapes.aster', 2, 4, 4), signature: areaSig },
  { id: 3, kind: 'struct', name: 'Point', origin: 'source', location: loc(1, './shapes.aster', 6, 8, 5) },
  { id: 4, kind: 'builtin-fn', name: 'print', origin: 'builtin', location: null, signature: null },
];
const found = (query) => ({ schema: 'aster/1', command: 'query', semantics: { available: true, declarations: decls }, query: { status: 'found', ...query } });

test('hoverText shows a type, a signature or a declaration', () => {
  assert.equal(convert.hoverText(found({ site: 'expression', type: int })), 'int');
  assert.equal(convert.hoverText(found({ site: 'local', type: int, target: 1 })), 'int');
  assert.equal(convert.hoverText(found({ site: 'callee', signature: areaSig, target: 2 })), 'fn area(side: int): int');
  assert.equal(convert.hoverText(found({ site: 'callee', signature: null, target: 4 })), 'fn print');
  assert.equal(convert.hoverText(found({ site: 'declaration', type: int, target: 1 })), 'local side: int');
  assert.equal(convert.hoverText(found({ site: 'declaration', signature: areaSig, target: 2 })), 'fn area(side: int): int');
  assert.equal(convert.hoverText(found({ site: 'declaration', target: 3 })), 'struct Point');
  assert.equal(convert.hoverText({ query: { status: 'none' } }), null);
  assert.equal(convert.hoverText({ query: { status: 'unsupported', site: 'type' } }), null);
});

test('definitionTarget resolves the declared name, and a builtin has none', () => {
  assert.deepEqual(convert.definitionTarget(found({ site: 'callee', signature: areaSig, target: 2 }), '/w'), {
    file: path.resolve('/w', './shapes.aster'),
    range: { start: { line: 1, character: 3 }, end: { line: 1, character: 7 } },
  });
  assert.equal(convert.definitionTarget(found({ site: 'callee', signature: null, target: 4 }), '/w'), null);
  assert.equal(convert.definitionTarget(found({ site: 'expression', type: int }), '/w'), null);
  assert.equal(convert.definitionTarget({ query: { status: 'none' } }, '/w'), null);
});

test('diagnosticsByFile groups by resolved path and keeps the code', () => {
  const doc = {
    diagnostics: [
      { code: 'type.mismatch', severity: 'error', message: 'type mismatch', primary: loc(1, './shapes.aster', 3, 12, 4), related: [] },
      { code: 'import.unreadable', severity: 'error', message: "cannot import 'gone.aster'", primary: loc(null, './gone.aster', 1, 1, 1), related: [] },
    ],
  };
  const byFile = convert.diagnosticsByFile(doc, '/w', 'main.aster', () => false);
  assert.deepEqual(byFile.get(path.resolve('/w/shapes.aster')), [
    { range: { start: { line: 2, character: 11 }, end: { line: 2, character: 15 } }, message: 'type mismatch', code: 'type.mismatch', severity: 'error' },
  ]);
  assert.deepEqual(byFile.get(path.resolve('/w/main.aster')), [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, message: "./gone.aster: cannot import 'gone.aster'", code: 'import.unreadable', severity: 'error' },
  ]);
});

test('diagnosticsByFile keeps an unloaded file that exists at its own path', () => {
  const doc = { diagnostics: [{ code: 'import.invalid-utf8', severity: 'error', message: 'bad', primary: loc(null, './bad.aster', 1, 3, 1), related: [] }] };
  const byFile = convert.diagnosticsByFile(doc, '/w', 'main.aster', () => true);
  assert.equal(byFile.get(path.resolve('/w/bad.aster'))[0].range.start.character, 2);
});

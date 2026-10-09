# Aster VS Code Saved-File Hover and Definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The VS Code extension shows compiler diagnostics, hover types and go-to-definition for saved Aster files by
running `aster check --format=json` and `aster query` one shot at a time, and fails closed whenever an answer might be
stale.

**Architecture:** Two modules that don't import `vscode`: `src/convert.cjs` (pure conversions between editor
coordinates and aster/1 JSON) and `src/adapter.cjs` (spawning the compiler, a `Session` that orders runs and checks
freshness). `src/extension.cjs` is the VS Code glue. A demo program and an independent agent script show the workflow.

**Tech Stack:** Plain CommonJS on Node 24 with no runtime dependencies, the VS Code API ^1.85, `node --test` for the
extension's tests, and vitest in the repo for the tests against the real compiler.

**Spec:** `docs/superpowers/specs/2026-10-08-aster-vscode-query-demo-design.md`. Contract: `docs/inspect/README.md`.

## Global Constraints

- The compiler is spawned with an argv array and `shell: false`. Nothing is ever interpolated into a shell command.
- No compiler runs in an untrusted workspace, or when `aster.compilerPath` or `aster.entry` is empty.
- Answers come only from the public aster/1 JSON. No parsing or type checking is duplicated, and no symbols are
  inferred from text.
- Fail closed: an answer from a dirty document, a dirty open import, a changed hash or an intervening save is never
  shown.
- `none`, `unsupported` and `invalid` are not errors. `unavailable` means "no semantics until the program checks".
- Extension version `0.2.0`; id `aster-local.aster-syntax`; `engines.vscode` `^1.85.0`; no `dependencies`.
- Commits use conventional-commit subjects with body lines of at most 100 characters (commitlint) and end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: from `editors/vscode`, `npm test`. From the repo root, `pnpm vitest run tests/vscode_adapter.test.ts`,
  then `pnpm lint`, `pnpm typecheck` and `pnpm test` before the PR.

## Review Focus

1. **The caret at the end of a line, or past it** (F12 with the cursor after the last name on a line): the position
   maps to the line's end byte, and caret mode finds the name on its left. Test: Task 1 `byteOffset` "past the end",
   and Task 4 "definition from the end of a line".
2. **A position inside a surrogate pair** (VS Code can report the middle of an astral character): it maps to the
   start of that code point and never to a continuation byte. Test: Task 1.
3. **Two saves in quick succession:** the older check's diagnostics never replace the newer ones. Test: Task 2 "a
   late response to an older check is dropped".
4. **A compiler that prints usage for `query`** (an older release): this is reported as a compiler problem, not as
   "no result". Test: Task 2 `run` "usage on stderr".
5. **A relative `aster.compilerPath` such as `../../../build/asterc`:** it resolves against the workspace folder, not
   the extension host's cwd. Test: Task 3 "relative compiler path".

---

### Task 1: Pure conversions (`convert.cjs`)

**Files:**
- Create: `editors/vscode/src/convert.cjs`
- Test: `editors/vscode/test/convert.test.cjs`

**Interfaces:**
- Produces:
  - `byteOffset(bytes: Buffer, line: number, character: number): {offset: number} | {error: string}`
  - `editorRange(r: CompilerRange): EditorRange` where `EditorRange = {start: {line, character}, end: {line, character}}` (0-based)
  - `renderType(t: object): string`
  - `renderSignature(name: string, sig: object | null): string`
  - `hoverText(doc: QueryResponse): string | null`
  - `definitionTarget(doc: QueryResponse, root: string): {file: string, range: EditorRange} | null`
  - `diagnosticsByFile(doc: CheckResponse, root: string, entry: string, exists: (file) => boolean): Map<string, Array<{range, message, code, severity}>>`

- [ ] **Step 1: Write the failing test** `editors/vscode/test/convert.test.cjs`

```js
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
```

- [ ] **Step 2: Run it and check it fails**

Run: `cd editors/vscode && node --test test/convert.test.cjs`
Expected: FAIL with `Cannot find module '../src/convert.cjs'`.

- [ ] **Step 3: Implement** `editors/vscode/src/convert.cjs`

```js
'use strict';
// Pure conversions between VS Code and the compiler's aster/1 JSON (docs/inspect/README.md). No vscode, no I/O.
const path = require('node:path');

// The byte offset in `bytes` (a file as saved, BOM included) of the editor position `line`/`character`: 0-based, in
// UTF-16 code units, as VS Code counts them. A position inside a surrogate pair names the start of its code point; one
// past the end of a line is the line's end, and one past the last line is the end of the file. A lone '\r' is a line
// break to VS Code but an ordinary character to the compiler, so such a file gets {error} instead.
function byteOffset(bytes, line, character) {
  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  for (let k = start; k < bytes.length; k++) {
    if (bytes[k] === 0x0d && bytes[k + 1] !== 0x0a) return { error: 'the file has a carriage return that does not end a line' };
  }
  let i = start;
  for (let l = 0; l < line; l++) {
    const nl = bytes.indexOf(0x0a, i);
    if (nl < 0) return { offset: bytes.length };
    i = nl + 1;
  }
  let units = 0;
  while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) {
    const b = bytes[i];
    const size = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    const width = size === 4 ? 2 : 1;
    if (units + width > character) break;
    units += width;
    i += size;
  }
  return { offset: i };
}

// An editor range (0-based) from a compiler range (1-based lines, 1-based UTF-16 columns).
function editorRange(r) {
  return {
    start: { line: r.start_line - 1, character: r.start_col_utf16 - 1 },
    end: { line: r.end_line - 1, character: r.end_col_utf16 - 1 },
  };
}

// A structured type as Aster source spells it.
function renderType(t) {
  switch (t.kind) {
    case 'int':
    case 'bool':
    case 'string':
    case 'void':
    case 'never':
      return t.kind;
    case 'array':
      return `[${renderType(t.element)}]`;
    case 'map':
      return `Map[${renderType(t.key)}, ${renderType(t.value)}]`;
    case 'set':
      return `Set[${renderType(t.element)}]`;
    default:
      return t.name === undefined ? t.kind : t.name;
  }
}

// `fn name(p: T, ...): R`, or `fn name` for a builtin the checker types by hand (a null signature).
function renderSignature(name, sig) {
  if (!sig) return `fn ${name}`;
  const params = sig.params.map((p) => `${p.name}: ${renderType(p.type)}`).join(', ');
  return `fn ${name}(${params}): ${renderType(sig.ret)}`;
}

// How hover describes a declaration: a signature for a function, `kind name: type` when it has a type.
function describe(d) {
  if (d.kind === 'fn' || d.kind === 'builtin-fn') return renderSignature(d.name, d.signature);
  if (d.type !== undefined) return `${d.kind} ${d.name}: ${renderType(d.type)}`;
  return `${d.kind} ${d.name}`;
}

// The hover text for a query response, or null when there is nothing to show.
function hoverText(doc) {
  const q = doc.query;
  if (q.status !== 'found') return null;
  const target = q.target === undefined ? null : doc.semantics.declarations[q.target];
  if (q.site === 'callee') return renderSignature(target ? target.name : '', q.signature);
  if (q.site === 'declaration' && target) return describe(target);
  return q.type === undefined ? null : renderType(q.type);
}

// Where go-to-definition goes: the target declaration's name, or null when there is no navigable target.
function definitionTarget(doc, root) {
  const q = doc.query;
  if (q.status !== 'found' || q.target === undefined) return null;
  const location = doc.semantics.declarations[q.target].location;
  if (!location) return null;
  return { file: path.resolve(root, location.path), range: editorRange(location.range) };
}

// A check response's diagnostics by absolute file, in editor coordinates. A diagnostic in a file that didn't load
// (`file` null) stays on that path when the file exists; otherwise it goes on the entry at 0:0 with the path in front.
function diagnosticsByFile(doc, root, entry, exists) {
  const byFile = new Map();
  for (const d of doc.diagnostics) {
    let file = path.resolve(root, d.primary.path);
    let range = editorRange(d.primary.range);
    let message = d.message;
    if (d.primary.file === null && !exists(file)) {
      file = path.resolve(root, entry);
      range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
      message = `${d.primary.path}: ${d.message}`;
    }
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ range, message, code: d.code, severity: d.severity });
  }
  return byFile;
}

module.exports = { byteOffset, editorRange, renderType, renderSignature, hoverText, definitionTarget, diagnosticsByFile };
```

- [ ] **Step 4: Run it and check it passes**

Run: `cd editors/vscode && node --test test/convert.test.cjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editors/vscode/src/convert.cjs editors/vscode/test/convert.test.cjs
git commit -m "feat(vscode): convert positions, types and diagnostics for the compiler adapter (#60)"
```

---

### Task 2: Compiler runs and sessions (`adapter.cjs`)

**Files:**
- Create: `editors/vscode/src/adapter.cjs`
- Create: `editors/vscode/test/fake-aster.cjs`
- Test: `editors/vscode/test/adapter.test.cjs`

**Interfaces:**
- Consumes: `convert.byteOffset`, `convert.diagnosticsByFile` (Task 1).
- Produces:
  - `run(compiler: string, argv: string[], {cwd, timeoutMs, signal?}): Promise<RunResult>` where `RunResult` is
    `{kind:'ok', status: number, doc: object}`, `{kind:'error', message: string}` or `{kind:'cancelled'}`
  - `exitMatches(doc, code): boolean`
  - `class Session({compiler, root, entry, timeoutMs, isDirty: (absFile) => boolean, runner = run})` with the fields
    `compiler`, `root`, `entry`, and these methods:
    - `saved(): void`
    - `check(): Promise<{kind:'diagnostics', ok, count, byFile} | {kind:'superseded'} | RunResult>`
    - `query(file: string, mode: 'pointer'|'caret', line, character, signal?): Promise<{kind:'answer', doc} | {kind:'stale', reasons: string[]} | {kind:'none', reason?: string} | {kind:'unavailable', reason} | RunResult>`

- [ ] **Step 1: Write the fake compiler** `editors/vscode/test/fake-aster.cjs`

```js
#!/usr/bin/env node
// A stand-in compiler for the adapter tests. FAKE_ASTER picks what it does; FAKE_ASTER_JSON is printed for `json`.
const mode = process.env.FAKE_ASTER;
if (mode === 'hang') setTimeout(() => {}, 60_000);
else if (mode === 'panic') {
  process.stderr.write('internal: boom\n');
  process.exit(101);
} else if (mode === 'garbage') process.stdout.write('not json\n');
else if (mode === 'usage') {
  process.stderr.write("error: unknown command 'query'\n");
  process.exit(2);
} else if (mode === 'argv') process.stdout.write(JSON.stringify({ schema: 'aster/1', argv: process.argv.slice(2) }) + '\n');
else if (mode === 'json') {
  process.stdout.write(process.env.FAKE_ASTER_JSON + '\n');
  process.exit(Number(process.env.FAKE_ASTER_EXIT || 0));
}
```

- [ ] **Step 2: Write the failing test** `editors/vscode/test/adapter.test.cjs`

```js
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chmodSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { after, beforeEach, test } = require('node:test');
const { run, Session } = require('../src/adapter.cjs');

const FAKE = path.join(__dirname, 'fake-aster.cjs');
chmodSync(FAKE, 0o755);
const fake = (mode, argv = [], opts = {}) => {
  process.env.FAKE_ASTER = mode;
  return run(process.execPath, [FAKE, ...argv], { cwd: __dirname, timeoutMs: 5000, ...opts });
};

test('run passes argv through without a shell', async () => {
  const r = await fake('argv', ['query', 'main.aster', '--file=$(touch pwned)', '--offset=3']);
  assert.equal(r.kind, 'ok');
  assert.deepEqual(r.doc.argv, ['query', 'main.aster', '--file=$(touch pwned)', '--offset=3']);
});

test('run reports a missing compiler', async () => {
  const r = await run('/nonexistent/aster', ['check'], { cwd: __dirname, timeoutMs: 5000 });
  assert.deepEqual(r, { kind: 'error', message: 'compiler not found: /nonexistent/aster' });
});

test('run reports a panic, garbage and usage on stderr as compiler problems', async () => {
  assert.match((await fake('panic')).message, /panicked \(exit 101\)/);
  assert.match((await fake('garbage')).message, /did not answer with aster\/1 JSON \(exit 0\)/);
  assert.match((await fake('usage')).message, /did not answer with aster\/1 JSON \(exit 2\): error: unknown command 'query'/);
});

test('run kills a compiler that runs past the timeout', async () => {
  const start = Date.now();
  const r = await fake('hang', [], { timeoutMs: 200 });
  assert.match(r.message, /timed out after 200 ms/);
  assert.ok(Date.now() - start < 3000);
});

test('run kills the compiler on cancellation', async () => {
  const controller = new AbortController();
  const pending = fake('hang', [], { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  assert.deepEqual(await pending, { kind: 'cancelled' });
  assert.deepEqual(await fake('hang', [], { signal: AbortSignal.abort() }), { kind: 'cancelled' });
});

// Sessions, with a scripted runner over real files so the hashes are real.
let root;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const MAIN = 'import "lib.aster";\nfn main(): int {\n    return twice(2);\n}\n';
const LIB = 'fn twice(n: int): int {\n    return n * 2;\n}\n';
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'aster-adapter-test-'));
  writeFileSync(path.join(root, 'main.aster'), MAIN);
  writeFileSync(path.join(root, 'lib.aster'), LIB);
});
after(() => rmSync(root, { recursive: true, force: true }));

const files = () => [
  { id: 0, path: 'main.aster', bom: false, sha256: sha(MAIN) },
  { id: 1, path: './lib.aster', bom: false, sha256: sha(LIB) },
];
const queryDoc = (query) => ({
  schema: 'aster/1', command: 'query', ok: true, files: files(), diagnostics: [],
  semantics: { available: true, declarations: [] },
  query: { request: { path: 'main.aster', mode: 'pointer', offset: 0, file: 0 }, ...query },
});
const answer = (doc, status = 0) => ({ kind: 'ok', status, doc });
const session = (runner, isDirty = () => false) =>
  new Session({ compiler: 'aster', root, entry: 'main.aster', timeoutMs: 5000, isDirty, runner });
const MAIN_FILE = () => path.join(root, 'main.aster');

test('query asks for the byte under the pointer, or the caret, of the saved file', async () => {
  const calls = [];
  const s = session(async (compiler, argv, opts) => {
    calls.push({ compiler, argv, cwd: opts.cwd });
    return answer(queryDoc({ status: 'none' }));
  });
  assert.equal((await s.query(MAIN_FILE(), 'pointer', 2, 11)).kind, 'answer');
  await s.query(MAIN_FILE(), 'caret', 2, 16);
  assert.deepEqual(calls, [
    { compiler: 'aster', argv: ['query', 'main.aster', '--file=main.aster', '--offset=48'], cwd: root },
    { compiler: 'aster', argv: ['query', 'main.aster', '--file=main.aster', '--caret=53'], cwd: root },
  ]);
});

test('a dirty document gets no answer and runs nothing', async () => {
  let ran = false;
  const s = session(async () => { ran = true; }, (f) => f === MAIN_FILE());
  assert.deepEqual(await s.query(MAIN_FILE(), 'pointer', 0, 0), { kind: 'stale', reasons: ['the document has unsaved changes'] });
  assert.equal(ran, false);
});

test('a dirty open import makes the answer stale', async () => {
  const lib = path.join(root, 'lib.aster');
  const s = session(async () => answer(queryDoc({ status: 'found', site: 'expression', type: { kind: 'int' } })), (f) => f === lib);
  assert.deepEqual(await s.query(MAIN_FILE(), 'pointer', 2, 11), { kind: 'stale', reasons: ['./lib.aster has unsaved changes'] });
});

test('an import changed after the compiler read it makes the answer stale', async () => {
  const s = session(async () => {
    writeFileSync(path.join(root, 'lib.aster'), LIB + '// edited\n');
    return answer(queryDoc({ status: 'found', site: 'expression', type: { kind: 'int' } }));
  });
  assert.deepEqual(await s.query(MAIN_FILE(), 'pointer', 2, 11), { kind: 'stale', reasons: ['./lib.aster changed since the compiler read it'] });
});

test('a save while the compiler runs makes the answer stale', async () => {
  const s = session(async () => {
    s.saved();
    return answer(queryDoc({ status: 'found', site: 'expression', type: { kind: 'int' } }));
  });
  assert.deepEqual(await s.query(MAIN_FILE(), 'pointer', 2, 11), { kind: 'stale', reasons: ['a file was saved while the compiler ran'] });
});

test('a fresh found answer comes back whole', async () => {
  const doc = queryDoc({ status: 'found', site: 'expression', type: { kind: 'int' } });
  assert.deepEqual(await session(async () => answer(doc)).query(MAIN_FILE(), 'pointer', 2, 11), { kind: 'answer', doc });
});

test('unavailable, invalid and a lone carriage return give no answer', async () => {
  const unavailable = queryDoc({ status: 'unavailable', reason: 'diagnostics' });
  assert.deepEqual(await session(async () => answer(unavailable, 1)).query(MAIN_FILE(), 'pointer', 0, 0), { kind: 'unavailable', reason: 'diagnostics' });
  const invalid = queryDoc({ status: 'invalid', reason: 'file-not-in-closure' });
  assert.deepEqual(await session(async () => answer(invalid, 2)).query(MAIN_FILE(), 'pointer', 0, 0), { kind: 'none', reason: 'invalid position: file-not-in-closure' });
  writeFileSync(path.join(root, 'main.aster'), 'fn main(): int {\r    return 0;\n}\n');
  let ran = false;
  const r = await session(async () => { ran = true; }).query(MAIN_FILE(), 'pointer', 0, 0);
  assert.equal(r.kind, 'none');
  assert.equal(ran, false);
});

test('an exit status that does not match the response is a compiler problem', async () => {
  const r = await session(async () => answer(queryDoc({ status: 'found', site: 'expression', type: { kind: 'int' } }), 1))
    .query(MAIN_FILE(), 'pointer', 2, 11);
  assert.deepEqual(r, { kind: 'error', message: 'unexpected exit 1 for a query response' });
});

test('a late response to an older check is dropped', async () => {
  const pending = [];
  const s = session((compiler, argv, opts) => new Promise((resolve) => pending.push({ resolve, signal: opts.signal })));
  const older = s.check();
  const newer = s.check();
  assert.equal(pending[0].signal.aborted, true);
  const doc = { schema: 'aster/1', command: 'check', ok: true, files: [], diagnostics: [] };
  pending[1].resolve(answer(doc));
  pending[0].resolve(answer({ ...doc, ok: false }, 1));
  assert.deepEqual(await newer, { kind: 'diagnostics', ok: true, count: 0, byFile: new Map() });
  assert.deepEqual(await older, { kind: 'superseded' });
});

test('check maps diagnostics and checks the exit status', async () => {
  const doc = {
    schema: 'aster/1', command: 'check', ok: false, files: [],
    diagnostics: [{ code: 'type.mismatch', severity: 'error', message: 'm', related: [],
      primary: { file: 1, path: './lib.aster', range: { start: 0, end: 1, start_line: 2, start_col_utf16: 12, end_line: 2, end_col_utf16: 16 } } }],
  };
  const r = await session(async () => answer(doc, 1)).check();
  assert.equal(r.kind, 'diagnostics');
  assert.equal(r.count, 1);
  assert.deepEqual([...r.byFile.keys()], [path.join(root, 'lib.aster')]);
  assert.equal((await session(async () => answer(doc, 0)).check()).kind, 'error');
});
```

Offsets: in `MAIN`, line 2 (`    return twice(2);`) starts at byte 37, so character 11 (`t` of `twice`) is byte 48
and character 16 (`(`) is byte 53.

- [ ] **Step 3: Run it and check it fails**

Run: `cd editors/vscode && node --test test/adapter.test.cjs`
Expected: FAIL with `Cannot find module '../src/adapter.cjs'`.

- [ ] **Step 4: Implement** `editors/vscode/src/adapter.cjs`

```js
'use strict';
// Runs the aster compiler one shot at a time and decides which answers may be shown: only those about the files as
// saved, never an older one over a newer one. No vscode import; src/extension.cjs is the glue.
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const convert = require('./convert.cjs');

// One compiler run: argv straight to the executable (never a shell), killed on timeout or abort. Resolves with the
// parsed aster/1 response and the exit status, or with why there is none.
function run(compiler, argv, { cwd, timeoutMs, signal }) {
  return new Promise((resolve) => {
    let settled = false;
    let child = null;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => {
      if (child) child.kill('SIGKILL');
      finish({ kind: 'cancelled' });
    };
    if (signal && signal.aborted) return finish({ kind: 'cancelled' });
    try {
      child = spawn(compiler, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
    } catch (e) {
      return finish({ kind: 'error', message: `cannot run ${compiler}: ${e.message}` });
    }
    if (signal) signal.addEventListener('abort', onAbort);
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ kind: 'error', message: `${compiler} timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (e) =>
      finish({ kind: 'error', message: e.code === 'ENOENT' ? `compiler not found: ${compiler}` : `cannot run ${compiler}: ${e.message}` }));
    child.on('close', (code, sig) => {
      if (code === null) return finish({ kind: 'error', message: `${compiler} was killed by ${sig}` });
      if (code === 101) return finish({ kind: 'error', message: `${compiler} panicked (exit 101)` });
      let doc = null;
      try {
        doc = JSON.parse(Buffer.concat(out).toString('utf8'));
      } catch {
        doc = null;
      }
      if (!doc || typeof doc !== 'object' || doc.schema !== 'aster/1') {
        const first = Buffer.concat(err).toString('utf8').split('\n')[0];
        return finish({ kind: 'error', message: `${compiler} did not answer with aster/1 JSON (exit ${code})${first ? `: ${first}` : ''}` });
      }
      finish({ kind: 'ok', status: code, doc });
    });
  });
}

// Whether `code` is the exit status the contract gives for this response (docs/inspect/README.md, Statuses).
function exitMatches(doc, code) {
  if (doc.command === 'query') {
    const q = doc.query;
    if (q.status === 'unavailable') return code === (q.reason === 'io' ? 2 : 1);
    if (q.status === 'invalid') return code === 2;
    return code === 0;
  }
  return doc.ok ? code === 0 : code === 1 || code === 2;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The SHA-256 of a file's bytes now, or null when it can't be read.
function hashFile(file) {
  try {
    return sha256(readFileSync(file));
  } catch {
    return null;
  }
}

// Why a query response no longer describes the saved files: a file in it is dirty in the editor, or its bytes on disk
// differ from what the compiler hashed (including a path that can't be read back). Empty when it is still fresh.
function staleReasons(doc, root, isDirty) {
  const reasons = [];
  for (const f of doc.files) {
    const file = path.resolve(root, f.path);
    if (isDirty(file)) reasons.push(`${f.path} has unsaved changes`);
    else if (hashFile(file) !== f.sha256) reasons.push(`${f.path} changed since the compiler read it`);
  }
  return reasons;
}

const mismatch = (r) => ({ kind: 'error', message: `unexpected exit ${r.status} for a ${r.doc.command} response` });

// One workspace's compiler, entry point and ordering: a newer check supersedes an older one, and a save while a query
// runs makes its answer stale.
class Session {
  constructor({ compiler, root, entry, timeoutMs, isDirty, runner = run }) {
    this.compiler = compiler;
    this.root = root;
    this.entry = entry;
    this.timeoutMs = timeoutMs;
    this.isDirty = isDirty;
    this.runner = runner;
    this.generation = 0;
    this.checkSeq = 0;
    this.checkController = null;
  }

  // A .aster file was saved: answers to requests that started before now are stale.
  saved() {
    this.generation++;
  }

  // Diagnostics for the entry's closure. Cancels a check still running; its result comes back `superseded`.
  async check() {
    if (this.checkController) this.checkController.abort();
    const controller = new AbortController();
    this.checkController = controller;
    const seq = ++this.checkSeq;
    const r = await this.runner(this.compiler, ['check', '--format=json', this.entry], { cwd: this.root, timeoutMs: this.timeoutMs, signal: controller.signal });
    if (seq !== this.checkSeq) return { kind: 'superseded' };
    this.checkController = null;
    if (r.kind !== 'ok') return r;
    if (r.doc.command !== 'check' || !exitMatches(r.doc, r.status)) return mismatch(r);
    const byFile = convert.diagnosticsByFile(r.doc, this.root, this.entry, existsSync);
    return { kind: 'diagnostics', ok: r.doc.ok, count: r.doc.diagnostics.length, byFile };
  }

  // What is at `line`/`character` of the saved `file` (absolute): `pointer` for hover, `caret` for definition.
  async query(file, mode, line, character, signal) {
    if (this.isDirty(file)) return { kind: 'stale', reasons: ['the document has unsaved changes'] };
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch (e) {
      return { kind: 'error', message: `cannot read ${file}: ${e.message}` };
    }
    const position = convert.byteOffset(bytes, line, character);
    if (position.error) return { kind: 'none', reason: position.error };
    const rel = path.relative(this.root, file).split(path.sep).join('/');
    const flag = mode === 'caret' ? '--caret' : '--offset';
    const generation = this.generation;
    const argv = ['query', this.entry, `--file=${rel}`, `${flag}=${position.offset}`];
    const r = await this.runner(this.compiler, argv, { cwd: this.root, timeoutMs: this.timeoutMs, signal });
    if (r.kind !== 'ok') return r;
    const doc = r.doc;
    if (doc.command !== 'query' || !doc.query || !exitMatches(doc, r.status)) return mismatch(r);
    if (generation !== this.generation) return { kind: 'stale', reasons: ['a file was saved while the compiler ran'] };
    const q = doc.query;
    if (q.status === 'unavailable') return { kind: 'unavailable', reason: q.reason };
    if (q.status === 'invalid') return { kind: 'none', reason: `invalid position: ${q.reason}` };
    const reasons = staleReasons(doc, this.root, this.isDirty);
    const own = doc.files[q.request.file];
    if (reasons.length === 0 && (!own || own.sha256 !== sha256(bytes))) reasons.push(`${rel} changed while the compiler ran`);
    if (reasons.length > 0) return { kind: 'stale', reasons };
    return { kind: 'answer', doc };
  }
}

module.exports = { run, exitMatches, Session };
```

- [ ] **Step 5: Run it and check it passes**

Run: `cd editors/vscode && node --test test/adapter.test.cjs test/convert.test.cjs`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add editors/vscode/src/adapter.cjs editors/vscode/test/fake-aster.cjs editors/vscode/test/adapter.test.cjs
git commit -m "feat(vscode): run the compiler one shot at a time and fail closed on stale answers (#60)"
```

---

### Task 3: VS Code glue, manifest and trust (`extension.cjs`)

**Files:**
- Create: `editors/vscode/src/extension.cjs`
- Create: `editors/vscode/test/vscode-mock.cjs`
- Test: `editors/vscode/test/extension.test.cjs`
- Modify: `editors/vscode/package.json`, `editors/vscode/.vscodeignore`, `editors/vscode/test/grammar.test.cjs:64-68`

**Interfaces:**
- Consumes: `Session` (Task 2), `convert.hoverText`, `convert.editorRange`, `convert.definitionTarget` (Task 1).
- Produces: `activate(context)`, `deactivate()`.

- [ ] **Step 1: Write the VS Code mock** `editors/vscode/test/vscode-mock.cjs`

```js
// The slice of the VS Code API that src/extension.cjs uses, recorded for assertions. install() makes
// require('vscode') return it.
const Module = require('node:module');

function create({ trusted = true, folder = null, settings = {} } = {}) {
  const state = { status: null, diagnostics: new Map(), hover: null, definition: null, log: [], listeners: {} };
  const on = (name) => (fn) => {
    state.listeners[name] = fn;
    return { dispose() {} };
  };
  class Range {
    constructor(sl, sc, el, ec) {
      Object.assign(this, { start: { line: sl, character: sc }, end: { line: el, character: ec } });
    }
  }
  const vscode = {
    Range,
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
    MarkdownString: class { appendCodeblock(code, lang) { this.value = `\`\`\`${lang}\n${code}\n\`\`\``; return this; } },
    Location: class { constructor(uri, range) { Object.assign(this, { uri, range }); } },
    StatusBarAlignment: { Left: 1 },
    Uri: { file: (fsPath) => ({ scheme: 'file', fsPath }) },
    window: {
      createOutputChannel: () => ({ appendLine: (l) => state.log.push(l), dispose() {} }),
      createStatusBarItem: () => (state.status = { text: '', tooltip: '', show() {}, dispose() {} }),
    },
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri, list) => state.diagnostics.set(uri.fsPath, list),
        clear: () => state.diagnostics.clear(),
        dispose() {},
      }),
      registerHoverProvider: (_, p) => ((state.hover = p), { dispose() {} }),
      registerDefinitionProvider: (_, p) => ((state.definition = p), { dispose() {} }),
    },
    workspace: {
      isTrusted: trusted,
      workspaceFolders: folder ? [{ uri: { fsPath: folder } }] : undefined,
      textDocuments: [],
      getConfiguration: () => ({ get: (key, fallback) => (key in settings ? settings[key] : fallback) }),
      onDidSaveTextDocument: on('save'),
      onDidChangeConfiguration: on('config'),
      onDidGrantWorkspaceTrust: on('trust'),
      onDidChangeWorkspaceFolders: on('folders'),
    },
  };
  return { vscode, state };
}

// Loads src/extension.cjs fresh against `vscode` and activates it.
function activate(vscode) {
  const original = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'vscode' ? vscode : original.call(this, request, ...rest);
  };
  try {
    const file = require.resolve('../src/extension.cjs');
    delete require.cache[file];
    require(file).activate({ subscriptions: [] });
  } finally {
    Module._load = original;
  }
}

module.exports = { create, activate };
```

- [ ] **Step 2: Write the failing test** `editors/vscode/test/extension.test.cjs`

```js
const assert = require('node:assert/strict');
const { chmodSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const mock = require('./vscode-mock.cjs');

const FAKE = path.join(__dirname, 'fake-aster.cjs');
chmodSync(FAKE, 0o755);
const root = mkdtempSync(path.join(tmpdir(), 'aster-extension-test-'));
after(() => rmSync(root, { recursive: true, force: true }));

async function settle(state) {
  for (let i = 0; i < 200 && (state.status.text === '' || state.status.text === 'Aster: checking…'); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('an untrusted workspace stays syntax-only and runs nothing', async () => {
  process.env.FAKE_ASTER = 'panic';
  const { vscode, state } = mock.create({ trusted: false, folder: root, settings: { compilerPath: FAKE, entry: 'main.aster' } });
  mock.activate(vscode);
  await settle(state);
  assert.equal(state.status.text, 'Aster: syntax only');
  assert.match(state.status.tooltip, /not trusted/);
  assert.deepEqual(state.log, []);
});

test('missing settings stay syntax-only and say which', async () => {
  const { vscode, state } = mock.create({ folder: root, settings: { compilerPath: FAKE } });
  mock.activate(vscode);
  assert.equal(state.status.text, 'Aster: syntax only');
  assert.match(state.status.tooltip, /aster\.entry/);
});

test('a trusted workspace checks the entry and publishes diagnostics', async () => {
  process.env.FAKE_ASTER = 'json';
  process.env.FAKE_ASTER_EXIT = '1';
  process.env.FAKE_ASTER_JSON = JSON.stringify({
    schema: 'aster/1', command: 'check', ok: false, files: [],
    diagnostics: [{ code: 'type.mismatch', severity: 'error', message: 'type mismatch', related: [],
      primary: { file: 1, path: './lib.aster', range: { start: 0, end: 4, start_line: 2, start_col_utf16: 12, end_line: 2, end_col_utf16: 16 } } }],
  });
  const { vscode, state } = mock.create({ folder: root, settings: { compilerPath: FAKE, entry: 'main.aster' } });
  mock.activate(vscode);
  await settle(state);
  assert.equal(state.status.text, 'Aster: 1 error — semantics unavailable');
  const [d] = state.diagnostics.get(path.join(root, 'lib.aster'));
  assert.deepEqual([d.message, d.code, d.source, d.range.start], ['type mismatch', 'type.mismatch', 'aster', { line: 1, character: 11 }]);
});

test('a relative compiler path resolves against the workspace folder', async () => {
  const bin = path.join(root, 'bin');
  require('node:fs').mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'aster'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(path.join(bin, 'aster'), 0o755);
  process.env.FAKE_ASTER = 'json';
  process.env.FAKE_ASTER_EXIT = '0';
  process.env.FAKE_ASTER_JSON = JSON.stringify({ schema: 'aster/1', command: 'check', ok: true, files: [], diagnostics: [] });
  const { vscode, state } = mock.create({ folder: root, settings: { compilerPath: './bin/aster', entry: 'main.aster' } });
  mock.activate(vscode);
  await settle(state);
  assert.equal(state.status.text, 'Aster: ✓ saved files');
});

test('a compiler problem is shown once and logged, not thrown', async () => {
  process.env.FAKE_ASTER = 'panic';
  const { vscode, state } = mock.create({ folder: root, settings: { compilerPath: FAKE, entry: 'main.aster' } });
  mock.activate(vscode);
  await settle(state);
  assert.equal(state.status.text, 'Aster: compiler problem');
  assert.match(state.log.join('\n'), /panicked/);
});
```

- [ ] **Step 3: Run it and check it fails**

Run: `cd editors/vscode && node --test test/extension.test.cjs`
Expected: FAIL with `Cannot find module '../src/extension.cjs'`.

- [ ] **Step 4: Implement** `editors/vscode/src/extension.cjs`

```js
'use strict';
// VS Code glue for the saved-file compiler adapter. Without workspace trust, a compiler and an entry point it stays
// syntax-only and runs nothing. All decisions about what may be shown live in adapter.cjs and convert.cjs.
const path = require('node:path');
const vscode = require('vscode');
const { Session } = require('./adapter.cjs');
const convert = require('./convert.cjs');

function activate(context) {
  const output = vscode.window.createOutputChannel('Aster');
  const diagnostics = vscode.languages.createDiagnosticCollection('aster');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  status.show();
  let session = null;

  const show = (text, tooltip) => {
    status.text = text;
    status.tooltip = tooltip;
  };
  const log = (line) => output.appendLine(`[${new Date().toISOString()}] ${line}`);
  const isDirty = (file) =>
    vscode.workspace.textDocuments.some((d) => d.uri.scheme === 'file' && d.isDirty && path.resolve(d.uri.fsPath) === file);
  const toRange = (r) => new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);

  function problem(r) {
    if (r.kind === 'cancelled') return;
    log(r.message);
    show('Aster: compiler problem', r.message);
  }

  function configure() {
    session = null;
    diagnostics.clear();
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!vscode.workspace.isTrusted) return show('Aster: syntax only', 'This workspace is not trusted, so no compiler runs.');
    if (!folder) return show('Aster: syntax only', 'Open a folder to use the compiler.');
    const config = vscode.workspace.getConfiguration('aster', folder.uri);
    const compilerSetting = config.get('compilerPath', '');
    const entry = config.get('entry', '');
    if (!compilerSetting) return show('Aster: syntax only', 'Set aster.compilerPath to use the compiler.');
    if (!entry) return show('Aster: syntax only', 'Set aster.entry to the file with main.');
    const root = folder.uri.fsPath;
    const compiler = /[\\/]/.test(compilerSetting) ? path.resolve(root, compilerSetting) : compilerSetting;
    session = new Session({ compiler, root, entry, timeoutMs: config.get('timeoutMs', 10000), isDirty });
    check();
  }

  async function check() {
    const current = session;
    if (!current) return;
    show('Aster: checking…', `Checking ${current.entry}`);
    const r = await current.check();
    if (current !== session || r.kind === 'superseded') return;
    if (r.kind !== 'diagnostics') return problem(r);
    diagnostics.clear();
    for (const [file, list] of r.byFile) {
      diagnostics.set(vscode.Uri.file(file), list.map((d) => {
        const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
        const item = new vscode.Diagnostic(toRange(d.range), d.message, severity);
        item.source = 'aster';
        item.code = d.code;
        return item;
      }));
    }
    if (r.ok) show('Aster: ✓ saved files', 'Hover and go to definition answer for saved files only.');
    else show(`Aster: ${r.count} error${r.count === 1 ? '' : 's'} — semantics unavailable`, 'Fix the errors and save to get hover and definition back.');
  }

  // A fresh query answer for the position, with the root it is relative to, or null.
  async function ask(document, position, token, mode) {
    const current = session;
    if (!current || document.uri.scheme !== 'file') return null;
    const controller = new AbortController();
    const subscription = token.onCancellationRequested(() => controller.abort());
    try {
      const r = await current.query(document.uri.fsPath, mode, position.line, position.character, controller.signal);
      if (current !== session) return null;
      if (r.kind === 'answer') return { doc: r.doc, root: current.root };
      if (r.kind === 'stale') {
        log(`dropped a stale answer: ${r.reasons.join('; ')}`);
        show('Aster: saved files only', 'Save your changes to get hover and definition.');
      } else if (r.kind === 'none') {
        if (r.reason) log(r.reason);
      } else if (r.kind !== 'unavailable') {
        problem(r);
      }
      return null;
    } finally {
      subscription.dispose();
    }
  }

  const hover = {
    async provideHover(document, position, token) {
      const a = await ask(document, position, token, 'pointer');
      const text = a && convert.hoverText(a.doc);
      if (!text) return null;
      const range = toRange(convert.editorRange(a.doc.query.location.range));
      return new vscode.Hover(new vscode.MarkdownString().appendCodeblock(text, 'aster'), range);
    },
  };
  const definition = {
    async provideDefinition(document, position, token) {
      const a = await ask(document, position, token, 'caret');
      const target = a && convert.definitionTarget(a.doc, a.root);
      return target ? new vscode.Location(vscode.Uri.file(target.file), toRange(target.range)) : null;
    },
  };

  const selector = { language: 'aster', scheme: 'file' };
  context.subscriptions.push(
    output,
    diagnostics,
    status,
    vscode.languages.registerHoverProvider(selector, hover),
    vscode.languages.registerDefinitionProvider(selector, definition),
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (session && d.languageId === 'aster') {
        session.saved();
        check();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aster')) configure();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(configure),
    vscode.workspace.onDidChangeWorkspaceFolders(configure),
  );
  configure();
}

function deactivate() {}

module.exports = { activate, deactivate };
```

- [ ] **Step 5: Update the manifest** `editors/vscode/package.json`

Make these changes:
- `"description"`: `"Syntax highlighting, plus compiler diagnostics, hover and go to definition for saved Aster files."`
- `"version"`: `"0.2.0"`
- Add `"main": "./src/extension.cjs"` and `"activationEvents": ["onLanguage:aster"]`.
- Add `"capabilities": {"untrustedWorkspaces": {"supported": "limited", "description": "In an untrusted workspace the extension only highlights syntax; it never runs a compiler.", "restrictedConfigurations": ["aster.compilerPath", "aster.entry"]}}`.
- Under `contributes`, add:

```json
"configuration": {
  "title": "Aster",
  "properties": {
    "aster.compilerPath": {
      "type": "string",
      "default": "",
      "description": "The aster compiler to run for diagnostics, hover and go to definition. A path with a slash is relative to the workspace folder. Empty: syntax highlighting only."
    },
    "aster.entry": {
      "type": "string",
      "default": "",
      "description": "The program's entry point (the file with main), relative to the workspace folder. Empty: syntax highlighting only."
    },
    "aster.timeoutMs": {
      "type": "number",
      "default": 10000,
      "minimum": 100,
      "description": "How long one compiler run may take, in milliseconds."
    }
  }
}
```

- `"keywords"`: add `"diagnostics"`.
- `scripts.package`: change the output to `aster-syntax-0.2.0.vsix`.

In `editors/vscode/.vscodeignore`, add these two lines after `!syntaxes/aster.tmLanguage.json`:

```
!src/
!src/*.cjs
```

In `editors/vscode/test/grammar.test.cjs`, replace lines 64-68 (the test's name and its first four asserts) with:

```js
test('manifest associates .aster with the grammar and configuration, and runs only the compiler adapter', () => {
  assert.equal(manifest.main, './src/extension.cjs');
  assert.equal(manifest.browser, undefined);
  assert.deepEqual(manifest.activationEvents, ['onLanguage:aster']);
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(manifest.capabilities.untrustedWorkspaces, {
    supported: 'limited',
    description: 'In an untrusted workspace the extension only highlights syntax; it never runs a compiler.',
    restrictedConfigurations: ['aster.compilerPath', 'aster.entry'],
  });
```

- [ ] **Step 6: Run the extension's suite and package it**

Run: `cd editors/vscode && npm test && npm run package && unzip -l aster-syntax-0.2.0.vsix`
Expected: every test passes, and the VSIX lists `extension/src/extension.cjs`, `extension/src/adapter.cjs` and
`extension/src/convert.cjs`, with no `test/` or `demo/` files. Delete the `.vsix` afterwards; `.gitignore` already
ignores it.

- [ ] **Step 7: Commit**

```bash
git add editors/vscode/src/extension.cjs editors/vscode/test/vscode-mock.cjs editors/vscode/test/extension.test.cjs \
  editors/vscode/package.json editors/vscode/.vscodeignore editors/vscode/test/grammar.test.cjs
git commit -m "feat(vscode): diagnostics, hover and definition behind workspace trust (#60)"
```

---

### Task 4: Demo, agent script and workflow test against the real compiler

**Files:**
- Create: `editors/vscode/demo/main.aster`, `editors/vscode/demo/shapes.aster`, `editors/vscode/demo/shapes.broken.aster`, `editors/vscode/demo/.vscode/settings.json`, `editors/vscode/demo/agent.mjs`
- Test: `tests/vscode_adapter.test.ts`

**Interfaces:**
- Consumes: `Session`, `run` (Task 2); `convert.hoverText`, `convert.editorRange`, `convert.definitionTarget` (Task 1); `stage()` and `REPO_ROOT` from `tests/stage.ts`.
- Produces: `node editors/vscode/demo/agent.mjs <compiler>` prints
  `{"broken":{code,path,line,col_utf16},"fixed":bool,"hover":Type,"definition":{name,path,line,col_utf16},"fresh":bool}`.

- [ ] **Step 1: Write the demo**

`editors/vscode/demo/main.aster`:

```
import "shapes.aster";

// Demo for the Aster VS Code extension. 📐 Hover a use, or go to its definition.
fn main(): int {
    let side: int = 3;
    let label: string = "📐 square"; let total: int = area(side);
    if total > 5 {
        let side: int = 4;
        print(side);
    }
    print(label);
    return total - 9;
}
```

`editors/vscode/demo/shapes.aster`:

```
// Areas of simple shapes.
fn area(side: int): int {
    return side * side;
}
```

`editors/vscode/demo/shapes.broken.aster` is the same, but with `return true;` in place of `return side * side;`.

`editors/vscode/demo/.vscode/settings.json`:

```json
{
  "aster.entry": "main.aster",
  "aster.compilerPath": "../../../build/asterc"
}
```

Check it: `build/asterc check editors/vscode/demo/main.aster` exits 0. With `shapes.broken.aster` copied over
`shapes.aster` in a temporary copy, `check --format=json` reports a `type.mismatch`.

- [ ] **Step 2: Write the agent script** `editors/vscode/demo/agent.mjs`

```js
#!/usr/bin/env node
// An agent's view of the demo through the public aster/1 JSON alone (docs/inspect/README.md), sharing no code with the
// extension. Usage: node agent.mjs <aster-compiler>. Works on a temporary copy and prints one JSON object of facts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = process.argv[2] ?? 'aster';
const compiler = /[\\/]/.test(arg) ? resolve(arg) : arg;
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'aster-agent-'));
const aster = (...argv) => JSON.parse(spawnSync(compiler, argv, { cwd: dir, encoding: 'utf8' }).stdout);
const sha = (path) => createHash('sha256').update(readFileSync(join(dir, path))).digest('hex');

try {
  copyFileSync(join(here, 'main.aster'), join(dir, 'main.aster'));
  copyFileSync(join(here, 'shapes.broken.aster'), join(dir, 'shapes.aster'));
  const broken = aster('check', '--format=json', 'main.aster').diagnostics[0];
  copyFileSync(join(here, 'shapes.aster'), join(dir, 'shapes.aster'));
  const fixed = aster('check', '--format=json', 'main.aster');
  const call = readFileSync(join(dir, 'main.aster')).indexOf('area(side)');
  const hover = aster('query', 'main.aster', '--file=main.aster', `--offset=${call + 5}`);
  const def = aster('query', 'main.aster', '--file=main.aster', `--caret=${call + 4}`);
  const target = def.semantics.declarations[def.query.target];
  console.log(JSON.stringify({
    broken: { code: broken.code, path: broken.primary.path, line: broken.primary.range.start_line, col_utf16: broken.primary.range.start_col_utf16 },
    fixed: fixed.ok,
    hover: hover.query.type,
    definition: { name: target.name, path: target.location.path, line: target.location.range.start_line, col_utf16: target.location.range.start_col_utf16 },
    fresh: [hover, def].every((doc) => doc.files.every((f) => sha(f.path) === f.sha256)),
  }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
```

- [ ] **Step 3: Write the workflow test** `tests/vscode_adapter.test.ts`

```ts
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { REPO_ROOT, stage } from './stage.js';

// Issue #60: the VS Code adapter (editors/vscode/src) driven against the real compiler on a copy of the demo, and
// the independent agent script (editors/vscode/demo/agent.mjs) reporting the same facts.

const require = createRequire(import.meta.url);
const adapter = require('../editors/vscode/src/adapter.cjs');
const convert = require('../editors/vscode/src/convert.cjs');
const DEMO = join(REPO_ROOT, 'editors/vscode/demo');
const dir = mkdtempSync(join(tmpdir(), 'aster-vscode-adapter-'));
const MAIN = join(dir, 'main.aster');
const SHAPES = join(dir, 'shapes.aster');
const dirty = new Set<string>();
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  dirty.clear();
  cpSync(join(DEMO, 'main.aster'), MAIN);
  cpSync(join(DEMO, 'shapes.aster'), SHAPES);
});

const session = (runner?: unknown) =>
  new adapter.Session({
    compiler: stage().bin, root: dir, entry: 'main.aster', timeoutMs: 60_000,
    isDirty: (f: string) => dirty.has(f), ...(runner ? { runner } : {}),
  });

// The editor position (0-based line, UTF-16 character) of the `nth` `needle` in `file`, moved right by `shift`.
function at(file: string, needle: string, shift = 0, nth = 0) {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n');
  let seen = 0;
  for (let line = 0; line < lines.length; line++) {
    for (let c = lines[line].indexOf(needle); c >= 0; c = lines[line].indexOf(needle, c + 1)) {
      if (seen++ === nth) return { line, character: c + shift };
    }
  }
  throw new Error(`no ${needle} in ${file}`);
}

describe('the VS Code adapter on the demo', () => {
  it('shows an imported error, then hover and definition after the fix', async () => {
    cpSync(join(DEMO, 'shapes.broken.aster'), SHAPES);
    const s = session();
    const broken = await s.check();
    expect(broken).toMatchObject({ kind: 'diagnostics', ok: false, count: 1 });
    const [d] = broken.byFile.get(SHAPES);
    expect([d.code, d.range.start]).toEqual(['type.mismatch', at('shapes.aster', 'true')]);
    const use = at('main.aster', 'area(side)', 5);
    expect(await s.query(MAIN, 'pointer', use.line, use.character)).toEqual({ kind: 'unavailable', reason: 'diagnostics' });

    cpSync(join(DEMO, 'shapes.aster'), SHAPES);
    s.saved();
    expect(await s.check()).toMatchObject({ kind: 'diagnostics', ok: true, count: 0 });
    const hover = await s.query(MAIN, 'pointer', use.line, use.character);
    expect(hover.kind).toBe('answer');
    expect(convert.hoverText(hover.doc)).toBe('int');
    expect(convert.editorRange(hover.doc.query.location.range)).toEqual({ start: use, end: { line: use.line, character: use.character + 4 } });

    const caret = at('main.aster', 'area(side)', 4);
    const def = await s.query(MAIN, 'caret', caret.line, caret.character);
    expect(convert.hoverText(def.doc)).toBe('fn area(side: int): int');
    expect(convert.definitionTarget(def.doc, dir)).toEqual({
      file: SHAPES,
      range: { start: at('shapes.aster', 'area'), end: at('shapes.aster', 'area', 4) },
    });
  });

  it('resolves a shadowed name to the inner declaration and the outer one outside it', async () => {
    const s = session();
    const inner = at('main.aster', 'print(side)', 10);
    const r = await s.query(MAIN, 'caret', inner.line, inner.character);
    expect(convert.definitionTarget(r.doc, dir).range.start).toEqual(at('main.aster', 'let side', 4, 1));
    const outer = at('main.aster', 'area(side)', 9);
    const o = await s.query(MAIN, 'caret', outer.line, outer.character);
    expect(convert.definitionTarget(o.doc, dir).range.start).toEqual(at('main.aster', 'let side', 4, 0));
  });

  it('describes a declaration after an astral character on the same line', async () => {
    const total = at('main.aster', 'let total', 4);
    const r = await session().query(MAIN, 'pointer', total.line, total.character);
    expect(convert.hoverText(r.doc)).toBe('local total: int');
  });

  it('finds a definition from the end of a line', async () => {
    const end = at('main.aster', 'print(label);', 'print(label);'.length + 3);
    expect((await session().query(MAIN, 'caret', end.line, end.character)).kind).toBe('answer');
  });

  it('drops an answer when an import changes after the compiler read it, or is dirty', async () => {
    const use = at('main.aster', 'area(side)', 5);
    const editing = session(async (compiler: string, argv: string[], opts: object) => {
      const r = await adapter.run(compiler, argv, opts);
      writeFileSync(SHAPES, readFileSync(SHAPES, 'utf8') + '// edited\n');
      return r;
    });
    expect(await editing.query(MAIN, 'pointer', use.line, use.character)).toEqual({
      kind: 'stale', reasons: ['./shapes.aster changed since the compiler read it'],
    });
    cpSync(join(DEMO, 'shapes.aster'), SHAPES);
    dirty.add(SHAPES);
    expect(await session().query(MAIN, 'pointer', use.line, use.character)).toEqual({
      kind: 'stale', reasons: ['./shapes.aster has unsaved changes'],
    });
  });

  it('agrees with the independent agent script', async () => {
    const r = spawnSync(process.execPath, [join(DEMO, 'agent.mjs'), stage().bin], { encoding: 'utf8', timeout: 60_000 });
    expect(r.status).toBe(0);
    const agent = JSON.parse(r.stdout);

    cpSync(join(DEMO, 'shapes.broken.aster'), SHAPES);
    const s = session();
    const [d] = (await s.check()).byFile.get(SHAPES);
    cpSync(join(DEMO, 'shapes.aster'), SHAPES);
    s.saved();
    const fixed = await s.check();
    const use = at('main.aster', 'area(side)', 5);
    const hover = await s.query(MAIN, 'pointer', use.line, use.character);
    const caret = at('main.aster', 'area(side)', 4);
    const def = convert.definitionTarget((await s.query(MAIN, 'caret', caret.line, caret.character)).doc, dir);

    expect(agent).toEqual({
      broken: { code: d.code, path: './shapes.aster', line: d.range.start.line + 1, col_utf16: d.range.start.character + 1 },
      fixed: fixed.ok,
      hover: hover.doc.query.type,
      definition: { name: 'area', path: './shapes.aster', line: def.range.start.line + 1, col_utf16: def.range.start.character + 1 },
      fresh: true,
    });
  });
});
```

- [ ] **Step 4: Run it**

Run: `pnpm vitest run tests/vscode_adapter.test.ts`
Expected: 6 PASS. A failure here is a real bug in the adapter or in the test's positions: fix the cause; don't
loosen the assertion.

- [ ] **Step 5: Commit**

```bash
git add editors/vscode/demo tests/vscode_adapter.test.ts
git commit -m "test(vscode): demo workflow and agent script against the real compiler (#60)"
```

---

### Task 5: Documentation, measurements and verification

**Files:**
- Modify: `editors/vscode/README.md`

- [ ] **Step 1: Measure** the latency of one-shot runs, as the median of 3 with `/usr/bin/time -f '%e s %M KB'` and
  `build/asterc` (run `pnpm build` first). Measure:
  - on the demo, from `editors/vscode/demo`: `check --format=json main.aster`, and `query main.aster --file=main.aster --offset=<the area(side) use>`;
  - on the compiler, from `packages/asterc-self`: `check --format=json asterc.aster`, and `query asterc.aster --file=checker.aster --offset=1000`.

- [ ] **Step 2: Rewrite** `editors/vscode/README.md`:
  - The intro says the extension highlights syntax with no setup. With workspace trust, `aster.compilerPath` and
    `aster.entry`, it also shows compiler diagnostics, hover and go to definition **for saved files**, by running the
    compiler one shot at a time. It is not a language server.
  - Install: the VSIX name becomes `aster-syntax-0.2.0.vsix`.
  - **Compiler features** covers the three settings, the trust rule, what runs and when (check on activation, on a
    settings change and on every save; one `query` per hover or definition request), and the status bar states from
    the spec.
  - **Saved files only** covers the freshness rules, and says that a lone `\r` file gets no answers.
  - **Demo** walks through it: open `editors/vscode/demo` as a folder and trust it; the settings point at
    `../../../build/asterc` (run `pnpm build` first); copy `shapes.broken.aster` over `shapes.aster` and save, and
    the error shows in `shapes.aster`; restore and save; hover `side` in `area(side)` and it shows `int`; F12 on
    `area` goes to `shapes.aster`; F12 on the inner `print(side)` goes to the inner `let`. Then
    `node demo/agent.mjs ../../build/asterc` prints the same facts.
  - **Manual smoke test** is the checklist above with a result line per step, and the date, platform and VS Code
    version filled in when someone runs it. If nobody has run it yet, say "not yet run" — never invent results.
  - **Latency** is the table from Step 1.
  - **Highlighting boundaries** stays as it is, except the last bullet becomes: "No completion, formatting, rename,
    semantic highlighting or unsaved-buffer analysis; hover, definition and diagnostics come from the compiler for
    saved files only."
  - **Develop** lists the new tests (`npm test` runs the grammar, convert, adapter and extension suites;
    `pnpm vitest run tests/vscode_adapter.test.ts` runs the demo against the real compiler) and the VSIX contents
    (it now includes `src/`).

- [ ] **Step 3: Full verification**

Run: `cd editors/vscode && npm test && npm run package`, then from the repo root `pnpm lint && pnpm typecheck && pnpm test`.
Expected: the extension's tests pass and it packages. Lint and typecheck are clean. `pnpm test` fails only
`tests/llvm_backend.test.ts`, and only when there is no clang on the machine.

- [ ] **Step 4: Commit**

```bash
git add editors/vscode/README.md
git commit -m "docs(vscode): compiler features, saved-file scope, demo and latency (#60)"
```

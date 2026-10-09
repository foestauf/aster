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

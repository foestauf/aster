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

const checkJson = (diagnostics, exit) => {
  process.env.FAKE_ASTER = 'json';
  process.env.FAKE_ASTER_EXIT = String(exit);
  process.env.FAKE_ASTER_JSON = JSON.stringify({ schema: 'aster/1', command: 'check', ok: diagnostics.length === 0, files: [], diagnostics });
};

test('a missing entry is shown as an error, not a stuck check', async () => {
  checkJson([{ code: 'io.root-unreadable', severity: 'error', message: "cannot read 'mian.aster'", primary: { file: null, path: 'mian.aster', range: null }, related: [] }], 2);
  const { vscode, state } = mock.create({ folder: root, settings: { compilerPath: FAKE, entry: 'mian.aster' } });
  mock.activate(vscode);
  await settle(state);
  assert.equal(state.status.text, 'Aster: 1 error — semantics unavailable');
  assert.equal(state.diagnostics.get(path.join(root, 'mian.aster'))[0].code, 'io.root-unreadable');
});

test('a malformed response is a compiler problem, not an exception', async () => {
  process.env.FAKE_ASTER = 'json';
  process.env.FAKE_ASTER_EXIT = '0';
  process.env.FAKE_ASTER_JSON = JSON.stringify({ schema: 'aster/1', command: 'check', ok: true });
  const { vscode, state } = mock.create({ folder: root, settings: { compilerPath: FAKE, entry: 'main.aster' } });
  mock.activate(vscode);
  await settle(state);
  assert.equal(state.status.text, 'Aster: compiler problem');
});

test('a failed check clears the previous diagnostics', async () => {
  checkJson([{ code: 'type.mismatch', severity: 'error', message: 'm', related: [],
    primary: { file: 1, path: './lib.aster', range: { start: 0, end: 4, start_line: 2, start_col_utf16: 12, end_line: 2, end_col_utf16: 16 } } }], 1);
  const { vscode, state } = mock.create({ folder: root, settings: { compilerPath: FAKE, entry: 'main.aster' } });
  mock.activate(vscode);
  await settle(state);
  assert.equal(state.diagnostics.size, 1);
  process.env.FAKE_ASTER = 'panic';
  state.listeners.save({ languageId: 'aster' });
  await settle(state);
  assert.equal(state.status.text, 'Aster: compiler problem');
  assert.equal(state.diagnostics.size, 0);
});

const { entryList } = require('../src/adapter.cjs');

test('aster.entry is a string or a list of strings', () => {
  assert.deepEqual(entryList('main.aster'), ['main.aster']);
  assert.deepEqual(entryList(''), []);
  assert.deepEqual(entryList(['app.aster', '', 'tool.aster', 'app.aster', 3]), ['app.aster', 'tool.aster']);
  assert.deepEqual(entryList(undefined), []);
});

test('each workspace folder runs its own compiler with its own entries, from its own directory', async () => {
  process.env.FAKE_ASTER = 'echo-check';
  const a = path.join(root, 'fa');
  const b = path.join(root, 'fb');
  const c = path.join(root, 'fc');
  for (const d of [a, b, c]) require('node:fs').mkdirSync(d, { recursive: true });
  const { vscode, state } = mock.create({ folders: [
    { path: a, settings: { compilerPath: FAKE, entry: 'main.aster' } },
    { path: b, settings: { compilerPath: FAKE, entry: ['app.aster', 'tool.aster'] } },
    { path: c, settings: { compilerPath: FAKE } },
  ] });
  mock.activate(vscode);
  await settle(state);
  for (let i = 0; i < 200 && state.diagnostics.size < 2; i++) await new Promise((r) => setTimeout(r, 10));
  const messages = (dir) => state.diagnostics.get(path.join(dir, 'x.aster')).map((d) => d.message);
  assert.deepEqual(messages(a), [`${a} check --format=json main.aster`]);
  assert.deepEqual(messages(b), [`${b} check --format=json app.aster`, `${b} check --format=json tool.aster`]);
  assert.equal(state.diagnostics.has(path.join(c, 'x.aster')), false);
  // The status bar follows the active editor's folder.
  vscode.window.activeTextEditor = { document: { uri: { scheme: 'file', fsPath: path.join(c, 'main.aster') } } };
  state.listeners.activeEditor();
  assert.equal(state.status.text, 'Aster: syntax only');
  assert.match(state.status.tooltip, /^fc: .*aster\.entry/);
});

test('a .aster file changed outside the editor re-checks the folder that contains it', async () => {
  checkJson([], 0);
  const pids = path.join(root, 'pids-watch');
  writeFileSync(pids, '');
  process.env.FAKE_ASTER_PIDS = pids;
  try {
    const { vscode, state } = mock.create({ folder: root, settings: { compilerPath: FAKE, entry: 'main.aster' } });
    mock.activate(vscode);
    await settle(state);
    assert.deepEqual(state.watchers.map((w) => w.glob), ['**/*.aster']);
    const runs = () => require('node:fs').readFileSync(pids, 'utf8').trim().split('\n').filter(Boolean).length;
    assert.equal(runs(), 1);
    state.listeners.fsDelete({ scheme: 'file', fsPath: path.join(root, 'lib.aster') });
    await settle(state);
    for (let i = 0; i < 200 && runs() < 2; i++) await new Promise((r) => setTimeout(r, 10));
    await settle(state);
    assert.equal(runs(), 2);
    // Outside every folder and every closure: nothing runs.
    state.listeners.fsChange({ scheme: 'file', fsPath: path.join(tmpdir(), 'elsewhere.aster') });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(runs(), 2);
  } finally {
    delete process.env.FAKE_ASTER_PIDS;
  }
});

// Whether a process is still running.
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function hungCheck(name) {
  process.env.FAKE_ASTER = 'hang';
  const pids = path.join(root, `pids-${name}`);
  writeFileSync(pids, '');
  process.env.FAKE_ASTER_PIDS = pids;
  const { vscode, state } = mock.create({ folder: root, settings: { compilerPath: FAKE, entry: 'main.aster' } });
  const extension = mock.activate(vscode);
  let pid = 0;
  for (let i = 0; i < 300 && !pid; i++) {
    await new Promise((r) => setTimeout(r, 10));
    pid = Number(require('node:fs').readFileSync(pids, 'utf8').split('\n')[0]) || 0;
  }
  delete process.env.FAKE_ASTER_PIDS;
  assert.ok(pid > 0 && alive(pid));
  return { vscode, state, extension, pid };
}

async function closesWithin(pid, ms) {
  const start = Date.now();
  while (alive(pid) && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
  return !alive(pid);
}

test('a configuration change kills the old context\'s running check', async () => {
  const { vscode, state, pid } = await hungCheck('config');
  process.env.FAKE_ASTER = 'json';
  checkJson([], 0);
  vscode.workspace.isTrusted = false;
  state.listeners.config({ affectsConfiguration: () => true });
  assert.ok(await closesWithin(pid, 100));
  assert.equal(state.status.text, 'Aster: syntax only');
});

test('deactivate kills running checks', async () => {
  const { extension, pid } = await hungCheck('deactivate');
  extension.deactivate();
  assert.ok(await closesWithin(pid, 100));
});

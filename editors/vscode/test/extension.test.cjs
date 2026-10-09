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

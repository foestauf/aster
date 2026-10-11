import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stage } from './stage.js';

// Issue #70: per-folder context, entry lists and bounded requests in the VS Code adapter (editors/vscode/src), driven
// against the real compiler. A fresh CLI run is the oracle; process counts come from a counting spawn (spawns minus
// `close` events).

const require = createRequire(import.meta.url);
const adapter = require('../editors/vscode/src/adapter.cjs');

const LIB = 'fn twice(x: int): int {\n    return x * 2;\n}\n';
const BROKEN_LIB = 'fn twice(x: int): int {\n    return true;\n}\n';
const program = (...imports: string[]) =>
  `${imports.map((i) => `import "${i}";\n`).join('')}fn main(): int {\n    let v: int = twice(2);\n    return v - 4;\n}\n`;
const TOOL = 'import "lib.aster";\nfn main(): int {\n    let w: int = twice(3);\n    return w - 6;\n}\n';
const NOTES = 'fn note(): int {\n    return 1;\n}\n';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aster-vscode-context-')));
  roots.push(root);
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}

// A runner whose spawns are counted, with the time from each kill to its process's `close`.
function counting() {
  const c = { spawned: 0, closed: 0, killToClose: [] as number[] };
  const spawnCounting = (cmd: string, args: string[], opts: object) => {
    const child = spawn(cmd, args, opts);
    c.spawned++;
    let killedAt = 0;
    const kill = child.kill.bind(child);
    child.kill = (sig?: NodeJS.Signals | number) => {
      killedAt = performance.now();
      return kill(sig);
    };
    child.on('close', () => {
      c.closed++;
      if (killedAt) c.killToClose.push(performance.now() - killedAt);
    });
    return child;
  };
  const runner = (compiler: string, argv: string[], opts: object) => adapter.run(compiler, argv, { ...opts, spawn: spawnCounting });
  return { c, runner, live: () => c.spawned - c.closed };
}

async function drained(live: () => number) {
  for (let i = 0; i < 100 && live() > 0; i++) await new Promise((r) => setTimeout(r, 10));
  return live();
}

const folder = (root: string, entries: string[], runner?: unknown) =>
  new adapter.Folder({ compiler: stage().bin, root, entries, timeoutMs: 60_000, isDirty: () => false, ...(runner ? { runner } : {}) });

// The editor position (0-based line, UTF-16 character) and byte offset of `probe` in `file` (ASCII fixtures).
function at(root: string, file: string, probe: string) {
  const text = readFileSync(join(root, file), 'utf8');
  const offset = text.indexOf(probe);
  if (offset < 0) throw new Error(`no ${probe} in ${file}`);
  const before = text.slice(0, offset).split('\n');
  return { line: before.length - 1, character: before.at(-1)!.length, offset };
}

function cli(cwd: string, argv: string[]) {
  return JSON.parse(spawnSync(stage().bin, argv, { cwd, encoding: 'utf8', maxBuffer: 1 << 30 }).stdout);
}
const cliQuery = (cwd: string, entry: string, file: string, offset: number, flag = '--offset') =>
  cli(cwd, ['query', entry, `--file=${file}`, `${flag}=${offset}`]);

// The answer as the CLI reports it: the selection and the closure, without digests (hashed independently).
const facts = (doc: any) => ({ query: doc.query, files: doc.files.map((f: any) => f.path) });

async function hover(f: any, root: string, file: string, probe: string, mode = 'pointer') {
  const p = at(root, file, probe);
  return f.query(join(root, file), mode, p.line, p.character);
}

describe('per-folder context', () => {
  it('two-folders: a hover in folder b equals the CLI run from b with b\'s entry', async () => {
    const root = project({ 'a/main.aster': program('lib.aster'), 'a/lib.aster': LIB, 'b/main.aster': program('lib.aster'), 'b/lib.aster': LIB });
    const a = folder(join(root, 'a'), ['main.aster']);
    const b = folder(join(root, 'b'), ['main.aster']);
    await a.check();
    await b.check();
    const r = await hover(b, join(root, 'b'), 'lib.aster', 'x * 2');
    expect(r.kind).toBe('answer');
    expect(facts(r.doc)).toEqual(facts(cliQuery(join(root, 'b'), 'main.aster', 'lib.aster', at(join(root, 'b'), 'lib.aster', 'x * 2').offset)));
    expect(b.contains(join(root, 'b', 'lib.aster'))).toBe(true);
    expect(a.contains(join(root, 'b', 'lib.aster'))).toBe(false);
  });
});

describe('entry lists', () => {
  const files = { 'app.aster': program('lib.aster'), 'tool.aster': TOOL, 'lib.aster': LIB };

  it('two-entries-shared-lib: each entry answers its own files, the first listed answers the shared one', async () => {
    const root = project(files);
    const f = folder(root, ['app.aster', 'tool.aster']);
    expect(await f.check()).toMatchObject({ kind: 'diagnostics', ok: true, count: 0 });
    const tool = await hover(f, root, 'tool.aster', 'twice(3)');
    expect(facts(tool.doc)).toEqual(facts(cliQuery(root, 'tool.aster', 'tool.aster', at(root, 'tool.aster', 'twice(3)').offset)));
    const lib = await hover(f, root, 'lib.aster', 'x * 2');
    expect(facts(lib.doc)).toEqual(facts(cliQuery(root, 'app.aster', 'lib.aster', at(root, 'lib.aster', 'x * 2').offset)));
  });

  it('reordering the list changes only which entry answers for a shared file', async () => {
    const root = project(files);
    const f = folder(root, ['tool.aster', 'app.aster']);
    await f.check();
    const lib = await hover(f, root, 'lib.aster', 'x * 2');
    expect(facts(lib.doc)).toEqual(facts(cliQuery(root, 'tool.aster', 'lib.aster', at(root, 'lib.aster', 'x * 2').offset)));
    const app = await hover(f, root, 'app.aster', 'twice(2)');
    expect(facts(app.doc)).toEqual(facts(cliQuery(root, 'app.aster', 'app.aster', at(root, 'app.aster', 'twice(2)').offset)));
  });

  it('shows the union of every entry\'s diagnostics, without duplicates', async () => {
    const root = project({ ...files, 'lib.aster': BROKEN_LIB, 'tool.aster': `${TOOL}fn extra(): int {\n    return false;\n}\n` });
    const r = await folder(root, ['app.aster', 'tool.aster']).check();
    const codes = (entry: string) => cli(root, ['check', '--format=json', entry]).diagnostics.length;
    expect(codes('app.aster')).toBe(1);
    expect(codes('tool.aster')).toBe(2);
    // The lib.aster error is reported by both entries and shown once.
    expect(r).toMatchObject({ kind: 'diagnostics', ok: false, count: 2 });
    expect(r.byFile.get(join(root, 'lib.aster'))).toHaveLength(1);
    expect(r.byFile.get(join(root, 'tool.aster'))).toHaveLength(1);
  });
});

describe('outside the closure', () => {
  it('starts no compiler until a save, and answers once an entry imports the file', async () => {
    const root = project({ 'main.aster': program('lib.aster'), 'lib.aster': LIB, 'notes.aster': NOTES });
    const k = counting();
    const f = folder(root, ['main.aster'], k.runner);
    await f.check();
    const spawned = k.c.spawned;
    expect(await hover(f, root, 'notes.aster', 'note')).toMatchObject({ kind: 'none', skipped: true });
    expect(k.c.spawned).toBe(spawned);

    f.saved();
    expect(await hover(f, root, 'notes.aster', 'note')).toMatchObject({ kind: 'none', reason: adapter.NOT_IN_CLOSURE });
    expect(k.c.spawned).toBe(spawned + 1);
    // That run recorded a fresh closure, so the next hover is skipped again.
    expect(await hover(f, root, 'notes.aster', 'note')).toMatchObject({ kind: 'none', skipped: true });
    expect(k.c.spawned).toBe(spawned + 1);

    writeFileSync(join(root, 'main.aster'), program('lib.aster', 'notes.aster'));
    f.saved();
    await f.check();
    const r = await hover(f, root, 'notes.aster', 'note');
    expect(r.kind).toBe('answer');
    expect(facts(r.doc)).toEqual(facts(cliQuery(root, 'main.aster', 'notes.aster', at(root, 'notes.aster', 'note').offset)));
  });
});

const closureOf = (f: any, file: string) => [...f.owner(file).closure].toSorted();
const cliClosure = (root: string, doc: any) => doc.files.map((x: any) => resolve(root, x.path)).toSorted();

describe('a missing entry', () => {
  it('leaves the closure unknown, so a hover still reports the unreadable entry', async () => {
    const root = project({ 'main.aster': program('lib.aster'), 'lib.aster': LIB });
    const f = folder(root, ['mian.aster']);
    expect(await f.check()).toMatchObject({ kind: 'diagnostics', ok: false, count: 1 });
    expect(await hover(f, root, 'main.aster', 'twice(2)')).toEqual({ kind: 'unavailable', reason: 'io' });
  });
});

describe('changes outside the editor', () => {
  for (const [id, change] of [
    ['external-change', (root: string) => writeFileSync(join(root, 'lib.aster'), BROKEN_LIB)],
    ['deleted-import', (root: string) => unlinkSync(join(root, 'lib.aster'))],
    ['changed-import', (root: string) => {
      writeFileSync(join(root, 'lib2.aster'), 'fn thrice(x: int): int {\n    return x * 3;\n}\n');
      writeFileSync(join(root, 'main.aster'), `import "lib2.aster";\n${program('lib.aster').replace('return v - 4;', 'return v - 4 + thrice(0);')}`);
    }],
  ] as const) {
    it(`${id}: after a refresh, the diagnostics and closure equal a fresh aster check`, async () => {
      const root = project({ 'main.aster': program('lib.aster'), 'lib.aster': LIB });
      const f = folder(root, ['main.aster']);
      expect(await f.check()).toMatchObject({ kind: 'diagnostics', ok: true });
      change(root);
      // What the file-system watcher does.
      f.saved();
      const r = await f.check();
      const fresh = cli(root, ['check', '--format=json', 'main.aster']);
      expect(r).toMatchObject({ kind: 'diagnostics', ok: fresh.ok, count: fresh.diagnostics.length });
      expect([...r.byFile.values()].flat().map((d: any) => d.code)).toEqual(fresh.diagnostics.map((d: any) => d.code));
      expect(closureOf(f, join(root, 'main.aster'))).toEqual(cliClosure(root, fresh));
    });
  }
});

describe('bounded requests', () => {
  const files = { 'main.aster': program('lib.aster'), 'lib.aster': LIB };

  it('hover sweep: of 20 overlapping hovers only the newest answers, and every cancelled process closes', async () => {
    // A library big enough (~150 ms a query) that every run is still going when the next hover arrives. Hovers arrive
    // as separate events, as VS Code sends them: one burst of 20 synchronous spawns would hold the event loop and
    // delay every `close` it measures.
    const big = Array.from({ length: 2000 }, (_, i) => `fn f${i}(x: int): int {\n    return x * ${i} + 1;\n}\n`).join('');
    const root = project({ 'main.aster': program('lib.aster'), 'lib.aster': `${LIB}${big}` });
    const k = counting();
    const f = folder(root, ['main.aster'], k.runner);
    await f.check();
    const p = at(root, 'main.aster', 'twice(2)');
    const pending = [];
    for (let i = 0; i < 20; i++) {
      pending.push(f.query(join(root, 'main.aster'), 'pointer', p.line, p.character));
      await new Promise((r) => setImmediate(r));
    }
    const results = await Promise.all(pending);
    expect(results.slice(0, 19).every((r) => r.kind === 'cancelled')).toBe(true);
    expect(results[19].kind).toBe('answer');
    expect(facts(results[19].doc)).toEqual(facts(cliQuery(root, 'main.aster', 'main.aster', p.offset)));
    expect(await drained(k.live)).toBe(0);
    expect(k.c.killToClose).toHaveLength(19);
    expect(Math.max(...k.c.killToClose)).toBeLessThan(100);
  });

  it('Ctrl+hover: a concurrent hover and definition request both answer', async () => {
    const root = project(files);
    const f = folder(root, ['main.aster']);
    await f.check();
    const p = at(root, 'main.aster', 'twice(2)');
    const [h, d] = await Promise.all([
      f.query(join(root, 'main.aster'), 'pointer', p.line, p.character),
      f.query(join(root, 'main.aster'), 'caret', p.line, p.character),
    ]);
    expect(facts(h.doc)).toEqual(facts(cliQuery(root, 'main.aster', 'main.aster', p.offset)));
    expect(facts(d.doc)).toEqual(facts(cliQuery(root, 'main.aster', 'main.aster', p.offset, '--caret')));
  });

  it('dispose kills the running check and queries within 100 ms and answers nothing afterwards', async () => {
    const root = project(files);
    const k = counting();
    const f = folder(root, ['main.aster'], k.runner);
    const p = at(root, 'main.aster', 'twice(2)');
    const check = f.check();
    const h = f.query(join(root, 'main.aster'), 'pointer', p.line, p.character);
    const d = f.query(join(root, 'main.aster'), 'caret', p.line, p.character);
    f.dispose();
    expect(await check).toEqual({ kind: 'superseded' });
    expect(await h).toEqual({ kind: 'cancelled' });
    expect(await d).toEqual({ kind: 'cancelled' });
    expect(await drained(k.live)).toBe(0);
    expect(k.c.killToClose).toHaveLength(3);
    expect(Math.max(...k.c.killToClose)).toBeLessThan(100);
    expect(await f.query(join(root, 'main.aster'), 'pointer', p.line, p.character)).toEqual({ kind: 'cancelled' });
  });

  it('invalid → fixed: facts equal a fresh CLI run, and an answer from before a save is not shown', async () => {
    const root = project({ ...files, 'lib.aster': BROKEN_LIB });
    const f = folder(root, ['main.aster']);
    expect(await f.check()).toMatchObject({ kind: 'diagnostics', ok: false, count: 1 });
    expect(await hover(f, root, 'main.aster', 'twice(2)')).toEqual({ kind: 'unavailable', reason: 'diagnostics' });

    writeFileSync(join(root, 'lib.aster'), LIB);
    f.saved();
    expect(await f.check()).toMatchObject({ kind: 'diagnostics', ok: true, count: 0 });
    const r = await hover(f, root, 'main.aster', 'twice(2)');
    expect(facts(r.doc)).toEqual(facts(cliQuery(root, 'main.aster', 'main.aster', at(root, 'main.aster', 'twice(2)').offset)));

    const saving = folder(root, ['main.aster'], async (compiler: string, argv: string[], opts: object) => {
      const out = await adapter.run(compiler, argv, opts);
      if (argv[0] === 'query') saving.saved();
      return out;
    });
    expect(await hover(saving, root, 'main.aster', 'twice(2)')).toEqual({ kind: 'stale', reasons: ['a file was saved while the compiler ran'] });
  });
});

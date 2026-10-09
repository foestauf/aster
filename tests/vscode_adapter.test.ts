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

import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCompiler, MISSING, parseArgs, parseMode, REPO_ROOT, TWO_STEP } from '../scripts/build-compiler.js';

// scripts/build-compiler.ts (pnpm bootstrap, pnpm build) is orchestration only. Stub compilers written as sh scripts
// stand in for asterc so the install rules are tested without cc.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aster-build-compiler-test-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * A stub compiler. `build <src> --emit=c` prints `emit`. `build <src> -o <out>` copies the stub named by `next` to
 * <out> (so the compiler it builds behaves like `next`), or exits `fail` with a message on stderr when `fail` is set.
 */
function stub(name: string, opts: { emit: string; next?: string; fail?: number; noise?: string }): string {
  const path = join(dir, name);
  const lines = [
    '#!/bin/sh',
    `if [ "$3" = "--emit=c" ]; then printf '%s\\n' '${opts.emit}'; exit 0; fi`,
    opts.noise === undefined ? '' : `echo '${opts.noise}' >&2`,
    opts.fail === undefined ? '' : `echo 'stub: build failed' >&2; exit ${opts.fail}`,
    `cp '${join(dir, opts.next ?? name)}' "$4"`,
  ];
  writeFileSync(path, lines.join('\n') + '\n');
  chmodSync(path, 0o755);
  return path;
}

describe('parseMode', () => {
  it('accepts exactly one of bootstrap or build', () => {
    expect(parseMode(['bootstrap'])).toBe('bootstrap');
    expect(parseMode(['build'])).toBe('build');
    expect(parseMode([])).toBeNull();
    expect(parseMode(['build', 'extra'])).toBeNull();
    expect(parseMode(['rebuild'])).toBeNull();
  });
});

describe('MISSING', () => {
  it('is the exact hint from the spec', () => {
    expect(MISSING).toBe('aster: no compiler at build/asterc; run `pnpm bootstrap` first');
  });
});

// The script's prefix is aster-build-compiler-; this test file's own dirs are aster-build-compiler-test-.
const count = () =>
  readdirSync(tmpdir()).filter((f) => f.startsWith('aster-build-compiler-') && !f.startsWith('aster-build-compiler-test-')).length;

describe('buildCompiler', () => {
  it('reports a spawn error as a failed step and leaves dest untouched', () => {
    const dest = join(dir, 'build', 'asterc');
    const r = buildCompiler({ cmd: join(dir, 'does-not-exist'), args: [] }, 'src.aster', dest);
    expect(r).toMatchObject({ ok: false, step: 'build c1' });
    expect(existsSync(dest)).toBe(false);
  });

  it('installs the second-generation compiler at a fixed point, creating the directory', () => {
    const b = stub('b', { emit: 'C', next: 'b' });
    const dest = join(dir, 'build', 'asterc');
    expect(buildCompiler({ cmd: b, args: [] }, 'src.aster', dest)).toEqual({ ok: true });
    expect(readFileSync(dest, 'utf8')).toBe(readFileSync(b, 'utf8'));
    expect(readdirSync(join(dir, 'build'))).toEqual(['asterc']);
  });

  it('leaves the installed compiler untouched when the builder fails', () => {
    const b = stub('b', { emit: 'C', fail: 1 });
    const dest = join(dir, 'asterc');
    writeFileSync(dest, 'old compiler');
    const r = buildCompiler({ cmd: b, args: [] }, 'src.aster', dest);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ message: expect.stringContaining('stub: build failed') });
    expect(readFileSync(dest, 'utf8')).toBe('old compiler');
  });

  it('treats stderr output from a successful build as a failure', () => {
    const b = stub('b', { emit: 'C', next: 'b', noise: 'warning: something' });
    const dest = join(dir, 'asterc');
    const r = buildCompiler({ cmd: b, args: [] }, 'src.aster', dest);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ message: expect.stringContaining('warning: something') });
    expect(existsSync(dest)).toBe(false);
  });

  it('refuses to install when c1 and c2 emit different C, naming the first differing line', () => {
    stub('c2', { emit: 'B', next: 'c2' });
    stub('c1', { emit: 'A', next: 'c2' });
    const b = stub('b', { emit: 'X', next: 'c1' });
    const dest = join(dir, 'asterc');
    writeFileSync(dest, 'old compiler');
    const r = buildCompiler({ cmd: b, args: [] }, 'src.aster', dest);
    expect(r).toEqual({ ok: false, step: 'fixed point', message: 'C(c1) differs from C(c2) at line 1:\n  c1: A\n  c2: B' });
    expect(readFileSync(dest, 'utf8')).toBe('old compiler');
  });

  it('removes its temp directory', () => {
    // The script's prefix is aster-build-compiler-; this test's own dirs are aster-build-compiler-test-.
    const before = count();
    const b = stub('b', { emit: 'C', fail: 1 });
    buildCompiler({ cmd: b, args: [] }, 'src.aster', join(dir, 'asterc'));
    const after = count();
    expect(after).toBe(before);
  });
});

describe('the script', () => {
  const text = readFileSync(join(REPO_ROOT, 'scripts', 'build-compiler.ts'), 'utf8');
  it('imports nothing from packages/', () => {
    expect(text).not.toMatch(/from\s+['"][^'"]*packages\//);
    expect(text).not.toMatch(/import\(\s*['"][^'"]*packages\//);
  });
  it('derives the repo root from its own location, not the cwd', () => {
    expect(REPO_ROOT.endsWith('/')).toBe(true);
    expect(text).not.toMatch(/process\.cwd\(\)/);
  });
});

describe('parseArgs', () => {
  it('accepts the three modes and --release for bootstrap only', () => {
    expect(parseArgs(['bootstrap'])).toEqual({ mode: 'bootstrap', release: null });
    expect(parseArgs(['bootstrap', '--release', 'build-20261004-c6205b8'])).toEqual({ mode: 'bootstrap', release: 'build-20261004-c6205b8' });
    expect(parseArgs(['bootstrap-seed'])).toEqual({ mode: 'bootstrap-seed', release: null });
    expect(parseArgs(['build'])).toEqual({ mode: 'build', release: null });
    expect(parseArgs(['bootstrap', '--release'])).toBeNull();
    expect(parseArgs(['build', '--release', 'x'])).toBeNull();
    expect(parseArgs([])).toBeNull();
  });

  it('accepts --release only for a well-formed build tag', () => {
    for (const bad of ['..', '../..', 'build-1-a', 'v1', '', 'build-20261004-c6205b8/..', 'build-20261004-C6205B8']) {
      expect(parseArgs(['bootstrap', '--release', bad])).toBeNull();
    }
    expect(parseArgs(['bootstrap', '--release', 'build-20261004-c6205b8'])).toEqual({ mode: 'bootstrap', release: 'build-20261004-c6205b8' });
  });

  it('names the two-step rule', () => {
    expect(TWO_STEP).toBe('the release cannot build this compiler source; land the feature first, then use it (two-step rule, docs/self-host/building.md)');
  });
});

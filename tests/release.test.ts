import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { BINARY, BUILD_TXT, main, makeRelease, releaseTag, renderSums, SEED, sha256File, SUMS } from '../scripts/release.js';

// scripts/release.ts (pnpm release) is orchestration only. The real tests drive it with S1 from the global setup.

let dir: string;
let out: string;
const MTIME = 1_759_619_776;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'aster-release-test-'));
  out = join(dir, 'out');
  const r = makeRelease({ compiler: inject('s1Bin'), out, mtime: MTIME });
  if (!r.ok) throw new Error(`${r.step}: ${r.message}`);
}, 300_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('releaseTag', () => {
  it('uses the UTC commit date and the first seven hex digits', () => {
    expect(releaseTag('c6205b8a1b2c3d4e', Date.UTC(2026, 9, 4, 23, 16, 16) / 1000)).toBe('build-20261004-c6205b8');
    expect(releaseTag('0123456789abcdef', Date.UTC(2026, 9, 5, 0, 30, 0) / 1000)).toBe('build-20261005-0123456');
  });
});

describe('main', () => {
  it('rejects bad arguments with status 2', () => {
    expect(main([])).toBe(2);
    expect(main(['--out'])).toBe(2);
    expect(main(['bogus'])).toBe(2);
  });
});

describe('makeRelease', () => {
  it('writes exactly the three assets', () => {
    expect(readdirSync(out).toSorted()).toEqual([BINARY, SUMS, SEED].toSorted());
  });

  it('writes checksums that match the assets', () => {
    expect(readFileSync(join(out, SUMS), 'utf8')).toBe(renderSums(out, [BINARY, SEED]));
    expect(readFileSync(join(out, SUMS), 'utf8')).toContain(`${sha256File(join(out, BINARY))}  ${BINARY}\n`);
  });

  it('packs the C seed as four files under asterc-c-seed/', () => {
    const list = spawnSync('tar', ['-tzf', join(out, SEED)], { encoding: 'utf8' });
    expect(list.stdout.split('\n').filter((l) => l !== '' && !l.endsWith('/')).toSorted()).toEqual(
      ['asterc-c-seed/BUILD.txt', 'asterc-c-seed/aster_rt.c', 'asterc-c-seed/aster_rt.h', 'asterc-c-seed/asterc.c'],
    );
    const build = spawnSync('tar', ['-xzOf', join(out, SEED), 'asterc-c-seed/BUILD.txt'], { encoding: 'utf8' });
    expect(build.stdout).toBe(BUILD_TXT);
    expect(BUILD_TXT).toBe('cc -std=c11 -O2 -I. asterc.c aster_rt.c -o asterc\n');
  });

  it('links a static binary that runs', () => {
    const ldd = spawnSync('ldd', [join(out, BINARY)], { encoding: 'utf8' });
    expect(`${ldd.stdout}${ldd.stderr}`).toMatch(/not a dynamic executable|statically linked/);
    const probe = join(dir, 'probe.aster');
    writeFileSync(probe, 'fn main(): int {\n    return 0;\n}\n');
    expect(spawnSync(join(out, BINARY), ['check', probe]).status).toBe(0);
  });

  it('produces a byte-identical tarball for the same commit', () => {
    const again = join(dir, 'again');
    const r = makeRelease({ compiler: inject('s1Bin'), out: again, mtime: MTIME });
    expect(r).toEqual({ ok: true });
    expect(readFileSync(join(again, SEED)).equals(readFileSync(join(out, SEED)))).toBe(true);
  }, 300_000);

  it('leaves no assets behind when a step fails', () => {
    const bad = join(dir, 'bad-compiler');
    writeFileSync(bad, '#!/bin/sh\necho "stub: no" >&2\nexit 1\n');
    chmodSync(bad, 0o755);
    const failed = join(dir, 'failed');
    const r = makeRelease({ compiler: bad, out: failed, mtime: MTIME });
    expect(r).toMatchObject({ ok: false, step: 'emit C', message: expect.stringContaining('stub: no') });
    expect(existsSync(failed) ? readdirSync(failed) : []).toEqual([]);
  });
});

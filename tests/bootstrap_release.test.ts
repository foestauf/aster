import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildCompiler } from '../scripts/build-compiler.js';
import { GH_HINT, NO_TAG, FELL_BACK, prepareRelease, repoSlug, resolveTag, verifyAssets } from '../scripts/release-bootstrap.js';
import { BINARY, COMPILER_SOURCE, makeRelease, renderSums, SEED, SUMS } from '../scripts/release.js';

// scripts/release-bootstrap.ts: pnpm bootstrap from a release. A fixture release made from S1 stands in for GitHub
// (ASTER_BOOTSTRAP_DIR), and throwaway git repositories stand in for the checkout.

let dir: string;
let fixture: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'aster-bootstrap-release-test-'));
  fixture = join(dir, 'fixture');
  const r = makeRelease({ compiler: inject('s1Bin'), out: fixture, mtime: 1_759_619_776 });
  if (!r.ok) throw new Error(`${r.step}: ${r.message}`);
}, 300_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function repo(name: string): string {
  const root = join(dir, name);
  mkdirSync(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'a');
  return root;
}
const gitIn = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
const commit = (root: string, m: string) => gitIn(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', m);

function copyFixture(name: string): string {
  const copy = join(dir, name);
  cpSync(fixture, copy, { recursive: true });
  return copy;
}

describe('resolveTag', () => {
  it('finds the nearest build-* tag that is an ancestor of HEAD', () => {
    const root = repo('tags');
    gitIn(root, 'tag', 'build-20260101-aaaaaaa');
    const first = gitIn(root, 'rev-parse', 'HEAD');
    commit(root, 'b');
    gitIn(root, 'tag', 'build-20260102-bbbbbbb');
    commit(root, 'c');
    gitIn(root, 'tag', 'v9');
    expect(resolveTag(root)).toBe('build-20260102-bbbbbbb');
    gitIn(root, 'checkout', '-q', first);
    expect(resolveTag(root)).toBe('build-20260101-aaaaaaa');
  });

  it('returns null without a build-* ancestor', () => {
    expect(resolveTag(repo('untagged'))).toBeNull();
  });
});

describe('repoSlug', () => {
  it('reads GitHub ssh and https remotes', () => {
    expect(repoSlug('git@github.com:foestauf/learn-lang.git')).toBe('foestauf/learn-lang');
    expect(repoSlug('https://github.com/foestauf/learn-lang.git')).toBe('foestauf/learn-lang');
    expect(repoSlug('https://github.com/foestauf/learn-lang')).toBe('foestauf/learn-lang');
    expect(repoSlug('https://gitlab.com/a/b.git')).toBeNull();
  });
});

describe('verifyAssets', () => {
  it('accepts the fixture', () => {
    expect(verifyAssets(fixture)).toEqual({ ok: true });
  });

  it('names a corrupted asset', () => {
    const copy = copyFixture('corrupt');
    writeFileSync(join(copy, SEED), 'not a tarball');
    expect(verifyAssets(copy)).toEqual({ ok: false, message: `checksum mismatch for ${SEED}` });
  });

  it('names a missing SHA256SUMS', () => {
    const copy = copyFixture('nosums');
    rmSync(join(copy, SUMS));
    expect(verifyAssets(copy)).toEqual({ ok: false, message: `missing ${SUMS}` });
  });
});

describe('prepareRelease', () => {
  it('uses the release binary even when it lost its execute bit, and reaches the fixed point', () => {
    const copy = copyFixture('noexec');
    chmodSync(join(copy, BINARY), 0o644);
    const work = mkdtempSync(join(dir, 'work-'));
    const r = prepareRelease({ root: dir, release: null, assetsDir: copy, work });
    expect(r).toMatchObject({ ok: true, origin: 'binary', source: `ASTER_BOOTSTRAP_DIR ${copy}`, notes: [] });
    if (!r.ok) return;
    expect(buildCompiler(r.builder, COMPILER_SOURCE, join(dir, 'installed-binary'))).toEqual({ ok: true });
  }, 300_000);

  it('falls back to the C seed when the binary does not run, and reaches the fixed point', () => {
    const copy = copyFixture('broken');
    writeFileSync(join(copy, BINARY), 'not a binary');
    writeFileSync(join(copy, SUMS), renderSums(copy, [BINARY, SEED]));
    const work = mkdtempSync(join(dir, 'work-'));
    const r = prepareRelease({ root: dir, release: null, assetsDir: copy, work });
    expect(r).toMatchObject({ ok: true, origin: 'c seed', notes: [FELL_BACK] });
    if (!r.ok) return;
    expect(buildCompiler(r.builder, COMPILER_SOURCE, join(dir, 'installed-seed'))).toEqual({ ok: true });
  }, 300_000);

  it('rejects assets that fail verification', () => {
    const copy = copyFixture('bad');
    writeFileSync(join(copy, BINARY), 'tampered');
    const r = prepareRelease({ root: dir, release: null, assetsDir: copy, work: mkdtempSync(join(dir, 'work-')) });
    expect(r).toEqual({ ok: false, message: `bootstrap: ASTER_BOOTSTRAP_DIR ${copy}: checksum mismatch for ${BINARY}` });
  });

  it('reports a checkout with no release ancestor', () => {
    const root = repo('no-release');
    const r = prepareRelease({ root, release: null, assetsDir: undefined, work: mkdtempSync(join(dir, 'work-')), fetch: false });
    expect(r).toEqual({ ok: false, message: NO_TAG });
  });

  it('deletes a corrupt cache and names the asset', () => {
    const root = repo('cache');
    const cache = join(root, 'build', 'bootstrap', 'build-20260101-aaaaaaa');
    mkdirSync(join(root, 'build', 'bootstrap'), { recursive: true });
    cpSync(fixture, cache, { recursive: true });
    writeFileSync(join(cache, SEED), 'truncated');
    const r = prepareRelease({ root, release: 'build-20260101-aaaaaaa', assetsDir: undefined, work: mkdtempSync(join(dir, 'work-')), fetch: false });
    expect(r).toEqual({ ok: false, message: `bootstrap: release build-20260101-aaaaaaa: checksum mismatch for ${SEED}` });
    expect(existsSync(cache)).toBe(false);
  });

  it('needs a GitHub origin remote to download', () => {
    const root = repo('no-origin');
    const r = prepareRelease({ root, release: 'build-20260101-aaaaaaa', assetsDir: undefined, work: mkdtempSync(join(dir, 'work-')), fetch: false });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('no GitHub origin remote') });
  });

  it('explains a failed download', () => {
    const root = repo('no-gh');
    gitIn(root, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
    const r = prepareRelease({ root, release: 'build-20260101-aaaaaaa', assetsDir: undefined, work: mkdtempSync(join(dir, 'work-')), fetch: false, gh: join(dir, 'no-such-gh') });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining(GH_HINT) });
    expect(r).toMatchObject({ message: expect.stringContaining('could not download release build-20260101-aaaaaaa') });
    expect(existsSync(join(root, 'build', 'bootstrap', 'build-20260101-aaaaaaa'))).toBe(false);
  });
});

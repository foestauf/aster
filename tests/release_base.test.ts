import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../scripts/build-compiler.js';

// scripts/release-base.sh: which release CI bootstraps from. A throwaway repository with no origin stands in for the
// checkout; the script's fetch fails quietly there.

let root: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
const commit = (m: string) => git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', m);
const base = (rev: string) =>
  spawnSync('sh', [join(REPO_ROOT, 'scripts', 'release-base.sh'), rev], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ASTER_RELEASE_WAIT_TRIES: '2', ASTER_RELEASE_WAIT_INTERVAL: '0' },
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aster-release-base-test-'));
  git('init', '-q');
  commit('a');
  commit('b');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('release-base.sh', () => {
  it('exits 3 when no build-* release exists yet', () => {
    git('tag', 'v1', 'HEAD^1');
    expect(base('HEAD^1')).toMatchObject({ status: 3, stdout: '' });
  });

  it('prints the tag on the base commit', () => {
    git('tag', 'build-20261004-aaaaaaa', 'HEAD^1');
    expect(base('HEAD^1')).toMatchObject({ status: 0, stdout: 'build-20261004-aaaaaaa\n' });
  });

  it('falls back to the nearest ancestor release with a warning', () => {
    commit('c');
    git('tag', 'build-20261001-aaaaaaa', 'HEAD~2');
    const r = base('HEAD^1');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('build-20261001-aaaaaaa\n');
    expect(r.stderr).toContain(
      `release for ${git('rev-parse', 'HEAD^1')} not published yet; falling back to the nearest earlier release`,
    );
  });

  it('fails when neither the revision nor its ancestors have a release', () => {
    git('tag', 'build-20261003-ccccccc', 'HEAD');
    const r = base('HEAD^1');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(
      `release for ${git('rev-parse', 'HEAD^1')} not published yet, and no earlier release is an ancestor of it`,
    );
  });

  it('fails on a revision that does not exist', () => {
    git('tag', 'build-20261004-aaaaaaa', 'HEAD');
    const r = base('HEAD~5');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
  });
});

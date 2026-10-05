import { describe, expect, it } from 'vitest';
import { goldenPath, normalise, renderOutcome, REPO_ROOT } from './golden.js';

describe('normalise', () => {
  it('makes repo paths repo-relative, with or without a trailing slash', () => {
    expect(normalise(`error ${REPO_ROOT}/tests/a.aster 1 2 x\nroot ${REPO_ROOT}\n`)).toBe('error tests/a.aster 1 2 x\nroot \n');
  });

  it('rewrites temp directories to <tmp>', () => {
    const tmp = '/var/fake/aster-xyz';
    expect(normalise(`${tmp}/out.c and ${tmp}`, { tmp: [tmp] })).toBe('<tmp>/out.c and <tmp>');
  });

  it('replaces the longest directory first when one contains another', () => {
    const outer = '/var/fake/outer';
    const inner = `${outer}/inner`;
    expect(normalise(`${inner}/a ${outer}/b`, { tmp: [outer, inner] })).toBe('<tmp>/a <tmp>/b');
  });

  it('handles a temp directory inside the repo', () => {
    const tmp = `${REPO_ROOT}/scratch`;
    expect(normalise(`${tmp}/x ${REPO_ROOT}/y`, { tmp: [tmp] })).toBe('<tmp>/x y');
  });
});

describe('renderOutcome', () => {
  it('lays out exit, stdout and stderr', () => {
    expect(renderOutcome({ status: 1, stdout: 'out\n', stderr: 'err\n' })).toBe('== exit 1\n== stdout\nout\n== stderr\nerr\n');
  });

  it('renders empty streams and a null status', () => {
    expect(renderOutcome({ status: null, stdout: '', stderr: '' })).toBe('== exit null\n== stdout\n== stderr\n');
  });
});

describe('goldenPath', () => {
  it('slugs separators to __ under tests/golden/<kind>', () => {
    expect(goldenPath('check', 'errors/a.aster')).toBe(`${REPO_ROOT}/tests/golden/check/errors__a.aster.txt`);
    expect(goldenPath('cli', 'x\\y')).toBe(`${REPO_ROOT}/tests/golden/cli/x__y.txt`);
    expect(goldenPath('check', '../../packages/asterc-self/l.aster')).toBe(
      `${REPO_ROOT}/tests/golden/check/..__..__packages__asterc-self__l.aster.txt`,
    );
  });
});

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../scripts/build-compiler.js';

// scripts/ci-bootstrap.sh: optimistic by default, strict for release.yml (#69). The two scripts are copied into a
// throwaway repository, since ci-bootstrap.sh works from its own checkout, and a fake pnpm on PATH logs each
// `bootstrap --release <tag>` and fails for the tags listed in $FAIL_TAGS.

let root: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
const commit = (m: string) => git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', m);

const FAKE_PNPM = `#!/bin/sh
echo "$*" >> "$PNPM_LOG"
for t in $FAIL_TAGS; do [ "$t" = "$4" ] && exit 7; done
exit 0
`;

function bootstrap(env: Record<string, string> = {}) {
  const r = spawnSync('sh', [join(root, 'scripts', 'ci-bootstrap.sh')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      PNPM_LOG: join(root, 'pnpm.log'),
      FAIL_TAGS: '',
      ASTER_RELEASE_WAIT_TRIES: '2',
      ASTER_RELEASE_WAIT_INTERVAL: '0',
      ...env,
    },
    timeout: 10_000,
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(join(root, 'pnpm.log'), 'utf8').trim().split('\n');
  } catch {
    // pnpm never ran.
  }
  return { ...r, calls };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aster-ci-bootstrap-test-'));
  git('init', '-q');
  mkdirSync(join(root, 'scripts'));
  for (const s of ['ci-bootstrap.sh', 'release-base.sh']) copyFileSync(join(REPO_ROOT, 'scripts', s), join(root, 'scripts', s));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'pnpm'), FAKE_PNPM);
  chmodSync(join(root, 'bin', 'pnpm'), 0o755);
  commit('a');
  commit('b');
  commit('c');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('ci-bootstrap.sh', () => {
  it("uses HEAD^1's own release when it is published", () => {
    git('tag', 'build-20261001-aaaaaaa', 'HEAD~2');
    git('tag', 'build-20261002-bbbbbbb', 'HEAD^1');
    const r = bootstrap();
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(['-s bootstrap --release build-20261002-bbbbbbb']);
    expect(r.stderr).not.toContain('optimistic');
  });

  it('uses an older published release at once instead of waiting', () => {
    git('tag', 'build-20261001-aaaaaaa', 'HEAD~2');
    // An hour-long wait would blow the test timeout.
    const r = bootstrap({ ASTER_RELEASE_WAIT_INTERVAL: '3600' });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(['-s bootstrap --release build-20261001-aaaaaaa']);
    expect(r.stderr).toContain(
      `::notice::optimistic bootstrap from build-20261001-aaaaaaa (HEAD^1, ${git('rev-parse', 'HEAD^1')}, has no published release)`,
    );
  });

  it("retries with HEAD^1's release once it appears after an optimistic failure", () => {
    git('tag', 'build-20261001-aaaaaaa', 'HEAD~2');
    // release.yml publishes HEAD^1's release while the script waits: a git shim tags it on the first fetch after the
    // optimistic attempt (the fake pnpm's log exists by then).
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(
      join(root, 'bin', 'git'),
      `#!/bin/sh\nif [ "$1" = fetch ] && [ -f "$PNPM_LOG" ]; then ${realGit} tag -f build-20261002-bbbbbbb HEAD^1 >/dev/null; fi\nexec ${realGit} "$@"\n`,
    );
    chmodSync(join(root, 'bin', 'git'), 0o755);
    const r = bootstrap({ FAIL_TAGS: 'build-20261001-aaaaaaa' });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(['-s bootstrap --release build-20261001-aaaaaaa', '-s bootstrap --release build-20261002-bbbbbbb']);
    expect(r.stderr).toContain('::warning::optimistic bootstrap from build-20261001-aaaaaaa failed; retrying with the release of HEAD^1');
  });

  it('fails without retrying when the wait finds no newer release', () => {
    git('tag', 'build-20261001-aaaaaaa', 'HEAD~2');
    const r = bootstrap({ FAIL_TAGS: 'build-20261001-aaaaaaa' });
    expect(r.status).toBe(7);
    expect(r.calls).toEqual(['-s bootstrap --release build-20261001-aaaaaaa']);
    expect(r.stderr).toContain('ci-bootstrap: no newer release than build-20261001-aaaaaaa appeared');
  });

  it("does not retry when HEAD^1's own release fails", () => {
    git('tag', 'build-20261002-bbbbbbb', 'HEAD^1');
    const r = bootstrap({ FAIL_TAGS: 'build-20261002-bbbbbbb' });
    expect(r.status).toBe(7);
    expect(r.calls).toEqual(['-s bootstrap --release build-20261002-bbbbbbb']);
  });

  it('waits for HEAD^1 in strict mode, then falls back as before', () => {
    git('tag', 'build-20261001-aaaaaaa', 'HEAD~2');
    const r = bootstrap({ ASTER_BOOTSTRAP_STRICT: '1' });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(['-s bootstrap --release build-20261001-aaaaaaa']);
    expect(r.stderr).toContain(`release for ${git('rev-parse', 'HEAD^1')} not published yet; falling back`);
    expect(r.stderr).not.toContain('optimistic');
  });

  it('fails and points at Recovery when no release exists', () => {
    const r = bootstrap();
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.stderr).toContain('ci-bootstrap: no build-* release exists; see Recovery in docs/self-host/building.md');
  });
});

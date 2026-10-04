# Aster Release Pipeline (R1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every push to `main` publishes a GitHub release holding a static `asterc` binary and its C seed, and `pnpm bootstrap` installs the compiler from the right release instead of the TypeScript seed.

**Architecture:** Two orchestration modules in `scripts/`: `release.ts` produces the three assets from an installed compiler, and `release-bootstrap.ts` resolves, downloads, verifies and prepares a release as a `Builder` for the unchanged `buildCompiler`. Two POSIX `sh` helpers (`release-base.sh`, `ci-bootstrap.sh`) give CI one place to choose the base's release. `release.yml` wraps `release.ts` and `gh`.

**Tech Stack:** Node 24 (TypeScript run natively), vitest, POSIX sh, GNU tar + gzip, gcc 13 (`cc`), `gh` CLI, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-04-aster-release-pipeline-design.md`

## Global Constraints

- Linux x86_64 only. `cc` is gcc 13. Node ≥ 24.
- Scripts are orchestration only: they spawn compilers, `cc`, `git`, `tar`, `gzip` and `gh`, and never import `packages/asterc/src`.
- Tag: `build-YYYYMMDD-<sha7>`, date = the commit's committer date in UTC, `<sha7>` = first 7 hex chars of the full SHA.
- Assets, exactly: `asterc-linux-x86_64`, `asterc-c-seed.tar.gz` (top-level dir `asterc-c-seed/` with `asterc.c`, `aster_rt.c`, `aster_rt.h`, `BUILD.txt`), `SHA256SUMS`.
- `BUILD.txt` is exactly `cc -std=c11 -O2 -I. asterc.c aster_rt.c -o asterc\n`.
- Binary link: `cc -std=c11 -O2 -static -I<seed dir> asterc.c aster_rt.c -o asterc-linux-x86_64` (verified to work and reach the fixed point on 2026-10-04).
- Runtime source: `packages/asterc/runtime/aster_rt.c` and `aster_rt.h`.
- Exact messages:
  - `bootstrap: no build-* release is an ancestor of HEAD; use --release <tag> or pnpm bootstrap:seed`
  - `bootstrap: release binary did not run; built the C seed instead`
  - `bootstrap: installed build/asterc (from release <tag>, binary)` / `(from release <tag>, c seed)`
  - `release for <sha> not published yet; re-run this job when release.yml finishes`
  - `the release cannot build this compiler source; land the feature first, then use it (two-step rule, docs/self-host/building.md)`
  - download failure hint: `install and authenticate gh, or set ASTER_BOOTSTRAP_DIR`
- `pnpm bootstrap` never falls back to the TypeScript seed. Only `ci-bootstrap.sh` chooses the seed, and only when no `build-*` tag exists at all.
- Commits: conventional commits (commitlint is enforced by husky), each ending with the session's attribution lines.

## Review Focus

1. A downloaded binary has no execute bit (GitHub assets download as 0644) → bootstrap must still use the binary, not fall back. Test in Task 2.
2. A cache directory left corrupt by an earlier run → bootstrap deletes it and exits 1 naming the asset, rather than looping or trusting it. Test in Task 2.
3. `gh` missing or unauthenticated, or no GitHub `origin` remote → one clear error with the hint, no stack trace. Test in Task 2.
4. CI's `HEAD^1` missing (shallow clone) or never released while other releases exist → `release-base.sh` exits 1 with a message, never prints an empty tag. Test in Task 3.
5. `release.ts` failing midway → no partial assets in `--out`. Test in Task 1.

---

### Task 1: `scripts/release.ts` produces the release assets

**Files:**
- Create: `scripts/release.ts`
- Create: `tests/release.test.ts`
- Modify: `package.json` (scripts), `.gitignore`

**Interfaces:**
- Consumes: `REPO_ROOT`, `INSTALLED`, `MISSING` from `scripts/build-compiler.ts`.
- Produces (exported from `scripts/release.ts`):
  - `BINARY = 'asterc-linux-x86_64'`, `SEED = 'asterc-c-seed.tar.gz'`, `SUMS = 'SHA256SUMS'`, `SEED_DIR = 'asterc-c-seed'`, `BUILD_TXT`, `RUNTIME_DIR` (absolute), `COMPILER_SOURCE = 'packages/asterc-self/asterc.aster'`
  - `releaseTag(sha: string, committedAt: number /* epoch seconds */): string`
  - `sha256File(path: string): string`
  - `renderSums(dir: string, names: string[]): string`
  - `type StepResult = { ok: true } | { ok: false; step: string; message: string }`
  - `makeRelease(opts: { compiler: string; out: string; mtime: number }): StepResult`
  - `main(argv: string[]): number` — `tag` prints HEAD's tag; `--out <dir>` writes assets.

- [ ] **Step 1: Write the failing tests**

`tests/release.test.ts`:

```ts
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
    expect(readdirSync(out).sort()).toEqual([BINARY, SUMS, SEED].sort());
  });

  it('writes checksums that match the assets', () => {
    expect(readFileSync(join(out, SUMS), 'utf8')).toBe(renderSums(out, [BINARY, SEED]));
    expect(readFileSync(join(out, SUMS), 'utf8')).toContain(`${sha256File(join(out, BINARY))}  ${BINARY}\n`);
  });

  it('packs the C seed as four files under asterc-c-seed/', () => {
    const list = spawnSync('tar', ['-tzf', join(out, SEED)], { encoding: 'utf8' });
    expect(list.stdout.split('\n').filter((l) => l !== '' && !l.endsWith('/')).sort()).toEqual(
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/release.test.ts`
Expected: FAIL, cannot resolve `../scripts/release.js`.

- [ ] **Step 3: Implement `scripts/release.ts`**

```ts
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLED, MISSING, REPO_ROOT } from './build-compiler.ts';

// `pnpm release` (release pipeline R1): the three assets of a GitHub release, built from the installed compiler. The
// binary is linked statically and must rebuild the compiler to the fixed point before anything is written to --out.
// Orchestration only: it spawns the compiler, cc, tar and gzip and never imports the TypeScript compiler.

export const BINARY = 'asterc-linux-x86_64';
export const SEED = 'asterc-c-seed.tar.gz';
export const SUMS = 'SHA256SUMS';
export const SEED_DIR = 'asterc-c-seed';
export const BUILD_TXT = 'cc -std=c11 -O2 -I. asterc.c aster_rt.c -o asterc\n';
export const RUNTIME_DIR = join(REPO_ROOT, 'packages', 'asterc', 'runtime');
export const COMPILER_SOURCE = 'packages/asterc-self/asterc.aster';

export type StepResult = { ok: true } | { ok: false; step: string; message: string };

/** The release tag for a commit: its UTC committer date and the first seven hex digits of its SHA. */
export function releaseTag(sha: string, committedAt: number): string {
  const day = new Date(committedAt * 1000).toISOString().slice(0, 10).replaceAll('-', '');
  return `build-${day}-${sha.slice(0, 7)}`;
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** `sha256sum` output for the named files in dir. */
export function renderSums(dir: string, names: string[]): string {
  return names.map((n) => `${sha256File(join(dir, n))}  ${n}\n`).join('');
}

function run(cmd: string, args: string[], cwd = REPO_ROOT) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), status: r.status, error: r.error };
}

/** Runs a step that must exit 0 with an empty stderr; returns its stdout, or the failure. */
function step(name: string, cmd: string, args: string[], cwd?: string): { ok: true; stdout: string } | { ok: false; step: string; message: string } {
  const r = run(cmd, args, cwd);
  if (r.error) return { ok: false, step: name, message: r.error.message };
  if (r.status !== 0 || r.stderr !== '') return { ok: false, step: name, message: `status ${r.status}\n${r.stderr}` };
  return { ok: true, stdout: r.stdout };
}

export function makeRelease(opts: { compiler: string; out: string; mtime: number }): StepResult {
  const work = mkdtempSync(join(tmpdir(), 'aster-release-'));
  try {
    const seed = join(work, SEED_DIR);
    mkdirSync(seed);
    const emitted = step('emit C', opts.compiler, ['build', COMPILER_SOURCE, '--emit=c']);
    if (!emitted.ok) return emitted;
    writeFileSync(join(seed, 'asterc.c'), emitted.stdout);
    copyFileSync(join(RUNTIME_DIR, 'aster_rt.c'), join(seed, 'aster_rt.c'));
    copyFileSync(join(RUNTIME_DIR, 'aster_rt.h'), join(seed, 'aster_rt.h'));
    writeFileSync(join(seed, 'BUILD.txt'), BUILD_TXT);

    const binary = join(work, BINARY);
    const linked = step('link', 'cc', ['-std=c11', '-O2', '-static', `-I${seed}`, join(seed, 'asterc.c'), join(seed, 'aster_rt.c'), '-o', binary]);
    if (!linked.ok) return linked;

    const smoke = join(work, 'smoke');
    const rebuilt = step('smoke build', binary, ['build', COMPILER_SOURCE, '-o', smoke]);
    if (!rebuilt.ok) return rebuilt;
    const again = step('smoke emit C', smoke, ['build', COMPILER_SOURCE, '--emit=c']);
    if (!again.ok) return again;
    if (again.stdout !== emitted.stdout) return { ok: false, step: 'smoke fixed point', message: 'the static binary rebuilt a compiler whose C differs' };

    const tar = step('tar', 'tar', [
      '--sort=name', '--owner=0', '--group=0', '--numeric-owner', `--mtime=@${opts.mtime}`, '--mode=a+rX,u+w,go-w',
      '-C', work, '-cf', join(work, 'asterc-c-seed.tar'), SEED_DIR,
    ]);
    if (!tar.ok) return tar;
    const gz = step('gzip', 'gzip', ['-n', '-9', join(work, 'asterc-c-seed.tar')]);
    if (!gz.ok) return gz;
    writeFileSync(join(work, SUMS), renderSums(work, [BINARY, SEED]));

    // Everything succeeded: only now touch --out.
    mkdirSync(opts.out, { recursive: true });
    const placed: string[] = [];
    try {
      for (const name of [BINARY, SEED, SUMS]) {
        copyFileSync(join(work, name), join(opts.out, `${name}.tmp-${process.pid}`));
        placed.push(name);
      }
      for (const name of placed) renameSync(join(opts.out, `${name}.tmp-${process.pid}`), join(opts.out, name));
    } catch (e) {
      for (const name of [BINARY, SEED, SUMS]) {
        rmSync(join(opts.out, `${name}.tmp-${process.pid}`), { force: true });
        rmSync(join(opts.out, name), { force: true });
      }
      return { ok: false, step: 'write assets', message: e instanceof Error ? e.message : String(e) };
    }
    return { ok: true };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function git(args: string[]): string {
  const r = run('git', args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export function main(argv: string[]): number {
  if (argv.length === 1 && argv[0] === 'tag') {
    console.log(releaseTag(git(['rev-parse', 'HEAD']), Number(git(['log', '-1', '--format=%ct', 'HEAD']))));
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== '--out') {
    console.error('usage: node scripts/release.ts tag | --out <dir>');
    return 2;
  }
  const installed = join(REPO_ROOT, INSTALLED);
  try {
    accessSync(installed, constants.X_OK);
  } catch {
    console.error(MISSING);
    return 2;
  }
  const r = makeRelease({ compiler: installed, out: argv[1]!, mtime: Number(git(['log', '-1', '--format=%ct', 'HEAD'])) });
  if (!r.ok) {
    console.error(`release: ${r.step} failed: ${r.message}`);
    return 1;
  }
  console.log(`release: wrote ${BINARY}, ${SEED} and ${SUMS} to ${argv[1]}`);
  return 0;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
```

Check how `build-compiler.ts` imports `selfhost.ts` (`'./selfhost.ts'`) and match that import style.

In `package.json` scripts add `"release": "node scripts/release.ts",`. In `.gitignore` add `dist-release/`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/release.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/release.ts tests/release.test.ts package.json .gitignore
git commit -m "feat: produce release assets with a static binary and a C seed (R1)"
```

---

### Task 2: `pnpm bootstrap` installs from a release

**Files:**
- Create: `scripts/release-bootstrap.ts`
- Create: `tests/bootstrap_release.test.ts`
- Modify: `scripts/build-compiler.ts` (modes, `--release`, messages)
- Modify: `tests/build_compiler.test.ts` (parseArgs)
- Modify: `package.json` (`bootstrap`, `bootstrap:seed`)

**Interfaces:**
- Consumes: `BINARY`, `SEED`, `SUMS`, `SEED_DIR`, `makeRelease`, `sha256File`, `renderSums`, `COMPILER_SOURCE` from Task 1; `Builder`, `buildCompiler` from `build-compiler.ts`.
- Produces (from `scripts/release-bootstrap.ts`):
  - `NO_TAG` (exact message from Global Constraints), `FELL_BACK = 'bootstrap: release binary did not run; built the C seed instead'`, `GH_HINT = 'install and authenticate gh, or set ASTER_BOOTSTRAP_DIR'`
  - `resolveTag(root: string): string | null`
  - `repoSlug(remoteUrl: string): string | null`
  - `verifyAssets(dir: string): { ok: true } | { ok: false; message: string }`
  - `type Origin = 'binary' | 'c seed'`
  - `type PrepareResult = { ok: true; builder: Builder; origin: Origin; source: string; notes: string[] } | { ok: false; message: string }`
  - `prepareRelease(opts: { root: string; release: string | null; assetsDir: string | undefined; work: string; fetch?: boolean; gh?: string }): PrepareResult`
- Produces (from `build-compiler.ts`): `type Mode = 'bootstrap' | 'bootstrap-seed' | 'build'`, `parseArgs(argv: string[]): { mode: Mode; release: string | null } | null`, `TWO_STEP` message; `parseMode` keeps working.

- [ ] **Step 1: Write the failing tests**

`tests/bootstrap_release.test.ts`:

```ts
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
```

Add to `tests/build_compiler.test.ts` (import `parseArgs` and `TWO_STEP`):

```ts
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

  it('names the two-step rule', () => {
    expect(TWO_STEP).toBe('the release cannot build this compiler source; land the feature first, then use it (two-step rule, docs/self-host/building.md)');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/bootstrap_release.test.ts tests/build_compiler.test.ts`
Expected: FAIL (missing module / missing exports).

- [ ] **Step 3: Implement `scripts/release-bootstrap.ts`**

```ts
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Builder } from './build-compiler.ts';
import { BINARY, SEED, SEED_DIR, sha256File, SUMS } from './release.ts';

// `pnpm bootstrap` from a GitHub release (release pipeline R1): resolve the nearest ancestor build-* tag, fetch and
// verify its assets, and hand back the release binary, or the compiler built from its C seed, as the builder.
// Orchestration only: it spawns git, gh, tar and sh and never imports the TypeScript compiler.

export const NO_TAG = 'bootstrap: no build-* release is an ancestor of HEAD; use --release <tag> or pnpm bootstrap:seed';
export const FELL_BACK = 'bootstrap: release binary did not run; built the C seed instead';
export const GH_HINT = 'install and authenticate gh, or set ASTER_BOOTSTRAP_DIR';

export type Origin = 'binary' | 'c seed';
export type PrepareResult =
  | { ok: true; builder: Builder; origin: Origin; source: string; notes: string[] }
  | { ok: false; message: string };

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), status: r.status, error: r.error };
}

export function resolveTag(root: string): string | null {
  const r = run('git', ['describe', '--tags', '--match', 'build-*', '--abbrev=0', 'HEAD'], root);
  return r.status === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null;
}

export function repoSlug(remoteUrl: string): string | null {
  const m = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return m ? m[1]! : null;
}

export function verifyAssets(dir: string): { ok: true } | { ok: false; message: string } {
  if (!existsSync(join(dir, SUMS))) return { ok: false, message: `missing ${SUMS}` };
  const want = new Map<string, string>();
  for (const line of readFileSync(join(dir, SUMS), 'utf8').split('\n')) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (m) want.set(m[2]!, m[1]!);
  }
  for (const name of [BINARY, SEED]) {
    if (!want.has(name)) return { ok: false, message: `${SUMS} has no entry for ${name}` };
    if (!existsSync(join(dir, name))) return { ok: false, message: `missing ${name}` };
    if (sha256File(join(dir, name)) !== want.get(name)) return { ok: false, message: `checksum mismatch for ${name}` };
  }
  return { ok: true };
}

/** Downloads a release's three assets into dest via a sibling temp dir, so dest is all-or-nothing. */
function download(root: string, gh: string, tag: string, dest: string): { ok: true } | { ok: false; message: string } {
  const remote = run('git', ['remote', 'get-url', 'origin'], root);
  const slug = remote.status === 0 ? repoSlug(remote.stdout) : null;
  if (slug === null) return { ok: false, message: `bootstrap: no GitHub origin remote to download release ${tag} from; ${GH_HINT}` };
  const partial = `${dest}.partial-${process.pid}`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  const args = ['release', 'download', tag, '--repo', slug, '--dir', partial];
  for (const name of [BINARY, SEED, SUMS]) args.push('--pattern', name);
  const r = run(gh, args, root);
  if (r.error || r.status !== 0) {
    rmSync(partial, { recursive: true, force: true });
    const why = r.error ? r.error.message : r.stderr.trim();
    return { ok: false, message: `bootstrap: could not download release ${tag}: ${why}\n${GH_HINT}` };
  }
  renameSync(partial, dest);
  return { ok: true };
}

const PROBE = 'fn main(): int {\n    return 0;\n}\n';

function runs(bin: string, work: string): boolean {
  const probe = join(work, 'probe.aster');
  writeFileSync(probe, PROBE);
  const r = spawnSync(bin, ['check', probe], { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

export function prepareRelease(opts: {
  root: string;
  release: string | null;
  assetsDir: string | undefined;
  work: string;
  fetch?: boolean;
  gh?: string;
}): PrepareResult {
  let dir: string;
  let source: string;
  if (opts.assetsDir !== undefined) {
    dir = opts.assetsDir;
    source = `ASTER_BOOTSTRAP_DIR ${dir}`;
    const v = verifyAssets(dir);
    if (!v.ok) return { ok: false, message: `bootstrap: ${source}: ${v.message}` };
  } else {
    if (opts.fetch !== false) {
      const f = run('git', ['fetch', '--quiet', '--tags', '--force', 'origin'], opts.root);
      if (f.status !== 0) process.stderr.write(`bootstrap: git fetch --tags failed; using local tags\n`);
    }
    const tag = opts.release ?? resolveTag(opts.root);
    if (tag === null) return { ok: false, message: NO_TAG };
    source = `release ${tag}`;
    dir = join(opts.root, 'build', 'bootstrap', tag);
    if (!existsSync(dir)) {
      mkdirSync(dirname(dir), { recursive: true });
      const d = download(opts.root, opts.gh ?? 'gh', tag, dir);
      if (!d.ok) return d;
    }
    const v = verifyAssets(dir);
    if (!v.ok) {
      rmSync(dir, { recursive: true, force: true });
      return { ok: false, message: `bootstrap: ${source}: ${v.message}` };
    }
  }

  // Never run or chmod the assets in place: ASTER_BOOTSTRAP_DIR is the caller's, and downloads arrive without +x.
  const bin = join(opts.work, 'asterc-release');
  copyFileSync(join(dir, BINARY), bin);
  chmodSync(bin, 0o755);
  if (runs(bin, opts.work)) return { ok: true, builder: { cmd: bin, args: [] }, origin: 'binary', source, notes: [] };

  const untar = run('tar', ['-xzf', join(dir, SEED), '-C', opts.work], opts.work);
  if (untar.status !== 0) return { ok: false, message: `bootstrap: ${source}: could not unpack ${SEED}: ${untar.stderr.trim()}` };
  const seedDir = join(opts.work, SEED_DIR);
  const built = run('sh', ['BUILD.txt'], seedDir);
  const seedBin = join(seedDir, 'asterc');
  if (built.status !== 0 || !runs(seedBin, opts.work)) {
    return { ok: false, message: `bootstrap: ${source}: neither the binary nor the C seed produced a working compiler\n${built.stderr}` };
  }
  return { ok: true, builder: { cmd: seedBin, args: [] }, origin: 'c seed', source, notes: [FELL_BACK] };
}
```

- [ ] **Step 4: Wire it into `scripts/build-compiler.ts`**

Replace `Mode`, `parseMode` and the mode branch of `main`:

```ts
export type Mode = 'bootstrap' | 'bootstrap-seed' | 'build';
export const TWO_STEP =
  'the release cannot build this compiler source; land the feature first, then use it (two-step rule, docs/self-host/building.md)';

export function parseArgs(argv: string[]): { mode: Mode; release: string | null } | null {
  if (argv.length === 1 && (argv[0] === 'bootstrap' || argv[0] === 'bootstrap-seed' || argv[0] === 'build')) return { mode: argv[0], release: null };
  if (argv.length === 3 && argv[0] === 'bootstrap' && argv[1] === '--release' && argv[2] !== '') return { mode: 'bootstrap', release: argv[2]! };
  return null;
}

export function parseMode(argv: string[]): Mode | null {
  return parseArgs(argv)?.mode ?? null;
}
```

Keep the existing `parseMode` tests passing (`parseMode(['bootstrap'])` etc. are unchanged). In `main`:

```ts
export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args === null) {
    console.error('usage: node scripts/build-compiler.ts bootstrap [--release <tag>] | bootstrap-seed | build');
    return 2;
  }
  const { mode } = args;
  const installed = join(REPO_ROOT, INSTALLED);
  const work = mkdtempSync(join(tmpdir(), 'aster-bootstrap-'));
  try {
    let builder: Builder;
    let from: string;
    if (mode === 'bootstrap') {
      const assetsDir = process.env.ASTER_BOOTSTRAP_DIR;
      const p = prepareRelease({ root: REPO_ROOT, release: args.release, assetsDir: assetsDir === undefined ? undefined : resolve(assetsDir), work });
      if (!p.ok) {
        console.error(p.message);
        return 1;
      }
      for (const note of p.notes) console.error(note);
      builder = p.builder;
      from = `from ${p.source}, ${p.origin}`;
    } else if (mode === 'bootstrap-seed') {
      const seed = spawnSync('pnpm', ['build:seed'], { cwd: REPO_ROOT, stdio: 'inherit' });
      if (seed.error || seed.status !== 0) {
        console.error('bootstrap-seed: pnpm build:seed failed');
        return 1;
      }
      builder = { cmd: process.execPath, args: [join(REPO_ROOT, S0)] };
      from = 'from the TypeScript seed';
    } else {
      if (!executable(installed)) {
        console.error(MISSING);
        return 2;
      }
      builder = { cmd: installed, args: [] };
      from = 'rebuilt by itself';
    }
    const r = buildCompiler(builder, COMPILER, installed);
    if (!r.ok) {
      console.error(`${mode}: ${r.step} failed: ${r.message}`);
      if (mode === 'bootstrap' && r.step === 'build c1') console.error(TWO_STEP);
      console.error(mode === 'build' ? 'build/asterc is unchanged; `pnpm bootstrap` rebuilds it from a release' : 'build/asterc is unchanged');
      return 1;
    }
    console.log(`${mode}: installed ${INSTALLED} (${from})`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
```

Import `resolve` from `node:path` and `prepareRelease` from `./release-bootstrap.ts`. Update the header comment: `bootstrap` uses the nearest ancestor release (or `--release`, or `ASTER_BOOTSTRAP_DIR`); `bootstrap-seed` is the TypeScript seed. `release-bootstrap.ts` imports only the `Builder` type from `build-compiler.ts` (`import type`), so the module cycle is type-only.

In `package.json`: `"bootstrap": "node scripts/build-compiler.ts bootstrap"` (unchanged) and add `"bootstrap:seed": "node scripts/build-compiler.ts bootstrap-seed"`.

Search for other callers that relied on `pnpm bootstrap` meaning the seed: `grep -rn "pnpm bootstrap\|build-compiler.ts bootstrap" scripts tests .github`. `scripts/selfhost.ts` and `tests/*` must not depend on bootstrap; if one does, switch it to `bootstrap:seed` and note why.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run tests/bootstrap_release.test.ts tests/build_compiler.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

Then the real path, with a local fixture (no GitHub needed):

```bash
node scripts/release.ts --out /tmp/aster-fixture   # use the scratchpad dir
cp build/asterc /tmp/asterc.bak
ASTER_BOOTSTRAP_DIR=/tmp/aster-fixture pnpm bootstrap
```
Expected last line: `bootstrap: installed build/asterc (from ASTER_BOOTSTRAP_DIR /tmp/aster-fixture, binary)`.

- [ ] **Step 6: Commit**

```bash
git add scripts/release-bootstrap.ts scripts/build-compiler.ts tests/bootstrap_release.test.ts tests/build_compiler.test.ts package.json
git commit -m "feat: bootstrap the compiler from a GitHub release (R1)"
```

---

### Task 3: CI chooses the base's release, and `release.yml` publishes

**Files:**
- Create: `scripts/release-base.sh`, `scripts/ci-bootstrap.sh`, `scripts/publish-release.sh`
- Create: `.github/workflows/release.yml`
- Create: `tests/release_base.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `pnpm bootstrap --release <tag>`, `pnpm bootstrap:seed` (Task 2); `node scripts/release.ts tag|--out` (Task 1).
- Produces: `sh scripts/release-base.sh <rev>` — stdout the `build-*` tag on `<rev>`; exit 0 found, 3 no `build-*` tag exists anywhere, 1 not found after waiting or bad rev. Env `ASTER_RELEASE_WAIT_TRIES` (default 30), `ASTER_RELEASE_WAIT_INTERVAL` seconds (default 30).

- [ ] **Step 1: Write the failing test**

`tests/release_base.test.ts`:

```ts
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

  it('gives up with a message when the base was never released', () => {
    git('tag', 'build-20261003-ccccccc', 'HEAD');
    const r = base('HEAD^1');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(`release for ${git('rev-parse', 'HEAD^1')} not published yet; re-run this job when release.yml finishes`);
  });

  it('fails on a revision that does not exist (a shallow clone)', () => {
    git('tag', 'build-20261004-aaaaaaa', 'HEAD');
    const r = base('HEAD~5');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/release_base.test.ts`
Expected: FAIL (script missing; `sh` exits 127).

- [ ] **Step 3: Write the scripts**

`scripts/release-base.sh`:

```sh
#!/bin/sh
# Prints the build-* release tag of <rev>; CI passes HEAD^1, the base of the change under test (release pipeline R1).
# Waits while release.yml publishes it. Exit 0: tag printed. Exit 3: no build-* release exists anywhere yet, so the
# caller bootstraps from the TypeScript seed. Exit 1: <rev> is unknown, or still has no release after the wait.
set -u
rev=${1:?usage: release-base.sh <rev>}
tries=${ASTER_RELEASE_WAIT_TRIES:-30}
interval=${ASTER_RELEASE_WAIT_INTERVAL:-30}
sha=$(git rev-parse --verify --quiet "$rev^{commit}") || { echo "release-base: unknown revision $rev" >&2; exit 1; }
i=0
while :; do
  git fetch --quiet --tags --force origin 2>/dev/null || true
  tag=$(git tag --points-at "$sha" --list 'build-*' | sort | tail -n 1)
  if [ -n "$tag" ]; then
    echo "$tag"
    exit 0
  fi
  if [ -z "$(git tag --list 'build-*')" ]; then
    exit 3
  fi
  i=$((i + 1))
  if [ "$i" -ge "$tries" ]; then
    echo "release for $sha not published yet; re-run this job when release.yml finishes" >&2
    exit 1
  fi
  sleep "$interval"
done
```

`scripts/ci-bootstrap.sh`:

```sh
#!/bin/sh
# CI's bootstrap (release pipeline R1): from the release of HEAD^1, the base of the change, so a change that uses a
# feature its base's release lacks fails here (the two-step rule). Before the first release exists, from the seed.
set -u
cd "$(dirname "$0")/.."
tag=$(sh scripts/release-base.sh HEAD^1)
case $? in
  0) exec pnpm -s bootstrap --release "$tag" ;;
  3)
    echo 'ci-bootstrap: no build-* release exists yet; bootstrapping from the TypeScript seed' >&2
    exec pnpm -s bootstrap:seed
    ;;
  *) exit 1 ;;
esac
```

`scripts/publish-release.sh`:

```sh
#!/bin/sh
# Publishes a release (release pipeline R1): a draft with all three assets first, then published and marked latest. On
# any failure the draft and its tag are deleted, so a published release always has every asset.
# Usage: publish-release.sh <tag> <sha> <assets dir>. Needs GH_TOKEN, GITHUB_SERVER_URL and GITHUB_REPOSITORY.
set -eu
tag=$1
sha=$2
dir=$3
subject=$(git log -1 --format=%s "$sha")
notes=$(printf '%s\n\nCommit %s\n%s/%s/commit/%s\n' "$subject" "$sha" "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$sha")
cleanup() {
  gh release delete "$tag" --yes --cleanup-tag >/dev/null 2>&1 || true
}
# A draft left by an earlier failed run.
cleanup
gh release create "$tag" --draft --target "$sha" --title "$tag" --notes "$notes" \
  "$dir/asterc-linux-x86_64" "$dir/asterc-c-seed.tar.gz" "$dir/SHA256SUMS" || { cleanup; exit 1; }
gh release edit "$tag" --draft=false --latest || { cleanup; exit 1; }
echo "published $tag"
```

`chmod +x scripts/release-base.sh scripts/ci-bootstrap.sh scripts/publish-release.sh`.

- [ ] **Step 4: Run to verify the test passes**

Run: `pnpm vitest run tests/release_base.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the workflows**

`.github/workflows/release.yml`:

```yaml
name: Release

# Release pipeline R1: every push to main that passes CI publishes build-YYYYMMDD-<sha7> with a static compiler, its C
# seed and SHA256SUMS. See docs/self-host/building.md.
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  release:
    if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'
    runs-on: ubuntu-24.04
    env:
      GH_TOKEN: ${{ github.token }}
      SHA: ${{ github.event.workflow_run.head_sha }}
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Skip if already released
        id: tag
        run: |
          tag=$(node scripts/release.ts tag)
          echo "tag=$tag" >> "$GITHUB_OUTPUT"
          if [ "$(gh release view "$tag" --json isDraft --jq .isDraft 2>/dev/null)" = false ]; then
            echo "$tag is already published"
            echo "done=true" >> "$GITHUB_OUTPUT"
          fi
      - if: steps.tag.outputs.done != 'true'
        run: sh scripts/ci-bootstrap.sh
      - if: steps.tag.outputs.done != 'true'
        run: node scripts/release.ts --out dist-release
      - if: steps.tag.outputs.done != 'true'
        run: sh scripts/publish-release.sh "${{ steps.tag.outputs.tag }}" "$SHA" dist-release
```

In `.github/workflows/ci.yml`, `normal-path`: add `with: fetch-depth: 0` to checkout, `env: GH_TOKEN: ${{ github.token }}` on the job, and replace `- run: pnpm bootstrap` with `- run: sh scripts/ci-bootstrap.sh`. Add the job:

```yaml
  release-bootstrap:
    # The two-step rule: the base's release must build this change's compiler source (docs/self-host/building.md).
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-24.04
    env:
      GH_TOKEN: ${{ github.token }}
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: sh scripts/ci-bootstrap.sh
      - run: pnpm test
```

Leave `proof` unchanged.

- [ ] **Step 6: Lint the workflows**

Run: `actionlint .github/workflows/*.yml && sh -n scripts/release-base.sh scripts/ci-bootstrap.sh scripts/publish-release.sh`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/release-base.sh scripts/ci-bootstrap.sh scripts/publish-release.sh .github/workflows tests/release_base.test.ts
git commit -m "ci: publish a release on every push to main and bootstrap CI from the base's release (R1)"
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/self-host/building.md`

- [ ] **Step 1: Update `building.md`**

- **First build:** `pnpm bootstrap` downloads the nearest ancestor `build-*` release (needs an authenticated `gh`; the repository is private), verifies `SHA256SUMS`, uses the static binary, or builds the C seed if the binary won't run, then builds c1 and c2 and installs at the fixed point. Node/pnpm are still needed for the scripts and tests.
- **Everyday commands table:** `pnpm bootstrap` row → "No; downloads a release"; add `pnpm bootstrap:seed` (Yes; today's bootstrap), `pnpm bootstrap --release <tag>`, `pnpm release` (`release.ts tag | --out <dir>`).
- **New section "Releases":** what triggers one (`release.yml` after CI passes on `main`), the tag format, the three assets and `BUILD.txt`, the cache `build/bootstrap/<tag>/`, `ASTER_BOOTSTRAP_DIR`, and **the two-step rule**: PR A adds a feature without using it in `packages/asterc-self/`; after A's release is published, PR B uses it. CI's `release-bootstrap` job bootstraps from the release of `HEAD^1` and fails otherwise, printing the two-step message. `main` has no branch protection yet, so make `release-bootstrap` a required check to enforce it.
- **CI paragraph:** add `release-bootstrap` and `release.yml`; `normal-path` now bootstraps via `scripts/ci-bootstrap.sh`.
- **Recovery:** lost `build/` → `pnpm bootstrap`. Binary won't run → the C seed is used automatically (or build it by hand from `BUILD.txt`). No GitHub access → `ASTER_BOOTSTRAP_DIR=<dir with the three assets>` or `pnpm bootstrap:seed`. Installed binary can't compile the source → `pnpm bootstrap` (the release of the nearest ancestor always can).

- [ ] **Step 2: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS (all suites).

- [ ] **Step 3: Commit**

```bash
git add docs/self-host/building.md
git commit -m "docs: document releases, release bootstrap and the two-step rule (R1)"
```

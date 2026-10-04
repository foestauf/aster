# Normal Build Path Implementation Plan (#21)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the self-hosted `build/asterc` the ordinary way to compile Aster (`pnpm aster`, `pnpm build`), with the
TypeScript compiler reachable only through explicit `pnpm bootstrap` / `pnpm aster:seed` / `pnpm build:seed`.

**Architecture:** One Node orchestration script (`scripts/build-compiler.ts`) installs the compiler in two modes that
differ only in the builder (S0 or the installed binary), with a fixed-point check and an atomic install. A POSIX `sh`
wrapper (`scripts/aster`) is the entry point. A `sh` script (`scripts/normal-path.sh`) proves the normal path with the
seed's `dist/` hidden; CI runs it plus `pnpm selfhost`.

**Tech Stack:** Node 24 (type-stripped `.ts` scripts), vitest, POSIX sh, GitHub Actions, gcc 13.

**Spec:** `docs/superpowers/specs/2026-10-04-aster-normal-build-path-design.md`

## Global Constraints

- Installed compiler path: `build/asterc` (repo-relative); `build/` is gitignored.
- Missing-compiler message, exact, to stderr, exit 2: ``aster: no compiler at build/asterc; run `pnpm bootstrap` first``
- Orchestration scripts never import from `packages/` and derive the repo root from their own location, never `process.cwd()`.
- Every child build runs with `LC_ALL=C`; a build that exits non-zero **or writes to stderr** is a failure.
- `pnpm test` and `pnpm selfhost` behaviour is unchanged; they use `pnpm build:seed`.
- Platform: Linux x86_64, gcc 13 as `cc`, Node 24+ (contract §2).
- Commit messages: conventional commits ending with `(#21)` plus the session attribution lines.

## Review Focus

1. **A failed rebuild must not touch the installed compiler** — `pnpm build` after a bad edit leaves `build/asterc` byte-identical (Task 1, stub-builder test).
2. **A non-fixed-point candidate is never installed** — when `c1` and `c2` emit different C, nothing is installed and the first differing line is reported (Task 1, stub-builder test).
3. **`build/` missing on a fresh clone** — bootstrap creates it (Task 1, dest-in-missing-dir test).
4. **Wrapper run from another working directory** — still finds `build/asterc` beside itself, and passes args and exit status through (Task 2 test).
5. **`normal-path.sh` dying half way** — `dist/` is restored by the trap, and a leftover `dist.hidden` makes it refuse to start rather than clobber (Task 3, manual checks in steps).

---

### Task 1: `scripts/build-compiler.ts` — bootstrap and self-rebuild

**Files:**
- Create: `scripts/build-compiler.ts`
- Create: `tests/build_compiler.test.ts`
- Modify: `package.json` (scripts), `.gitignore`, `tsconfig.json`, `tests/global-setup.ts:13`, `scripts/selfhost.ts:189-190`

**Interfaces:**
- Consumes: `firstDifference(a: string, b: string): { line: number; a: string; b: string } | null` from `scripts/selfhost.ts`.
- Produces:
  - `export const REPO_ROOT: string` (ends with `/`)
  - `export const INSTALLED = 'build/asterc'`
  - `export const MISSING = 'aster: no compiler at build/asterc; run \`pnpm bootstrap\` first'`
  - `export type Mode = 'bootstrap' | 'build'`
  - `export function parseMode(argv: string[]): Mode | null`
  - `export interface Builder { cmd: string; args: string[] }`
  - `export type BuildResult = { ok: true } | { ok: false; step: string; message: string }`
  - `export function buildCompiler(builder: Builder, source: string, dest: string): BuildResult`
  - `export function main(argv: string[]): number`
  - package.json scripts: `build:seed`, `bootstrap`, `build`

- [ ] **Step 1: Write the failing tests** — `tests/build_compiler.test.ts`. The stub builder is a `sh` script that
  acts like `asterc build <src> -o <out>` / `--emit=c`, so `buildCompiler` is exercised without a real compiler.

```ts
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCompiler, MISSING, parseMode, REPO_ROOT } from '../scripts/build-compiler.js';

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

describe('buildCompiler', () => {
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
    if (!r.ok) expect(r.message).toContain('stub: build failed');
    expect(readFileSync(dest, 'utf8')).toBe('old compiler');
  });

  it('treats stderr output from a successful build as a failure', () => {
    const b = stub('b', { emit: 'C', next: 'b', noise: 'warning: something' });
    const dest = join(dir, 'asterc');
    const r = buildCompiler({ cmd: b, args: [] }, 'src.aster', dest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('warning: something');
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
    const count = () =>
      readdirSync(tmpdir()).filter((f) => f.startsWith('aster-build-compiler-') && !f.startsWith('aster-build-compiler-test-')).length;
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
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/build_compiler.test.ts`
Expected: FAIL — cannot resolve `../scripts/build-compiler.js`.

- [ ] **Step 3: Implement `scripts/build-compiler.ts`**

```ts
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, copyFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstDifference } from './selfhost.ts';

// `pnpm bootstrap` and `pnpm build` (issue #21): install the self-hosted compiler as build/asterc. The builder (stage
// 0 for bootstrap, the installed compiler for build) builds c1 from packages/asterc-self/asterc.aster, c1 builds c2,
// and c2 is installed only if c1 and c2 emit identical C. A failure leaves any installed compiler untouched.
// Orchestration only: it spawns compilers and never imports the TypeScript compiler.

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const INSTALLED = 'build/asterc';
export const MISSING = 'aster: no compiler at build/asterc; run `pnpm bootstrap` first';
const COMPILER = 'packages/asterc-self/asterc.aster';
const S0 = 'packages/asterc/dist/cli/bin.js';

export type Mode = 'bootstrap' | 'build';
export interface Builder {
  cmd: string;
  args: string[];
}
export type BuildResult = { ok: true } | { ok: false; step: string; message: string };

export function parseMode(argv: string[]): Mode | null {
  return argv.length === 1 && (argv[0] === 'bootstrap' || argv[0] === 'build') ? argv[0] : null;
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, LC_ALL: 'C' },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), status: r.status };
}

export function buildCompiler(builder: Builder, source: string, dest: string): BuildResult {
  const work = mkdtempSync(join(tmpdir(), 'aster-build-compiler-'));
  try {
    const c1 = join(work, 'c1');
    const c2 = join(work, 'c2');
    const builds: [string, Builder, string][] = [
      ['build c1', builder, c1],
      ['build c2', { cmd: c1, args: [] }, c2],
    ];
    for (const [step, b, out] of builds) {
      const r = run(b.cmd, [...b.args, 'build', source, '-o', out]);
      if (r.status !== 0 || r.stderr !== '') return { ok: false, step, message: `status ${r.status}\n${r.stderr}` };
    }
    const emitted: string[] = [];
    for (const [name, bin] of [['c1', c1], ['c2', c2]] as const) {
      const r = run(bin, ['build', source, '--emit=c']);
      if (r.status !== 0 || r.stderr !== '') return { ok: false, step: `${name} --emit=c`, message: `status ${r.status}\n${r.stderr}` };
      emitted.push(r.stdout);
    }
    const d = firstDifference(emitted[0]!, emitted[1]!);
    if (d !== null) {
      return { ok: false, step: 'fixed point', message: `C(c1) differs from C(c2) at line ${d.line}:\n  c1: ${d.a}\n  c2: ${d.b}` };
    }
    mkdirSync(dirname(dest), { recursive: true });
    const staged = `${dest}.tmp-${process.pid}`;
    copyFileSync(c2, staged);
    chmodSync(staged, 0o755);
    renameSync(staged, dest);
    return { ok: true };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function main(argv: string[]): number {
  const mode = parseMode(argv);
  if (mode === null) {
    console.error('usage: node scripts/build-compiler.ts bootstrap|build');
    return 2;
  }
  const installed = join(REPO_ROOT, INSTALLED);
  let builder: Builder;
  if (mode === 'bootstrap') {
    const seed = spawnSync('pnpm', ['build:seed'], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (seed.error || seed.status !== 0) {
      console.error('bootstrap: pnpm build:seed failed');
      return 1;
    }
    builder = { cmd: process.execPath, args: [join(REPO_ROOT, S0)] };
  } else {
    if (!executable(installed)) {
      console.error(MISSING);
      return 2;
    }
    builder = { cmd: installed, args: [] };
  }
  const r = buildCompiler(builder, COMPILER, installed);
  if (!r.ok) {
    console.error(`${mode}: ${r.step} failed: ${r.message}`);
    console.error(mode === 'build' ? 'build/asterc is unchanged; `pnpm bootstrap` rebuilds it from the TypeScript seed' : 'build/asterc is unchanged');
    return 1;
  }
  console.log(`${mode}: installed ${INSTALLED} (${mode === 'bootstrap' ? 'from the TypeScript seed' : 'rebuilt by itself'})`);
  return 0;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
```

  Node runs this file by type stripping, which does not map `./selfhost.js` to `selfhost.ts`, so the runtime import
  must say `./selfhost.ts`. Add `"allowImportingTsExtensions": true` to the root `tsconfig.json` `compilerOptions`
  (allowed because it is `noEmit`) so `pnpm typecheck` accepts it; the package's `tsconfig.build.json` is untouched.
  Tests keep importing `../scripts/build-compiler.js` (vitest resolves it), like `selfhost_script.test.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/build_compiler.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Wire up package.json, .gitignore and the seed callers**

`package.json` scripts become (only the changed/new lines shown; keep the rest):

```json
    "build": "node scripts/build-compiler.ts build",
    "build:seed": "pnpm --filter asterc build",
    "bootstrap": "node scripts/build-compiler.ts bootstrap",
```

`.gitignore`: add a line `build/`.

`tests/global-setup.ts:13`: `execFileSync('pnpm', ['build:seed'], …)`, and update its leading comment to say
"stage 0's dist (`pnpm build:seed`)".

`scripts/selfhost.ts:189-190`:

```ts
    step('stage 0 (pnpm build:seed)', () => {
      if (run('pnpm', ['build:seed'], { stdio: 'inherit' }).status !== 0) fail('pnpm build:seed failed');
    });
```

- [ ] **Step 6: Exercise it for real**

```bash
rm -rf build
pnpm build; echo "exit $?"          # expect the MISSING hint and "exit 2"
pnpm bootstrap; echo "exit $?"      # expect "bootstrap: installed build/asterc (from the TypeScript seed)", exit 0
pnpm build; echo "exit $?"          # expect "build: installed build/asterc (rebuilt by itself)", exit 0
build/asterc run tests/programs/basics/hello.aster   # prints 30
git status --porcelain              # build/ must not appear
```

- [ ] **Step 7: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint && pnpm exec vitest run tests/build_compiler.test.ts tests/selfhost_script.test.ts
git add scripts/build-compiler.ts tests/build_compiler.test.ts package.json .gitignore tsconfig.json tests/global-setup.ts scripts/selfhost.ts
git commit -m "feat: pnpm bootstrap and pnpm build install the self-hosted compiler (#21)"
```

---

### Task 2: `scripts/aster` — the entry-point wrapper

**Files:**
- Create: `scripts/aster` (mode 755)
- Create: `tests/aster_wrapper.test.ts`
- Modify: `package.json` (`aster`, `aster:seed`)

**Interfaces:**
- Consumes: the `MISSING` text (duplicated verbatim in sh; the test pins both to the same string by importing `MISSING`).
- Produces: `pnpm aster <args>` → `build/asterc <args>`; `pnpm aster:seed <args>` → TS CLI.

- [ ] **Step 1: Write the failing test** — `tests/aster_wrapper.test.ts`

```ts
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MISSING, REPO_ROOT } from '../scripts/build-compiler.js';

// scripts/aster is `pnpm aster`: it runs build/asterc beside it and never falls back to the TypeScript seed.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aster-wrapper-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(REPO_ROOT, 'scripts', 'aster'), join(dir, 'scripts', 'aster'));
  chmodSync(join(dir, 'scripts', 'aster'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const wrapper = (args: string[], cwd: string) =>
  spawnSync(join(dir, 'scripts', 'aster'), args, { cwd, encoding: 'utf8', input: 'from stdin\n' });

describe('scripts/aster', () => {
  it('fails with the bootstrap hint when build/asterc is missing', () => {
    const r = wrapper(['run', 'x.aster'], dir);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe(MISSING + '\n');
  });

  it('runs build/asterc beside it from any cwd, passing args, stdin and exit status through', () => {
    mkdirSync(join(dir, 'build'));
    const stub = join(dir, 'build', 'asterc');
    writeFileSync(stub, '#!/bin/sh\nprintf "[%s]" "$@"\ncat\nexit 7\n');
    chmodSync(stub, 0o755);
    const r = wrapper(['run', 'a b.aster', '--', 'x'], tmpdir());
    expect(r.status).toBe(7);
    expect(r.stdout).toBe('[run][a b.aster][--][x]from stdin\n');
  });

  it('treats a non-executable build/asterc as missing', () => {
    mkdirSync(join(dir, 'build'));
    writeFileSync(join(dir, 'build', 'asterc'), 'not executable');
    expect(wrapper([], dir).status).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/aster_wrapper.test.ts`
Expected: FAIL — `scripts/aster` does not exist (ENOENT in `copyFileSync`).

- [ ] **Step 3: Write `scripts/aster`**

```sh
#!/bin/sh
# `pnpm aster`: runs the installed self-hosted compiler, build/asterc (issue #21). It never falls back to the
# TypeScript seed: `pnpm bootstrap` installs the compiler, and `pnpm aster:seed` runs the seed explicitly.
bin="$(dirname "$0")/../build/asterc"
if [ ! -x "$bin" ]; then
  echo 'aster: no compiler at build/asterc; run `pnpm bootstrap` first' >&2
  exit 2
fi
exec "$bin" "$@"
```

Then `chmod +x scripts/aster` (git records the mode).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/aster_wrapper.test.ts`
Expected: PASS.

- [ ] **Step 5: package.json**

```json
    "aster": "sh scripts/aster",
    "aster:seed": "node packages/asterc/dist/cli/bin.js",
```

Then check pnpm's argument passing by hand (it must forward `--` to the wrapper, as the README's `pnpm aster run … -- <file>` relies on):

```bash
pnpm -s aster run tests/programs/programs/lex.aster -- tests/programs/basics/hello.aster | head -3
pnpm -s aster:seed build tests/programs/basics/hello.aster --emit=tokens | head -3
```

Expected: token lines from both. If pnpm swallows the `--`, note it and adjust (e.g. document `build/asterc run …`).

- [ ] **Step 6: Commit**

```bash
git add scripts/aster tests/aster_wrapper.test.ts package.json
git commit -m "feat: pnpm aster runs the self-hosted compiler (#21)"
```

---

### Task 3: `scripts/normal-path.sh` — prove the normal path without the seed

**Files:**
- Create: `scripts/normal-path.sh` (mode 755)

**Interfaces:**
- Consumes: `build/asterc` (Task 1), `pnpm build` (Task 1), `pnpm aster` (Task 2).
- Produces: `scripts/normal-path.sh` → prints `normal path: PASS`, exit 0; or `normal path: FAIL (<step>)`, exit 1.

- [ ] **Step 1: Write the script**

```sh
#!/bin/sh
# The normal-path check (issue #21): with the TypeScript seed's dist/ hidden, rebuild the compiler with itself, build
# it through `pnpm aster`, and build and run representative programs. Run it after `pnpm bootstrap`.
set -u
cd "$(dirname "$0")/.."
dist=packages/asterc/dist
step=setup

fail() {
  echo "normal path: FAIL ($step)${1:+: $1}" >&2
  exit 1
}

[ -x build/asterc ] || { echo 'aster: no compiler at build/asterc; run `pnpm bootstrap` first' >&2; exit 2; }
[ -e "$dist.hidden" ] && fail "$dist.hidden exists; restore it to $dist first"

work=$(mktemp -d "${TMPDIR:-/tmp}/aster-normal-path-XXXXXX")
restore() {
  [ -e "$dist.hidden" ] && mv "$dist.hidden" "$dist"
  rm -rf "$work"
}
trap restore EXIT
trap 'exit 1' INT TERM HUP
[ -e "$dist" ] && mv "$dist" "$dist.hidden"

step='pnpm build (self-rebuild)'
pnpm -s build || fail

step='pnpm aster build of the compiler'
pnpm -s aster build packages/asterc-self/asterc.aster -o "$work/asterc" || fail
"$work/asterc" build packages/asterc-self/asterc.aster --emit=c > "$work/a.c" || fail
build/asterc build packages/asterc-self/asterc.aster --emit=c > "$work/b.c" || fail
cmp -s "$work/a.c" "$work/b.c" || fail 'its --emit=c differs from build/asterc'

# The expect-stdout block of a golden program's header, without the comment markers.
expected() {
  awk '
    !/^\/\// { exit }
    /^\/\/ ?expect-stdout:$/ { on = 1; next }
    /^\/\/ ?expect-/ { on = 0; next }
    on { sub(/^\/\/ ?/, ""); print }
  ' "$1"
}

check() {
  prog=$1
  shift
  step="pnpm aster run $prog"
  pnpm -s aster run "tests/programs/$prog" "$@" > "$work/out" || fail "exit $?"
  expected "tests/programs/$prog" > "$work/want"
  cmp -s "$work/want" "$work/out" || fail "stdout differs: $(diff "$work/want" "$work/out" | head -5)"
}

check basics/hello.aster
check programs/rpn.aster
check programs/calc.aster
check modules/diamond.aster
check programs/lex.aster -- tests/programs/programs/fixtures/lex_sample.txt

echo 'normal path: PASS'
```

  Before relying on it, confirm each of the five programs has no `expect-exit`, `expect-stdin` or extra `expect-args`
  directives that the script ignores (`grep -n '^// expect' tests/programs/<prog>`). `lex.aster`'s
  `expect-args: fixtures/lex_sample.txt` is relative to its own directory; the script passes the repo-relative path.
  If `modules/diamond.aster` needs anything else, swap it for `modules/basic.aster`.

  If pnpm does not forward `--` (Task 2, Step 5), call `build/asterc run` for the `lex.aster` check only and say so in
  a comment.

- [ ] **Step 2: Run it and check its failure handling**

```bash
chmod +x scripts/normal-path.sh
scripts/normal-path.sh; echo "exit $?"                       # normal path: PASS, exit 0
ls packages/asterc/dist >/dev/null && echo "dist restored"
mv packages/asterc/dist packages/asterc/dist.hidden && mkdir packages/asterc/dist
scripts/normal-path.sh; echo "exit $?"                       # FAIL (setup): dist.hidden exists, exit 1
rmdir packages/asterc/dist && mv packages/asterc/dist.hidden packages/asterc/dist
```

  Then temporarily rename `build/asterc` and confirm `scripts/normal-path.sh` exits 2 with the bootstrap hint and leaves
  `dist/` in place; rename it back.

- [ ] **Step 3: Commit**

```bash
git add scripts/normal-path.sh
git commit -m "test: scripts/normal-path.sh proves the build path without the seed (#21)"
```

---

### Task 4: CI — the proof and the normal path on every PR

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace the single `test` job with two jobs**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  proof:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm selfhost
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: selfhost-report
          path: .selfhost/
          if-no-files-found: ignore

  normal-path:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm bootstrap
      - run: scripts/normal-path.sh
```

- [ ] **Step 2: Validate locally**

Run: `node -e "require('node:fs').readFileSync('.github/workflows/ci.yml','utf8')" && grep -c 'runs-on' .github/workflows/ci.yml`
Expected: `2`. The real check is the PR's CI run (Task 6).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the self-hosting proof and the normal-path check (#21)"
```

---

### Task 5: Documentation

**Files:**
- Create: `docs/self-host/building.md`
- Modify: `README.md` (intro, Quick start, CLI note, Self-hosted compiler, Self-hosting, new Remaining work, Docs list)
- Modify: `docs/spec/language.md:50`
- Modify: `docs/superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md` (status line, §1 criterion 4, §5 S0 row)

- [ ] **Step 1: Write `docs/self-host/building.md`** with these sections, using the exact commands from Tasks 1–3:

  1. **What you get** — `build/asterc` is the Aster compiler, written in Aster and built by itself; TypeScript is the
     bootstrap seed, recovery path and test oracle.
  2. **Requirements** — Linux x86_64; gcc 13 as `cc`; Node 24+ and pnpm for bootstrap, orchestration scripts and tests
     only. `build/asterc` itself needs only `cc` and libc (runtime embedded, contract §4.4). Untested: other OSes,
     architectures, clang, other gcc majors.
  3. **First build** — `pnpm install && pnpm bootstrap` (what it does: §3 of the spec, in two sentences).
  4. **Everyday commands** — the spec §2 table, verbatim, plus "you can call `build/asterc` directly".
  5. **Changing the compiler** — edit `packages/asterc-self/*.aster`, `pnpm build` (fixed-point, atomic, old binary
     kept on failure), `pnpm test`, `pnpm selfhost` before a PR.
  6. **Artifacts** — `build/asterc`; `.selfhost/` (`report.txt`, `report.json`, `c0.c`…`c4.c`, vitest json);
     temp dirs `aster-build-compiler-*`, `aster-selfhost-*`, `aster-normal-path-*` under `$TMPDIR`, removed on exit.
  7. **Verifying** — `pnpm selfhost` (and `--record`), `scripts/normal-path.sh`, and that CI runs both on every PR.
  8. **Recovery** — spec §3's recovery paragraph, as a short list.
  9. **Differences from the seed CLI** — link contract §4.5; `pnpm aster:seed` for `--emit=tokens|ast|ir` and `ASTER_CC`.

- [ ] **Step 2: README**

  - Intro paragraph: the compiler is written in Aster and compiles itself through C; the TypeScript `asterc` is the
    bootstrap seed and test oracle; an LLVM backend is the next goal.
  - Quick start: `pnpm install`, `pnpm bootstrap`, then the same `pnpm aster run …` lines. Requirements line adds gcc 13
    and points to `docs/self-host/building.md`.
  - After the CLI block: one line that `pnpm aster` is the self-hosted compiler and `pnpm aster:seed` is the
    TypeScript one, which alone supports `--emit=tokens|ast|ir` and `ASTER_CC`. Move the "`run` goes through Node,
    which decodes arguments as UTF-8…" sentence under `aster:seed`, since the wrapper passes raw bytes; verify with
    `build/asterc run` before rewording.
  - "Self-hosted compiler": replace the `pnpm build` / `pnpm aster build … -o asterc` lines with `pnpm bootstrap` /
    `build/asterc …`, keep the timings and the limits list, and link `building.md`.
  - "Self-hosting": present tense, achieved; mention CI runs the proof on every PR.
  - New "Remaining work" section (not part of self-hosting): `--emit=tokens|ast|ir` and `ASTER_CC` in the self-hosted
    CLI; import identity through symlinks; the runtime never frees memory; compile-time performance; LLVM backend
    (planning is next).
  - Docs list: add `building.md` and the normal-build-path spec.

- [ ] **Step 3: language.md and the contract**

  - `docs/spec/language.md:50`: `Run it with \`pnpm aster run example.aster\` (after \`pnpm bootstrap\`).`
  - Contract: add under the Status line `**Achieved:** 2026-10-04 — #20 proved it, #21 made it the normal build path
    ([building.md](../../self-host/building.md)).`; §1 criterion 4 gets the same link; §5 S0 row command becomes
    `` `pnpm build:seed`; then `node packages/asterc/dist/cli/bin.js` ``.

- [ ] **Step 4: Check every command in the docs actually runs**

```bash
grep -n 'pnpm [a-z:]*' README.md docs/self-host/building.md | grep -v 'pnpm \(install\|bootstrap\|build\|build:seed\|aster\|aster:seed\|test\|selfhost\|typecheck\|lint\)\b'
```
Expected: no output (no stale or invented commands).

- [ ] **Step 5: Commit**

```bash
git add docs/self-host/building.md README.md docs/spec/language.md docs/superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md
git commit -m "docs: the self-hosted compiler is the normal build path (#21)"
```

---

### Task 6: Full verification, proof record, PR

- [ ] **Step 1: Run everything**

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm bootstrap && scripts/normal-path.sh
```
Expected: all pass, `normal path: PASS`.

- [ ] **Step 2: Record the proof from a clean tree**

```bash
git status --porcelain     # must be empty
pnpm selfhost --record     # PASS; rewrites docs/self-host/proof.md
git add docs/self-host/proof.md
git commit -m "docs: self-hosting proof record (#21)"
```

- [ ] **Step 3: Push and open the PR** — title `build: the self-hosted compiler is the normal build path (#21)`;
  body: summary, the commands table, the `scripts/normal-path.sh` output, the proof table, "Closes #21", and a note
  that closing the milestone and opening the LLVM planning issue wait for the user's go-ahead.

- [ ] **Step 4: Watch CI** — both `proof` and `normal-path` must pass. Fix anything that differs between WSL and the
  runner (e.g. gcc version string, pnpm `--` handling) on the branch.

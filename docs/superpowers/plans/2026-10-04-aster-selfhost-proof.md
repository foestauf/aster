# Aster Self-Hosting Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove S1 → S2 → S3 self-hosting parity with one command (`pnpm selfhost`), and fix #13 (astral invalid escape) and #12 (symlinked root identity) in stage 0.

**Architecture:** A shared `tests/stage.ts` picks the compiler under test: an env-provided stage binary, or else S1 built once in vitest's global setup. The existing self-host and parity suites route their builds through it, and a new golden-run suite covers contract §6.3. `scripts/selfhost.ts` builds S0 to S4 and compares their C byte for byte. It then runs the stage-aware suites once per stage and writes a report. It only orchestrates and never imports the TypeScript compiler.

**Tech Stack:** TypeScript on Node 24 (native type stripping for scripts), vitest 5, pnpm, gcc 13, Aster.

**Spec:** `docs/superpowers/specs/2026-10-04-aster-selfhost-proof-design.md` (and the contract, `docs/superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md`).

## Global Constraints

- Platform: Linux x86_64, gcc 13 as `cc`, Node ≥ 24. C flags: `-std=c11 -O2 -Wall`. Test harnesses may add `-Werror`.
- Comparisons run with the repo root as cwd, the compiler root spelled `packages/asterc-self/asterc.aster`, and `LC_ALL=C`.
- Frozen baseline: no existing `expect-*` directive, parity corpus or expectation changes. Tests are only added. No skips and no skip lists.
- C comparisons are byte-identical, with no normalisation.
- `scripts/selfhost.ts` must not import anything under `packages/`.
- Code style follows the surrounding files: 2-space indent, single quotes, `node:` imports, a short header comment per test file, and comments only where something is non-obvious.
- Each commit message is conventional (commitlint) and ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FpzzMjPkrLERmoHMVp5kyD
  ```
- Run `pnpm build && pnpm test && pnpm lint && pnpm typecheck` before each commit. Everything must pass. (Task 1 has an expected red step before its fix.)

## Review Focus

1. **`ASTER_STAGE_BIN` set without `ASTER_STAGE`, or pointing at a missing file.** `stage()` must throw a clear error, not silently fall back to S1. (Task 2 tests this.)
2. **`pnpm selfhost` invoked from a subdirectory.** Every stage command must still run with the repo root as cwd. The script derives the root from `import.meta.url`, never from `process.cwd()`. (Task 6 asserts it.)
3. **A failure partway through `pnpm selfhost`.** The temp stage dir is removed whether the run succeeds or fails, while `.selfhost/` keeps whatever was written. (Task 6 covers it through `try/finally`, checked by inspection and by the manual verification step.)
4. **A root that is itself a symlink to a file, imported back by its physical path.** It must load once. (Task 5 adds the case.)
5. **A dirty tree.** A plain run records `dirty: true` and carries on. `--record` refuses. (Task 6 tests this through `recordAllowed`.)

---

### Task 1: #13: an invalid escape consumes the whole following code point

**Files:**
- Modify: `packages/asterc/src/lexer/lexer.ts`, the string-literal escape branch (around lines 72–82, `const width = …`)
- Modify: `packages/asterc/src/lexer/lexer.test.ts`, after the `reports invalid escapes and keeps lexing` test (around line 78)
- Create: `tests/programs/programs/fixtures/lex_escape_astral.txt`
- Create: `tests/programs/errors/invalid_escape_astral.aster`
- Modify: `docs/self-host/friction.md`, entry `### 9.` (line ~126)

**Interfaces:** none. This is a behaviour change in the lexer only.

- [ ] **Step 1: Capture the before behaviour.** Run:
  ```bash
  node -e "import('./packages/asterc/dist/index.js').then(m=>{const r=m.lex(m.makeSource('x','\"\\\\😀\" tail'));console.log(JSON.stringify(r.diagnostics), JSON.stringify(r.tokens[0].stringValue))})"
  ```
  (`pnpm build` first if `dist` is stale.) Save the output for the commit message. It should show a message containing a lone `\ud83d` and a span of `{start:1,end:3}`.

- [ ] **Step 2: Write the failing lexer unit tests** in `lexer.test.ts`, after `reports invalid escapes and keeps lexing`:
  ```ts
  it('consumes a whole astral character after an invalid backslash', () => {
    const r = run('"\\😀" tail');
    expect(r.diagnostics).toEqual([{ message: "invalid escape sequence '\\😀'", span: { start: 1, end: 4 } }]);
    expect(r.tokens.map((t) => t.kind)).toEqual(['string', 'ident', 'eof']);
    expect(r.tokens[0].stringValue).toBe('');
    expect(r.tokens[1].span).toEqual({ start: 6, end: 10 });
  });

  it('consumes a whole BMP character after an invalid backslash', () => {
    const r = run('"\\é"');
    expect(r.diagnostics).toEqual([{ message: "invalid escape sequence '\\é'", span: { start: 1, end: 3 } }]);
  });

  it('keeps an invalid backslash before a newline or end of file one unit wide', () => {
    expect(run('"\\').diagnostics[0]).toEqual({ message: "invalid escape sequence '\\'", span: { start: 1, end: 2 } });
    expect(run('"\\\nx').diagnostics[0]).toEqual({ message: "invalid escape sequence '\\'", span: { start: 1, end: 2 } });
  });
  ```
  Check the EOF/newline expectations against today's output (`width === 1` branch) before you commit to them. They must describe current behaviour, which this task does not change. If the current messages differ (for example, an extra "unterminated string" diagnostic), assert `diagnostics[0]` only, as shown.

- [ ] **Step 3: Add the parity fixture** `tests/programs/programs/fixtures/lex_escape_astral.txt`. Each line is a separate case, and the file ends without a trailing newline after the last line, so the EOF case is real:
  ```
  "\😀" tail
  "a\😀b\n" x
  "\é" y
  "\q\t\😀"
  "\
  "\😀
  "\
  ```

- [ ] **Step 4: Add the error golden** `tests/programs/errors/invalid_escape_astral.aster`:
  ```
  // An invalid escape before an astral character: the diagnostic quotes the whole character, and the caret spans it.
  // expect-error: 3:20 invalid escape sequence '\😀'
  fn main(): int {
    let s: string = "\😀";
    return 0;
  }
  ```
  Line and column in `expect-error` are 1-based and count UTF-16 units. The column given here is a guess. Run `pnpm aster check tests/programs/errors/invalid_escape_astral.aster` after the fix and use the real `line:col`. The quoted message must be exactly the one shown.

- [ ] **Step 5: Run the tests and watch them fail.**
  `pnpm build && pnpm vitest run packages/asterc/src/lexer tests/lex_aster.test.ts tests/parse_aster.test.ts tests/golden.test.ts tests/asterc_self.test.ts`
  Expected: the new lexer unit tests fail, and `lex_aster`/`parse_aster` fail on `lex_escape_astral.txt` (TS and Aster disagree). The golden fails or passes depending on the column. Record which fail.

- [ ] **Step 6: Fix the lexer.** In `lexer.ts`, replace the width line in the string escape branch:
  ```ts
  // Consume the whole next code point, so an astral character is never split into a lone surrogate.
  const width = next === undefined || next === '\n' ? 1 : 1 + String.fromCodePoint(text.codePointAt(i + 1)!).length;
  ```

- [ ] **Step 7: Run the full gate.** `pnpm build && pnpm test && pnpm lint && pnpm typecheck`. Everything passes, including the S1 diagnostic comparisons in `asterc_self.test.ts`, which pick up the new error golden automatically. If `parse_aster` or `check_aster` still disagree on the fixture, the Aster side has a real divergence: read `packages/asterc-self/lexer.aster`'s escape branch and report it rather than editing expectations.

- [ ] **Step 8: Update friction entry 9.** Add a short paragraph saying the astral invalid-escape discrepancy (#13) was confirmed and fixed in stage 0 by consuming the whole code point. Cite the fixture and golden. Give the before span `[1,3)` with a lone high surrogate, and the after span `[1,4)` in UTF-16 units, which is `[1,6)` in bytes.

- [ ] **Step 9: Commit.**
  `fix(lexer): consume the whole code point after an invalid escape (#13)`. Put the before/after output from Steps 1 and 7 in the body.

---

### Task 2: `tests/stage.ts`, and S1 built once in global setup

**Files:**
- Create: `tests/stage.ts`
- Create: `tests/stage.test.ts`
- Modify: `tests/global-setup.ts`
- Modify: `tests/asterc_self.test.ts`: replace the S1 `beforeAll` build (lines ~19–36), `runS1`, and the `S2` block (lines ~387–410)

**Interfaces:**
- Produces:
  ```ts
  export interface Stage { name: 'S1' | 'S2' | 'S3'; bin: string }
  export function stage(): Stage
  export function buildWithStage(src: string, out: string): void
  export const REPO_ROOT: string
  ```
  `buildWithStage` runs `<bin> build <src> -o <out>` with cwd `REPO_ROOT` and `LC_ALL=C`. It throws `Error("<stage> failed to build <src> (status N):\n<stderr>")` on a non-zero status or any stderr output.
- The global setup provides `s1Bin: string` via vitest `provide`/`inject`.

- [ ] **Step 1: Write `tests/stage.test.ts`.** The pure resolution logic is exported separately so it can be tested without env mutation:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { resolveStage } from './stage.js';

  // tests/stage.ts picks the compiler under test: an explicit stage binary from the environment, or S1 from global setup.
  describe('resolveStage', () => {
    const exists = (p: string): boolean => p === '/bin/s2';

    it('defaults to S1 from global setup', () => {
      expect(resolveStage({}, '/tmp/s1', exists)).toEqual({ name: 'S1', bin: '/tmp/s1' });
    });

    it('uses ASTER_STAGE_BIN and ASTER_STAGE together', () => {
      expect(resolveStage({ ASTER_STAGE_BIN: '/bin/s2', ASTER_STAGE: 'S2' }, '/tmp/s1', exists)).toEqual({ name: 'S2', bin: '/bin/s2' });
    });

    it.for([
      [{ ASTER_STAGE_BIN: '/bin/s2' }, /set together/],
      [{ ASTER_STAGE: 'S2' }, /set together/],
      [{ ASTER_STAGE_BIN: '/bin/s2', ASTER_STAGE: 'S9' }, /S1, S2 or S3/],
      [{ ASTER_STAGE_BIN: '/bin/missing', ASTER_STAGE: 'S3' }, /does not exist/],
    ] as const)('rejects %j', ([env, message]) => {
      expect(() => resolveStage(env, '/tmp/s1', exists)).toThrow(message);
    });

    it('rejects a missing S1 when no stage is given', () => {
      expect(() => resolveStage({}, undefined, exists)).toThrow(/global setup/);
    });
  });
  ```

- [ ] **Step 2: Run it.** `pnpm vitest run tests/stage.test.ts` fails because `./stage.js` doesn't exist yet.

- [ ] **Step 3: Write `tests/stage.ts`.**
  ```ts
  import { spawnSync } from 'node:child_process';
  import { existsSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import { inject } from 'vitest';

  // The self-hosted compiler under test. `pnpm test` uses S1, which tests/global-setup.ts builds once from stage 0.
  // `pnpm selfhost` runs the stage-aware suites once per stage with ASTER_STAGE_BIN and ASTER_STAGE set.

  export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

  export interface Stage {
    name: 'S1' | 'S2' | 'S3';
    bin: string;
  }

  declare module 'vitest' {
    export interface ProvidedContext {
      s1Bin: string;
    }
  }

  export function resolveStage(
    env: Record<string, string | undefined>,
    s1: string | undefined,
    exists: (path: string) => boolean,
  ): Stage {
    const bin = env.ASTER_STAGE_BIN;
    const name = env.ASTER_STAGE;
    if ((bin === undefined) !== (name === undefined)) throw new Error('ASTER_STAGE_BIN and ASTER_STAGE must be set together');
    if (bin === undefined || name === undefined) {
      if (s1 === undefined) throw new Error('no S1: tests/global-setup.ts should have built it');
      return { name: 'S1', bin: s1 };
    }
    if (name !== 'S1' && name !== 'S2' && name !== 'S3') throw new Error(`ASTER_STAGE must be S1, S2 or S3, not '${name}'`);
    if (!exists(bin)) throw new Error(`ASTER_STAGE_BIN '${bin}' does not exist`);
    return { name, bin };
  }

  let cached: Stage | undefined;

  export function stage(): Stage {
    cached ??= resolveStage(process.env, inject('s1Bin'), existsSync);
    return cached;
  }

  export function buildWithStage(src: string, out: string): void {
    const { name, bin } = stage();
    const r = spawnSync(bin, ['build', src, '-o', out], {
      cwd: REPO_ROOT,
      env: { ...process.env, LC_ALL: 'C' },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
    if (r.error) throw r.error;
    if (r.status !== 0 || r.stderr !== '') throw new Error(`${name} failed to build ${src} (status ${r.status}):\n${r.stderr}`);
  }
  ```
  If `inject('s1Bin')` throws outside a provided context in vitest 5, wrap it as `(() => { try { return inject('s1Bin'); } catch { return undefined; } })()`. Check vitest 5's `provide`/`inject` API with context7 (`/vitest-dev/vitest`, "globalSetup provide inject") before you write this.

- [ ] **Step 4: Global setup builds S1 unless a stage is given.** Rewrite `tests/global-setup.ts`:
  ```ts
  import { execFileSync } from 'node:child_process';
  import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { fileURLToPath } from 'node:url';
  import type { TestProject } from 'vitest/node';

  const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

  // Builds stage 0's dist (the self-host suites compare against its CLI) and, unless ASTER_STAGE_BIN names a stage,
  // S1 from packages/asterc-self/asterc.aster, once for every test file.
  export default async function setup(project: TestProject): Promise<() => void> {
    execFileSync('pnpm', ['build'], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (process.env.ASTER_STAGE_BIN !== undefined) return () => {};
    const { buildExecutable, compileToC, formatDiagnostic, makeSource } = await import('../packages/asterc/src/index.js');
    const dir = mkdtempSync(join(tmpdir(), 'aster-s1-'));
    const src = join(REPO_ROOT, 'packages', 'asterc-self', 'asterc.aster');
    const compiled = compileToC(makeSource(src, readFileSync(src, 'utf8')));
    if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
    const built = buildExecutable(compiled.c, join(dir, 's1'), ['-Werror']);
    if (!built.ok) throw new Error(built.message);
    project.provide('s1Bin', join(dir, 's1'));
    return () => rmSync(dir, { recursive: true, force: true });
  }
  ```
  The dynamic import happens after `pnpm build`, so a fresh checkout works. Adjust the `provide` call to vitest 5's actual global-setup signature, which you confirmed in Step 3.

- [ ] **Step 5: Point `asterc_self.test.ts` at `stage()`.**
  - Delete the `S1_SOURCE` constant, the `s1` path and the `beforeAll` that compiles and builds S1. Keep `workDir`/`tmpDir`, `afterAll` and the `TMPDIR`-empty `afterEach`.
  - Rename `runS1` to `runSn` at every call site, defined as `const runSn = (argv: readonly string[], opts?: RunOptions): Outcome => spawn(stage().bin, argv, opts);`. Use a word-boundary replace on `runS1` and check the diff.
  - Rename `s0UsageToS1` to `s0UsageToSn`.
  - Update the header comment: "the self-hosted compiler under test (S1 by default; see tests/stage.ts)".
  - Replace the `describe('S2: the compiler built by itself', …)` block. Keep its body, but build `next = join(workDir, 'next')` with `runSn(['build', join('packages','asterc-self','asterc.aster'), '-o', next])` and title it `` `${stage().name} builds the next stage, whose C matches stage 0` ``. Keep the four `--emit=c` cases.
  - Any test that used `s1` as a path for something other than running it (search for `s1` usages) should use `stage().bin`.

- [ ] **Step 6: Run the gate.** `pnpm build && pnpm test && pnpm lint && pnpm typecheck`. All tests pass, with the same `asterc_self` count as before plus the new `stage.test.ts` cases. Also check by hand that a stage env works:
  ```bash
  d=$(mktemp -d) && pnpm -s aster build packages/asterc-self/asterc.aster -o $d/s1 && \
  ASTER_STAGE_BIN=$d/s1 ASTER_STAGE=S1 pnpm vitest run tests/asterc_self.test.ts; rm -rf $d
  ```

- [ ] **Step 7: Commit.** `test: run the self-host suite against a chosen stage (#20)`

---

### Task 3: stage-aware front-end and back-end parity drivers

**Files:**
- Modify: `tests/lex_aster.test.ts`, `tests/parse_aster.test.ts`, `tests/check_aster.test.ts`, `tests/typed_aster.test.ts`, `tests/ir_aster.test.ts` and `tests/emit_aster.test.ts`: the `beforeAll` that builds the driver

**Interfaces:**
- Consumes: `buildWithStage(src, out)` and `stage()` from Task 2.
- Produces: a helper added to `tests/stage.ts`:
  ```ts
  /** Builds the driver at `src` into `out`: with stage 0 in process under `pnpm test`, with the stage under `pnpm selfhost`. */
  export function buildDriver(src: string, out: string): void
  ```

- [ ] **Step 1: Add `buildDriver` to `tests/stage.ts`.**
  ```ts
  export function buildDriver(src: string, out: string): void {
    if (process.env.ASTER_STAGE_BIN !== undefined) return buildWithStage(src, out);
    const compiled = compileToC(makeSource(src, readFileSync(src, 'utf8')));
    if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
    const built = buildExecutable(compiled.c, out, ['-Werror']);
    if (!built.ok) throw new Error(built.message);
  }
  ```
  Import `readFileSync`, plus `buildExecutable`, `compileToC`, `formatDiagnostic` and `makeSource` from `../packages/asterc/src/index.js`. That is fine here, because `tests/` may import stage 0 and only `scripts/selfhost.ts` may not.

  `buildWithStage` takes `src` relative to the repo root or absolute. The drivers pass absolute paths, which is fine.

- [ ] **Step 2: Replace each driver build.** In each of the six files, replace the body of the `beforeAll` that compiles the driver (the `compileToC` → `buildExecutable` lines) with `buildDriver(<same absolute path>, <same exe>)`. Keep the hook timeout, and add `CC_HOOK_TIMEOUT = 60_000` where a file lacks one, because a stage build of a driver takes about a second.

  In `emit_aster.test.ts`, E0 is built with `buildDriver`. E1 keeps being built from E0's own C with `buildExecutable(own.stdout, e1, ['-Werror'])`. That compiles C, not Aster, so it is stage-independent. Leave it. Rename the describe title "emit.aster (built by stage 0)" to "emit.aster (built by the stage under test)".

  Drop imports that are no longer used (lint enforces this).

- [ ] **Step 3: Run the gate.** `pnpm build && pnpm test && pnpm lint && pnpm typecheck` passes with unchanged counts. Then run under a stage:
  ```bash
  d=$(mktemp -d) && pnpm -s aster build packages/asterc-self/asterc.aster -o $d/s1 && \
  ASTER_STAGE_BIN=$d/s1 ASTER_STAGE=S1 pnpm vitest run tests/{lex,parse,check,typed,ir,emit}_aster.test.ts; rm -rf $d
  ```
  Expected: all pass.

- [ ] **Step 4: Commit.** `test: build the parity drivers with the stage under test (#20)`

---

### Task 4: `selfhost_golden.test.ts`, the golden runs through a stage (contract §6.3)

**Files:**
- Create: `tests/selfhost_golden.test.ts`

**Interfaces:**
- Consumes: `stage()` and `REPO_ROOT` from `tests/stage.ts`, `parseExpectations` from `tests/harness.ts`.

- [ ] **Step 1: Write the suite.**
  ```ts
  import { spawnSync } from 'node:child_process';
  import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { basename, dirname, join } from 'node:path';
  import { afterAll, afterEach, describe, expect, it } from 'vitest';
  import { parseExpectations } from './harness.js';
  import { stage } from './stage.js';

  // Contract §6.3: every runnable golden program, run through the stage under test with `run <file> -- <args>` and its
  // expect-stdin, must meet its expect-stdout, expect-stderr and expect-exit unchanged. Runs from the program's own
  // directory, as tests/golden.test.ts does, under a private TMPDIR that must be empty after every program.

  const PROGRAMS_DIR = new URL('./programs/', import.meta.url).pathname;
  const runnable = readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.aster') && !f.split(/[\\/]/).includes('fixtures'))
    .toSorted()
    .map((file) => ({ file, expected: parseExpectations(readFileSync(join(PROGRAMS_DIR, file), 'utf8')) }))
    .filter(({ expected }) => !expected.library && expected.errors.length === 0);

  const workDir = mkdtempSync(join(tmpdir(), 'aster-sn-golden-'));
  const tmpDir = join(workDir, 'tmp');
  mkdirSync(tmpDir);
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));
  afterEach(() => {
    const left = readdirSync(tmpDir);
    if (left.length > 0) throw new Error(`TMPDIR is not empty: ${left.join(', ')}`);
  });

  describe(`golden programs run through ${stage().name}`, () => {
    it('covers more than the compiler driver', () => {
      expect(runnable.length).toBeGreaterThan(50);
    });

    it.for(runnable)('$file', ({ file, expected }) => {
      const r = spawnSync(stage().bin, ['run', basename(file), '--', ...expected.args], {
        cwd: dirname(join(PROGRAMS_DIR, file)),
        env: { ...process.env, TMPDIR: tmpDir, LC_ALL: 'C' },
        input: expected.stdin,
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      if (r.error) throw r.error;
      expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.status }).toEqual({
        stdout: expected.stdout,
        stderr: expected.stderr,
        exitCode: expected.exitCode,
      });
    });
  });
  ```
  Check the real number of runnable programs (`golden.test.ts`'s run count) and set the `toBeGreaterThan` bound just below it.

  If `describe` evaluating `stage()` at collection time fails because `inject` isn't available during collection, move the name into a variable computed inside a `beforeAll`, and use a static describe title such as `'golden programs run through the stage under test'`.

- [ ] **Step 2: Run it.** `pnpm vitest run tests/selfhost_golden.test.ts`. Expected: every program passes. A failure is a real §6.3 defect: investigate with superpowers:systematic-debugging, and never edit a golden's directives. Programs that write to stderr and exit non-zero (panics) must still match, because `Sn run` passes the program's status through.

- [ ] **Step 3: Run the full gate** (`pnpm build && pnpm test && pnpm lint && pnpm typecheck`).

- [ ] **Step 4: Commit.** `test: run every golden program through the stage under test (#20)`

---

### Task 5: #12: the root is keyed by its physical path

**Files:**
- Modify: `packages/asterc/src/driver/load.ts`: `nodeLoadHost.realPath` (line ~47) and the `loaded` seed (line ~75)
- Modify: `packages/asterc/src/driver/load.test.ts`: add an in-memory case
- Create: `tests/load_symlink.test.ts`

**Interfaces:**
- Consumes: `stage()` from `tests/stage.ts`.
- Produces: no API change. `LoadHost.realPath` keeps its signature.

- [ ] **Step 1: Write the on-disk test** `tests/load_symlink.test.ts`:
  ```ts
  import { spawnSync } from 'node:child_process';
  import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { afterAll, describe, expect, it } from 'vitest';
  import { stage } from './stage.js';

  // #12: a root spelled through a symlinked directory and `..` must get the same identity as the physical file that an
  // import cycle reaches, so it loads once. Stage 0 resolves physically. The self-hosted loader uses lexical identity,
  // so it may load the file twice (contract §4.5, §7); that limit is asserted here, not hidden.

  const S0_BIN = fileURLToPath(new URL('../packages/asterc/dist/cli/bin.js', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'aster-symlink-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // dir/entry/link -> dir/other/dir, so entry/link/.. is physically dir/other, lexically dir/entry.
  mkdirSync(join(dir, 'entry'));
  mkdirSync(join(dir, 'other', 'dir'), { recursive: true });
  symlinkSync(join(dir, 'other', 'dir'), join(dir, 'entry', 'link'));
  writeFileSync(join(dir, 'other', 'root.aster'), 'import "helper.aster";\nfn main(): int {\n  return helper();\n}\n');
  writeFileSync(join(dir, 'other', 'helper.aster'), `import "${join(dir, 'other', 'root.aster')}";\nfn helper(): int {\n  return 0;\n}\n`);
  // A root that is itself a symlink to a file, imported back by the physical path.
  symlinkSync(join(dir, 'other', 'root.aster'), join(dir, 'entry', 'root_link.aster'));

  const spellings = {
    canonical: join(dir, 'other', 'root.aster'),
    aliased: `${dir}/entry/link/../root.aster`,
    'file symlink': join(dir, 'entry', 'root_link.aster'),
  };

  const s0 = (argv: string[]) => spawnSync(process.execPath, [S0_BIN, ...argv], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });

  describe('stage 0 loads a root reached through a symlink once', () => {
    it.for(Object.entries(spellings))('%s', ([, path]) => {
      expect(s0(['check', path])).toMatchObject({ stdout: '', stderr: '', status: 0 });
      const c = s0(['build', path, '--emit=c']);
      expect(c.status).toBe(0);
      expect(c.stdout).toBe(s0(['build', spellings.canonical, '--emit=c']).stdout);
    });
  });

  describe('the self-hosted loader keeps lexical identity (documented limit)', () => {
    it(`${stage().name} loads the aliased root twice`, () => {
      const r = spawnSync(stage().bin, ['check', spellings.aliased], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/duplicate|more than one|already defined/);
    });
  });
  ```
  `spellings.aliased` uses a template string precisely so that `..` is not folded by `join`.

  `` `${dir}/entry/link/../root.aster` `` must not be passed through `join` or `resolve`.

  Before you fix anything, run the second describe once and replace the `toMatch` regex with the actual diagnostic text S1 prints. If S1 does not in fact load the root twice, because lexically `entry/link/../root.aster` becomes `entry/root.aster`, which doesn't exist so the root itself is read through the OS, then work out the real S1 behaviour and assert exactly that, with a comment explaining it. The point is to pin the documented limit, whatever it is.

- [ ] **Step 2: Run it and watch it fail.** `pnpm build && pnpm vitest run tests/load_symlink.test.ts`. Expected: `aliased` fails on S0 with duplicate-declaration or root-main diagnostics. Save the output for the commit message. If it does not fail, Node's `realpathSync` may already handle it. In that case record the evidence, keep the test as a regression guard, and still make Steps 3 and 4 only if a variant (such as the file-symlink root) fails.

- [ ] **Step 3: Add the in-memory unit test** to `load.test.ts`, following the existing tests' mock `LoadHost` style (read lines 1–30 for the helper). The host's `realPath` maps `/p/entry/link/../root.aster` and `/p/other/root.aster` to `/p/other/root.aster`, and maps `/p/other/helper.aster` to itself. `readFile` serves the root (which imports `helper.aster`) and the helper (which imports `/p/other/root.aster`). Load with root path `/p/entry/link/../root.aster`, and expect two files, the root first, with the display path `/p/entry/link/../root.aster` unchanged.

- [ ] **Step 4: Fix the loader.** In `load.ts`:
  ```ts
  realPath(path) {
    try {
      // realpathSync.native: the JS realpathSync folds `..` lexically before following links, which is wrong
      // through a symlinked directory.
      return realpathSync.native(path);
    } catch {
      return resolve(path);
    }
  },
  ```
  and
  ```ts
  // The root is keyed the same way as every import: physically, from its spelling as given.
  const loaded = new Set<string>([host.realPath(root.path)]);
  ```

- [ ] **Step 5: Run the gate.** `pnpm build && pnpm test && pnpm lint && pnpm typecheck`. All tests pass, including the existing loader, CLI, golden and `asterc_self` path-spelling tests.

- [ ] **Step 6: Commit.** `fix(loader): key the root by its physical path (#12)`. Put the before/after output in the body.

---

### Task 6: `pnpm selfhost`, the proof command

**Files:**
- Create: `scripts/selfhost.ts`
- Create: `tests/selfhost_script.test.ts`
- Modify: `package.json`: add `"selfhost": "node scripts/selfhost.ts"`
- Modify: `.gitignore`: add `.selfhost/`

**Interfaces:**
- Produces (exported from `scripts/selfhost.ts` for tests):
  ```ts
  export function firstDifference(a: string, b: string): { line: number; a: string; b: string } | null
  export function recordAllowed(dirty: boolean, record: boolean): boolean
  export const STAGE_SUITES: readonly string[]
  export const REPO_ROOT: string
  ```

- [ ] **Step 1: Write `tests/selfhost_script.test.ts`.**
  ```ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';
  import { firstDifference, recordAllowed, REPO_ROOT, STAGE_SUITES } from '../scripts/selfhost.ts';

  // scripts/selfhost.ts (pnpm selfhost) is orchestration only (contract §6.4). These cover its pure parts and the rule
  // that it never imports the TypeScript compiler.

  describe('firstDifference', () => {
    it('is null for identical text', () => {
      expect(firstDifference('a\nb\n', 'a\nb\n')).toBeNull();
    });
    it('reports the first differing line, 1-based', () => {
      expect(firstDifference('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ line: 2, a: 'b', b: 'B' });
    });
    it('treats a missing trailing newline as a difference', () => {
      expect(firstDifference('a\n', 'a')).toEqual({ line: 2, a: '', b: '<end of file>' });
    });
    it('reports a length difference on the first extra line', () => {
      expect(firstDifference('a\n', 'a\nb\n')).toEqual({ line: 2, a: '<end of file>', b: 'b' });
    });
  });

  describe('recordAllowed', () => {
    it('refuses to record from a dirty tree', () => {
      expect(recordAllowed(true, true)).toBe(false);
      expect(recordAllowed(false, true)).toBe(true);
      expect(recordAllowed(true, false)).toBe(true);
    });
  });

  describe('the script', () => {
    const text = readFileSync(join(REPO_ROOT, 'scripts', 'selfhost.ts'), 'utf8');
    it('imports nothing from packages/', () => {
      expect(text).not.toMatch(/from\s+['"][^'"]*packages\//);
      expect(text).not.toMatch(/import\(\s*['"][^'"]*packages\//);
    });
    it('derives the repo root from its own location, not the cwd', () => {
      expect(REPO_ROOT.endsWith('/')).toBe(true);
      expect(text).not.toMatch(/process\.cwd\(\)/);
    });
    it('runs only suites that exist', () => {
      for (const s of STAGE_SUITES) expect(() => readFileSync(join(REPO_ROOT, s))).not.toThrow();
    });
  });
  ```
  Importing a `.ts` file with `.ts` extension needs `allowImportingTsExtensions` in tsconfig, or rewrite the import as `'../scripts/selfhost.js'` if vitest resolves that. Check how `gen-runtime`'s test (`tests/runtime_aster.test.ts`) imports the script, if it does, and follow the same pattern.

- [ ] **Step 2: Run it.** `pnpm vitest run tests/selfhost_script.test.ts` fails because the module is missing.

- [ ] **Step 3: Write `scripts/selfhost.ts`.** Structure:
  ```ts
  import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
  import { createHash } from 'node:crypto';
  import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { fileURLToPath, pathToFileURL } from 'node:url';

  // `pnpm selfhost`: the self-hosting proof (contract §6.4, issue #20). Builds S1 with stage 0, S2 with S1, S3 with S2
  // and S4 with S3, requires the compiler's C to be byte-identical at every hop, runs the full test suite and then the
  // stage-aware suites once per stage, and writes a report to .selfhost/. Orchestration only: it spawns compilers, cc,
  // git and vitest, and never lexes, parses, checks, lowers or emits Aster itself.
  // `--record` also writes docs/self-host/proof.md and requires a clean tree.

  export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
  const COMPILER = 'packages/asterc-self/asterc.aster';
  const S0 = 'packages/asterc/dist/cli/bin.js';
  export const STAGE_SUITES = [
    'tests/asterc_self.test.ts', 'tests/selfhost_golden.test.ts', 'tests/load_symlink.test.ts',
    'tests/lex_aster.test.ts', 'tests/parse_aster.test.ts', 'tests/check_aster.test.ts',
    'tests/typed_aster.test.ts', 'tests/ir_aster.test.ts', 'tests/emit_aster.test.ts',
  ] as const;
  ```
  Then:
  - `firstDifference(a, b)`: split both on `'\n'` and walk the lines. The first index where they differ, or where one side runs out, gives `{ line: i + 1, a: lineA ?? '<end of file>', b: lineB ?? '<end of file>' }`. Equal strings give `null`. Make sure the four test cases hold: `'a\n'.split('\n')` is `['a', '']`.
  - `recordAllowed(dirty, record)` returns `!(dirty && record)`.
  - `run(cmd, args, opts)` wraps `spawnSync` with `cwd: REPO_ROOT`, `env: { ...process.env, LC_ALL: 'C' }`, `encoding: 'utf8'` and `maxBuffer: 256 MiB`. It returns `{ stdout, stderr, status }` and throws on `error`.
  - `step(name, fn)` prints `• <name>…` then `ok` or `FAILED`. On failure it records the failure in the report and throws, so the run stops.
  - `main(argv)`:
    1. **Environment.**
       - `commit = git rev-parse HEAD` and `dirty = git status --porcelain` non-empty.
       - `uname -sm`, the first line of `cc --version`, and `process.version`.
       - It fails unless uname is `Linux x86_64`, the cc line matches `/\bgcc\b|\(Ubuntu 13\.|\b13\.\d+\.\d+/` and also contains ` 13.`, and Node's major version is at least 24.
       - If `--record` was given but `!recordAllowed(dirty, true)`, it fails with "--record needs a clean tree".
    2. **S0.** It runs `pnpm build` with inherited stdio.
    3. **Stages.**
       - `work = mkdtempSync(join(tmpdir(), 'aster-selfhost-'))`, with everything after it wrapped in `try { … } finally { rmSync(work, { recursive: true, force: true }) }`.
       - `.selfhost/` is created as `join(REPO_ROOT, '.selfhost')` with `mkdirSync(..., { recursive: true })`, and old `*.c`/`*.json`/`report.*` are cleared first.
       - Build S1 with `node S0 build COMPILER -o work/s1`. Get `c0` from `node S0 build COMPILER --emit=c`.
       - For n = 1..4: `cn = Sn build COMPILER --emit=c`, which requires status 0 and empty stderr. For n ≤ 3, build `work/s(n+1)` with `Sn build COMPILER -o work/s(n+1)`, again requiring status 0 and empty stderr.
       - Write each `cn` to `.selfhost/c<n>.c`.
    4. **C oracle.**
       - For n = 1..4, compute `firstDifference(c0, cn)`. Any difference fails, printing `C(S<n>) differs from C(S0) at line L:` followed by `  S0: …` and `  Sn: …`.
       - Record each sha256 (hex, first 16 characters shown in the table, all of it in the JSON).
    5. **Suites.**
       - Run `pnpm exec vitest run --reporter=default --reporter=json --outputFile=.selfhost/S0+S1.json` once.
       - For S1, S2 and S3, run `pnpm exec vitest run <...STAGE_SUITES> --reporter=default --reporter=json --outputFile=.selfhost/<Sn>.json` with `ASTER_STAGE_BIN=work/sN` and `ASTER_STAGE=SN`.
       - Use inherited stdio so progress shows.
       - Parse each JSON for `numTotalTests`, `numPassedTests`, `numFailedTests`, `numPendingTests` and `numTodoTests`. Fail if the status isn't 0, if failed > 0, or if pending + todo > 0.
    6. **Report.**
       - Build `report = { commit, dirty, uname, cc, node, stages: [{ name, cSha256, matchesS0, suite: {total, passed, failed, skipped} }], fullSuite: {...}, ok }`.
       - Write `.selfhost/report.json` and `.selfhost/report.txt`, then print the text. The text is:
         ```
         Aster self-hosting proof
         commit  <sha>  (dirty: no)
         cc      <cc line>
         uname   Linux x86_64
         node    v24.x

         stage  C sha256          = C(S0)  tests
         S0     <16 hex>          —        <passed>/<total> (pnpm test)
         S1     <16 hex>          yes      <passed>/<total>
         S2     …
         S3     …
         S4     <16 hex>          yes      (built by S3; C only)

         PASS
         ```
       - With `--record`, also write `docs/self-host/proof.md`: a title, one sentence saying it was generated by `pnpm selfhost --record` at commit `<sha>`, then the report text in a fenced block, then one line on how to reproduce it.
       - Exit 0 on success. On any failure, still write a report with `ok: false` and the failed step, then exit 1.
  - Run `main(process.argv.slice(2))` only when executed directly: `if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));`. `main` returns an exit code. Any `--flag` other than `--record` is a usage error, exit 2.

- [ ] **Step 4: Wire it up.** Add `"selfhost": "node scripts/selfhost.ts"` to `package.json` scripts, after `gen:runtime`. Add `.selfhost/` to `.gitignore`.

- [ ] **Step 5: Run the unit tests.** `pnpm vitest run tests/selfhost_script.test.ts` passes. Then run the gate (`pnpm build && pnpm test && pnpm lint && pnpm typecheck`).

- [ ] **Step 6: Run the proof.** Run `pnpm selfhost` (in the background; it takes several minutes). Expected: PASS, with the table printed and `.selfhost/report.*` written. Run it once from `packages/` as well (`cd packages && pnpm selfhost`) to confirm the cwd handling (Review Focus 2). Then check that `ls /tmp | grep aster-selfhost` is empty afterwards (Review Focus 3).

- [ ] **Step 7: Commit.** `feat: pnpm selfhost, the stage 1 to 3 self-hosting proof (#20)`

---

### Task 7: documentation and the committed proof record

**Files:**
- Modify: `docs/superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md` §8 (the "Proposals" list)
- Modify: `README.md`: add a "Self-hosting" section
- Create (generated): `docs/self-host/proof.md`

- [ ] **Step 1: Update the contract.** In §8, change "the name and output format of the proof command (#20)" to "the name and output format of the proof command: decided in #20 as `pnpm selfhost` (see `2026-10-04-aster-selfhost-proof-design.md`)". In §7's #12 and #13 bullets, append "Resolved in #20: fixed in stage 0." Keep the "unsupported symlink aliases" sentence for the self-hosted loader.

- [ ] **Step 2: Add the README section.** Read `README.md` first and place the section next to any existing self-hosting or testing text, in the same voice:
  ```markdown
  ## Self-hosting

  `packages/asterc-self/asterc.aster` is the Aster compiler written in Aster. `pnpm selfhost` proves it compiles itself:
  stage 0 (TypeScript) builds S1, S1 builds S2, S2 builds S3, and the C each stage emits for the compiler must be
  byte-identical to stage 0's. It then runs the conformance suites against S1, S2 and S3, and writes a report to
  `.selfhost/`. The last recorded run is in [docs/self-host/proof.md](docs/self-host/proof.md). It needs Linux x86_64,
  gcc 13 as `cc`, and Node 24 or later.
  ```

- [ ] **Step 3: Commit the docs.** `docs: record pnpm selfhost in the contract and README (#20)`

- [ ] **Step 4: Generate the record.** With a clean tree, run `pnpm selfhost --record`. It must PASS. Then commit:
  `docs: self-hosting proof record (#20)`. The record pins the parent commit, which is the commit just made in Step 3.

---

## Self-review notes

- Spec §2 → Task 1. §3 → Task 5. §4 → Tasks 2, 3 and 4 (plus the `load_symlink` stage case in Task 5). §5 → Task 6. §6 → Tasks 1 (friction) and 7. §8 testing → Tasks 6 and 7.
- `stage()`, `buildWithStage`, `buildDriver` and `REPO_ROOT` (in `tests/stage.ts`) are used consistently in Tasks 2–5. `STAGE_SUITES` in Task 6 lists every suite that uses `stage()` or `buildDriver`.

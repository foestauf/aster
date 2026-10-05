# Archive the TypeScript Seed (R2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing in tests, scripts or CI depends on `packages/asterc` (R2a, Tasks 1–6). Then delete it, after tagging `seed-final` (R2b, Task 7).

**Architecture:** The behavioural oracles become committed vitest file snapshots under `tests/golden/`, produced by the self-hosted stage while the old TS comparisons still run in the same test, so equality with TS is proven at generation time. The internal-representation parity suites are deleted. S1 is built by `build/asterc`. The runtime moves to `runtime/`.

**Tech Stack:** Node 24, TypeScript, vitest 5 (`toMatchFileSnapshot`, `-u`), POSIX sh, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-05-aster-archive-seed-design.md`

## Global Constraints

- Self-hosted stage under test: `stage()` from `tests/stage.ts` (S1 from the global setup, or `ASTER_STAGE_BIN`). Goldens must be identical for every stage (S1, S2, S3, SL1), because `pnpm selfhost` runs the STAGE_SUITES against each.
- Golden file format, exactly:
  ```
  == exit <n>
  == stdout
  <stdout>
  == stderr
  <stderr>
  ```
  Absolute repo paths are rewritten to repo-relative paths, and the test's private temp directories to `<tmp>`, by one helper `normalise(text, { repo, tmp })` in `tests/golden.ts`.
- Golden layout: `tests/golden/check/<corpus path, '/' → '__'>.txt`, `tests/golden/cli/<case slug>.txt`, `tests/golden/accepted.txt`.
- `pnpm golden` = `vitest run -u tests/check_aster.test.ts tests/asterc_self.test.ts`.
- The runtime lives at `runtime/aster_rt.c` and `runtime/aster_rt.h`.
- `tests/llvm_backend.test.ts` fails locally (131 tests) because clang isn't installed. That's environmental. `pnpm selfhost` can't run locally for the same reason (it needs clang 18). CI's `proof` job is its evidence.
- oxlint `--deny-warnings` is enforced. Use `.toSorted()`, not `.sort()`.
- Conventional commits ending with the session's two attribution lines.
- **Generation protocol** (Tasks 2 and 3): (1) confirm the suite passes unchanged; (2) add the snapshot assertion *next to* the existing TS comparison; (3) run with `-u` to write goldens, so the TS comparison still passes in the same run; (4) run again without `-u` and it passes; (5) remove the TS comparison; (6) run again without `-u` and it passes. Record each run's output in the report.

## Review Focus

1. A golden that bakes in a machine-specific path (a home directory, `/tmp/aster-self-XXXX`) → it would pass locally and fail in CI. Task 2 adds a test of `normalise` with a fake repo root and temp dir, and both suites grep their goldens for `/home/` and `/tmp/` in a test.
2. A golden generated from a stage that differs from TS → prevented by the generation protocol. The report must show step (3) passing with the TS comparison still present.
3. `pnpm selfhost` running the STAGE_SUITES against S2/S3/SL1 → goldens must not mention the stage name. Task 3 checks that no golden contains `S1`.
4. `vitest -u` locally silently accepting a changed golden → CI has `CI=true` and never writes. Task 5's guard test asserts that `.github/workflows/*.yml` never pass `-u` or `--update`.
5. global-setup on a machine without `build/asterc` → a clear "run pnpm bootstrap first" error, not a stack trace. Covered in Task 5.

---

### Task 1: Move the runtime to `runtime/`

**Files:** `git mv packages/asterc/runtime/aster_rt.{c,h} runtime/`. Modify `scripts/gen-runtime.ts`, `scripts/release.ts` (`RUNTIME_DIR`), `scripts/bench.ts` (`RUNTIME`), `tests/runtime_aster.test.ts`, `tests/llvm_backend.test.ts`, `packages/asterc/package.json` (`files`), and every other hit of `grep -rn "asterc/runtime" --exclude-dir=node_modules --exclude-dir=docs .`. Also the README's runtime mention, and `packages/asterc-self/runtime.aster`, regenerated with `pnpm gen:runtime` (only its header line may change).

The TS seed must keep working until R2b, because its CLI and `buildExecutable` read the runtime. Find how it locates the runtime (`grep -rn runtime packages/asterc/src --include=*.ts | grep -v test`). Point it at `../../runtime` (repo root) via a path relative to its own file, and update `packages/asterc/package.json`.

- [ ] Run `grep -rn "asterc/runtime" . --exclude-dir=node_modules --exclude-dir=docs --exclude-dir=.git`. Expected: no hits after the change.
- [ ] Run `pnpm gen:runtime && git diff --stat packages/asterc-self/runtime.aster`. Expected: a one-line header change at most.
- [ ] Run `pnpm build:seed && pnpm typecheck && pnpm lint && pnpm test`. Expected: only the 131 known llvm failures.
- [ ] Commit: `refactor: move the C runtime to runtime/ (R2)`.

### Task 2: `check_aster` → goldens, plus `tests/golden.ts`

**Files:** Create `tests/golden.ts` and `tests/golden/check/*.txt`. Modify `tests/check_aster.test.ts` and `package.json` (`golden` script).

`tests/golden.ts` exports:
- `REPO_ROOT`
- `goldenPath(kind: 'check' | 'cli', name: string): string` → absolute path to `tests/golden/<kind>/<name with '/' and '\\' → '__'>.txt`
- `renderOutcome(o: { status: number | null; stdout: string; stderr: string }): string` → the Global Constraints format (each section's text as is; the file ends with a newline after stderr's content)
- `normalise(text: string, opts: { tmp?: string[] }): string` → replaces every occurrence of `REPO_ROOT` (with and without a trailing slash) with `` (repo-relative) and each `opts.tmp` dir with `<tmp>`, longest first

Add `tests/golden.test.ts`, a new small unit file. If that name collides with the old `tests/golden.test.ts` (deleted in Task 6), name the new one `tests/golden_helpers.test.ts`. It tests `normalise` with a fake temp dir and `REPO_ROOT`, `renderOutcome` formatting, and `goldenPath` slugging.

In `tests/check_aster.test.ts`, follow the generation protocol: per corpus file, render the self-hosted driver's outcome with `renderOutcome`, `normalise` it, and assert `await expect(text).toMatchFileSnapshot(goldenPath('check', file))`. Then remove the TS side: `makeSource`, `runFrontend`, `typeToString`, the TS renderer and `bomOf` if it's only used for TS. Keep the audit comment block, reworded so it names checker behaviour without line numbers in a deleted file. Keep the corpus list unchanged.

Add a test asserting that no file under `tests/golden/check/` contains `/home/`, `/tmp/` or the substring `S1`.

`package.json`: `"golden": "vitest run -u tests/check_aster.test.ts tests/asterc_self.test.ts"`.

- [ ] Protocol steps 1–6, with outputs in the report.
- [ ] `pnpm typecheck && pnpm lint`.
- [ ] Commit: `test: pin check.aster's output as goldens instead of the TS front end (R2)`.

### Task 3: `asterc_self` and `corpus.ts` → goldens

**Files:** Create `tests/golden/accepted.txt` and `tests/golden/cli/*.txt`. Modify `tests/asterc_self.test.ts` and `tests/corpus.ts`.

1. **`accepted.txt`, one-off, while the seed exists:** generate it with a throwaway node one-liner that imports `acceptedCorpus` from `tests/corpus.ts` (run through vitest or `node --experimental-strip-types`, whichever works). Write the sorted `file` paths, one per line, `\n`-terminated. Record the exact command in the report. Then rewrite `tests/corpus.ts` to export `PROGRAMS_DIR` and `acceptedFiles(): string[]`, which reads `tests/golden/accepted.txt`. Drop `acceptedCorpus` and every TS import.
2. **`asterc_self.test.ts`,** following the generation protocol:
   - Every `runS0(...)`-based expectation becomes `await expect(normalise(renderOutcome(runSn(argv, opts)), { tmp: [tmpDir, workDir] })).toMatchFileSnapshot(goldenPath('cli', '<describe>-<case>'))`. Slugs come from the describe and case labels, lower-case, with non-alphanumerics → `-`, and must be unique (assert it).
   - Keep the `s0UsageToSn` mapping only during generation, for the TS comparison. Delete it with the TS side.
   - Where a test already asserts a literal value (for example `{ stdout: '', stderr: "error: cannot read 'missing.aster'\n", status: 2 }`), keep the literal and drop the S0 call. No golden is needed there.
   - **Delete** the `build --emit=c, accepted programs` describe's per-file C-vs-`emitC(lower(typed))` comparison (internal representation). Keep "prints about a megabyte for the compiler itself", rewritten to not use TS.
   - `check, accepted programs` iterates over `acceptedFiles()`.
   - The `divergences from stage 0` describe: keep each test's own assertions on the stage. Drop the S0 halves. Rename the describe to `self-hosted CLI behaviour (formerly divergences from stage 0)`.
   - Remove `S0_BIN`, the `emitC`/`lower` imports and the header comment's S0 references. The header should say the CLI is pinned by `tests/golden/cli/`.
3. Add the same "no `/home/`, `/tmp/`, `S1`" assertion for `tests/golden/cli/`.

- [ ] Protocol steps 1–6, with outputs in the report.
- [ ] `pnpm typecheck && pnpm lint`.
- [ ] Commit: `test: pin the CLI as goldens instead of the stage-0 CLI (R2)`.

### Task 4: `source_encoding` and `load_symlink` without stage 0

**Files:** `tests/source_encoding.test.ts`, `tests/load_symlink.test.ts`.

- `source_encoding`: remove `S0_BIN` and `runS0`. Each malformed case asserts the stage's exact outcome:
  - `status` 1 (check the current S0 expectation in the file for the exact status and stderr shape),
  - stderr equal to the exact message built from the case's `reason` (the message format is in `docs/superpowers/specs/2026-10-04-aster-source-encoding-design.md`, or in the existing assertions),
  - empty stdout.

  Each valid case asserts exit 0 and the listed `stdout` bytes. Compare raw Buffers, as now.
- `load_symlink`: delete the `stage 0 loads a root reached through a symlink once` describe and `S0_BIN`. Keep the self-hosted describe. Reword the header so it no longer claims a stage-0 comparison: the canonical and file-symlink spellings load once, and the aliased spelling hits the documented lexical-identity limit. Add a stage test that `check` on `spellings.canonical` exits 0 with empty output, if none exists.

- [ ] Run `pnpm vitest run tests/source_encoding.test.ts tests/load_symlink.test.ts`. Expected: PASS.
- [ ] Commit: `test: assert source encoding and symlink loading without stage 0 (R2)`.

### Task 5: Build S1 without the seed; guard test; CI

**Files:** `tests/global-setup.ts`, `tests/stage.ts`, `scripts/selfhost.ts`, `tests/selfhost_script.test.ts` (if it pins stage names or labels), `.github/workflows/ci.yml`, a new `tests/seed_guard.test.ts`.

- `global-setup.ts`: drop `pnpm build:seed` and the TS imports. If `ASTER_STAGE_BIN` is set, return as now. Otherwise:
  - require `build/asterc` to be executable, else throw `Error('aster: no compiler at build/asterc; run \`pnpm bootstrap\` first')`;
  - run `build/asterc build packages/asterc-self/asterc.aster -o <tmp>/s1` via `execFileSync` (stderr must be empty and status 0, else throw with the stderr);
  - `project.provide('s1Bin', …)`.
- `stage.ts`: `buildDriver` always calls `buildWithStage`. Remove the TS imports and update the doc comment.
- `selfhost.ts`:
  - Replace the `stage 0 (pnpm build:seed)` step with `step('stage 0 (build/asterc)', …)`, which fails with the MISSING message if `build/asterc` isn't executable.
  - Replace `[process.execPath, S0, …]` with `[INSTALLED_ABS, …]`.
  - Keep `cs[0]` as the reference C, now produced by `build/asterc`, and keep stage names: S0 now *means* the installed compiler, so document that in a comment.
  - Rename the full-suite JSON from `S0+S1.json` to `S1.json`, *unless* `S1.json` is already used by the per-stage run. It is (`S${n}.json`), so use `full.json` and update any test or doc that names `S0+S1.json` (`grep -rn "S0+S1"`).
  - Remove the `S0` constant.
- `ci.yml` `proof` job: add `env: GH_TOKEN: ${{ github.token }}` and `with: fetch-depth: 0` on checkout, plus a step `- run: sh scripts/ci-bootstrap.sh` before `pnpm selfhost`.
- `tests/seed_guard.test.ts`: read every file under `.github/workflows/`, `scripts/` and `tests/`, excluding itself, `node_modules` and `tests/golden/`.
  - Assert that no file mentions `packages/asterc/src`, `packages/asterc/dist`, `build:seed` or `aster:seed`. The only allowed exceptions are, exactly, `scripts/build-compiler.ts` (its `bootstrap-seed` mode), `scripts/ci-bootstrap.sh` (`bootstrap:seed` fallback) and `package.json`, which isn't scanned anyway.
  - Assert that no workflow passes `-u` or `--update` to vitest.
  - Use an explicit allowlist array so R2b can empty it.

- [ ] Run `pnpm test` with `build/asterc` present. Expected: only the 131 known llvm failures.
- [ ] Run `mv build/asterc build/asterc.bak; pnpm vitest run tests/release_base.test.ts; mv build/asterc.bak build/asterc`. Expected: global setup fails with the MISSING message.
- [ ] `pnpm typecheck && pnpm lint && actionlint .github/workflows/*.yml`.
- [ ] Commit: `test: build S1 with the installed compiler and guard against the seed (R2)`.

### Task 6: Delete the dropped suites; docs

**Files:** Delete `tests/{lex,parse,typed,ir,emit}_aster.test.ts`, `tests/golden.test.ts` (the old corpus-through-TS one), `tests/typed_dump.ts`, `tests/typed_dump.test.ts`, `tests/ir_validate.ts` and `tests/ir_validate.test.ts`. Modify `scripts/selfhost.ts` `STAGE_SUITES` (remove the deleted files; `tests/selfhost_script.test.ts` asserts the list matches the files importing `stage.js`), `docs/self-host/building.md` and README.

- Check that `tests/runtime_aster.test.ts` no longer imports TS. Its probe compile uses `buildWithStage`; fix it here if Task 1 left it.
- `building.md`:
  - add a "Goldens" subsection: `tests/golden/`, `pnpm golden` after a deliberate output change, and the fact that CI never writes snapshots;
  - say which suites now pin behaviour;
  - say that `pnpm test` needs `build/asterc`.
- README: the test-suite description, if it mentions TS parity.
- `docs/self-host/proof.md` is **not** re-recorded locally, because there's no clang here. Note this in the PR. CI `proof` is the evidence.

- [ ] Run `grep -rln "packages/asterc/src\|asterc/dist" tests scripts .github`. Expected: only the allowlisted files.
- [ ] Run `pnpm typecheck && pnpm lint && pnpm test`. Expected: only the 131 known llvm failures.
- [ ] Commit: `test: drop the TS byte-parity suites (R2)`.

---

### Task 7 (R2b; separate PR, after R2a merges and a `build-*` release exists)

**Pre-check:** `gh release list` shows at least one published `build-*`. R2a is merged.

1. `git tag seed-final <R2a merge sha> && git push origin seed-final`.
2. Delete `packages/asterc`. Remove the `build:seed`, `bootstrap:seed` and `aster:seed` scripts. Remove the `bootstrap-seed` mode and the `S0` constant in `scripts/build-compiler.ts`, and their tests in `tests/build_compiler.test.ts` (`parseArgs` drops `bootstrap-seed`; the usage text changes). Delete `scripts/normal-path.sh` and the `normal-path` job. Remove `packages/*/src` from `vitest.config.ts` (`include`) and `tsconfig.json`. Run `pnpm install` to update the lockfile.
3. `scripts/ci-bootstrap.sh` exit 3: `echo 'ci-bootstrap: no build-* release exists; see Recovery in docs/self-host/building.md' >&2; exit 1`. The `::warning::` line goes away.
4. `tests/seed_guard.test.ts`: empty the allowlist, and add `bootstrap:seed` and `bootstrap-seed` to the forbidden strings.
5. Docs: `building.md` drops the seed rows and adds the last-resort Recovery path (spec §5). The README describes Aster as self-hosted, with the seed at `seed-final`. In `packages/asterc-self/*.aster`, rewrite the "port of packages/asterc/src/…" comments to say what the code does (`grep -rn "packages/asterc" packages/asterc-self`).
6. Verify with `pnpm typecheck && pnpm lint && pnpm test` and `actionlint`. Commit: `build: remove the TypeScript seed; recover from seed-final (R2)`.

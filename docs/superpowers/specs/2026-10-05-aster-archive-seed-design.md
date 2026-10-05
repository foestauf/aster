# Aster: Archive the TypeScript Seed (R2) (Design)

**Date:** 2026-10-05
**Status:** Approved in brainstorming
**Scope:** R2 of two. It builds on R1, [`2026-10-04-aster-release-pipeline-design.md`](2026-10-04-aster-release-pipeline-design.md),
which made GitHub releases the bootstrap (§9 there lists R2's inputs).
**Baseline:** `2accda7` (R1 merged, PR #45).

## 1. Purpose

After R1, `pnpm bootstrap` installs the compiler from a release, and the TypeScript compiler in `packages/asterc` is
used only as a fallback seed and as a **test oracle**. R2 retires it, so new language features are written once, in
Aster.

The seed is the byte-parity oracle for nine suites. Nothing else records what correct output is, so R2 must pin
observable behaviour before the seed goes.

Decisions taken in brainstorming:

1. **Hybrid oracles.**
   - Pin observable behaviour as committed goldens: diagnostics, CLI output, UTF-8 and symlink handling.
   - Drop the internal-representation suites (tokens, AST, typed tree, IR, C). The self-hosted compiler is now the
     reference. Behaviour is covered by the 220 programs in `selfhost_golden`, and C stability by the fixed point in
     `pnpm selfhost`.
2. **Two PRs.**
   - **R2a** cuts over: nothing in CI uses the seed, but the code still exists.
   - **R2b** deletes it, after tagging `seed-final` on R2a's merge commit.
3. **The runtime moves** to a top-level `runtime/`.

### Non-goals

`--emit=tokens|ast|ir` in the self-hosted CLI. Rewriting historical specs and plans. Removing Node, pnpm or vitest:
the scripts and tests stay in TypeScript. Any language or compiler change.

## 2. Suite fates

| Suite or file | Role today | Fate |
|---|---|---|
| `tests/selfhost_golden.test.ts` | 220 programs vs inline `// expect-*` headers, via the stage | **Keep.** The main conformance suite. |
| `tests/check_aster.test.ts` | `programs/check.aster` driver vs the TS front end: diagnostics, typed summary, exit | **Golden:** `tests/golden/check/` |
| `tests/asterc_self.test.ts` | CLI stdout/stderr/exit vs the S0 CLI | **Golden:** `tests/golden/cli/` |
| `tests/source_encoding.test.ts` | Malformed UTF-8 vs S0 | **Fixed expected strings** in the test |
| `tests/load_symlink.test.ts` | Symlinked root vs S0 `--emit=c` | **Fixed expectation:** symlinked and canonical paths give identical C from the stage |
| `tests/{lex,parse,typed,ir,emit}_aster.test.ts` | Byte parity of internal representations vs TS | **Delete** |
| `tests/golden.test.ts` | The same corpus as `selfhost_golden`, through TS | **Delete** (redundant) |
| `tests/typed_dump.ts`, `typed_dump.test.ts`, `ir_validate.ts`, `ir_validate.test.ts` | Test the TS compiler | **Delete** |
| `tests/corpus.ts` | Accepted corpus via the TS front end (used by `asterc_self`) | **Golden:** reads the committed list `tests/golden/accepted.txt` |
| `tests/runtime_aster.test.ts` | runtime.aster freshness, plus a probe compiled with TS | Read `runtime/`, build the probe with the stage |
| `tests/llvm_backend.test.ts` | Reads `packages/asterc/runtime` | Path change only |
| `packages/asterc/src/**/*.test.ts` (13 files) | Unit tests of the TS compiler | Deleted with the package in R2b |

The driver programs `tests/programs/programs/{lex,parse,typed,ir,emit}.aster` and their inline goldens stay. They are
ordinary corpus programs run by `selfhost_golden`, so the self-hosted libraries still get exercised.

## 3. Goldens

### Layout

- `tests/golden/check/<corpus path with / replaced by __>.txt`: one file per corpus program that the check driver
  covers today (the same file list `check_aster` iterates over).
- `tests/golden/cli/<case>.txt`: one file per `asterc_self` case.
- `tests/golden/accepted.txt`: the sorted corpus paths that TS accepts today, one per line. It is the same file set and
  the same path spelling as `acceptedCorpus()` returns now. `asterc_self`'s "accepted programs" cases iterate over it,
  so the set is pinned rather than recomputed by the compiler under test. After R2a it is edited by hand.

Each file records three parts, in this fixed format:

```
== exit <n>
== stdout
<stdout bytes>
== stderr
<stderr bytes>
```

Absolute paths are written as repo-relative paths. Temporary directories are written as `<tmp>`. The test applies the
same normalisation before comparing.

### Updating goldens

Goldens are vitest file snapshots (`expect(text).toMatchFileSnapshot(path)`). Vitest stores them as committed files and
compares on every run. `pnpm golden` (= `vitest run -u tests/check_aster.test.ts tests/asterc_self.test.ts`) rewrites
them from the stage under test after a deliberate change, and the diff is reviewed like code. In CI (`CI=true`) vitest
never writes snapshots, so a missing or changed golden fails. No custom generator script is needed. The normalisation
lives in one helper, `tests/golden.ts`, shared by both suites.

`tests/golden/accepted.txt` is the one golden that isn't a snapshot. R2a writes it once from the TypeScript front end's
`acceptedCorpus()`, while the seed still exists, with a one-off command recorded in the plan. After that it changes
only by hand, when a program is added to the corpus.

### Proof that the goldens equal the TypeScript output

The goldens are generated from the self-hosted stage, not from TS. In R2a they are committed **before** the TS-oracle
suites are deleted, and the plan has a step that runs the old parity suites against the same tree and requires them
green. Then, in one checkout, the stage's output equals TS (the old suites) and equals the goldens (the new suites).
The R2a PR records that run.

## 4. Build paths (R2a)

- **`tests/global-setup.ts`:** builds S1 with `build/asterc build packages/asterc-self/asterc.aster`. If
  `build/asterc` is missing it fails with the usual `run pnpm bootstrap first` message. `ASTER_STAGE_BIN` still skips
  the build. No `pnpm build:seed`.
- **`tests/stage.ts`:** `buildDriver` keeps only the stage-binary path, so the in-process TS path is removed.
- **`scripts/selfhost.ts`:** the first hop is `build/asterc` instead of stage 0. It builds S1 and emits its reference
  C, and S1 to S4 (and SL) must match it byte for byte. The full `pnpm test` run is labelled "S1" instead of "S0+S1".
  `docs/self-host/proof.md` is re-recorded.
- **`runtime/`:** `aster_rt.c` and `aster_rt.h` move from `packages/asterc/runtime/` with `git mv`. The references in
  `scripts/gen-runtime.ts`, `scripts/release.ts` (`RUNTIME_DIR`), `scripts/bench.ts`, `tests/runtime_aster.test.ts`,
  `tests/llvm_backend.test.ts`, the generated header of `packages/asterc-self/runtime.aster`, and the README are
  updated. `pnpm gen:runtime` output is unchanged apart from that header line.
- **CI:** `proof` runs `sh scripts/ci-bootstrap.sh` before `pnpm selfhost`. A test asserts that no workflow and no
  script except `build-compiler.ts`'s `bootstrap-seed` mode and `ci-bootstrap.sh`'s exit-3 path mentions `build:seed`,
  `aster:seed`, `packages/asterc/src` or `packages/asterc/dist`. R2b then removes those two.

## 5. Removal (R2b)

R2b starts after R2a merges **and** at least one `build-*` release exists.

1. Tag R2a's merge commit `seed-final` and push the tag. This is the last commit where `pnpm bootstrap:seed` works.
2. Delete:
   - `packages/asterc`,
   - the `build:seed`, `bootstrap:seed` and `aster:seed` scripts,
   - the `bootstrap-seed` mode and the `S0` constant in `scripts/build-compiler.ts`, with their tests,
   - `scripts/normal-path.sh` and the `normal-path` CI job (`release-bootstrap` covers the same path),
   - `packages/*/src` from `vitest.config.ts` and `tsconfig.json`.
3. `scripts/ci-bootstrap.sh`, exit 3: print `ci-bootstrap: no build-* release exists; see Recovery in docs/self-host/building.md`
   and exit 1. There is no seed fallback any more.
4. The test from §4 tightens to: nothing mentions those strings at all.
5. Docs:
   - `docs/self-host/building.md`: drop the seed rows and add a last-resort Recovery path for when no release can be
     downloaded. That path is `git checkout seed-final && pnpm install && pnpm bootstrap:seed`, then `git checkout`
     forward and `pnpm build` along `main`'s first-parent history (each commit is buildable by its parent's compiler),
     or build any surviving C seed.
   - README: Aster is self-hosted, the bootstrap is a release, and the TypeScript seed lives at the `seed-final` tag.
   - `packages/asterc-self/*.aster` comments that say "port of packages/asterc/src/..." are rewritten to name what
     the code does.

Historical specs, plans and `proof.md` records are left as they are.

## 6. Testing

- **R2a is green when:**
  - the new golden suites pass against S1,
  - every remaining suite passes,
  - `pnpm selfhost` passes from `build/asterc`, with C identical at every hop,
  - the old parity suites passed on the commit that added the goldens (§3),
  - CI is green with nothing in CI building the seed.
- **R2b is green when** CI passes with `packages/asterc` gone.
- **After R2b merges,** `release.yml` publishes a release from the seedless tree, and `rm -rf build && pnpm bootstrap`
  works on a clean checkout.

### Risks

- **Weaker anchor.** "Byte-identical to TS" becomes "byte-identical to the previous release". That's inherent in
  retiring a seed. The fixed point, the 220 behavioural programs and the goldens are the remaining net.
- **Machine-specific output in goldens.** Handled by the normalisation in §3. A test feeds a known absolute path and
  temporary directory through the normaliser and checks it.

## 7. Work breakdown

- **R2a:** runtime move; `tests/golden.ts` and `pnpm golden`; goldens generated and the old suites run green;
  rewritten `check_aster` and `asterc_self` tests; fixed expectations in `source_encoding` and `load_symlink`; build-path
  switch (global setup, stage, selfhost, CI `proof`); deletion of the dropped suites and `corpus.ts` reading `accepted.txt`; the
  guard test; `building.md` notes on goldens.
- **R2b:** the `seed-final` tag, deletions, `ci-bootstrap.sh`, the tightened guard, docs.

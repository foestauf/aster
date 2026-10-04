# Aster Normal Build Path: the Self-Hosted Compiler by Default (Design)

**Date:** 2026-10-04
**Status:** Approved in brainstorming
**Issue:** #21. It closes the "Self-hosted Aster — C backend" milestone.
**Baseline:** `48601a4` (malformed UTF-8, PR #31).
**Builds on:** [`2026-10-04-aster-self-hosting-contract-design.md`](2026-10-04-aster-self-hosting-contract-design.md)
(cited as "contract §n") and [`2026-10-04-aster-selfhost-proof-design.md`](2026-10-04-aster-selfhost-proof-design.md).

## 1. Purpose

#20 proved that `packages/asterc-self/asterc.aster` compiles itself: `pnpm selfhost` builds S1 to S4 and finds the C
byte-identical at every hop. The repository's front door still points at TypeScript, though: `pnpm aster` runs
`packages/asterc/dist/cli/bin.js`, and nothing outside the test suite ever uses the self-hosted compiler.

#21 makes the self-hosted compiler the ordinary way to compile Aster, including the compiler itself. TypeScript stays,
but only as an explicit bootstrap seed, a recovery path and the test oracle.

Decisions taken in brainstorming:

1. **Seed.** A clean checkout bootstraps from the TypeScript seed once. The result is cached as a gitignored binary,
   `build/asterc`. No generated C is committed.
2. **Entry point.** `pnpm aster` runs `build/asterc`. If the binary is missing it fails with a hint and never falls back
   to TypeScript. The TypeScript CLI moves to `pnpm aster:seed`.
3. **CI.** Every push and PR runs the full proof (`pnpm selfhost`) plus a separate normal-path job, so every merged
   revision is a verified one.

### Success criteria

1. After `pnpm install && pnpm bootstrap`, `pnpm build` rebuilds the compiler and `pnpm aster` compiles programs
   without running the TypeScript compiler. CI proves this by hiding the seed's `dist/` (§4).
2. `pnpm selfhost` passes in CI on every PR, and `docs/self-host/proof.md` is re-recorded on this branch.
3. `docs/self-host/building.md` documents tools, dependencies, artifacts, commands, platforms and recovery (§5).
4. The README and contract describe self-hosting as achieved, with remaining work listed separately (§5).

### Non-goals

LLVM (only a planning issue is opened afterwards). Closing the self-hosted CLI's gaps from contract §4.5
(`--emit=tokens|ast|ir`, `ASTER_CC`, import identity, panic exit code). A committed C seed. Platforms beyond contract §2.
Removing or shrinking the TypeScript compiler or its tests.

## 2. Commands and artifacts

| Command | Runs the TS compiler? | What it does |
|---|---|---|
| `pnpm bootstrap` | **Yes, explicitly** | `build:seed`, then S0 builds S1 and S1 builds S2; checks the fixed point (§3); installs S2 as `build/asterc`. |
| `pnpm build` | No | Rebuilds the compiler with the installed `build/asterc` (§3) and installs the result. |
| `pnpm aster <args>` | No | `scripts/aster`, a POSIX `sh` wrapper, `exec`s `build/asterc <args>`. |
| `pnpm aster:seed <args>` | Yes | `node packages/asterc/dist/cli/bin.js <args>`: the old `pnpm aster`. |
| `pnpm build:seed` | Builds it | `pnpm --filter asterc build`: the old `pnpm build`. |

**Artifacts.** `build/` is gitignored and holds only `asterc`. `.selfhost/` stays the proof's report directory.

**Missing compiler.** If `build/asterc` is missing or not executable, both `pnpm aster` and `pnpm build` print
`aster: no compiler at build/asterc; run \`pnpm bootstrap\` first` to stderr and exit 2. Neither falls back to
TypeScript.

**The wrapper.** `scripts/aster` resolves `build/asterc` relative to its own location, not the caller's working
directory. It is a few lines of `sh` with no logic beyond the existence check and `exec`, so stdin, stdout, stderr,
arguments and the exit code pass through untouched. Users may call `build/asterc` directly; the wrapper exists only so
that `pnpm aster` keeps working.

**Callers of the old `pnpm build`.** `tests/global-setup.ts` and `scripts/selfhost.ts` need stage 0's `dist/`, not an
installed compiler, so they switch to `pnpm build:seed`. That keeps `pnpm test` and `pnpm selfhost` exactly as they are
and stops either of them from bootstrapping. Contract §5's S0 row is updated to match.

## 3. Bootstrap and rebuild

Both are one Node script, `scripts/build-compiler.ts`, which `package.json` runs as `bootstrap` and `build`. Like
`selfhost.ts` it is orchestration only: it spawns compilers and compares their output, and never imports
`packages/asterc`.

The two modes differ only in the first compiler, called **B** (the builder):

| Mode | B |
|---|---|
| `bootstrap` | S0, after `pnpm build:seed` (`node packages/asterc/dist/cli/bin.js`) |
| `build` | the installed `build/asterc`, which must exist (§2) |

Steps, in a fresh directory from `mkdtemp`:

1. B builds `packages/asterc-self/asterc.aster` into `c1`.
2. `c1` builds the same source into `c2`.
3. `c1 build … --emit=c` and `c2 build … --emit=c` must be byte-identical (the fixed point). If not, the script reports
   the first differing line, in the same format as `selfhost.ts`.
4. `c2` is copied into `build/` under a temporary name and renamed over `build/asterc`, so the install is atomic.

Any build that exits non-zero or writes to stderr fails the run (contract: a successful build is silent). On failure the
script prints which step failed, leaves any existing `build/asterc` untouched, removes the temp directory and exits 1.
Usage errors exit 2. Every step runs with `LC_ALL=C`, as in `selfhost.ts`.

`bootstrap` does not compare against stage 0's C. That comparison is the proof's job (`pnpm selfhost`), and it runs in
CI. The fixed point is a cheap sanity check, so a broken compiler is never installed.

**Recovery.** If an edit breaks the compiler, `pnpm build` fails and the old binary stays installed. If the installed
binary can no longer compile the source (for example, the source starts using a language feature that was added to both
compilers in the same change), run `pnpm bootstrap` to rebuild from the TypeScript seed. If `build/` is lost or damaged,
`pnpm bootstrap` also restores it.

The pure helpers (argument parsing, the missing-compiler message, the fixed-point comparison) are exported and unit
tested in `tests/build_compiler.test.ts`, in the style of `tests/selfhost_script.test.ts`. The fixed-point comparison
reuses `firstDifference` from `selfhost.ts`. `tests/aster_wrapper.test.ts` copies `scripts/aster` into a temp tree and
checks the missing-compiler message and exit code, and that arguments and the exit status pass through when a stub
`build/asterc` is present.

## 4. Automation and CI

`.github/workflows/ci.yml` gets two jobs, both on `ubuntu-latest` (Ubuntu 24.04, gcc 13, which satisfies the proof's
environment check) with Node 24.

**`proof`:** `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm selfhost`. The proof already runs the
full `pnpm test`, the stage-aware suites against S1, S2 and S3, and the S0 to S4 C comparison. The `.selfhost/` report is
uploaded as a workflow artifact.

**`normal-path`:** `pnpm install --frozen-lockfile`, `pnpm bootstrap`, then `scripts/normal-path.sh`. The script:

1. Fails with the §2 hint if `build/asterc` is missing.
2. Renames `packages/asterc/dist` to `dist.hidden` and restores it on exit (a `trap`), so any use of the TypeScript
   compiler fails loudly. It refuses to start if `dist.hidden` already exists.
3. Runs `pnpm build` (the self-rebuild, §3).
4. Builds the compiler through the normal path with `pnpm aster build packages/asterc-self/asterc.aster -o <tmp>/asterc`,
   and checks that `<tmp>/asterc build packages/asterc-self/asterc.aster --emit=c` equals `build/asterc`'s.
5. Builds and runs a representative set of user programs with `pnpm aster run`, comparing stdout and exit code with the
   expectations in each program's `// expect-…` header. The set is `basics/hello.aster`, `programs/rpn.aster`,
   `programs/calc.aster`, one multi-file program from `modules/`, and `programs/lex.aster` with a file argument. The
   exact list is fixed in the plan once the headers are read.
6. Prints `normal path: PASS` and exits 0, or names the failing step and exits 1.

The same script works locally after `pnpm bootstrap`. Because CI starts from a fresh checkout, the `normal-path` job is
also the clean-checkout bootstrap check.

**Recording the revision.** On the final commit of this branch, `pnpm selfhost --record` re-records
`docs/self-host/proof.md` (it stays one commit behind, as before), and `scripts/normal-path.sh` is run once locally.
Its output is quoted in the PR.

## 5. Documentation and close-out

**New `docs/self-host/building.md`**, the operator's guide:

- Required tools: Linux x86_64, gcc 13 as `cc`, Node 24 or later and pnpm. Node and pnpm are needed only for the
  bootstrap, the orchestration scripts and the tests.
- Permitted dependencies: `build/asterc` needs only `cc` and libc at run time (the C runtime is embedded, contract §3).
  The `sh` wrapper and the Node orchestration scripts never run the TypeScript compiler.
- Artifact locations: `build/asterc`, `.selfhost/`, and the temp directories under `$TMPDIR`.
- Commands: the §2 table, the edit-and-rebuild loop, and how to run the proof and the normal-path check.
- Supported platforms: contract §2 (Linux x86_64, gcc 13), and what is untested.
- Recovery: §3.
- The self-hosted CLI's divergences, by reference to contract §4.5, and `pnpm aster:seed` for the debug emit stages.

**README.** The quick start becomes `pnpm install`, `pnpm bootstrap`, `pnpm aster run …`. The intro and "Self-hosting"
sections describe the achieved state: the compiler is written in Aster and builds itself, and TypeScript is the seed and
oracle. The "Self-hosted compiler" section's build instructions point to `building.md`. A new **"Remaining work"**
section lists what is not part of self-hosting: debug emit stages and `ASTER_CC` in the self-hosted CLI, import identity
through symlinks, the runtime never freeing memory, compile-time performance, and the LLVM backend (planning next). Docs
links gain this spec and `building.md`.

**Contract.** The status line notes that #21 is done. §5's S0 row uses `pnpm build:seed`. Success criterion 4 links to
`building.md`.

**After merge (with the user's go-ahead, since both are outward-facing):** close #21 and the milestone, and open an
"LLVM backend: planning" issue whose scope is a design spec only.

## 6. Testing summary

- Unit: `tests/build_compiler.test.ts` (script helpers), `tests/aster_wrapper.test.ts` (wrapper behaviour).
- Integration: `scripts/normal-path.sh`, locally and in CI.
- Regression: `pnpm selfhost` (full suite, S1 to S3 suites, C comparison), locally and in CI.
- `pnpm typecheck` and `pnpm lint` cover the new TypeScript.

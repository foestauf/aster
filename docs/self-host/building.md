# Building the Aster compiler

## What you get

`build/asterc` is the Aster compiler. It is written in Aster and built by itself. The TypeScript compiler in `packages/asterc` is only the bootstrap seed, the recovery path and the test oracle.

## Requirements

- Linux x86_64.
- gcc 13 as `cc`.
- Node 24 or later and pnpm. They are needed for the bootstrap, the orchestration scripts and the tests only.

`build/asterc` itself needs only `cc` and libc at run time. The C runtime is embedded in the binary (contract section 4.4).

Untested: other operating systems, other architectures, clang and other gcc major versions.

## First build

```sh
pnpm install
pnpm bootstrap
```

`pnpm bootstrap` builds the TypeScript seed, then the seed builds `packages/asterc-self/asterc.aster` into a first compiler (c1), and c1 builds the same source into a second (c2). It checks that c1 and c2 emit identical C, then installs c2 as `build/asterc` in one atomic rename.

## Everyday commands

| Command | Runs the TS compiler? | What it does |
|---|---|---|
| `pnpm bootstrap` | Yes, explicitly | `build:seed`, then S0 builds S1 and S1 builds S2; checks the fixed point; installs S2 as `build/asterc`. |
| `pnpm build` | No | Rebuilds the compiler with the installed `build/asterc` and installs the result. |
| `pnpm aster <args>` | No | `scripts/aster`, a POSIX `sh` wrapper, `exec`s `build/asterc <args>`. |
| `pnpm aster:seed <args>` | Yes | `node packages/asterc/dist/cli/bin.js <args>`: the TypeScript compiler. |
| `pnpm build:seed` | Builds it | `pnpm --filter asterc build`: compiles the TypeScript compiler. |

You can call `build/asterc` directly. The wrapper exists so that `pnpm aster` works.

If `build/asterc` is missing or not executable, `pnpm aster` and `pnpm build` print `aster: no compiler at build/asterc; run \`pnpm bootstrap\` first` to stderr and exit 2. Neither falls back to TypeScript.

## Changing the compiler

1. Edit the files in `packages/asterc-self/*.aster`.
2. Run `pnpm build`. It rebuilds the compiler with the installed one, checks the fixed point and installs the result. If anything fails, the old `build/asterc` stays in place and the command exits 1.
3. Run `pnpm test`.
4. Run `pnpm selfhost` before a pull request.

## Artifacts

- `build/asterc`: the installed compiler. `build/` is gitignored.
- `.selfhost/`: the proof's report directory, with `report.txt`, `report.json`, `c0.c` to `c4.c` and the vitest JSON.
- Temporary directories named `aster-build-compiler-*`, `aster-selfhost-*` and `aster-normal-path-*` under `$TMPDIR`. The scripts remove them on exit.

## Verifying

- `pnpm selfhost` builds S1 to S4, compares the C at every hop and runs the conformance suites against S1, S2 and S3 (S4 is built only for the C comparison). `pnpm selfhost --record` also re-records [proof.md](proof.md).
- `scripts/normal-path.sh` hides `packages/asterc/dist`, runs `pnpm build`, builds the compiler through `pnpm aster`, and builds and runs representative programs with `pnpm aster run`. It prints `normal path: PASS` on success. Run `pnpm bootstrap` first. While it runs it hides `packages/asterc/dist`, so don't run `pnpm test`, `pnpm selfhost`, `pnpm bootstrap` or `pnpm aster:seed` in the same checkout at the same time.

CI runs both on every push to `main` and every pull request: the `proof` job runs typecheck, lint and `pnpm selfhost`, and the `normal-path` job runs `pnpm bootstrap` and then `scripts/normal-path.sh`.

## Recovery

- If an edit breaks the compiler, `pnpm build` fails and the old binary stays installed. Fix the source and run `pnpm build` again.
- If the installed binary can no longer compile the source, run `pnpm bootstrap`. This happens when the source starts using a language feature that was added to both compilers in the same change.
- If `build/` is lost or damaged, run `pnpm bootstrap`.

## Differences from the seed CLI

The self-hosted CLI diverges from the TypeScript one in a few places, listed in [the contract's section 4.5](../superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md). Use `pnpm aster:seed` for `--emit=tokens|ast|ir` and for `ASTER_CC`.

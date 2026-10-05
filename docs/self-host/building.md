# Building the Aster compiler

## What you get

`build/asterc` is the Aster compiler. It is written in Aster and built by itself. The original TypeScript compiler has been removed from the tree. It is archived at the `seed-final` git tag and is used only in the last-resort recovery described below. Day to day, the compiler is bootstrapped from a published release.

## Requirements

- Linux x86_64.
- gcc 13 as `cc`.
- For the LLVM backend only: clang 18 as `clang` and lld 18 as `ld.lld` (Ubuntu 24.04 packages `clang-18`, `lld-18`). Textual `--emit=llvm` does not need clang.
- Node 24 or later and pnpm. They are needed for the bootstrap, the orchestration scripts and the tests only.
- `origin` must be a GitHub remote: `pnpm bootstrap` derives the repository from it to download releases.
- An authenticated `gh` for `pnpm bootstrap`, because the repository is private. Not needed with `ASTER_BOOTSTRAP_DIR`.

`build/asterc` itself needs only `cc` and libc at run time. The C runtime is embedded in the binary (contract section 4.4).

Untested: other operating systems, other architectures and other compiler major versions. C remains the default backend.

## First build

```sh
pnpm install
pnpm bootstrap
```

`pnpm bootstrap` downloads the nearest ancestor `build-*` release of `HEAD` and verifies it against `SHA256SUMS`. It uses the static binary, or builds the C seed if the binary won't run. That compiler builds `packages/asterc-self/asterc.aster` into a first compiler (c1), and c1 builds the same source into a second (c2). It checks that c1 and c2 emit identical C, then installs c2 as `build/asterc` in one atomic rename.

See [Releases](#releases) for the assets and the cache.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm bootstrap` | Downloads the nearest ancestor release, which builds S1; S1 builds S2; checks the fixed point; installs S2 as `build/asterc`. |
| `pnpm bootstrap --release <tag>` | The same, from the named release instead of the nearest ancestor. |
| `pnpm release` | `node scripts/release.ts tag` prints the release tag of `HEAD`. `node scripts/release.ts --out <dir>` writes the three release assets from the installed compiler. |
| `pnpm build` | Rebuilds the compiler with the installed `build/asterc` and installs the result. |
| `pnpm aster <args>` | `scripts/aster`, a POSIX `sh` wrapper, `exec`s `build/asterc <args>`. |

You can call `build/asterc` directly. The wrapper exists so that `pnpm aster` works.

If `build/asterc` is missing or not executable, `pnpm aster` and `pnpm build` print `aster: no compiler at build/asterc; run \`pnpm bootstrap\` first` to stderr and exit 2. Neither falls back to anything else.

## Changing the compiler

1. Edit the files in `packages/asterc-self/*.aster`.
2. Run `pnpm build`. It rebuilds the compiler with the installed one, checks the fixed point and installs the result. If anything fails, the old `build/asterc` stays in place and the command exits 1.
3. Run `pnpm test`. It needs `build/asterc`, so run `pnpm bootstrap` first on a fresh checkout.
4. Run `pnpm selfhost` before a pull request.

## Goldens

`pnpm test` needs `build/asterc` (run `pnpm bootstrap` first). These suites pin behaviour:

- `tests/check_aster.test.ts`: `check.aster`'s output on the whole corpus, against `tests/golden/check/`.
- `tests/asterc_self.test.ts`: the CLI's output, against `tests/golden/cli/`. It also reads `tests/golden/accepted.txt` (through `tests/corpus.ts`), the list of programs the compiler must accept, and checks each error program's diagnostics against its `// expect-error:` headers. `accepted.txt` is edited by hand: `pnpm golden` doesn't touch it.
- `tests/selfhost_golden.test.ts`: every runnable program in `tests/programs/` meets its `// expect-…` header.
- `tests/source_encoding.test.ts` and `tests/load_symlink.test.ts`: fixed expectations.
- `tests/llvm_backend.test.ts`: the LLVM backend (needs clang 18).

The snapshots live in `tests/golden/`. After a deliberate output change, run `pnpm golden` and review the diff before committing. CI never writes snapshots: a mismatch fails the run.

## Artifacts

- `build/asterc`: the installed compiler. `build/` is gitignored.
- `.selfhost/`: the proof's report directory, with `report.txt`, `report.json`, `c0.c` to `c4.c` and the vitest JSON.
- `build/bootstrap/<tag>/`: the cache of a downloaded release (see [Releases](#releases)).
- Temporary directories named `aster-build-compiler-*`, `aster-bootstrap-*`, `aster-release-*`, and `aster-selfhost-*` under `$TMPDIR`. The scripts remove them on exit.

## Verifying

- `pnpm selfhost` builds S1 to S4, compares the C at every hop and runs the conformance suites against S1, S2 and S3 (S4 is built only for the C comparison). It also builds LLVM stages SL1 and SL2, checks their LLVM fixed point and C oracle, and runs the stage-aware suites against SL1. This proof requires clang 18 and lld 18. `pnpm selfhost --record` also re-records [proof.md](proof.md). `pnpm selfhost --suite=<full|S1|S2|S3|SL1>` (repeatable) still builds and compares every stage but runs only the named test runs. It can't be combined with `--record`.

CI runs on every push to `main` and every pull request:

| Job | Runs |
|---|---|
| `proof (<suite>)` | One job per test run of `pnpm selfhost` (`full`, `S1`, `S2`, `S3`, `SL1`), in parallel: `scripts/ci-bootstrap.sh`, then `pnpm selfhost --suite=<suite>`. The `full` job also runs typecheck and lint. |
| `proof` | After the `proof (<suite>)` jobs. Fails unless they all passed and S1, S2, S3 and SL1 ran the same number of tests. |
| `release-bootstrap` | Pull requests only. `scripts/ci-bootstrap.sh`, then `pnpm test`. Enforces the two-step rule. |

`scripts/ci-bootstrap.sh` bootstraps from the release of `HEAD^1`, the base of the change. It asks `scripts/release-base.sh` for that tag. If the release isn't published yet, the script waits up to about 15 minutes, because `release.yml` is still running for the base. If the wait runs out, it warns and uses the nearest earlier release instead. One failed CI run on `main` therefore can't wedge `main`. If no `build-*` release exists at all, it fails and points at Recovery below.

`release-bootstrap` runs only on pull requests and is the job meant to be the required check.

A push of several commits to `main` publishes a release for the tip only. The intermediate commits get none, so the next CI run waits about 15 minutes for the release of its `HEAD^1`, then falls back to the nearest earlier release.

`release.yml` runs after CI passes on a push to `main` and publishes the release. Its concurrency group can drop a pending release run when merges arrive in quick succession. The fallback covers the gap, and re-running `release.yml` for the missed commit restores the release. See [Releases](#releases).

## Recovery

- If an edit breaks the compiler, `pnpm build` fails and the old binary stays installed. Fix the source and run `pnpm build` again.
- If the installed binary can no longer compile the source, run `pnpm bootstrap`. The release of the nearest ancestor can whenever the two-step rule was enforced for the changes since it, but the fallback may pick an older release than you expect, so it may lack newer features.
- If `build/` is lost or damaged, run `pnpm bootstrap`.
- If the release binary won't run, `pnpm bootstrap` builds the C seed automatically and prints a note. You can also build it by hand: unpack `asterc-c-seed.tar.gz` and run `BUILD.txt` with `sh`.
- If you have no GitHub access, set `ASTER_BOOTSTRAP_DIR=<dir with the three assets>`.
- Last resort, when no release can be downloaded or run and no C seed survives: the original TypeScript compiler is archived at the `seed-final` git tag. Run `git checkout seed-final && pnpm install && pnpm bootstrap:seed`. That builds the self-hosted compiler at that commit, with no network. (`pnpm bootstrap:seed` exists only at `seed-final`.) Then walk forward along `main`'s first-parent history, running `pnpm build` at each commit so each compiler builds the next, until you reach the commit you want. Alternatively, build a surviving C seed by hand: unpack `asterc-c-seed.tar.gz` and run `BUILD.txt` with `sh`.

## Releases

Every push to `main` that passes CI publishes one release. `release.yml` runs after the `CI` workflow completes successfully for a push to `main`. It skips a tag that is already published. The workflow assumes each push to `main` is one commit, as with squash merges. CI bootstraps from the release of `HEAD^1`, and every push publishes one release.

The tag is `build-YYYYMMDD-<sha7>`: the UTC committer date and the first seven hex digits of the commit SHA. `node scripts/release.ts tag` prints it.

| Asset | Contents |
|---|---|
| `asterc-linux-x86_64` | The compiler, linked statically. It must rebuild the compiler to the fixed point before it is written. |
| `asterc-c-seed.tar.gz` | `asterc-c-seed/`: `asterc.c`, the C runtime and `BUILD.txt`. |
| `SHA256SUMS` | `sha256sum` output for the other two assets. |

`BUILD.txt` holds the one command that builds the seed: `cc -std=c11 -O2 -I. asterc.c aster_rt.c -o asterc`.

The publisher creates a draft, uploads all three assets, then publishes and marks it latest. Uploads and publication
use the numeric release ID returned by the successful create request. A published tag is a successful no-op on rerun;
a release lookup failure stops publication without changing anything.

Failed or uncertain requests never trigger automatic release or tag deletion. A request can succeed even when its
response is lost, and another actor can publish a draft between a state check and deletion. An existing draft is
therefore left untouched and blocks a rerun. Inspect the tag and release ID reported in the error: if already published,
rerun safely; otherwise review the retained draft and its assets before manually recovering it. Do not delete a
published release or its tag to retry publication.

`pnpm bootstrap` caches a download in `build/bootstrap/<tag>/` and reuses it. A directory that fails verification is deleted. `ASTER_BOOTSTRAP_DIR=<dir>` skips the download and uses the three assets in that directory. It is never modified.

### The two-step rule

A release can only build source its own compiler understands. To add a language feature and use it in the compiler:

1. PR A adds the feature. It doesn't use the feature in `packages/asterc-self/`.
2. Wait for the release of A's merge commit to be published.
3. PR B uses the feature in `packages/asterc-self/`.

The `release-bootstrap` job enforces this. It bootstraps from the release of the base and builds the change's compiler source with it. If the base's release lacks the feature, the build of c1 fails and prints the two-step message.

`main` has no branch protection yet. Make `release-bootstrap` a required check to enforce the rule.

## Differences from the seed CLI

The self-hosted CLI diverged from the original TypeScript one in a few places, listed in [the contract's section 4.5](../superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md). `--emit=tokens|ast|ir` and `ASTER_CC` exist only in the compiler archived at `seed-final`.

## Experimental LLVM surface

The self-hosted CLI recognizes `--backend=c|llvm` for `build` and `run`, and `--emit=llvm` for `build`. LLVM emission is implemented in `packages/asterc-self/emit_llvm.aster`. Executable production uses `clang -O2 -flto -fuse-ld=lld` and the unchanged C runtime. C builds require neither clang nor lld.

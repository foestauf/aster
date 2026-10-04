# Aster Release Pipeline and Release Bootstrap (Design)

**Date:** 2026-10-04
**Status:** Approved in brainstorming
**Scope:** R1 of two. R2 (archive the TypeScript seed) is a separate spec, built on this one (§9).
**Baseline:** `cdbca89` (LLVM measurements, PR #44; C stays the default backend).
**Builds on:** [`2026-10-04-aster-normal-build-path-design.md`](2026-10-04-aster-normal-build-path-design.md) and
[`docs/self-host/building.md`](../../self-host/building.md).

## 1. Purpose

Today `pnpm bootstrap` builds the compiler from the TypeScript seed (`packages/asterc`). Every language feature that
the compiler's own source uses must therefore be built twice, once in TypeScript and once in Aster. We want to freeze
the seed and add features to the Aster compiler only.

Freezing the seed is safe only if a lost or broken `build/asterc` can always be replaced. **R1 makes GitHub Releases
that replacement**: every push to `main` publishes a compiler that can build the commit after it, and `pnpm bootstrap`
downloads the right one.

Decisions taken in brainstorming:

1. **A release on every push to `main`.** No human steps. Releases are cheap.
2. **The two-step rule.** A feature that the compiler's own source wants to use lands in two PRs: PR A adds the
   feature without using it in `packages/asterc-self/`, and PR B, merged after A's release, starts using it. CI enforces
   the rule (§6).
3. **The seed is archived in R2, not R1.** R1 keeps `packages/asterc` and the TypeScript oracle tests working.
4. **Approach A.** A release carries a static binary and the compiler's own emitted C (the "C seed"). Nothing
   generated is committed to git.

### Non-goals

Targets other than Linux x86_64. Pruning old releases. Signing releases (SHA-256 checksums only). Semantic versioning
of the compiler. Any change to the language, the compiler or `pnpm selfhost`. Everything in R2.

## 2. Release contents

A release's tag is `build-YYYYMMDD-<shortsha>`: the UTC date of the commit, and the commit's 7-character SHA, for
example `build-20261004-c6205b8`. The tag points at that commit. Tags sort by date. The newest release has GitHub's
"latest" flag.

Assets:

| Asset | Contents |
|---|---|
| `asterc-linux-x86_64` | The compiler, linked with `cc -std=c11 -O2 -static` (§3, step 3). |
| `asterc-c-seed.tar.gz` | One top-level directory `asterc-c-seed/` holding `asterc.c`, `aster_rt.c`, `aster_rt.h` and `BUILD.txt`. |
| `SHA256SUMS` | `sha256sum` output for the two files above. |

`asterc.c` is the output of `asterc build packages/asterc-self/asterc.aster --emit=c`. `aster_rt.c` and `aster_rt.h`
are copied from `packages/asterc/runtime/`. `BUILD.txt` gives the command that builds the compiler from the seed:

```sh
cc -std=c11 -O2 -I. asterc.c aster_rt.c -o asterc
```

The C seed is the fallback for any machine where the binary won't run, including other distributions, other libcs and
(untested) other architectures.

The release notes are the commit subject, the full SHA and a link to the commit.

Releases are kept forever. Every old commit on `main` can be rebuilt from its parent's release.

## 3. Producing a release

`scripts/release.ts` produces the assets. Like `build-compiler.ts`, it is orchestration only: it spawns compilers and
`cc` and never imports the TypeScript compiler.

`node scripts/release.ts --out <dir>` does the following:

1. Requires an installed `build/asterc` (exit 2 with the usual "run `pnpm bootstrap` first" message otherwise).
2. Writes `asterc.c` with `build/asterc build packages/asterc-self/asterc.aster --emit=c`.
3. Links `asterc-linux-x86_64` with `cc -std=c11 -O2 -static -I<runtime> asterc.c aster_rt.c`.
4. Smoke-tests the static binary: it must build `packages/asterc-self/asterc.aster`, and the result must emit C
   identical to `asterc.c` (the fixed point).
5. Writes `asterc-c-seed.tar.gz` with a fixed file order, owner `0:0` and mtime of the commit, so the tarball's bytes
   depend only on its contents.
6. Writes `SHA256SUMS`.

Any failure exits 1, names the step and leaves no partial assets in `<dir>`.

**Risk.** Static glibc can misbehave with `run_process`, which `build` uses to call `cc`. Step 4 catches that, because
it calls `cc`. If `-static` turns out to be unworkable, the plan falls back to a dynamically linked binary built on
ubuntu-24.04 and records why. The C seed covers machines where that binary won't run.

### The workflow

`.github/workflows/release.yml`:

- Trigger: `workflow_run` on CI completing with success for a push to `main`. The workflow checks out that run's
  `head_sha`, not the branch tip.
- `concurrency: release`, `cancel-in-progress: false`, so releases are published in merge order.
- Permissions: `contents: write`.
- Steps: `pnpm install --frozen-lockfile`, bootstrap, `node scripts/release.ts --out dist-release`, then publish. The
  bootstrap step runs `pnpm bootstrap` (§4) if any `build-*` tag exists, and `pnpm bootstrap:seed` otherwise. Only the
  very first release takes the seed path. The choice is made in the workflow; `pnpm bootstrap` itself never falls back
  to the seed.
- Publishing: create the release as a **draft** with all three assets, then mark it published and latest. If any step
  after creating the draft fails, delete the draft and the tag. A published release always has all three assets.
- Idempotence: if the tag for `head_sha` already exists as a published release, the workflow exits 0 without changes,
  so re-running is safe.

## 4. Bootstrapping from a release

### Which release

`pnpm bootstrap` uses the **nearest ancestor release**: after `git fetch --tags --force origin`, the tag
`git describe --tags --match 'build-*' --abbrev=0 HEAD` names it.

The two-step rule (§6) guarantees that the release of a commit's first parent on `main` can build that commit.
Therefore the nearest ancestor release can build `HEAD` for a checkout of `main`, for an older commit, and for a branch
whose merge base with `main` has a release. "Latest" would be wrong for an old checkout, because a newer compiler may
reject older source.

`--release <tag>` overrides the choice. If no ancestor tag exists, bootstrap exits 1 with
`bootstrap: no build-* release is an ancestor of HEAD; use --release <tag> or pnpm bootstrap:seed`.

### Steps

1. Resolve the tag.
2. Fetch the three assets into `build/bootstrap/<tag>/`, unless they are already there. The repository is private, so
   anonymous downloads don't work: downloads use `gh release download <tag> --repo <owner>/<repo>`, where
   `<owner>/<repo>` comes from the `origin` remote. CI authenticates `gh` with `GH_TOKEN`. Assets are downloaded into a
   temporary sibling directory and renamed into place, so an interrupted download never leaves a partial cache. If `gh`
   is missing or fails, bootstrap exits 1 with its error and the hint
   `install and authenticate gh, or set ASTER_BOOTSTRAP_DIR`.
3. Verify both files against `SHA256SUMS`. On a mismatch, delete the cached directory and exit 1, naming the asset.
4. Pick a builder. Run `asterc-linux-x86_64 check` on a one-line program. If that succeeds, the binary is the builder.
   Otherwise unpack the C seed, build it with the command in `BUILD.txt`, print
   `bootstrap: release binary did not run; built the C seed instead` to stderr, and use that.
5. Run the existing `buildCompiler(builder, …)` unchanged: c1, c2, fixed point, atomic install of `build/asterc`.

The final line names the source, for example
`bootstrap: installed build/asterc (from release build-20261004-c6205b8, binary)` or `(…, c seed)`.

### Escape hatches

- `ASTER_BOOTSTRAP_DIR=<dir>` uses the assets in `<dir>` instead of downloading. They are still checksum-verified.
  This covers offline machines and the tests.
- `pnpm bootstrap:seed` is today's `pnpm bootstrap`: the TypeScript seed builds the compiler. It stays until R2.

### Scripts and documentation

| Command | Change |
|---|---|
| `pnpm bootstrap` | From a release (above). |
| `pnpm bootstrap:seed` | New name for today's bootstrap. |
| `pnpm build` | Unchanged. Its failure hint now says `pnpm bootstrap` rebuilds from a release. |
| `pnpm release` | New: `node scripts/release.ts`. |

`docs/self-host/building.md` gains a "Releases" section (what a release holds, the two-step rule) and a rewritten
"Recovery" section: lost `build/` → `pnpm bootstrap`; the binary won't run → the C seed is used automatically; no
GitHub access → `ASTER_BOOTSTRAP_DIR` or `pnpm bootstrap:seed`.

## 5. Changes to existing CI

`ci.yml`:

- `proof` is unchanged. It still starts from the TypeScript seed, so the byte-parity oracle stays intact until R2.
- `normal-path` runs `pnpm bootstrap` (from a release) instead of building from the seed. Until the first release
  exists, it runs `pnpm bootstrap:seed`, chosen the same way as in §3.
- New job `release-bootstrap` (§6).

All jobs check out with `fetch-depth: 0` where they need tags.

## 6. Enforcing the two-step rule

The PR job `release-bootstrap`:

1. Checks out the PR with full history and tags.
2. **Waits for the release of the base.** If `origin/main`'s HEAD has no `build-*` tag yet, it polls every 30 s for up
   to 15 minutes. If the tag still doesn't exist, it warns
   `release for <sha> not published yet; falling back to the nearest earlier release` and uses the nearest ancestor
   `build-*` tag. (If no earlier release is an ancestor, it fails with
   `release for <sha> not published yet, and no earlier release is an ancestor of it`.) An older release can only
   reject a change, never wrongly accept it, and the next green push to `main` publishes a release again, so one failed
   CI run can't wedge `main`.
3. Runs `pnpm bootstrap`, then `pnpm test`.

If the PR's compiler source uses a feature the base's release doesn't support, step 3 fails. The job then prints
`the latest release cannot build this compiler source; land the feature first, then use it (two-step rule, building.md)`
after the build error.

The job runs only on `pull_request`, not on pushes to `main`.

**Repository setting.** `main` has no branch protection today. For CI to enforce the rule rather than merely report it,
`release-bootstrap` must be a required status check. The R1 PR says so. Claude does not change repository settings.

A failed `release.yml` (or a failed CI run that prevents it) leaves a commit without a release. Later runs wait, then
fall back to the nearest earlier release, so `main` is not wedged. Re-running `release.yml` restores the exact base.

## 7. Testing

Vitest, in `tests/release.test.ts` and `tests/bootstrap_release.test.ts`:

- Tag resolution: nearest ancestor among several tags, the `--release` override, and no ancestor tag (in a temporary
  git repository).
- `ASTER_BOOTSTRAP_DIR` fixture produced by `release.ts --out`: bootstrap installs a compiler and reports `binary`.
- Checksum mismatch: one corrupted byte is rejected, naming the asset.
- Fallback: a fixture whose binary is replaced by a non-executable file falls back to the C seed and reports `c seed`.
- C seed: the tarball unpacks and builds with exactly the `BUILD.txt` command, and that compiler reaches the fixed point.
- Tarball determinism: two `release.ts` runs on the same commit give byte-identical tarballs.

End to end, after the R1 PR merges:

1. `release.yml` publishes the first release (bootstrapped from the seed).
2. On a clean checkout, `rm -rf build && pnpm bootstrap` installs from that release.
3. A follow-up PR goes green on `release-bootstrap`.

## 8. Work breakdown

One PR, in this order:

1. `scripts/release.ts` and its tests.
2. Release bootstrap in `scripts/build-compiler.ts`, `bootstrap:seed`, and their tests.
3. `release.yml`, the `ci.yml` changes, and `release-bootstrap`.
4. `building.md`.

## 9. Follow-up: R2 (separate spec)

R2 archives the seed. It is designed in its own brainstorming session. Known inputs:

- Tag the last commit whose source the seed can build as `seed-final`.
- Move `packages/asterc/runtime/` out of the TypeScript package (into `packages/asterc-self/runtime/` or `runtime/`),
  since `gen:runtime` and the C seed need it.
- 19 of the 28 files in `tests/` and all five scripts in `scripts/` reference the TypeScript compiler, mostly as the
  byte-parity oracle. They move to golden expected outputs or are deleted.
- `proof` starts from a release instead of stage 0.
- Remove `packages/asterc`, `bootstrap:seed` and `aster:seed`.

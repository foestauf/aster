# Reproducing the v0.8 maps measurements

The JSON files retain every sample, output hash, expected output, build command and measured decision. Command paths use `$V08A_ROOT`, `$V08B_ROOT` and `$RESULTS` instead of execution-local absolute prefixes. Numeric samples and hashes are unchanged. `provenance.json` explains the v0.8b local HEAD/staged-tree mapping to the published source commit and lists exact downloaded toolchain package hashes.

## Prerequisites

Use Linux x86_64, Node 24.19.0, GCC 13.3.0-16 as `cc`, and clang/lld 18.1.8 as `clang` / `ld.lld`. The recorded Debian package versions are `13.3.0-16` for GCC components and `18.1.8-18+b1` for LLVM components, from the official Debian package archive. Put the matching toolchain first in PATH for bootstrap and measurement. A different OS/package build/CPU is a declared replication, not the same machine.

Obtain two separate worktrees at:

- a: `22e693d71243915c4aabd1c5c6ab67a337c14fc5`
- b: `842e320f594d3a5b7546152e9c326ca6a1fb36bd`

Set `V08A_ROOT` and `V08B_ROOT` to their absolute paths. Bootstrap each via the normal `pnpm bootstrap` path in `docs/self-host/building.md`, or via the checksummed assets of the published `build-20261006-22e693d` release using `ASTER_BOOTSTRAP_DIR`. Both compilers must pass the C fixed point. The original experiment ran each full `pnpm selfhost` proof before timing; run those serially before measuring, with the LLVM toolchain present.

CPU 0 was used here. Replace it with a valid allowed CPU if necessary, record the difference, and keep every measurement and descendant pinned. Avoid other CPU-heavy jobs during sampling.

## Frozen repository harness

Run once in each source worktree, serially:

```sh
cd "$V08A_ROOT"
taskset -c 0 node scripts/bench.ts --runs=10 --configs=c-O2,c-O3,c-lto,llvm \
  --source-revision=22e693d71243915c4aabd1c5c6ab67a337c14fc5
# Preserve .bench/report.json and .bench/report.txt before another run.

cd "$V08B_ROOT"
taskset -c 0 node scripts/bench.ts --runs=10 --configs=c-O2,c-O3,c-lto,llvm \
  --source-revision=842e320f594d3a5b7546152e9c326ca6a1fb36bd
# Preserve .bench/report.json and .bench/report.txt.
```

Do not add the new map workloads to `bench/`, because the existing harness enumerates that directory and would change the historical score.

## Matched-source compiler and new map diagnostics

The portable scripts below differ from the recorded auxiliary scripts only in path parameterization and locating the included workload files. They use the repository measurement runner and identical optimization flags, one warmup, ten rounds, rotating order, checked stdout/stderr/status, and JSON raw samples. They do not change compiler code or the original suite.

`DATA` is the absolute path to this directory in the checkout containing the report files. `RESULTS` is a new empty output directory. Compilers are built before sampling. The first script interleaves a/b compilers and configurations while checking/emitting both frozen input trees.

```sh
mkdir -p "$RESULTS"
taskset -c 0 python "$DATA/measure_compilers.py" "$V08A_ROOT" "$V08B_ROOT" "$RESULTS/paired"
taskset -c 0 python "$DATA/measure_extra.py" "$V08A_ROOT" "$RESULTS/maps"
```

The map workloads and independent expected stdout are in `workloads/`. Their reference calculation uses insertion-ordered Python dicts: insert keys `0..N-1` with value `3*k`, sum values eight times, remove every even key and reinsert with `5*k` eight times, then sum final values. The int workload additionally sums `key*(position%7)` in final set insertion order. The string workload uses `symbol_` plus each decimal key and verifies equal-but-distinct string lookup/reinsertion.

Separate own-source C-O2 diagnostic samples used in the friction log are recorded in `provenance.json`; the interleaved same-source measurements are preferable for a version comparison. Performance variability remains a limitation even when the warning heuristic does not fire.

# L1: benchmark harness and C baseline

Date: 2026-10-04. Implements the measurement-first portion of the approved
[LLVM design](2026-10-04-aster-llvm-backend-design.md), issue #34. This changes no
compiler implementation or default build flags.

## Workloads and correctness

Five deterministic programs in `bench/` cover integer loops, array sorting,
string building, struct/payload-enum churn, and a calc-style interpreter. Each
has `// expect-stdout:` and `// expect-exit:` comments; undeclared stderr is
empty. Every warmup and measured execution must match stdout, stderr and exit
status exactly. An independent optional Python reference recalculates expected
answers; the benchmark has no Python dependency.

## Configuration and scheduling

`pnpm bench` requires an already bootstrapped `build/asterc`, Node 24+, Linux
x86_64 and `cc`. It builds all programs before timing:

- `c-O2`: unchanged `build/asterc build` normal driver path.
- `c-O3`: `--emit=c`, then `cc -std=c11 -O3 -Wall`, with the C runtime.
- `c-lto`: `--emit=c`, then `cc -std=c11 -O2 -flto -Wall`, with the C runtime in
  the same link invocation.
- Optional `llvm`: `--backend=llvm`; never enabled implicitly.

One untimed-for-statistics but measured-and-checked warmup precedes five
measured rounds by default. Runs are strictly serial. For each benchmark,
configuration order rotates by round, including warmup, reducing order bias.
`--runs=N` allows 1–1000 measured rounds; all samples remain in the report.

The script compiles a small `scripts/bench-runner.c` helper with the existing C
toolchain. `CLOCK_MONOTONIC` brackets `fork`/`exec`/`wait4`; parent Node startup,
validation and report generation are not timed. Linux `wait4` reports peak RSS
in KiB, including waited-for descendants. This is the largest individual
process peak, not the sum of concurrently live processes. It needs no package
beyond the existing C toolchain and avoids GNU time's coarse wall resolution.

## Compiler workloads

Every configuration also builds its own compiler executable. `self-emit-c`
measures that compiler emitting the whole compiler source as C; it must match
the initial compiler's C byte for byte. `self-build` measures a complete native
rebuild. The resulting executable must reproduce the same C oracle; this check
runs outside the timed interval, after every warmup and measured rebuild.

The C variants optimize the *running compiler*. Their unchanged driver still
builds the child with `cc -O2`; no private driver flag override is implied. The
optional LLVM compiler's full rebuild explicitly selects `--backend=llvm`.
These different full-pipeline costs remain separate from emission-only time.

## Reports and selection

`.bench/report.txt` and `.bench/report.json` are gitignored. `--record` writes
`docs/perf/baseline.md`; `--record=NAME` selects another safe basename. Records
include all raw samples, validation hashes, median wall time and median peak
RSS, build and execution commands, commit and dirty status, input/source hashes,
compiler binary hash, CPU, governor when readable, OS, toolchain versions and
Node version. Failed runs write diagnostic reports and never overwrite a
successful recorded Markdown baseline.

An optional `--source-revision=<40-character SHA>` plus
`--environment-note=<text>` records materialized-source provenance separately
from local git history. The input digest captures the current benchmark,
harness, C runtime and self-hosted compiler sources even in a dirty worktree.
Non-reference platform/toolchain use is prominently marked; a cloud or other
development run must not be represented as the official reference-machine
baseline.

The best C configuration is the *single measured configuration* with the highest
geometric mean of runtime-workload speedups over `c-O2`. Self-compile rows do not
participate in that geometric mean, because they are separate decision gates.
Ties retain `c-O2` (then declared C order). We never pick a different C variant
for each benchmark. This harness does not switch defaults or automatically
assert L5 acceptance; shared/cloud-machine noise and workload coverage remain
limitations of a performance decision.

## L5 decision reporting

A combined fresh run with all `c-O2,c-O3,c-lto,llvm` configurations evaluates
three separate median-based gates against the single best whole-suite C
configuration: suite geometric-mean speedup at least 1.10x; full `self-build`
not slower; and no individual runtime regression above 5%. A 1e-12 numeric
rounding tolerance handles floating-point boundary representation. The optional
per-workload fastest-C envelope is diagnostic, not a replacement comparator.
Self-emission is shown separately and never substitutes for full self-build.

Correctness PASS and the L5 performance decision are distinct. Incomplete or
unchecked data cannot establish performance eligibility. Fewer than five timed
samples, inconsistent sample rounds/medians, or a timed `(max-min)/median` above
20% in a compared case marks the performance conclusion **inconclusive**, while
retaining each exact measured gate result. This is a conservative stability
heuristic, not a statistical confidence interval. All C runtime cases affect
best-C selection; only the selected C and LLVM full-build cases affect that
gate. Emission-only variability remains diagnostic.

The harness evaluates only the results of its current invocation and never
splices an old C baseline into new LLVM samples. It records the process's Linux
CPU-affinity mask. External `taskset` may pin a run, but the script does not
change affinity, the governor, or compiler defaults. Record reproduction copies
a named preserved bootstrap compiler explicitly and documents the matching
pinned toolchain PATH.

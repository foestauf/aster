# v0.8a / v0.8b C and LLVM measurements

Measured 2026-10-06. **The backend decision has not changed: keep C as the default.**

v0.8b makes the compiler use maps/sets, with modest lower checker medians on matched inputs. It does not change the C or LLVM emitted for the five original runtime workloads or either new maps/sets diagnostic: all fourteen emitted files are byte-identical between v0.8a and v0.8b.

## Sources and method

- v0.8a: [`22e693d`](https://github.com/foestauf/aster/commit/22e693d71243915c4aabd1c5c6ab67a337c14fc5), maps/sets support before compiler adoption.
- v0.8b: [`842e320`](https://github.com/foestauf/aster/commit/842e320f594d3a5b7546152e9c326ca6a1fb36bd), compiler adoption. The report-only commit containing this document is later.
- Same development cloud host: Debian 13, AMD EPYC 9V74, nine visible logical CPUs. Every measurement and descendant pinned to CPU 0; serial configurations, rotating order; no concurrent assistant compile/test jobs.
- GCC 13.3.0-16; clang/lld 18.1.8 (Debian `18+b1`); Node 24.19.0. Official Debian packages were extracted locally. GCC matches the earlier LLVM decision; the clang package revision differs from that report. This is not the Ubuntu 24.04 reference machine.
- Original unmodified benchmark protocol: C-O2, C-O3, C-O2+LTO and the LLVM driver's `clang -O2 -flto -fuse-ld=lld`; one checked warmup plus ten checked timed samples. C-O3/C-LTO affect the running compiler; its native C child build still uses the unchanged C-O2 driver.
- Timings use the repository's CLOCK_MONOTONIC/fork/exec/wait runner. RSS is Linux wait4 `ru_maxrss`: largest individual process/descendant peak, not summed simultaneous tree memory.
- Both full self-host proofs passed before timing. v0.8a: 1178 full tests and 992 each for S1/S2/S3/SL1. v0.8b: 1172 full and 1003 each. C and LLVM fixed points passed. Every timed output and rebuilt compiler's C oracle passed.

The v0.8b working tree still had local HEAD `22e693d` plus staged implementation when measured. Its raw metadata is preserved. The staged tree exactly matched GitHub commit `842e320`'s tree `029d345b2f8957d0a5a60120959da3bccddb6910`, with no unstaged tracked changes. Compiler input/binary hashes are in [provenance.json](data/v08-maps/provenance.json). Later report-only edits do not change the measured compiler.

## Frozen five-workload score

One C configuration is selected for the entire suite by geometric mean; C+LTO wins in both runs. The runtime inputs are unchanged from [the historical decision](llvm-decision.md). Historical samples are not reused.

| Measurement | Historical | v0.8a | v0.8b |
|---|---:|---:|---:|
| LLVM speedup over C+LTO, geometric mean | 1.03699× | 1.03756× | 1.03438× |
| C+LTO full self-build, seconds | 4.571 | 4.330 | 4.365 |
| LLVM full self-build, seconds | 4.966 | 4.469 | 4.359 |
| C+LTO full self-build peak RSS, KiB | 247974 | 425520 | 423088 |
| LLVM full self-build peak RSS, KiB | 465594 | 806292 | 804252 |

The a/b runtime-score difference is not evidence of a codegen change: the generated program sources and runtime are identical. Absolute cross-date and cross-version self-build values also include different compiler source size and cloud conditions. The interleaved matched-source diagnostics below are the cleaner comparison of compiler execution.

v0.8b measured medians:

| Runtime workload | C+LTO ms | LLVM ms | LLVM elapsed-time change |
|---|---:|---:|---:|
| array_sort | 98.653 | 107.511 | +8.98% |
| calc_interpreter | 70.789 | 75.404 | +6.52% |
| integer_loops | 163.824 | 194.325 | +18.62% |
| string_build | 133.112 | 131.004 | −1.58% |
| struct_enum | 106.912 | 66.626 | −37.68% |

Positive changes mean LLVM takes longer. LLVM self-build peak RSS is about 1.90× C+LTO.

Promotion gates on the v0.8b run:

- Suite speedup at least 1.10×: **FAIL**, 1.03438×.
- Full self-build no slower: **PASS numerically**, 4.358660 s versus 4.364752 s. The 0.14% difference is effectively a tie, not a credible LLVM compile-time win. The fastest individual C full self-build was also checked separately in the raw data.
- Every runtime regression at most 5%: **FAIL**, three cases exceed 5%.

Thus two gates fail; the combined decision fails. v0.8b's runtime/full-self-build cases all stay below the harness's 20% `(max−min)/median` warning threshold. Its C-O2 emission-only diagnostic is noisy (25.2%). v0.8a has six quality flags and is formally inconclusive. The threshold is a warning heuristic, not a confidence interval; it does not establish significance for small differences.

## Compiler adoption, with identical inputs

A separate diagnostic interleaves both compiler versions and all four backend configurations. Each compiler checks and emits C for both frozen compiler source trees. All emitted outputs match the corresponding v0.8a oracle byte-for-byte.

Checker medians, milliseconds:

| Fixed input | Compiler configuration | v0.8a compiler | v0.8b compiler | Lower elapsed time |
|---|---|---:|---:|---:|
| v0.8a source | C-O2 | 98.242 | 91.702 | 6.66% |
| v0.8a source | C+LTO | 89.707 | 86.696 | 3.36% |
| v0.8a source | LLVM | 84.062 | 80.168 | 4.63% |
| v0.8b source | C-O2 | 96.614 | 93.733 | 2.98% |
| v0.8b source | C+LTO | 93.123 | 88.238 | 5.25% |
| v0.8b source | LLVM | 88.372 | 82.481 | 6.67% |

These are modest observed improvements across both backends, not a new LLVM-specific advantage. Some paired cases exceed the spread warning (including v0.8b C-O2 on a source, 54.3%); treat the percentages as exploratory medians. Complete C-O3, emission-only, RSS and raw samples are in [paired-compilers.json](data/v08-maps/paired-compilers.json).

The separate informational own-source C-O2 runs used for the friction log were 95.730 ms (a) and 91.944 ms (b), with median peaks 196544 and 193862 KiB. Those earlier runs were not interleaved and use different source inputs; they should not replace the matched-input table.

## New maps/sets diagnostics, outside the historical score

The original five workloads exercise neither maps nor sets. Two new, bounded diagnostics exercise int and string keys, insertion, lookup, presence tests, deletion/reinsertion, insertion-order enumeration and shared map/set operations. Their expected results were computed independently with a Python insertion-ordered-dict reference.

They were compiled with v0.8a; v0.8b emits byte-identical C and LLVM for both. They are **new nonhistorical workloads**, not additions to the frozen score or promotion gates.

| Diagnostic | C+LTO ms | LLVM ms | LLVM speedup | Peak RSS C+LTO / LLVM, KiB |
|---|---:|---:|---:|---:|
| int map + set, 100000 keys | 206.598 | 149.655 | 1.3805× | 68602 / 43612 |
| string map + set, 50000 keys | 129.098 | 107.854 | 1.1970× | 46230 / 33730 |

The int case has noisy samples (C+LTO spread 28.7%, LLVM 23.5%); the string comparator spreads are 10.9% and 9.8%. These cases suggest LLVM can be useful for some map-heavy programs, without meeting the overall default-backend criteria. They do not establish a v0.8b codegen gain.

C represents the features directly through `aster_map` handles and the shared C runtime API. Both backends use the same ordered hash-table implementation. The observed backend differences do not imply that maps/sets require LLVM. Lower LLVM memory usage is measured; a precise optimization/allocation explanation would require a separate profiling experiment.

## Data and reproduction

See [the reproduction guide](data/v08-maps/README.md), [a raw run](data/v08-maps/v08a.json), [b raw run](data/v08-maps/v08b.json), [new diagnostics](data/v08-maps/new-map-set-diagnostics.json), and [client emission hashes](data/v08-maps/client-emission-parity.json).

All sample counts, median wall/RSS values and both frozen-suite geometric means were independently recomputed from the saved raw samples. The underlying raw local reports are unchanged; the committed copies replace execution-local absolute path prefixes with documented placeholders only. No compiler flags, specification or default backend were changed for these measurements.

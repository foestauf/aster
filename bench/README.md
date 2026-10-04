# Deterministic execution workloads

These five CPU-bound programs cover the workload categories in the
[LLVM backend design](../docs/superpowers/specs/2026-10-04-aster-llvm-backend-design.md#5-measurement-and-the-decision-rule).
They take no arguments, read no external input, and print one checksum followed
by a newline. Every program declares its expected stdout and exit status in
comments. Stderr must be empty. The benchmark harness checks all three for the
warm-up and each measured run; incorrect work must never produce a valid timing.

Run the suite with `pnpm bench`. The harness also measures the compiler compiling
itself. These `.aster` files contain execution workloads only; Python is not a
benchmark dependency.

| Program | Work and data dependency | Expected stdout |
| --- | --- | --- |
| `integer_loops.aster` | 40,000,000 Park–Miller steps; each state depends on the previous state, and each contributes to a modular checksum | `592666852` |
| `array_sort.aster` | Generate and heap-sort three 262,144-element arrays, reuse their storage, check for inversions, and sum position-weighted values | `68652146336000035` |
| `string_build.aster` | Concatenate 128 decimal fields in each of 2,048 batches; hash every byte 16 times with a rolling state | `584164027` |
| `struct_enum.aster` | Allocate and mutate 2,000,000 records through three payload-enum variants, replacing entries in a 4,096-element ring | `667174078821` |
| `calc_interpreter.aster` | Tokenize and recursively parse 40,000 expressions from four forms, then interpret each AST 12 times with changing `x` | `74910056192` |

The initial GCC `-O2` smoke runs on the development machine took approximately
0.15–0.39 seconds per workload. These are sizing checks, not a reproducible
performance baseline; use the benchmark report for actual comparisons. Inputs
are fixed for reproducibility, while serial state, data-dependent branches,
mutable arrays, and checksum consumption prevent trivial dead-code removal.
Optimization of runtime helpers and object abstractions is intentionally fair.

## Memory and arithmetic

The runtime does not free strings, structs, or enums before process exit. These
workloads deliberately avoid unbounded growth: sorting reuses one array, string
construction uses short batches, and object/interpreter iteration counts are
bounded. Batching bounds the size of an individual string, not the lifetime of
its earlier concatenation allocations. The initial smoke runs stayed below
150 MiB peak RSS. Process exit reclaims all allocations between measurements.

The recurrence multiplication and checksum arithmetic stay within signed 64-bit
range. No workload relies on undefined host-language overflow, random seeds,
wall-clock time, files, or environment variables. An output mismatch, nonempty
stderr, a crash, or a nonzero status is a failure rather than a timing sample.

## Independent reference answers

Run `python3 bench/reference.py` to recalculate and check all five declarations
without the Aster compiler (about ten seconds on the development machine). It
uses arbitrary-precision Python integers, Python's sort rather than heap sort,
joined strings rather than repeated concatenation, tuple state instead of
payload enums, and direct arithmetic instead of a calculator parser. The
reference is intentionally simple and is not included in benchmark timings.

When adjusting a workload, update its independent reference and expected stdout
together, rerun both the reference check and every configured compiled variant,
and record a new baseline. Do not compare records made with different workloads
as if they measured the same task.

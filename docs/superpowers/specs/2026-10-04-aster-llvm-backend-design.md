# Aster LLVM Backend: Plan (Design)

**Date:** 2026-10-04
**Status:** Approved in brainstorming
**Issue:** #33 (planning only). It defines issues L1 to L5 (§6), which carry out the work.
**Baseline:** `f3a5f36` (normal build path, PR #32).
**Builds on:** [`2026-10-04-aster-self-hosting-contract-design.md`](2026-10-04-aster-self-hosting-contract-design.md)
(cited as "contract §n") and [`2026-10-04-aster-normal-build-path-design.md`](2026-10-04-aster-normal-build-path-design.md).

## 1. Purpose

Aster compiles itself through C (#15 to #21). The next phase is an LLVM backend. **Its purpose is faster compiled
programs**, including the compiler itself.

A backend swap alone does not deliver that. Today the C goes through `gcc -O2`, an optimiser about as capable as LLVM's,
so a straightforward LLVM backend would land at roughly the same speed. The levers that matter are:

- **The runtime boundary.** `aster_rt.c` is a separate translation unit. Every array index (`aster_rt_array_at`), push,
  allocation and string operation is an out-of-line call that neither compiler can inline today.
- **The IR we generate.** With our own LLVM IR we control its shape and attributes directly.
- **Measurement.** There are no benchmarks. Self-compile time (about 3 s) is the only number on record.

So the plan measures first, builds the LLVM backend to the same correctness bar as C, then optimises it, and makes it
the default only if it measurably wins.

Decisions taken in brainstorming:

1. **Benchmark first.** A benchmark suite and a measured C baseline come before any LLVM code. The baseline includes
   cheap C-side variants, so LLVM is compared with the best C configuration, not today's default.
2. **The emitter is written in Aster only.** It is `packages/asterc-self/emit_llvm.aster`. The TypeScript seed never
   learns LLVM. The **C backend is the oracle**: correctness means identical behaviour, not identical text.
3. **The C runtime stays.** clang compiles it together with the program as one LTO unit, so hot runtime helpers can be
   inlined into Aster code.
4. **The default changes only on evidence.** LLVM becomes the default backend only if a recorded measurement shows it
   wins (§5).

### Non-goals

Targets other than Linux x86_64 (arm64, macOS, wasm). Debug info. An LLVM emitter in the TypeScript seed. Freeing
memory or a garbage collector. Porting the runtime away from C. Language changes made for speed. Using the LLVM C API
(Aster has no FFI, and that would need many new builtins).

### #33 is done when

This spec is merged, issues L1 to L5 exist on GitHub with their acceptance criteria and dependencies, and #33 links
them. #33 changes no code.

## 2. Toolchain and platform

| Item | Contract after L2 |
|---|---|
| OS / arch | Linux x86_64, unchanged (contract §2). CI pins `ubuntu-24.04`. |
| C backend | gcc 13 as `cc`, unchanged. |
| LLVM backend | clang 18 and lld 18 (Ubuntu 24.04 packages `clang-18`, `lld-18`), run as `clang` with `-fuse-ld=lld`. |
| Emission | Textual LLVM IR (`.ll`), written by the self-hosted compiler. clang compiles it; the compiler links no LLVM library. |

clang becomes a dependency of the LLVM backend only. The C backend and the normal build path keep working without it
until L5's decision says otherwise.

## 3. CLI (self-hosted compiler)

- `--backend=c|llvm` on `build` and `run`. The default is `c` until L5 decides otherwise.
- `--emit=llvm` prints the module, as `--emit=c` prints C. It needs no clang.
- The TypeScript seed rejects both as a usage error (exit 2). The divergence is recorded in contract §4.5.
- A clang failure is reported as `cc` failures are (contract §4.5): clang's stderr streams, then
  `internal compiler error: C compiler 'clang' failed`, exit 3.

## 4. The emitter

`emit_llvm.aster` translates the existing IR (`ir.aster`) into one LLVM module. No new lowering is needed: the IR was
designed for this ("every value lives in a typed, mutable local slot (maps 1:1 onto LLVM alloca/load/store)",
`packages/asterc/src/ir/ir.ts`).

**Shape.** Each IR local gets one `alloca` in the entry block, and each instruction becomes loads, an operation and a
store. Each IR block becomes an LLVM block, and the terminators map directly (`jmp` to `br label`, `br` to `br i1`,
`switch` to `switch i64`, `ret`, `unreachable`). clang's `mem2reg`/SROA turns the slots into SSA. The emitter does not
build SSA itself.

**Types.** These match `packages/asterc/runtime/aster_rt.h` exactly:

| Aster | LLVM |
|---|---|
| `int` | `i64` |
| `bool` | `i1` in registers, `i8` in memory and struct fields (as C `bool`) |
| `string` | `{ ptr, i64 }` (`aster_string`) |
| struct, array | `ptr` (heap object, `aster_rt_alloc` / `aster_array`) |
| payload-free enum | `i64` tag |
| enum with payloads | `ptr` |

Struct and enum layouts follow the C emitter's struct definitions, so both backends agree on every field offset.

**The ABI trap.** On x86-64, clang lowers a C parameter of type `aster_string` (16 bytes, two INTEGER eightbytes) as
**two arguments**, `ptr` and `i64`, not as one aggregate. A returned `aster_string` comes back as `{ ptr, i64 }`, and C
`bool` parameters and returns are `i1 zeroext`. The emitter must declare and call every runtime function exactly as
clang lowers its C prototype. Getting this wrong breaks strings without any error. L3 pins it with tests that pass
strings through every runtime entry point, and with a check that the emitted `declare`s match
`clang -S -emit-llvm` output for `aster_rt.h`.

**Semantics carried over from C:**

- Arithmetic wraps: plain `add`/`sub`/`mul` with **no `nsw`/`nuw`**. Negation is `sub i64 0, x`.
- `aster_rt_div`, `aster_rt_mod` and the arithmetic helpers are `static inline` in the header, so the LLVM backend
  cannot call them. The emitter reproduces them in IR: division by zero panics with `division by zero`,
  `x / -1` is negation, and `x % -1` is 0, so `INT64_MIN / -1` never traps.
- Bounds checks, empty-pop and panic messages go through the same runtime calls, so stderr is identical.
- `main` mirrors the C emitter: `int main(int argc, char **argv)` calls `aster_rt_args` when the program uses
  arguments, and the exit code is truncated to `int` as in C.
- String literals become private constant globals. Their byte content is identical to the C escapes, with no NUL
  terminator relied on.

**Determinism.** The output is byte-stable: globals and declarations are in a fixed order, temporaries are numbered per
function, and nothing depends on a hash order. L4's fixed point relies on this.

**Driver.** `--backend=llvm` writes `program.ll` and the embedded runtime (`aster_rt.h`, `aster_rt.c`) into the private
temp directory, then runs
`clang -O2 -flto -fuse-ld=lld -std=c11 -Wall program.ll aster_rt.c -o <out>`. Optimisation flags may change in L5,
recorded with the measurements that justify them.

## 5. Measurement and the decision rule

**The benchmark suite (L1)** lives in `bench/`:

- about five CPU-bound programs: integer loops, array-heavy sorting, string building, struct/enum churn, and a
  `calc`-style interpreter;
- **the compiler compiling itself** (`build/asterc build packages/asterc-self/asterc.aster`).

Each program declares its expected output, so a benchmark that computes the wrong answer fails rather than reporting a
time.

**`pnpm bench`** is orchestration only, like `selfhost.ts`. It builds each benchmark, runs it N times (default 5) after
one warm-up, and reports median wall time and peak RSS. It writes `.bench/report.{txt,json}` (gitignored). It compares
**configurations**, each a way of turning a program into a binary:

| Configuration | How |
|---|---|
| `c-O2` | Today's normal path. |
| `c-O3`, `c-lto` | The program's `--emit=c` compiled by the bench script with gcc `-O3`, or with `-O2 -flto` together with `aster_rt.c`. |
| `llvm` | `--backend=llvm` (from L3). |

The C variants are built by the bench script from `--emit=c`, so measuring them changes no compiler.
`pnpm bench --record` writes `docs/perf/<name>.md` with the environment (commit, CPU model, governor if readable,
compiler versions). The L1 record is `docs/perf/baseline.md`.

**The decision rule (L5).** LLVM becomes the default backend only if, on the recorded benchmark machine:

1. its suite geometric-mean speedup over the **best C configuration** is at least **10%**;
2. self-compile is not slower than the best C configuration; and
3. no single benchmark regresses by more than **5%**.

If LLVM wins, a follow-up issue switches the default and updates the normal build path. If it does not, C stays the
default and the decision record says what was measured and what might change the outcome. A C configuration that beats
`c-O2` (for example `c-lto`) can be adopted for the C backend on its own merits in its own issue.

## 6. Issues

Each issue gets its own spec, then a plan, then a PR, as #16 to #21 did. The order is strict: each depends on the one
before it.

### L1: `bench`: benchmark suite and C baseline

- `bench/` programs with expected outputs; `pnpm bench [--record]` (§5); C configurations `c-O2`, `c-O3`, `c-lto`.
- `docs/perf/baseline.md` recorded on the reference machine, with its environment.
- Unit tests for the script's pure parts (median, geometric mean, report rendering), in the style of
  `tests/selfhost_script.test.ts`.
- No compiler change.

### L2: `--backend` and `--emit=llvm` surface, and the toolchain contract

- Self-hosted CLI: `--backend=c|llvm` and `--emit=llvm`, parsed and validated. `--backend=llvm` and `--emit=llvm` exit
  2 with `llvm backend not implemented yet` until L3.
- The seed rejects both. Contract §2 and §4.5 are amended (§2 and §3 of this spec). `docs/self-host/building.md` lists
  clang 18 and lld 18 as LLVM-only dependencies.
- CI installs `clang-18` and `lld-18` and checks their versions.
- Tests: CLI parsing and the usage errors, through `tests/asterc_self.test.ts`.

### L3: `emit_llvm.aster` and the LLVM driver path

- The emitter (§4) and the driver path. `--emit=llvm` is deterministic.
- **Parity:** every runnable golden program (the conformance corpus, contract §6) gives byte-identical stdout, stderr
  and exit code under `--backend=llvm` and `--backend=c`, and every emitted module passes clang's verifier.
- ABI tests for strings, bools and out-parameters across every runtime entry point (§4, the ABI trap).
- Tests for wrapping arithmetic, `INT64_MIN / -1`, `% -1`, and division by zero.

### L4: self-hosting on LLVM

- `pnpm selfhost` gains an LLVM leg. S1 builds the compiler with `--backend=llvm` to give SL1. SL1 builds SL2. The two
  must be fixed points (`--emit=llvm` of the compiler identical), and both must emit C identical to S0's.
- The stage-aware suites run against SL1.
- The CI `proof` job runs the LLVM leg. `docs/self-host/proof.md` gains its rows.

### L5: make the LLVM path fast, then decide

- Optimisation guided by the benchmarks. For example: confirm that LTO inlines the hot runtime helpers; add
  `nounwind`, `noreturn` and `willreturn` attributes to the runtime declarations; choose IR shapes that clang optimises
  well; try `-O3`. Each change is kept only if it measures faster and the L3/L4 parity still holds.
- `pnpm bench --record` writes `docs/perf/llvm-decision.md`. It applies §5's rule and states the outcome.
- If LLVM wins, a follow-up issue makes it the default. If it does not, the record says so and C stays the default.

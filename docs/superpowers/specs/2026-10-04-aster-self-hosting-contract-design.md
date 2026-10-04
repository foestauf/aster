# Aster Self-Hosting Contract: the C Backend (Design)

**Date:** 2026-10-04
**Status:** Approved in brainstorming
**Achieved:** 2026-10-04 — #20 proved it, #21 made it the normal build path ([building.md](../../self-host/building.md)).
**Issue:** #15. It gates #16 (typed program), #17 (lowering), #18 (C emission), #19 (driver), #20 (stage parity) and
#21 (normal build path).
**Baseline:** `492fc8b` (v0.7, PR #14).
**Builds on:** [`2026-10-03-aster-check-aster-design.md`](2026-10-03-aster-check-aster-design.md).

## 1. Purpose

Aster has a lexer, parser, loader and checker written in Aster. It has no typed tree, no lowering, no C emitter and no
driver. This document sets the finish line for "Aster compiles itself through the existing C backend": what counts as
the compiler, what it may lean on, how its generations are built, and how they are compared. LLVM planning starts only
after #20 and #21 are done.

This document is planning only. It changes no compiler source, specification or test.

### Success criteria for the self-hosting milestone

1. `packages/asterc-self/asterc.aster` is a complete Aster compiler. It provides `check`, `build` and `run` as in §4,
   and it emits C and invokes `cc` itself.
2. For every runnable golden program and for the compiler's own source closure, its `--emit=c` output is byte-identical
   to the TypeScript compiler's (§6).
3. Stages 1, 2 and 3 (§5) pass the frozen conformance suite (§6). The C that built stage 2 is identical to the C that
   built stage 3.
4. A single repeatable command reproduces the proof (#20). The self-hosted compiler becomes the normal build path,
   with TypeScript kept as the bootstrap seed and oracle (#21; see [building.md](../../self-host/building.md)).

### Non-goals

LLVM. Maps, sets and other friction-log items, unless a later issue shows the compiler needs them and records an
explicit decision. Optimisation. A runtime rewrite. Identical binaries. Platforms beyond §2. Debug emit stages other
than C.

## 2. Supported platform and toolchain

| Item | Contract |
|---|---|
| OS / arch | Linux x86_64. Tested on WSL2 (kernel 6.6). |
| C compiler | gcc 13 (Ubuntu 13.3), invoked as `cc` from `PATH`. |
| LLVM backend toolchain | clang 18 as `clang`, lld 18 as `ld.lld`, Linux x86_64 only; CI uses Ubuntu 24.04 packages `clang-18`, `lld-18`. LLVM-only dependencies. |
| Stage 0 host | Node ≥ 24 running `packages/asterc/dist/cli/bin.js` (`pnpm aster:seed`). |
| C flags | `-std=c11 -O2 -Wall`, the same as the TypeScript `buildExecutable`. Test harnesses may add `-Werror`. |
| Environment for comparisons | Repo root as cwd, root file spelled `packages/asterc-self/asterc.aster`, `LC_ALL=C`. |

macOS and Windows are **unsupported**. Clang 18 is supported only for the experimental LLVM backend; gcc 13 remains the C-backend compiler. They are not claimed to work or not work. The new runtime builtins (§4.3)
use POSIX APIs (`mkdtemp`, `posix_spawnp`, `waitpid`, `remove`), so `aster_rt.c` defines `_POSIX_C_SOURCE` itself.

## 3. Source closure

```
packages/asterc/                 # stage 0: the TypeScript compiler (seed + oracle), unchanged in role
packages/asterc-self/            # the self-hosted compiler; no package.json
  asterc.aster                   # entry point: fn main(args: [string]): int, CLI parsing (§4)
  lexer.aster parser.aster       # moved from tests/programs/programs/
  loader.aster checker.aster     # moved; checker extended to a full typed program (#16)
  lower.aster                    # typed program → IR (#17)
  emit.aster                     # IR → C text (#18)
  diag.aster                     # human diagnostic formatting (§4.2)
  runtime.aster                  # generated: aster_rt.h / aster_rt.c as string constants (§4.4)
  driver.aster                   # temp dir, file writes, cc and program execution (#19)
tests/programs/programs/
  lex.aster parse.aster check.aster   # stay as golden test drivers; import the moved libraries via relative paths
```

Module names inside `packages/asterc-self/` are a proposal. #16–#19 may split or rename them. What is fixed is the
directory, the entry point `asterc.aster`, and the rule that the closure is exactly the files reachable by `import`
from `asterc.aster`. Moving the existing libraries must leave `lex/parse/check_aster.test.ts` passing with only path
updates.

## 4. The compiler contract

### 4.1 CLI

The self-hosted compiler accepts the TypeScript CLI's grammar minus the debug stages:

```
aster check <file.aster>
aster build <file.aster> [-o <out>] [--emit=c]
aster run <file.aster> [-- <args>...]
```

It matches `packages/asterc/src/cli/cli.ts` in these ways:

- **Argument errors.** It gives the same reasons in the same order of precedence. That covers a missing command, an
  unknown command, `--` used outside `run`, `-o`/`--emit` used outside `build`, `-o` with no path, an unknown emit
  stage, an unknown option, an unexpected argument and a missing input file. Each error is printed as
  `error: <reason>\n` followed by the same usage text, and exits 2. The usage text drops `tokens|ast|ir` from
  `--emit=`, so it reads `--emit=c`. That is the only change to the text.
- **Unreadable input.** `error: cannot read '<file>'\n`, exit 2.
- **Malformed UTF-8 source.** Checked before anything else reads the text, with the same algorithm in both compilers
  (`driver/utf8.ts`, `loader.aster`). A root file that is not well-formed UTF-8 prints
  `<file>: error: invalid UTF-8 at line <L>, byte <B>\n` and exits 1, for every command. An imported one is reported
  at its import, `cannot import '<path>': invalid UTF-8 at line <L>, byte <B>`, as a compile error. Added in #25.
- **Compile errors.** Every diagnostic is printed through the human format (§4.2), sorted and deduplicated as by
  `sortDiagnostics`, and the exit code is 1. A program that has errors never reaches lowering.
- **`--emit=c`.** It writes the C text to stdout and exits 0. Nothing else goes to stdout.
- **`build` without `-o`.** The output path follows `defaultOutput`: the input's basename without `.aster`, or
  `<base>.out` if the name doesn't end in `.aster`.
- **`run`.** It builds into a temp dir and runs the program with inherited stdio, passing along the arguments that
  follow `--`. It exits with the program's status, or with `128 + signal` if a signal killed the program. It then
  removes everything it created.
- **Internal errors.** `internal compiler error: <message>\n`, exit 3.

**Exit codes:** 0 ok, 1 compile error, 2 usage, 3 internal. They are the same as `EXIT` in `cli.ts`.

### 4.2 Diagnostics

`check`, `build` and `run` render diagnostics exactly as `formatDiagnostic` does:
`<path>:<line>:<col>: error: <message>`, then two-space-indented source line, then the caret line. Columns and caret
widths count **UTF-16 code units**, as the TypeScript implementation does. The Aster side works in bytes, so it must
convert, and the conformance corpus must include a non-ASCII line (added if none exists). `<path>` is the path as the
loader spelled it, which is the same rule as today.

### 4.3 New builtins

These are the only new capabilities the boundary needs. Each is added **to stage 0 first**: the TypeScript checker,
lowering, C emission and `aster_rt.c`, with golden programs. Stage 0 has to be able to compile stage 1.

```
write_file(path: string, contents: string): Result[int, string]  // Ok(bytes written); Err("<path>: <reason>")
make_temp_dir(prefix: string): Result[string, string]            // mkdtemp of "$TMPDIR/<prefix>XXXXXX", /tmp if unset
remove_path(path: string): Result[int, string]                   // C remove(): one file or one empty directory; Ok(0)
run_process(argv: [string]): Result[int, string]                 // posix_spawnp + waitpid, stdio inherited;
                                                                 // Ok(exit status) or Ok(128 + signal);
                                                                 // Err(reason) if the process could not be started
```

Errors follow `read_file`'s convention, `"<path>: <reason>"`, and an embedded NUL fails with the reason `invalid path`.
`run_process` with an empty `argv` is `Err("empty argv")`. These four are the decision. No other filesystem, environment
or process builtin is approved by this document.

### 4.4 Runtime embedding

`runtime.aster` defines two string constants holding the exact bytes of `packages/asterc/runtime/aster_rt.h` and
`aster_rt.c`. A TypeScript script (`pnpm gen:runtime`) generates it, and a test fails when the generated file is stale.
Generating it is a source-sync step. It does no lexing, parsing, checking, lowering or C generation.

`build` and `run` do the following:

1. `make_temp_dir("aster-cc-")`.
2. Write `aster_rt.h`, `aster_rt.c` and `program.c` into the temp dir.
3. `run_process(["cc", "-std=c11", "-O2", "-Wall", "-I<tmp>", "<tmp>/program.c", "<tmp>/aster_rt.c", "-o", <out>])`.
4. Remove the three files and the directory, whatever the outcome.

For `run`, `<out>` is `<tmp>/program`, and it is executed and removed before the directory. Emitted C keeps its first
line `#include "aster_rt.h"`, so `--emit=c` stays comparable to stage 0.

### 4.5 Documented divergences from stage 0

| Behaviour | Stage 0 (TS) | Self-hosted | Why accepted |
|---|---|---|---|
| `--emit=tokens\|ast\|ir` | Supported | Unknown emit stage (exit 2) | Debug aids. `lex/parse.aster` already prove token/AST parity. |
| `--backend=c\|llvm`, `--emit=llvm` | Rejected (exit 2) | Backend selection for build/run, LLVM textual emission for build; default C. LLVM uses textual IR and the unchanged C runtime. | LLVM is self-hosted only. |
| `ASTER_CC` | Overrides `cc` | Ignored, always `cc` | Would need an `env` builtin, and nothing in self-hosting uses it. |
| LLVM tool failure | Not applicable | clang stderr streams, then `internal compiler error: C compiler 'clang' failed`, exit 3 | Same driver-failure convention as C. |
| `cc` failure text | `cc`'s stderr inside the internal-error message | `cc`'s stderr streams first, then `internal compiler error: C compiler 'cc' failed` | Exit code 3 matches. Only reachable if emitted C is broken, which §6 catches. |
| Import identity | `realPath` of each import | Lexically normalised path (the `loader.aster` rule) | No `realpath` builtin. See §7. |
| A panic inside the compiler | Caught: `internal compiler error: <stack>`, exit 3 | `panic: <message>`, exit 101 | Aster cannot catch a panic. Failures the driver detects itself still exit 3. Added in #19. |
| `cc` warnings on success | Stage 0 discards cc's stderr when cc succeeds | Self-hosted streams cc's stderr (inherited stdio), so warnings appear on stderr even when the build succeeds | Emitted C is meant to be warning-free (tests build with -Werror); only reachable for unusual programs. Added in #19. |

After `internal compiler error:` the message text is not compared between stages: stage 0 carries Node error and stack
text, the self-hosted compiler the runtime's `<subject>: <strerror>`. Exit code 3 matches.

## 5. Stages

All stages are built from **one commit** in the §2 environment.

| Stage | Built by | Command |
|---|---|---|
| S0 | — | `pnpm build:seed`; then `node packages/asterc/dist/cli/bin.js` |
| S1 | S0 | `S0 build packages/asterc-self/asterc.aster -o <dir>/s1` |
| S2 | S1 | `S1 build packages/asterc-self/asterc.aster -o <dir>/s2` |
| S3 | S2 | `S2 build packages/asterc-self/asterc.aster -o <dir>/s3` |

S2 and S3 are produced without running the TypeScript front end. Binary equality between stages is **not** required.

## 6. Conformance

### 6.1 Frozen baseline

These stay exactly as they are at the baseline commit:

- every golden program's `expect-*` directives,
- the lexer/parser/checker parity corpora (`tests/{lex,parse,check}_aster.test.ts` and `fixtures/`),
- the TypeScript unit tests.

Tests may only be **added**, and each addition says what regression or capability it covers. There is no permanent
skip-list. A test that has to change because of moved paths (§3) changes only the paths.

### 6.2 The C oracle

For `Sn` with n ∈ {1, 2, 3}:

- **Programs.** For every runnable golden program `X` (everything under `tests/programs/` except files marked
  `// expect-library` and programs that expect a compile error), `Sn build X --emit=c` must be byte-identical to
  `S0 build X --emit=c`.
- **Compiler closure.** The same holds for `X = packages/asterc-self/asterc.aster`. So C(S0) = C(S1) = C(S2) = C(S3).
  This includes the issue's requirement that the C emitted to produce S2 equals the C emitted to produce S3.

No normalisation is applied. A difference in ordering, naming, whitespace or escaping is a failure. This makes the
TypeScript emitter the reference for #17 and #18: lowering and emission mirror its local IDs, block labels, declaration
order, name mangling and string-literal escaping. If #17 or #18 finds a TypeScript behaviour that cannot reasonably be
mirrored, the fix is a change to stage 0 in its own commit, not a normaliser.

### 6.3 Behaviour

For each of S1, S2 and S3:

- Every runnable golden program goes through `Sn run X -- <expect-args>` with its `expect-stdin`. It must meet its
  `expect-stdout`, `expect-stderr` and `expect-exit` unchanged.
- Every program that expects a compile error goes through `Sn check X`. Its stdout, stderr and exit code must equal
  `S0 check X`'s, byte for byte.
- The CLI cases in §4.1 (each usage error, an unreadable file, `build` with and without `-o`, `run` with arguments, a
  signal-killed program) must match S0's stdout, stderr and exit code. The exception is the divergences listed in §4.5,
  each of which gets its own test.
- The front-end parity tests keep passing against the moved libraries.

### 6.4 Proof command

#20 provides one command, proposed as `pnpm selfhost`. It builds S0 to S3 in a fresh temp dir and runs §6.2 and §6.3.
It prints the commit, `cc --version`, `uname -m` and a per-stage pass/fail table, and exits non-zero if anything drifts.
It is orchestration only: it may call S0 to S3 and `cc`, compare files and run tests, but it must not lex, parse,
check, lower or emit Aster itself.

## 7. Path identity and open investigations

- **Path identity.** The self-hosted loader keeps `loader.aster`'s identity: repeated `/` collapsed, `.` dropped,
  `name/..` folded. Reaching the same file through a symlinked alias is **unsupported**. It may load twice, and that is
  a documented limit, not a bug. On the corpus, which contains no symlinks, it agrees with stage 0. Emitted C contains
  no source paths, so path spelling affects only diagnostics and load order.
- **#12** (TS root identity through symlinks) stays a stage-0 correctness investigation. #20 must resolve it or record
  evidence that narrows it before the proof is declared. Resolved in #20: fixed in stage 0.
- **#13** (astral invalid-escape diagnostic parity) is a lexer parity gate. #20 must resolve it or record evidence that
  refutes it. §4.2's UTF-16 column rule is relevant: the fix must not quote half a surrogate pair. Resolved in #20:
  fixed in stage 0.

## 8. Decided vs proposed

**Decided by this document:**

- the platform and toolchain (§2)
- `packages/asterc-self/` with entry point `asterc.aster` (§3)
- the CLI and its exit codes (§4.1)
- the diagnostic format (§4.2)
- exactly four new builtins (§4.3)
- the embedded runtime and the build steps (§4.4)
- the divergences (§4.5)
- the stage definitions (§5)
- the frozen baseline, the byte-identical C oracle and the behaviour suite (§6.1–6.3)
- lexical path identity (§7)

**Proposals, settled by later issues:**

- module names inside `packages/asterc-self/` (#16–#19)
- the typed-program representation (#16)
- internal debug dumps, which must not be exposed as CLI emit stages (#16–#18)
- the name and output format of the proof command: decided in #20 as `pnpm selfhost` (see `2026-10-04-aster-selfhost-proof-design.md`)
- how to handle memory: the runtime never frees, and compiling a compiler of roughly 6k lines may need a lot of memory.
  #18 or #20 measures it first and treats a fix as a separately accepted runtime change if one is needed.

**Order of work:** #15 → #16 → #17 → #18 → #20 → #21, with #19 alongside. The four builtins (§4.3) land in stage 0
early in #19, because nothing else depends on them until the driver is integrated.

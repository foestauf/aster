# The Aster Compiler Driver and POSIX Builtins (Design)

**Date:** 2026-10-04
**Status:** Approved in brainstorming. Rob chose two stacked PRs, S1 plus one S2 hop as the self-compile proof, and a
documented divergence for compiler panics.
**Issue:** #19
**Builds on:** [`2026-10-04-aster-self-hosting-contract-design.md`](2026-10-04-aster-self-hosting-contract-design.md)
(§4 the compiler contract, §6 conformance) and
[`2026-10-04-aster-c-emit-design.md`](2026-10-04-aster-c-emit-design.md) (#18).

## 1. Purpose

`packages/asterc-self/` can load, check, lower and emit C byte-identical to stage 0, but only through test drivers in
`tests/programs/programs/`. Nothing writes files or runs `cc`. This milestone adds the four POSIX builtins the contract
approves (§4.3) and the compiler entry point `asterc.aster` that uses them to provide `check`, `build` and `run`.

It ships as two stacked PRs:

- **PR A, the builtins.** `write_file`, `make_temp_dir`, `remove_path` and `run_process` in stage 0 (TS checker,
  lowering, C emission, runtime) and in `checker.aster`, `lower.aster`, `ir.aster`, `ir_print.aster` and
  `emit.aster`, with golden coverage.
- **PR B, the driver.** `runtime.aster` plus `pnpm gen:runtime`, `diag.aster`, `driver.aster` and `asterc.aster`,
  tested against stage 0 and through one self-compile hop (S1 builds S2).

### Success criteria

1. Each builtin has the contract §4.3 signature and semantics in both compilers. The typed, IR and emit parity suites
   pass with the new goldens in the accepted corpus.
2. `S0 build packages/asterc-self/asterc.aster -o s1` succeeds with `-Werror`. S1 implements contract §4.1–§4.4.
3. For every program in the accepted corpus, including `asterc.aster` itself, `S1 build X --emit=c` equals
   `S0 build X --emit=c` byte for byte, with exit 0 and empty stderr.
4. `S1 build packages/asterc-self/asterc.aster -o s2` succeeds, and `S2 build asterc.aster --emit=c` equals S0's.
5. The CLI cases in §5.3 give the same stdout, stderr and exit code under S1 as under S0, except the divergences in §6,
   each of which has its own test.
6. `build` and `run` leave nothing behind in `$TMPDIR`, whether they succeed or fail.
7. `pnpm test`, `pnpm lint` and `pnpm typecheck` pass. The frozen baseline (contract §6.1) is unchanged. Tests are only
   added.

### Non-goals

The full §6.3 golden-run sweep, S3, `pnpm selfhost` and #12/#13 (all #20). Making the self-hosted compiler the normal
build path (#21). Any builtin beyond the four. `ASTER_CC`, `--emit=tokens|ast|ir`, maps, LLVM, runtime memory work.
Malformed UTF-8 diagnostics (#25).

## 2. PR A: the four builtins

### 2.1 Surface

```
write_file(path: string, contents: string): Result[int, string]   // Ok(bytes written)
make_temp_dir(prefix: string): Result[string, string]             // Ok(created directory path)
remove_path(path: string): Result[int, string]                    // Ok(0)
run_process(argv: [string]): Result[int, string]                  // Ok(exit status) or Ok(128 + signal)
```

All four are ordinary builtins: any program may call them, and their names are reserved like `read_file`'s.

### 2.2 Checker

Both checkers add the four to the signature table next to `read_file`, with `ret: Void` as a placeholder. The call is
typed by hand, as `read_file`'s is: `Result[string, string]` for `make_temp_dir`, `Result[int, string]` for the
other three. Instantiating `Result[int, string]` registers that instance the same way any user mention would, so the
instance order (and therefore the emitted C) matches between the two checkers. `run_process`'s parameter is
`[string]`.

### 2.3 IR

One new instruction serves all four:

```ts
| { kind: 'sys'; builtin: SysBuiltin; ok: number; value: number; err: number; args: Operand[] }
// SysBuiltin = 'write_file' | 'make_temp_dir' | 'remove_path' | 'run_process'
```

printed as `%<ok>, %<value>, %<err> = <builtin> <operand>, <operand>`. `ok` is a `bool` local, `value` is `int` (or
`string` for `make_temp_dir`) and `err` is `string`. `ir.aster` adds the matching `IrInstr::Sys` variant and
`ir_print.aster` prints it identically. `read_file` keeps its own instruction: its IR is part of the frozen unit tests.
`tests/ir_validate.ts` learns the new instruction.

### 2.4 Lowering

`lowerSys` (TS) and `lower_sys` (Aster) mirror `lowerReadFile`: allocate `ok`, `value` and `err` in that order, emit
the instruction, branch on `ok`, and build `Ok(value)` or `Err(err)` into the result local. Block labels and local IDs
follow `lowerReadFile`'s pattern exactly so the two lowerings stay byte-identical.

### 2.5 C emission

```c
l_ok = aster_rt_write_file(a, b, &l_value, &l_err);
```

The runtime function takes the arguments in order, then `&value` and `&err`, and returns `bool`. `emit.aster` mirrors
the case.

### 2.6 Runtime

`aster_rt.c` starts with `#define _POSIX_C_SOURCE 200809L`, before any include. New functions in `aster_rt.h`:

```c
bool aster_rt_write_file(aster_string path, aster_string contents, int64_t *value, aster_string *err);
bool aster_rt_make_temp_dir(aster_string prefix, aster_string *value, aster_string *err);
bool aster_rt_remove_path(aster_string path, int64_t *value, aster_string *err);
bool aster_rt_run_process(aster_array argv, int64_t *value, aster_string *err);
```

- **Errors** reuse `path_error`: `"<path>: <strerror>"`. The path is the path argument. For `make_temp_dir` it is the
  template (`<dir>/<prefix>XXXXXX`), and for `run_process` it is `argv[0]`. An embedded NUL in any of these strings
  (and in any `argv` element) fails with the reason `invalid path`, the path cut at the NUL, as `read_file` does.
  An empty `argv` fails with `Err("empty argv")`.
- **`write_file`** opens with `fopen(path, "wb")`, writes all bytes and closes. A short write or failing `fclose`
  reports the `errno` reason. `Ok` carries the length.
- **`make_temp_dir`** uses `$TMPDIR` if it is set and non-empty, otherwise `/tmp`. The template is `<dir>/<prefix>XXXXXX`,
  with no slash normalisation. It calls `mkdtemp` and returns the created path.
- **`remove_path`** calls `remove()`: one file, or one empty directory.
- **`run_process`** calls `fflush(NULL)` first, so the caller's buffered output comes before the child's. Then it calls
  `posix_spawnp` with inherited stdio and the inherited environment, followed by `waitpid` (retrying on `EINTR`). A
  normal exit gives `Ok(WEXITSTATUS)`, a signal gives `Ok(128 + WTERMSIG)`. A spawn failure gives
  `Err("<argv[0]>: <strerror(rc)>")`.

### 2.7 Tests

- **Goldens** in `tests/programs/io/`:
  - `files.aster` does a round trip: `make_temp_dir`, `write_file` (checking the count), `read_file`, removing the
    file and then the directory, and a second `remove_path` that fails.
  - `files_errors.aster` covers writing into a missing directory, a NUL in a path, removing a non-empty directory and
    removing a missing path. Messages that embed the random temp name are matched by prefix or suffix only.
  - `process.aster` covers `true` → 0, `sh -c 'exit 3'` → 3, `sh -c 'kill -9 $$'` → 137, a missing command → `Err`,
    an empty argv → `Err`, and ordering: `print("a")`, a child `echo b`, `print("c")` must give `a b c`.
  - Errors in `tests/programs/errors/` cover a wrong argument type for each builtin and use of the result as a
    non-Result.
- **Parity.** The new goldens join `tests/corpus.ts`'s accepted corpus, so `typed_aster`, `ir_aster`, `emit_aster`
  and `ir_validate` cover the self-hosted side.
- **TS unit tests.** New cases in `checker.test.ts`, `lower.test.ts` and `emit.test.ts`. Existing cases are untouched.

## 3. PR B: modules

| File | Role |
|---|---|
| `runtime.aster` | Generated. `fn runtime_h(): string` and `fn runtime_c(): string` return the exact bytes of `aster_rt.h`/`aster_rt.c`. Aster has no global constants, so they are functions. |
| `scripts/gen-runtime.ts` | `pnpm gen:runtime`. It writes `runtime.aster` from the two files, escaping every byte so the literal decodes to the same bytes. It does no lexing, parsing, checking, lowering or C generation (contract §4.4). |
| `diag.aster` | `format_diag(files, d): string`, the port of `formatDiagnostic` (§4). |
| `driver.aster` | `build_c(c, out): Result[int, string]` and `run_c(c, args): Result[int, string]` (§5.2). |
| `asterc.aster` | `fn main(args: [string]): int`: argument parsing, `default_output` and the command flow (§5.1). |

`report.aster` and the test drivers in `tests/programs/programs/` stay as they are.

## 4. Human diagnostics

`formatDiagnostic` works on JS strings, so lines and columns count UTF-16 code units, and the BOM has already been
stripped. The loader's `Diag` spans are byte offsets into the source map (with `SourceFile.bom` recording a stripped
BOM). `format_diag`:

1. Finds the file as `print_diags` does, and the line containing `start` by scanning for `\n` in its bytes.
2. Takes the line text from the line start to the next `\n` (or the end of the file), dropping one trailing `\r`.
3. Sets `col = 1 + utf16_len(line[..start])`, where `utf16_len` counts 1 for each UTF-8 lead byte of a 1–3 byte
   sequence and 2 for a 4-byte lead byte, and 0 for continuation bytes.
4. Builds the padding from `line[..start]`: each tab is copied, and every other UTF-16 unit becomes one space.
5. Sets `width = max(1, min(utf16_len(src[start..end]), utf16_len(line) - (col - 1)))`. The end is clamped to the file,
   as `print_diags` clamps it.
6. Returns `<path>:<line>:<col>: error: <message>\n  <line>\n  <padding><carets>`.

The corpus gains `tests/programs/errors/non_ascii_column.aster`, with an error after a non-ASCII and an astral
character on the same line, and an `expect-error` at the UTF-16 column. The source must be valid UTF-8. #25 covers the
invalid case.

## 5. The compiler

### 5.1 `asterc.aster`

`parse_args(args): Result[Args, string]` is a line-for-line port of `parseArgs`, so the reasons and their precedence
match. The emit stages are only `c`. `main`:

1. If parsing fails, `eprint("error: " + reason)` plus the usage text and return 2. The usage text is
   `cli.ts`'s with `--emit=tokens|ast|ir|c` replaced by `--emit=c`. `eprint` adds the newline, so the last usage line is
   printed without one, to keep the bytes identical.
2. If `read_file(file)` fails, `error: cannot read '<file>'`, return 2.
3. Run `load_program` and `check_program`. If either reports diagnostics, `sort_diags` them, print each through
   `format_diag` to stderr, and return 1. Lowering is never reached.
4. `check` returns 0.
5. `lower_program` then `emit_c` gives the lines. `compile_c` joins them with `"\n"` and drops `emit_c`'s last
   element (`""`), so the `c` it returns has no final newline.
6. `--emit=c` prints `c` (`print` adds the newline, so the output equals stage 0's exactly) and returns 0.
7. `build` calls `build_c(c + "\n", out ?? default_output(file))`. `run` calls `run_c(c + "\n", program_args)` and
   returns its status. `cc` gets the exact text stage 0 writes. An `Err(msg)` from either becomes `internal compiler error: <msg>`, return 3.

`default_output` mirrors `defaultOutput`: the basename (after the last `/`) without a trailing `.aster`, or
`<base>.out` if there is nothing to strip.

Large output goes through one `print`. Building `c` by repeated `+` is quadratic, so `join` builds it by halves.

### 5.2 `driver.aster`

`build_c(c, out)`:

1. `make_temp_dir("aster-cc-")` → `tmp`. On `Err(e)`, return `Err(e)`.
2. Write `tmp/aster_rt.h`, `tmp/aster_rt.c` and `tmp/program.c`. Stop at the first failure.
3. `run_process(["cc", "-std=c11", "-O2", "-Wall", "-I" + tmp, tmp + "/program.c", tmp + "/aster_rt.c", "-o", out])`.
   A non-zero status becomes `Err("C compiler 'cc' failed")`. `cc` has already streamed its stderr. A spawn failure
   becomes `Err("failed to run C compiler 'cc': <reason>")`.
4. Remove each file that was written, then `tmp`, whatever the outcome. Removal failures are ignored when an error is
   already being reported. Otherwise the first one is the result.

`run_c(c, args)` calls `build_c` with `out = tmp/program` inside its own `make_temp_dir("aster-run-")`. It runs
`[tmp/program] + args` with inherited stdio, then removes `program` and `tmp`, and returns `Ok(status)`. If the program ran but cleanup then fails, the result is the cleanup error (an internal compiler
error, exit 3), as `driver_remove_then` returns it.

### 5.3 Tests (`tests/asterc_self.test.ts`)

`beforeAll` builds S1 with stage 0 (`-Werror`, 60 s hook timeout). The S0 side runs `runCli` in-process, with
`childStdio: 'pipe'`. Every comparison is `{ stdout, stderr, status }` under a private `TMPDIR`, which is checked empty
afterwards.

- **C oracle.** For each accepted corpus file, `S1 build X --emit=c` equals `S0`'s, with exit 0 and empty stderr.
- **S2 hop.** S1 builds S2 from `packages/asterc-self/asterc.aster`, and S2's `--emit=c` of the same file equals S0's.
- **CLI parity, S1 vs S0:**
  - each usage error in `cli.test.ts`'s list
  - an unreadable file
  - every golden that expects compile errors, via `check` and via `build`
  - the module goldens via `check`, with the root spelled relative, absolute, and with `./` and `..` segments
  - a missing import
  - an import cycle and a diamond
  - a non-root `main` and a root without `main`
  - `non_ascii_column.aster`
- **Build and run, S1 vs S0:**
  - `build` with `-o` and without it (in a temp cwd, checking the default name)
  - `run` with arguments after `--` and with stdin
  - a program that exits non-zero
  - a program that panics (101)
  - a program killed by a signal (unbounded recursion, SIGSEGV → 139)
- **Divergences**, one test each (§6).
- **Cleanup.** `TMPDIR` is empty after a successful build, after a successful run, and after a `cc` failure.

## 6. Divergences

Contract §4.5 gains two rows, in PR B:

| Behaviour | Stage 0 (TS) | Self-hosted | Why accepted |
|---|---|---|---|
| A panic inside the compiler | Caught: `internal compiler error: <stack>`, exit 3 | `panic: <message>`, exit 101 | Aster cannot catch a panic. Failures the driver detects itself still exit 3. |
| `cc` warnings on success | Stage 0 discards cc's stderr when cc succeeds | Self-hosted streams cc's stderr (inherited stdio), so warnings appear on stderr even when the build succeeds | Emitted C is meant to be warning-free (tests build with -Werror); only reachable for unusual programs. |

Tests:

- `--emit=ir` gives `unknown emit stage 'ir'` and exit 2.
- `ASTER_CC=false` is ignored: the build succeeds.
- A `PATH` whose `cc` is a script that writes to stderr and exits 1 gives that stderr, then
  `internal compiler error: C compiler 'cc' failed`, exit 3, and an empty `TMPDIR`.
- A compiler panic: S1 run under `ulimit -v` small enough that allocation fails gives `panic: out of memory` and exit
  101. If this isn't reliable under WSL2, the test is dropped and the reason recorded in the friction log.

## 7. Limits and records

The README records the tested platform (Linux x86_64, WSL2 kernel 6.6, gcc 13.3), the commands, and S1's time and
peak memory for building itself. `docs/self-host/friction.md` gains a "Found while building the driver" section.
Symlink aliases stay unsupported (contract §7).

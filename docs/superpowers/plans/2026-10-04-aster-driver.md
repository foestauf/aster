# Aster Driver and POSIX Builtins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four contract builtins to both compilers (PR A), then ship `packages/asterc-self/asterc.aster`: a
complete `check`/`build`/`run` compiler written in Aster that matches stage 0 and compiles itself (PR B).

**Architecture:** Each builtin is typed by hand as a `Result`, lowered through one new `sys` IR instruction that fills an
ok flag, a value and an error, and emitted as a `bool`-returning runtime call. The driver is four small Aster modules
(`runtime.aster` generated, `diag.aster`, `driver.aster`, `asterc.aster`) on top of the existing loader, checker,
lowering and emitter.

**Tech Stack:** TypeScript (stage 0, vitest, pnpm), Aster, C11 runtime with POSIX (`mkdtemp`, `posix_spawnp`), gcc 13.

**Spec:** `docs/superpowers/specs/2026-10-04-aster-driver-design.md`. The contract it builds on is
`docs/superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md` (§4, §6). Read both before starting a task.

## Global Constraints

- Linux x86_64, gcc 13 invoked as `cc`, Node ≥ 24. C flags `-std=c11 -O2 -Wall` (tests add `-Werror`).
- Frozen baseline (contract §6.1): no existing golden `expect-*` directive, parity fixture or TS unit test may change.
  Tests are only added.
- C emitted by `emit.aster` must equal stage 0's byte for byte, with no normalisation (contract §6.2). A behaviour that
  can't be mirrored is fixed in stage 0 in its own commit.
- Exactly four new builtins: `write_file`, `make_temp_dir`, `remove_path`, `run_process`. No others.
- Exit codes: 0 ok, 1 compile error, 2 usage, 3 internal. Compiler panics stay `panic: …`/101 (spec §6).
- Commits use conventional-commit prefixes (commitlint runs in a husky hook) and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FpzzMjPkrLERmoHMVp5kyD
  ```
- Before a task is done, run `pnpm build && pnpm test && pnpm lint && pnpm typecheck`. Tests import `src/` directly,
  but the CLI uses `dist/`.
- Aster has a flat namespace across imports, no global constants, no closures and no maps. Follow the existing
  `packages/asterc-self/*.aster` style: a comment above each function, `snake_case`, a module-specific prefix.

## Review Focus

1. **Output ordering when the compiler streams through `run_process`.** `cc`'s stderr and the program's stdout must not
   be reordered against the compiler's own buffered output. Task 3 tests `print`/child/`print` ordering, and Task 9
   tests that `cc` stderr comes before `internal compiler error`.
2. **Cleanup on every failure path.** A failing `cc`, a failing `write_file`, or a program that exits non-zero or is
   signalled must still leave `$TMPDIR` empty. Task 9 checks an empty private `TMPDIR` after each.
3. **Non-ASCII diagnostics.** Columns and carets count UTF-16 units, astral characters count 2, and tabs are kept in the
   padding. Task 7 adds `non_ascii_column.aster` with both, plus a tab.
4. **Large stdout.** `--emit=c` for the compiler's own closure is about 1 MB, printed in one `print`. Task 8 compares it
   byte for byte, and `join` must not be quadratic.
5. **Paths spelled oddly.** Relative, absolute, `./`, `..` and a root in another directory affect diagnostics and
   `default_output`. Task 7 and Task 9 test each spelling against S0.

---

# PR A: the four builtins (branch `feat/sys-builtins`, already created, spec committed)

### Task 1: Stage 0 checker types the four builtins

**Files:**
- Modify: `packages/asterc/src/check/types.ts` (`BuiltinName`)
- Modify: `packages/asterc/src/check/builtins.ts` (`BUILTIN_SIGNATURES`)
- Modify: `packages/asterc/src/check/checker.ts:1342-1343` (hand-typed return)
- Test: `packages/asterc/src/check/checker.test.ts`
- Create: `tests/programs/errors/sys_builtin_errors.aster`

**Interfaces:**
- Produces: `BuiltinName` includes `'write_file' | 'make_temp_dir' | 'remove_path' | 'run_process'`. A typed
  `{ kind: 'builtin', builtin, type }` node, where `type` is `Result[string, string]` for `make_temp_dir` and
  `Result[int, string]` for the others.

- [ ] **Step 1: Write failing tests.** In `checker.test.ts`, follow the existing `read_file` test (find it with
  `grep -n read_file packages/asterc/src/check/checker.test.ts`). Add one test that checks this program without
  diagnostics and asserts each call's type renders as stated:

```aster
fn main(): int {
    let a: Result[int, string] = write_file("p", "x");
    let b: Result[string, string] = make_temp_dir("t-");
    let c: Result[int, string] = remove_path("p");
    let d: Result[int, string] = run_process(["true"]);
    return 0;
}
```

  Add a second test that expects these diagnostics from the error golden below.

- [ ] **Step 2: Write the error golden** `tests/programs/errors/sys_builtin_errors.aster`. Each `expect-error` line
  is written from what the checker actually reports. Run `pnpm test tests/golden.test.ts` after implementing and copy
  the real `line:col message` text, then confirm each one is the intended error. It covers:

```aster
fn main(): int {
    let a: Result[int, string] = write_file("p", 1);       // wrong second argument type
    let b: int = make_temp_dir("t-");                      // Result used as int
    let c: Result[int, string] = remove_path();            // arity
    let d: Result[int, string] = run_process("true");     // string, not [string]
    let e: Result[string, string] = write_file("p", "x");  // wrong Result instance
    return 0;
}
```

- [ ] **Step 3: Run and see it fail.** `pnpm vitest run packages/asterc/src/check/checker.test.ts` should report
  undefined functions.
- [ ] **Step 4: Implement.**
  - Add the four names to `BuiltinName`.
  - Add the signatures, with `VOID` returns commented like `read_file`'s: `run_process: { params: [arrayOf(STRING)] }`.
    Find the array type constructor in `packages/asterc/src/types/type.ts`.
  - Replace the ternary at `checker.ts:1342` with a helper:

```ts
/** read_file and the four POSIX builtins return a Result the checker builds by hand. */
function builtinReturnType(ctx: Ctx, builtin: SignatureBuiltin, sig: Signature): Type {
  const result = (ok: Type) => instantiate(ctx, ctx.templates.get(RESULT)!, [ok, STRING]);
  switch (builtin) {
    case 'read_file':
    case 'make_temp_dir':
      return result(STRING);
    case 'write_file':
    case 'remove_path':
    case 'run_process':
      return result(INT);
    default:
      return sig.returnType;
  }
}
```

  Check every other `switch` on `BuiltinName` or `IrBuiltin` (`grep -rn "'read_stdin'" packages/asterc/src`) and
  make TypeScript exhaustiveness pass. Lowering throws for the four for now; Task 2 replaces that.
- [ ] **Step 5: Run.** `pnpm vitest run packages/asterc/src/check tests/golden.test.ts`. The golden's errors must match.
  `pnpm typecheck`.
- [ ] **Step 6: Commit.** `feat(check): type write_file, make_temp_dir, remove_path and run_process`

### Task 2: Stage 0 IR, lowering and IR validation

**Files:**
- Modify: `packages/asterc/src/ir/ir.ts`, `packages/asterc/src/ir/lower.ts`, `packages/asterc/src/ir/print.ts`
- Modify: `tests/ir_validate.ts`
- Test: `packages/asterc/src/ir/lower.test.ts`

**Interfaces:**
- Consumes: Task 1's typed `builtin` nodes.
- Produces:

```ts
export type SysBuiltin = 'write_file' | 'make_temp_dir' | 'remove_path' | 'run_process';
/** Calls a fallible runtime builtin. Sets `ok`; sets `value` when ok, else `err` to the error message. */
| { kind: 'sys'; builtin: SysBuiltin; ok: number; value: number; err: number; args: Operand[] }
```

  Printed as `%<ok>, %<value>, %<err> = <builtin> <op>, <op>`, with operands comma-separated and printed by the same
  `operand()` helper `read_file` uses.

- [ ] **Step 1: Failing test.** In `lower.test.ts`, next to the `read_file` lowering test, add one that lowers
  `fn main(): int { let r: Result[int, string] = write_file("p", "x"); return 0; }` and asserts the exact printed IR
  (`printIr`). Write the expectation by hand from the lowering below:
  - locals in the order `ok:bool`, `value:int`, `err:string`, `dst:Result…`
  - instruction `%a, %b, %c = write_file "p"-operand, "x"-operand`
  - `br` to `sys_ok.N`/`sys_err.N`, `enum_new` Ok(value) / Err(err), `jmp sys_end.N`

  Copy the label spelling from the `read_file` test's `read_ok` output. Add a second test for `make_temp_dir`, whose
  `value` is a `string`.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement.** In `lower.ts`'s `'builtin'` case, after the `read_file` line:

```ts
if (isSysBuiltin(e.builtin)) return lowerSys(st, e.builtin, args, e.type as Extract<Type, { kind: 'enum' }>);
```

```ts
/** A POSIX builtin: the runtime fills an ok flag, a value and an error, then each outcome builds its Result variant. */
function lowerSys(st: FnState, builtin: SysBuiltin, args: Operand[], resultType: Extract<Type, { kind: 'enum' }>): Operand {
  const ok = newTemp(st, irType(BOOL));
  const value = newTemp(st, irType(builtin === 'make_temp_dir' ? STRING : INT));
  const err = newTemp(st, irType(STRING));
  const dst = newTemp(st, irType(resultType));
  emit(st, { kind: 'sys', builtin, ok, value, err, args });
  const okLabel = newLabel(st, 'sys_ok');
  const errLabel = newLabel(st, 'sys_err');
  const endLabel = newLabel(st, 'sys_end');
  terminate(st, { kind: 'br', cond: { kind: 'local', id: ok }, then: okLabel, else: errLabel });
  for (const [label, variant, tag, payload] of [[okLabel, 'Ok', 0, value], [errLabel, 'Err', 1, err]] as const) {
    startBlock(st, label);
    emit(st, { kind: 'enum_new', dst, enum: resultType.name, variant, tag, args: [{ kind: 'local', id: payload }] });
    terminate(st, { kind: 'jmp', target: endLabel });
  }
  startBlock(st, endLabel);
  return { kind: 'local', id: dst };
}
```

  Export `isSysBuiltin(name): name is SysBuiltin` from `ir.ts`. In `irBuiltin`, throw `internal: <name> is lowered to
  a sys instruction` for the four, as for `read_file`. In `print.ts`:
  `` case 'sys': return `%${i.ok}, %${i.value}, %${i.err} = ${i.builtin} ${i.args.map(operand).join(', ')}`; ``
  In `tests/ir_validate.ts`, check:
  - `ok` is `bool` and `err` is `string`
  - `value` is `string` for `make_temp_dir`, else `int`
  - the arity and argument types per builtin: `run_process`'s argument is an array of string

  Look at how `ir_validate.ts` names array types.
- [ ] **Step 4: Run** `pnpm vitest run packages/asterc/src/ir tests/ir_validate.test.ts`. It should pass.
- [ ] **Step 5: Commit.** `feat(ir): lower the POSIX builtins to a sys instruction`

### Task 3: Stage 0 runtime, C emission and goldens

**Files:**
- Modify: `packages/asterc/runtime/aster_rt.h`, `packages/asterc/runtime/aster_rt.c`
- Modify: `packages/asterc/src/codegen/c/emit.ts`
- Test: `packages/asterc/src/codegen/c/emit.test.ts`
- Create: `tests/programs/io/files.aster`, `tests/programs/io/files_errors.aster`, `tests/programs/io/process.aster`

**Interfaces:**
- Consumes: Task 2's `sys` instruction.
- Produces: the C call `<ok> = aster_rt_<builtin>(<args…>, &<value>, &<err>);` and these runtime functions:

```c
bool aster_rt_write_file(aster_string path, aster_string contents, int64_t *value, aster_string *err);
bool aster_rt_make_temp_dir(aster_string prefix, aster_string *value, aster_string *err);
bool aster_rt_remove_path(aster_string path, int64_t *value, aster_string *err);
bool aster_rt_run_process(aster_array argv, int64_t *value, aster_string *err);
```

- [ ] **Step 1: Write the goldens.** They fail now because the C doesn't exist yet. Golden programs run with
  cwd = their own directory, under the real `$TMPDIR`. They must clean up after themselves and never print a random
  temp name.

`tests/programs/io/files.aster`:

```aster
// expect-stdout:
// made
// wrote 11
// read hello world
// removed file
// removed dir
// gone
fn main(): int {
    let dir: string = match make_temp_dir("aster-files-") {
        Result::Ok(d) => d,
        Result::Err(e) => panic(e),
    };
    print("made");
    let path: string = dir + "/a.txt";
    match write_file(path, "hello world") {
        Result::Ok(n) => print("wrote " + int_to_string(n)),
        Result::Err(e) => panic(e),
    }
    match read_file(path) {
        Result::Ok(text) => print("read " + text),
        Result::Err(e) => panic(e),
    }
    match remove_path(path) {
        Result::Ok(_) => print("removed file"),
        Result::Err(e) => panic(e),
    }
    match remove_path(dir) {
        Result::Ok(_) => print("removed dir"),
        Result::Err(e) => panic(e),
    }
    match remove_path(dir) {
        Result::Ok(_) => print("still there"),
        Result::Err(e) => {
            if ends_with(e, ": No such file or directory") {
                print("gone");
            } else {
                print(e);
            }
        }
    }
    return 0;
}

fn ends_with(s: string, suffix: string): bool {
    return len(s) >= len(suffix) && substring(s, len(s) - len(suffix), len(s)) == suffix;
}
```

`tests/programs/io/files_errors.aster` (cwd is `tests/programs/io`, and `fixtures/` exists there and is non-empty):

```aster
// expect-stdout:
// fixtures/missing/a.txt: No such file or directory
// fixtures/a: invalid path
// fixtures/a: invalid path
// fixtures: Directory not empty
// fixtures/missing.txt: No such file or directory
// true
fn show(r: Result[int, string]) {
    match r {
        Result::Ok(n) => print("ok " + int_to_string(n)),
        Result::Err(e) => print(e),
    }
}

fn main(): int {
    show(write_file("fixtures/missing/a.txt", "x"));
    show(write_file("fixtures/a\0b", "x"));
    show(remove_path("fixtures/a\0b"));
    show(remove_path("fixtures"));
    show(remove_path("fixtures/missing.txt"));
    match make_temp_dir("x\0y") {
        Result::Ok(_) => print("made"),
        Result::Err(e) => print(substring(e, len(e) - len("x: invalid path"), len(e)) == "x: invalid path"),
    }
    return 0;
}
```

  The last case can't print the `$TMPDIR` prefix. It prints a `bool`, so replace its expected line with `true`. Check
  that `strerror(ENOTEMPTY)` on glibc reads `Directory not empty`. Make the expected text match glibc exactly.

`tests/programs/io/process.aster`:

```aster
// expect-stdout:
// a
// b
// c
// status 0
// status 3
// status 137
// no-such-command-aster: No such file or directory
// empty argv
fn show(r: Result[int, string]) {
    match r {
        Result::Ok(n) => print("status " + int_to_string(n)),
        Result::Err(e) => print(e),
    }
}

fn main(): int {
    print("a");
    let _r: Result[int, string] = run_process(["echo", "b"]);
    print("c");
    show(run_process(["true"]));
    show(run_process(["sh", "-c", "exit 3"]));
    show(run_process(["sh", "-c", "kill -9 $$"]));
    show(run_process(["no-such-command-aster"]));
    let none: [string] = [];
    show(run_process(none));
    return 0;
}
```

  If Aster rejects `let _r` or an unused binding, use `match … { _ => {} }`. Copy the idiom from existing goldens.

- [ ] **Step 2: Failing emit unit test.** In `emit.test.ts`, next to the `read_file` emit test, assert that
  `write_file("p", "x")` emits `l<ok> = aster_rt_write_file(<p>, <x>, &l<value>, &l<err>);`, with the mangled local
  names as the existing test spells them.
- [ ] **Step 3: Run** `pnpm vitest run packages/asterc/src/codegen tests/golden.test.ts -t "files|process"` and see
  it fail.
- [ ] **Step 4: Emit.** In `emit.ts` beside `case 'read_file'`:

```ts
case 'sys':
  return `${mangleLocal(fn.locals[instr.ok])} = aster_rt_${instr.builtin}(${[...instr.args.map(op), `&${mangleLocal(fn.locals[instr.value])}`, `&${mangleLocal(fn.locals[instr.err])}`].join(', ')});`;
```

- [ ] **Step 5: Runtime.** Add the prototypes to `aster_rt.h` after `aster_rt_read_file`. In `aster_rt.c`:
  - Put `#define _POSIX_C_SOURCE 200809L` as the very first line, before every `#include`.
  - Add `#include <spawn.h>`, `<sys/stat.h>`, `<sys/types.h>`, `<sys/wait.h>` and `<unistd.h>`, plus
    `extern char **environ;`.
  - Implement the functions below, reusing `path_error` and `io_reason`. Make `cstr_or_error` a shared helper:
    `read_file` already does the NUL check and copy inline, so refactor it to use the helper with identical
    behaviour.

```c
/* Copies `s` into a NUL-terminated buffer, or reports "<s up to the NUL>: invalid path" and returns NULL. */
static char *cstr_or_error(aster_string s, aster_string *err) {
    const char *nul = s.len > 0 ? memchr(s.ptr, '\0', (size_t)s.len) : NULL;
    if (nul != NULL) {
        *err = path_error(s, (int64_t)(nul - s.ptr), "invalid path");
        return NULL;
    }
    char *c = alloc_bytes(s.len + 1);
    if (s.len > 0) memcpy(c, s.ptr, (size_t)s.len);
    c[s.len] = '\0';
    return c;
}

bool aster_rt_write_file(aster_string path, aster_string contents, int64_t *value, aster_string *err) {
    char *cpath = cstr_or_error(path, err);
    if (cpath == NULL) return false;
    errno = 0;
    FILE *f = fopen(cpath, "wb");
    int e = errno;
    free(cpath);
    if (f == NULL) {
        *err = path_error(path, path.len, io_reason(e));
        return false;
    }
    size_t n = contents.len > 0 ? fwrite(contents.ptr, 1, (size_t)contents.len, f) : 0;
    e = errno;
    if (fclose(f) != 0 && (int64_t)n == contents.len) e = errno;
    else if ((int64_t)n == contents.len) e = 0;
    if (e != 0 || (int64_t)n != contents.len) {
        *err = path_error(path, path.len, io_reason(e));
        return false;
    }
    *value = contents.len;
    return true;
}
```

  For `make_temp_dir`, take `getenv("TMPDIR")`, using `/tmp` if it is NULL or empty. Build the template
  `<dir>/<prefix>XXXXXX` as an `aster_string`, NUL-check the prefix with `cstr_or_error` (so the error reads
  `<template up to the NUL>: invalid path`), then call `mkdtemp`. On failure, `path_error(template, …, io_reason(errno))`.
  On success, `*value` is the template as filled in.

  `remove_path`: `cstr_or_error`, then `remove`. On failure `path_error`. On success `*value = 0`.

  `run_process`:
  - An empty `argv` gives `*err` = `"empty argv"` as an `aster_string`.
  - Otherwise, build a `char *[len+1]` with `cstr_or_error` on each element. If one fails, free and return false.
  - Call `fflush(NULL)`, then `posix_spawnp(&pid, argv[0], NULL, NULL, cargv, environ)`. A non-zero return `rc` gives
    `path_error(argv0, argv0.len, io_reason(rc))`.
  - Loop `waitpid(pid, &status, 0)` while it returns -1 with `errno == EINTR`.
  - `WIFEXITED` gives `WEXITSTATUS`. `WIFSIGNALED` gives `128 + WTERMSIG`.
  - Free the copies.

  `io_reason` already maps errno to `strerror` text. Check it accepts an arbitrary code.
- [ ] **Step 6: Run.** `pnpm vitest run packages/asterc/src/codegen tests/golden.test.ts` must pass, with goldens built
  using `-Werror`. Fix the expected lines only where glibc's real text differs from the guess above, and say so in the
  commit body. Run the full `pnpm test`: `emit_aster`/`ir_aster`/`typed_aster` will now FAIL for the new goldens. That
  is expected until Task 4. Record which tests fail.
- [ ] **Step 7: Commit.** `feat(runtime): write_file, make_temp_dir, remove_path and run_process`

### Task 4: The self-hosted compiler learns the four builtins

**Files:**
- Modify: `packages/asterc-self/checker.aster` (signature table ~line 121, the hand-typed return ~line 2643, builtin name lists)
- Modify: `packages/asterc-self/ir.aster` (`IrInstr::Sys`), `ir_print.aster`, `lower.aster` (~line 639, ~line 890), `emit.aster` (~line 387)
- Modify: `packages/asterc-self/typed_dump.aster`, only if it lists builtins by name

**Interfaces:**
- Consumes: Task 1–3 behaviour as the oracle.
- Produces: `IrInstr::Sys(string, int, int, int, [IrOperand])`, the fields being builtin, ok, value, err and args.
  `fn lower_sys(st: IrState, name: string, args: [IrOperand], ty: Type): IrOperand`.

- [ ] **Step 1: Run the parity suites and see them fail** on `io/files.aster`, `io/files_errors.aster`,
  `io/process.aster` and `errors/sys_builtin_errors.aster`:
  `pnpm vitest run tests/check_aster.test.ts tests/typed_aster.test.ts tests/ir_aster.test.ts tests/emit_aster.test.ts`.
- [ ] **Step 2: Checker.**
  - Add the four `Signature` entries after `read_file`'s, in the same order as `BUILTIN_SIGNATURES`. Order matters if
    the table order is observable; mirror TS. `run_process`'s param is `Type::Array([Type::Str])`, whatever spelling
    `checker.aster` uses for array types.
  - Replace `if name == "read_file" { … }` with a `builtin_result_ok(name): Option[Type]` that returns `Type::Str` for
    `read_file`/`make_temp_dir` and `Type::Int` for the other three, and `None` otherwise. Then instantiate
    `Result[ok, Str]`.
  - Add the names wherever `checker.aster` lists builtin names (`grep -n '"read_stdin"' packages/asterc-self/*.aster`).
- [ ] **Step 3: IR and print.** Add `Sys(string, int, int, int, [IrOperand])` to `IrInstr`, and update the comment block
  listing variants. `ir_print.aster`:

```aster
IrInstr::Sys(name, ok, value, err, args) => "%" + int_to_string(ok) + ", %" + int_to_string(value) + ", %" + int_to_string(err) + " = " + name + " " + ir_join_operands(args),
```

  Use whatever helper `ir_print.aster` already uses to join call operands with `, `.
- [ ] **Step 4: Lowering.** In `lower_builtin`, after the `read_file` case:
  `if is_sys_builtin(name) { return Option::Some(lower_sys(st, name, a, ty)); }`.

```aster
// The four POSIX builtins: the runtime fills an ok flag, a value and an error, then each outcome builds its Result
// variant (lowerSys).
fn lower_sys(st: IrState, name: string, args: [IrOperand], ty: Type): IrOperand {
    let result_enum: string = match ty {
        Type::Enum(n) => n,
        _ => panic("internal: " + name + " without a Result type"),
    };
    let ok: int = ir_new_temp(st, Type::Bool);
    var value_ty: Type = Type::Int;
    if name == "make_temp_dir" {
        value_ty = Type::Str;
    }
    let value: int = ir_new_temp(st, value_ty);
    let err: int = ir_new_temp(st, Type::Str);
    let dst: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, IrInstr::Sys(name, ok, value, err, args));
    let ok_label: string = ir_new_label(st, "sys_ok");
    let err_label: string = ir_new_label(st, "sys_err");
    let end_label: string = ir_new_label(st, "sys_end");
    ir_terminate(st, IrTerm::Br(ir_ref(ok), ok_label, err_label));
    ir_start_block(st, ok_label);
    ir_emit(st, IrInstr::EnumNew(dst, result_enum, "Ok", 0, [ir_ref(value)]));
    ir_terminate(st, IrTerm::Jmp(end_label));
    ir_start_block(st, err_label);
    ir_emit(st, IrInstr::EnumNew(dst, result_enum, "Err", 1, [ir_ref(err)]));
    ir_terminate(st, IrTerm::Jmp(end_label));
    ir_start_block(st, end_label);
    return ir_ref(dst);
}

fn is_sys_builtin(name: string): bool {
    return name == "write_file" || name == "make_temp_dir" || name == "remove_path" || name == "run_process";
}
```

  Put `is_sys_builtin` in `ir.aster` if emit/print need it too.
- [ ] **Step 5: Emission.** In `emit.aster` beside `IrInstr::ReadFile`:

```aster
IrInstr::Sys(name, ok, value, err, args) => c_mangle_local(f.locals[ok]) + " = aster_rt_" + name + "(" + c_sys_args(f, args, value, err) + ");",
```

  `c_sys_args` joins `c_operand(f, a)` for each argument, then `&` + the mangled `value` and `err` locals, separated by
  `, `.
- [ ] **Step 6: Run** the four parity suites plus `pnpm test`. Everything must pass, E1 included.
- [ ] **Step 7: Commit.** `feat(self): the self-hosted compiler checks, lowers and emits the POSIX builtins`

### Task 5: PR A wrap-up

- [ ] **Step 1:** Add a short "Found while adding the POSIX builtins" section to `docs/self-host/friction.md`, only if
  something real was found. Update the README's builtin list (`grep -n read_file README.md`) with the four signatures.
- [ ] **Step 2:** Run `pnpm build && pnpm test && pnpm lint && pnpm typecheck`. All must pass.
- [ ] **Step 3:** Commit `docs: the POSIX builtins in the README`, push `feat/sys-builtins`, and open PR A against
  `main`. Title: `feat: write_file, make_temp_dir, remove_path and run_process (#19, part 1)`. The body says
  "Part 1 of #19" and does not close the issue.

---

# PR B: the driver (branch `feat/asterc-driver`, created from `feat/sys-builtins`; the PR's base is `feat/sys-builtins`)

### Task 6: `pnpm gen:runtime` and `runtime.aster`

**Files:**
- Create: `scripts/gen-runtime.ts`, `packages/asterc-self/runtime.aster` (generated)
- Modify: `package.json` (script `"gen:runtime": "node scripts/gen-runtime.ts"`; Node 24 runs `.ts` with type stripping. Check that `node scripts/gen-runtime.ts` works, else use `node --experimental-strip-types`.)
- Test: `tests/runtime_aster.test.ts`

**Interfaces:**
- Produces: `fn runtime_h(): string`, `fn runtime_c(): string` in `runtime.aster` (marked `// expect-library`).
  `scripts/gen-runtime.ts` exports `renderRuntimeAster(h: string, c: string): string` and, when run directly, writes the
  file.

- [ ] **Step 1: Failing test** `tests/runtime_aster.test.ts`:
  1. `readFileSync('packages/asterc-self/runtime.aster')` equals `renderRuntimeAster(<h>, <c>)`. The message says to
     run `pnpm gen:runtime`.
  2. Compile and run a tiny program that imports `runtime.aster` and prints `runtime_h()` then `runtime_c()`, with
     `print` and the trailing newline accounted for. Build it with stage 0 (`compileToC` + `buildExecutable`, as
     `emit_aster.test.ts` does). Its stdout must equal the two files' bytes. Put the program in the test's temp dir and
     import the absolute path of `runtime.aster`.
- [ ] **Step 2: Implement** `renderRuntimeAster`.
  - Header: `// expect-library`, then `// Generated by pnpm gen:runtime from packages/asterc/runtime/; do not edit.`
  - Then each function returns a single string literal on one line.
  - Escape `\` → `\\`, `"` → `\"`, newline → `\n`, tab → `\t`. Check that the lexer's `ESCAPES` map in
    `packages/asterc/src/lexer/lexer.ts` supports each escape used.
  - Any other byte outside 0x20..0x7e is an error: the runtime is ASCII, so throw if not.
- [ ] **Step 3:** Run `pnpm gen:runtime`, then the test. It should pass.
- [ ] **Step 4: Commit.** `feat(self): runtime.aster embeds the C runtime, generated by pnpm gen:runtime`

### Task 7: `asterc.aster` argument parsing, `check` and `diag.aster`

**Files:**
- Create: `packages/asterc-self/diag.aster`, `packages/asterc-self/asterc.aster`
- Create: `tests/programs/errors/non_ascii_column.aster`
- Test: `tests/asterc_self.test.ts`

**Interfaces:**
- Consumes: `load_program(path, src): Loaded` (`loader.aster`), `check_program(items, root_end): Checked`,
  `sort_diags(diags): [Diag]` (`report.aster`), and `SourceFile { path, src, base, bom }`. Check the exact fields in
  `loader.aster`.
- Produces:
  - `fn format_diag(files: [SourceFile], d: Diag): string` (`diag.aster`)
  - `struct CliArgs { command: string, file: string, out: Option[string], emit_c: bool, program_args: [string] }`
  - `fn parse_cli(args: [string]): Result[CliArgs, string]`
  - `fn usage_text(): string`
  - `fn default_output(file: string): string`
  - `fn main(args: [string]): int` (`asterc.aster`)

- [ ] **Step 1: Write the error golden** `tests/programs/errors/non_ascii_column.aster`. One line has a tab, an `é`
  (2 bytes, 1 UTF-16 unit) and an astral `😀` (4 bytes, 2 UTF-16 units) inside a string, before an error on the same
  line, for example `\tlet s: string = "é😀"; let x: int = s;`. Its `expect-error` column is in UTF-16 units: get it
  from `pnpm aster check` and verify it by hand.
- [ ] **Step 2: Test harness and failing tests** in `tests/asterc_self.test.ts`:

```ts
// Helpers (sketch; implement fully):
// - workDir: a private dir; tmpDir = join(workDir, 'tmp'), passed as TMPDIR to every spawned process.
// - s1: built in beforeAll from packages/asterc-self/asterc.aster with compileToC + buildExecutable(…, ['-Werror']),
//   with a 60 s hook timeout.
// - runS1(argv, opts?: { cwd?, input?, env? }) -> { stdout, stderr, status }
//   spawnSync(s1, argv, { cwd: opts.cwd ?? REPO_ROOT, env: { ...process.env, TMPDIR: tmpDir, LC_ALL: 'C', ...opts.env }, input, encoding: 'utf8', maxBuffer: 256 MB, timeout: 60_000 })
// - runS0(argv, opts?) -> same shape: run `node packages/asterc/dist/cli/bin.js` the same way (so `run` uses inherited
//   stdio, like S1). This needs `pnpm build` first: the test asserts dist exists with a clear message.
// - afterEach: expect(readdirSync(tmpDir)).toEqual([]).
// - S0_USAGE_TO_S1: S0 stderr with '--emit=tokens|ast|ir|c' replaced by '--emit=c'.
```

  Tests in this task:
  - **Usage errors.** Every argv from `cli.test.ts`'s list (copy it), plus `['run', 'a.aster', '--emit=c']` and
    `['build', 'a', '--', 'x']`. `runS1` must equal `runS0` after `S0_USAGE_TO_S1`.
  - **Unreadable file.** `check missing.aster` gives the same output under both, exit 2.
  - **Check, accepted.** Every file in `acceptedCorpus()` (`tests/corpus.ts`) gives `check X` → `{ '', '', 0 }`.
  - **Check, errors.** Every golden under `tests/programs/` whose directives include `expect-error` gives S1 `check`
    equal to S0 `check` (cwd = repo root, path spelled `tests/programs/...`). `non_ascii_column.aster` is included.
  - **Path spellings.** For `tests/programs/modules/<a module golden with an import>` and for `errors/import_missing.aster`,
    S1 equals S0 when the root is spelled relative, absolute (`join(REPO_ROOT, …)`), `./tests/programs/…`, and
    `tests/programs/modules/../modules/…`, and also from `cwd: tests/programs/modules` with a bare file name. Pick
    real files with `ls tests/programs/modules`. Cycle, diamond and root-main cases come from the `errors/import_*`
    and `modules/` goldens. Name the specific ones in the test.
- [ ] **Step 3:** Run `pnpm build && pnpm vitest run tests/asterc_self.test.ts`. It fails because there's no
  `asterc.aster`.
- [ ] **Step 4: `diag.aster`.** Port `formatDiagnostic` as spec §4 describes:

```aster
// expect-library
// Human diagnostics, as packages/asterc/src/diagnostics/diagnostic.ts's formatDiagnostic prints them. Spans are byte
// offsets; lines and columns count UTF-16 code units, as the TypeScript compiler's strings do.

import "loader.aster";

// UTF-16 code units in src[from..to): one per UTF-8 lead byte, two for a 4-byte sequence's lead.
fn utf16_len(src: string, from: int, to: int): int {
    var n: int = 0;
    for i in from..to {
        let b: int = byte_at(src, i);
        if b < 128 || b >= 192 {
            n += 1;
            if b >= 240 {
                n += 1;
            }
        }
    }
    return n;
}

fn format_diag(files: [SourceFile], d: Diag): string {
    var f: SourceFile = files[0];
    for candidate in files {
        if candidate.base <= d.start {
            f = candidate;
        }
    }
    // Local byte offsets into f.src. Check whether SourceFile.src includes a BOM that print_diags adds back via f.bom;
    // formatDiagnostic's text has no BOM, so offsets here exclude it.
    let start: int = d.start - f.base;
    let end: int = min(d.end - f.base, len(f.src));
    var line_start: int = 0;
    var line: int = 1;
    for i in 0..start {
        if byte_at(f.src, i) == 10 {
            line += 1;
            line_start = i + 1;
        }
    }
    var line_end: int = line_start;
    while line_end < len(f.src) && byte_at(f.src, line_end) != 10 {
        line_end += 1;
    }
    var text_end: int = line_end;
    if text_end > line_start && byte_at(f.src, text_end - 1) == 13 {
        text_end -= 1;
    }
    let text: string = substring(f.src, line_start, text_end);
    let col: int = 1 + utf16_len(f.src, line_start, start);
    var padding: string = "";
    for i in line_start..start {
        let b: int = byte_at(f.src, i);
        if b == 9 {
            padding = padding + "\t";
        } else if b < 128 || b >= 192 {
            padding = padding + " ";
            if b >= 240 {
                padding = padding + " ";
            }
        }
    }
    let width: int = max(1, min(utf16_len(f.src, start, end), utf16_len(text, 0, len(text)) - (col - 1)));
    var carets: string = "";
    for _ in 0..width {
        carets = carets + "^";
    }
    return f.path + ":" + int_to_string(line) + ":" + int_to_string(col) + ": error: " + d.message + "\n  " + text + "\n  " + padding + carets;
}
```

  Caveats to resolve against the code:
  - **`min`/`max`.** `min` is used in `report.aster`. Check that `max` exists, else write it.
  - **The `\r` edge case.** `lineText` strips `\r` only at the end of the line, which matches. If `start` falls after
    the stripped `\r`, `text.length - (col-1)` can go to 0 or negative, and `max(1, …)` covers it as in TS.
  - **Spans past the end of a line.** TS `d.span.end - d.span.start` counts UTF-16 units over the whole span, which can
    cross lines. `utf16_len(f.src, start, end)` matches that.
  - **Spans at or past EOF.** A span may start at EOF, which is `len(src)` (`nextBase` leaves room for it). The loops
    above handle it, giving an empty line text at the end.
- [ ] **Step 5: `asterc.aster`.** Port `parseArgs` line by line. Keep the precedence exactly.

```aster
// The Aster compiler: `check`, `build` and `run`, as packages/asterc/src/cli/cli.ts provides them, minus the debug emit
// stages (self-hosting contract §4.1).

import "loader.aster";
import "checker.aster";
import "report.aster";
import "diag.aster";
import "lower.aster";
import "emit.aster";
import "driver.aster";   // added in Task 9; omit until then

struct CliArgs { command: string, file: string, out: Option[string], emit_c: bool, program_args: [string] }

// cli.ts's USAGE with the emit stages narrowed to c, without its final newline (eprint adds it).
fn usage_text(): string {
    return "usage:\n  aster check <file.aster>\n  aster build <file.aster> [-o <out>] [--emit=c]\n  aster run <file.aster> [-- <args>...]";
}

fn starts_with(s: string, prefix: string): bool {
    return len(s) >= len(prefix) && substring(s, 0, len(prefix)) == prefix;
}

fn parse_cli(args: [string]): Result[CliArgs, string] {
    if len(args) == 0 {
        return Result::Err("missing command");
    }
    let command: string = args[0];
    if command != "check" && command != "build" && command != "run" {
        return Result::Err("unknown command '" + command + "'");
    }
    var file: Option[string] = Option::None;
    var out: Option[string] = Option::None;
    var emit_c: bool = false;
    let program_args: [string] = [];
    var i: int = 1;
    while i < len(args) {
        let arg: string = args[i];
        if arg == "--" {
            if command != "run" {
                return Result::Err("'--' is only valid with 'run'");
            }
            for k in i + 1..len(args) {
                push(program_args, args[k]);
            }
            break;
        } else if arg == "-o" || starts_with(arg, "--emit=") {
            if command != "build" {
                if arg == "-o" {
                    return Result::Err("'-o' is only valid with 'build'");
                }
                return Result::Err("'--emit' is only valid with 'build'");
            }
            if arg == "-o" {
                i += 1;
                if i >= len(args) {
                    return Result::Err("'-o' requires a path");
                }
                out = Option::Some(args[i]);
            } else {
                let stage: string = substring(arg, len("--emit="), len(arg));
                if stage != "c" {
                    return Result::Err("unknown emit stage '" + stage + "'");
                }
                emit_c = true;
            }
        } else if starts_with(arg, "-") {
            return Result::Err("unknown option '" + arg + "'");
        } else if file is None ... // set file, or Err("unexpected argument '" + arg + "'")
        i += 1;
    }
    // missing input file, else Ok(CliArgs { … })
}
```

  The `file is None …` line is pseudocode. Write it with `match` or `if let` as the codebase does. Check whether `break`
  exists in Aster (`grep -rn "break;" tests/programs | head`). If it doesn't, use a flag.

  `default_output(file)`:
  - `base` is the text after the last `/`.
  - If `base` ends with `.aster` and stripping it leaves something different from `base`, return the stripped name.
  - Otherwise return `base + ".out"`.
  - Note that `'.aster'` alone strips to `''`, and JS `replace` does the same, so `''` is returned. Mirror that exactly.

  `main` (Task 7 subset): parse, print `error: <reason>` + `\n` + usage via one `eprint`, then return 2. If `read_file`
  fails, `eprint("error: cannot read '" + file + "'")` and return 2. Then load and check. Diagnostics go through
  `sort_diags`, then `eprint(format_diag(files, d))` each, and return 1. Load and check diagnostics are reported
  together, as `runFrontend` does: check whether the TS reports loader diagnostics and stops before checking, and
  mirror `check.aster`'s flow, which already has parity. For `check`, return 0. For `build`/`run`, return 3 with
  `internal compiler error: not implemented` until Tasks 8–9.

  If `--emit=c` needs to be accepted by `check`, it isn't: `'--emit' is only valid with 'build'`.
- [ ] **Step 6:** `pnpm build && pnpm vitest run tests/asterc_self.test.ts` must pass. Also run the full `pnpm test`:
  `asterc.aster` now joins the accepted corpus, so `typed/ir/emit_aster` cover it.
- [ ] **Step 7: Commit.** `feat(self): asterc.aster parses the CLI and checks programs, with human diagnostics`

### Task 8: `--emit=c` and the C oracle

**Files:**
- Modify: `packages/asterc-self/asterc.aster`
- Test: `tests/asterc_self.test.ts`

**Interfaces:**
- Produces: `fn join_lines(lines: [string], from: int, to: int): string`, which joins with `\n` and is built by halves.
  `fn compile_c(loaded: Loaded, checked: Checked): string`.

- [ ] **Step 1: Failing test.** For every `acceptedCorpus()` file, `runS1(['build', join('tests/programs', file),
  '--emit=c'])` equals `{ stdout: emitC(lower(typed)), stderr: '', status: 0 }`. The expected C comes from the corpus
  entry, which is cheaper than spawning S0. Include `../../packages/asterc-self/asterc.aster`, which is in the
  corpus. Add an explicit test that `asterc.aster`'s output is non-empty and over 500 000 bytes, guarding against a
  filtered corpus.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.**

```aster
// Joins lines[from..to) with newlines, by halves so the total copying is O(n log n) rather than quadratic.
fn join_lines(lines: [string], from: int, to: int): string {
    if to - from == 0 {
        return "";
    }
    if to - from == 1 {
        return lines[from];
    }
    let mid: int = from + (to - from) / 2;
    return join_lines(lines, from, mid) + "\n" + join_lines(lines, mid, to);
}
```

  `emit_c` returns lines whose last element is `""`, so `join_lines(lines, 0, len(lines))` equals `emitC`'s text, which
  ends in `\n`. `print` adds a newline, so print `join_lines(lines, 0, len(lines) - 1)`. That is exactly the C, and its
  final `\n` comes from `print`. Verify it with the byte-equality test, not by reasoning.
- [ ] **Step 4:** Run the test. It should pass. Record S1's wall time and peak RSS for `--emit=c` of its own closure:
  `/usr/bin/time -v`, "Maximum resident set size".
- [ ] **Step 5: Commit.** `feat(self): asterc --emit=c prints C byte-identical to stage 0`

### Task 9: `driver.aster`, `build` and `run`

**Files:**
- Create: `packages/asterc-self/driver.aster`
- Modify: `packages/asterc-self/asterc.aster`
- Test programs are written inline into the test's work dir; no new goldens
- Test: `tests/asterc_self.test.ts`

**Interfaces:**
- Consumes: Task 6's `runtime_h()`/`runtime_c()`, PR A's builtins.
- Produces: `fn build_c(c: string, out: string): Result[int, string]`, `fn run_c(c: string, args: [string]): Result[int, string]`.

- [ ] **Step 1: Failing tests.** Each compares `{stdout, stderr, status}` of S1 and S0 and then checks that `tmpDir` is
  empty:
  - `build hello.aster -o <work>/h1` → both 0, and the binary prints `30`. Use `cli.test.ts`'s `HELLO`, written to the
    work dir.
  - `build hello.aster` with `cwd` = a fresh dir containing `hello.aster` → `./hello` exists for both. Also
    `noext.txt` → `noext.txt.out`.
  - `run args.aster -- a 'b c'` → program output identical. Use `tests/programs/io/args.aster`, and pass `-- ` plus its
    `expect-args`.
  - `run stdin.aster` with `input` → identical. Use `tests/programs/io/stdin.aster` and its `expect-stdin`.
  - `run` of a program returning 7 → status 7 under both.
  - `run` of a program that panics → status 101, stderr `panic: …` under both.
  - `run` of `fn f(n: int): int { return f(n + 1) + 1; } fn main(): int { return f(0); }` → 139 under both (SIGSEGV).
    If the optimiser turns it into a loop at `-O2`, make the recursion non-tail, for example with an array push per
    frame, until both give 139.
  - Divergences, S1 only:
    - `ASTER_CC=false` env with `build hello.aster -o x` → status 0.
    - `PATH=<work>/fakecc:` + `process.env.PATH`, where `<work>/fakecc/cc` is `#!/bin/sh\necho 'cc: boom' >&2\nexit 1`
      (chmod 755) → stdout `''`, stderr `cc: boom\ninternal compiler error: C compiler 'cc' failed\n`, status 3, and
      `tmpDir` empty.
    - Out-of-memory panic: `spawnSync('sh', ['-c', 'ulimit -v 65536; exec "$0" build "$1" --emit=c', s1, 'packages/asterc-self/asterc.aster'])`
      → status 101, stderr starts with `panic: out of memory`. Run it 3 times. If it isn't deterministic, delete the
      test and add a friction-log line saying why.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: `driver.aster`:**

```aster
// expect-library
// Builds and runs emitted C (self-hosting contract §4.4): writes the runtime and the program into a fresh temp dir,
// runs cc, and removes everything it created whatever the outcome.

import "runtime.aster";

// Removes `paths` in order, ignoring failures; for cleanup after an error that is already being reported.
fn remove_all(paths: [string]) {
    for p in paths {
        match remove_path(p) {
            _ => {}
        }
    }
}

// Removes `paths` in order and returns the first failure, or `result` if none.
fn remove_then(paths: [string], result: Result[int, string]): Result[int, string] {
    var first: Option[string] = Option::None;
    for p in paths {
        match remove_path(p) {
            Result::Ok(_) => {}
            Result::Err(e) => {
                if let Option::None = first {
                    first = Option::Some(e);
                }
            }
        }
    }
    match result {
        Result::Err(_) => return result,
        Result::Ok(_) => {}
    }
    if let Option::Some(e) = first {
        return Result::Err(e);
    }
    return result;
}

// Compiles `c` with the runtime into an executable at `out`.
fn build_c(c: string, out: string): Result[int, string] {
    let tmp: string = make_temp_dir("aster-cc-")?;
    return build_in(tmp, c, out);
}
```

  `build_in(tmp, c, out)`:
  1. Keep `written: [string]`. For each `(name, text)` in `aster_rt.h`/`runtime_h()`, `aster_rt.c`/`runtime_c()` and
     `program.c`/`c`, call `write_file(tmp + "/" + name, text)`. On success, push the path. On `Err(e)`, call
     `remove_all(written)`, `remove_all([tmp])` and return `Err(e)`.
  2. `run_process(["cc", "-std=c11", "-O2", "-Wall", "-I" + tmp, tmp + "/program.c", tmp + "/aster_rt.c", "-o", out])`.
     `Ok(0)` gives `Ok(0)`. `Ok(n)` gives `Err("C compiler 'cc' failed")`. `Err(e)` gives
     `Err("failed to run C compiler 'cc': " + e)`.
  3. `return remove_then(written + [tmp], result)`. Build the list with `push`, since Aster may not have array `+`.

  `run_c(c, args)`:
  1. `make_temp_dir("aster-run-")?` → `dir`, then `exe = dir + "/program"`.
  2. `build_c(c, exe)`. On `Err`, call `remove_then([dir], Err(e))`, which also removes `exe` first if it exists. To
     keep this simple, try removing `exe` and ignore any failure.
  3. Build `argv = [exe] + args`, then `status = run_process(argv)`. Map `Err(e)` to
     `Err("failed to run program: " + e)`.
  4. `return remove_then([exe, dir], status)`.

  Wire both into `asterc.aster`'s `main`. `build` calls `build_c(c, out ?? default_output(file))`. `run` returns the
  `Ok` status. `Err(msg)` gives `eprint("internal compiler error: " + msg)` and return 3.
- [ ] **Step 4: Run.** `pnpm vitest run tests/asterc_self.test.ts` and the full `pnpm test` must pass.
- [ ] **Step 5: Commit.** `feat(self): asterc builds and runs programs through cc`

### Task 10: S2 hop, contract amendment, docs, PR B

**Files:**
- Test: `tests/asterc_self.test.ts`
- Modify: `docs/superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md` (§4.5 table, one row)
- Modify: `README.md`, `docs/self-host/friction.md`

- [ ] **Step 1: S2 test.** In its own `describe`, `beforeAll` (timeout 120 s) runs
  `runS1(['build', 'packages/asterc-self/asterc.aster', '-o', s2])`, expecting status 0 and empty stderr. Then
  `S2 build packages/asterc-self/asterc.aster --emit=c` equals the corpus entry's `emitC` for `asterc.aster`, with exit
  0. Also run S2 on 3 representative corpus programs (`programs/fib.aster`, `io/files.aster`, `programs/emit.aster`).
- [ ] **Step 2: Run it.** It should pass. Record S1 build-of-self wall time and peak RSS.
- [ ] **Step 3: Contract.** Append this row to the §4.5 table:
  `| A panic inside the compiler | Caught: \`internal compiler error: <stack>\`, exit 3 | \`panic: <message>\`, exit 101 | Aster cannot catch a panic. Failures the driver detects itself still exit 3. Added in #19. |`
- [ ] **Step 4: README.** Add a "Self-hosted compiler" section: how to build S1 (`pnpm aster build
  packages/asterc-self/asterc.aster -o asterc`), the commands, the tested platform (Linux x86_64, WSL2 kernel 6.6,
  gcc 13.3), the measurements, and the limits (§4.5 divergences, symlink aliases). Friction log: a "Found while
  building the driver" section with real findings only.
- [ ] **Step 5:** `pnpm build && pnpm test && pnpm lint && pnpm typecheck` must all pass.
- [ ] **Step 6:** Commit `docs: the self-hosted compiler in the README, contract §4.5 panic row`. Push
  `feat/asterc-driver` and open PR B with base `feat/sys-builtins`, titled
  `feat: asterc.aster, the self-hosted compiler driver (#19, part 2)`. Its body says `Closes #19`.

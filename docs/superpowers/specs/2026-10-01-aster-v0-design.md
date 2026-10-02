# Aster v0 — Design

**Date:** 2026-10-01
**Status:** Approved in brainstorming, pending spec review

## 1. Purpose

Aster is a small, statically typed, compiled language built to learn compiler construction. The bootstrap compiler (`asterc`) is written in TypeScript. Long-term goals, which shape v0 decisions but are not v0 deliverables:

- Native code via an LLVM IR backend.
- A self-hosted compiler written in Aster.

v0 targets C (compiled with the system C compiler) through an internal IR designed so an LLVM IR emitter can later be added as a second printer over the same IR.

### Success criteria

v0 is done when:

1. This program builds to a native executable that prints `30` and exits `0`:
   ```
   fn main(): int {
       let x: int = 10;
       let y: int = 20;
       print(x + y);
       return 0;
   }
   ```
2. The golden test suite covers every language feature in §3, including every builtin and both runtime panics (division/modulo by zero, string index out of bounds).
3. Three "real program" golden tests pass: FizzBuzz, recursive Fibonacci, and a small string tokenizer written in Aster.

### Non-goals for v0

Structs, arrays, pointers, generics, classes, modules/multiple files, GC, async, file or stdin input, `+=`-style compound assignment, `for` loops, hex/binary literals, an LLVM backend, deployment infrastructure.

## 2. Repository layout

```
learn-lang/
  package.json              # pnpm workspace root; scripts: build, test, lint, typecheck
  pnpm-workspace.yaml
  tsconfig.base.json        # strict
  eslint.config.mjs
  commitlint.config.js      # conventional commits, husky hook
  .github/workflows/ci.yml  # Ubuntu, Node 24, gcc: typecheck + lint + test
  packages/
    asterc/
      package.json          # bin: aster
      src/
        lexer/
        parser/
        ast/
        check/
        ir/
        codegen/c/
        diagnostics/
        driver/             # pipeline orchestration, cc invocation
        cli/
      runtime/
        aster_rt.h
        aster_rt.c
  tests/
    programs/               # golden .aster programs, grouped by feature
    golden.test.ts
  docs/
    spec/language.md        # user-facing Aster v0 language reference
    superpowers/specs/      # design docs
```

Tooling: pnpm, TypeScript (strict), vitest, eslint, commitlint + husky. No turbo while there is a single package. No Docker or deployment; it is a CLI.

## 3. Language (v0)

### 3.1 Lexical structure

- Comments: `//` to end of line. No block comments.
- Whitespace is insignificant except as a separator.
- Identifiers: `[A-Za-z_][A-Za-z0-9_]*`, excluding keywords.
- Keywords: `fn let var if else while break continue return true false`.
- Type names `int bool string void` are ordinary identifiers resolved as types in type position. They are not keywords.
- Integer literals: decimal digits only. A literal that does not fit in a signed 64-bit integer is a compile error. A negative number is unary minus applied to a literal. As a special case, `-9223372036854775808` is accepted.
- String literals: `"..."` with escapes `\n \t \\ \" \0`. Any other escape is a compile error. Raw newlines inside a string literal are a compile error.
- Punctuation: `( ) { } , : ; = + - * / % ! < <= > >= == != && ||`.

### 3.2 Types

| Type     | Meaning |
|----------|---------|
| `int`    | 64-bit signed integer. Arithmetic wraps (two's complement) on overflow. |
| `bool`   | `true` / `false`. |
| `string` | Immutable sequence of bytes (UTF-8 by convention). Never freed in v0; memory is reclaimed at process exit. |
| `void`   | Return type only. Not usable as a variable or parameter type. |

There are no implicit conversions.

### 3.3 Grammar

```
program     = { function } EOF ;
function    = "fn" IDENT "(" [ param { "," param } ] ")" [ ":" type ] block ;
param       = IDENT ":" type ;
type        = IDENT ;                       (* int | bool | string | void *)

block       = "{" { statement } "}" ;
statement   = "let" IDENT ":" type "=" expr ";"
            | "var" IDENT ":" type "=" expr ";"
            | IDENT "=" expr ";"
            | ifStmt
            | "while" expr block
            | "break" ";"
            | "continue" ";"
            | "return" [ expr ] ";"
            | block
            | expr ";" ;
ifStmt      = "if" expr block [ "else" ( ifStmt | block ) ] ;

expr        = or ;
or          = and { "||" and } ;
and         = equality { "&&" equality } ;
equality    = comparison { ( "==" | "!=" ) comparison } ;
comparison  = additive { ( "<" | "<=" | ">" | ">=" ) additive } ;
additive    = multiplicative { ( "+" | "-" ) multiplicative } ;
multiplicative = unary { ( "*" | "/" | "%" ) unary } ;
unary       = ( "-" | "!" ) unary | postfix ;
postfix     = primary { "(" [ expr { "," expr } ] ")" } ;
primary     = INT | STRING | "true" | "false" | IDENT
            | "(" expr ")"
            | ifExpr ;
ifExpr      = "if" expr exprBlock "else" ( ifExpr | exprBlock ) ;
exprBlock   = "{" expr "}" ;
```

Notes:
- All binary operators are left-associative. Comparison and equality operators are non-associative: `a < b < c` is a parse error.
- A statement beginning with `if` is always parsed as `ifStmt`. An `if` in expression position (after `=`, as an argument, as an operand, after `return`) is parsed as `ifExpr`.
- Omitting `: type` on a function means `void`.
- Only a plain identifier can be called; calling any other expression is a type error.
- The parser is hand-written: recursive descent for statements, precedence climbing (Pratt) for expressions.

### 3.4 Semantics and type rules

**Functions**
- Functions are top-level and may be declared in any order. Mutual and direct recursion are allowed.
- Function names must be unique and must not collide with builtin names.
- `fn main(): int` with no parameters must exist. Its return value is the process exit code (truncated to the platform's exit-status range by the OS).
- Parameters are immutable.
- A non-`void` function in which any control path can reach the end of the body without `return` is a compile error. A `while true` loop with no `break` counts as non-terminating, and the code after it is unreachable. Every other `while` condition is treated as possibly false. An expression statement that calls `panic` also ends its path.
- `return e;` in a `void` function and `return;` in a non-`void` function are errors. Arguments are checked for count and type.

**Variables**
- `let` declares an immutable binding and `var` a mutable one. An initializer is required and must match the declared type.
- Assignment `x = e;` requires `x` to be a `var` and `e` to have the same type as `x`.
- Redeclaring a name in the same scope is an error. Shadowing a name from an enclosing scope (including parameters) is allowed.
- Variables of type `void` are an error.

**Control flow**
- Conditions of `if`/`while` must be `bool`.
- `break` and `continue` outside a loop are errors.
- In an `if` expression, the `else` is mandatory and all branches must have the same type, which is the expression's type. That type must not be `void`.
- An expression statement may be any expression. Its value is discarded.

**Operators**

| Operator | Operands | Result |
|----------|----------|--------|
| unary `-` | int | int (wrapping) |
| `!` | bool | bool |
| `+` | int, int / string, string | int (wrapping) / string (concatenation) |
| `- *` | int, int | int (wrapping) |
| `/ %` | int, int | int; truncates toward zero; panics on zero divisor; `MIN / -1` wraps to `MIN` and `MIN % -1` is `0` |
| `< <= > >=` | int, int | bool |
| `== !=` | same type (int, bool, string) | bool; string equality compares bytes |
| `&& \|\|` | bool, bool | bool; short-circuiting |

Evaluation order: operands left to right, arguments left to right.

### 3.5 Builtins

Builtins are special-cased in the checker (there is no overloading or generics in user code).

| Builtin | Signature | Behaviour |
|---------|-----------|-----------|
| `print` | `(x: int \| bool \| string): void` | Writes `x` and a newline to stdout. bools print as `true`/`false`. |
| `len` | `(s: string): int` | Byte length. |
| `byte_at` | `(s: string, i: int): int` | Byte value 0–255 at index `i`. Panics if `i < 0` or `i >= len(s)`. |
| `substring` | `(s: string, start: int, end: int): string` | Bytes `[start, end)`. Panics unless `0 <= start <= end <= len(s)`. |
| `int_to_string` | `(n: int): string` | Decimal representation. |
| `panic` | `(msg: string): void` | Writes `panic: <msg>` to stderr and exits with code 101. |

### 3.6 Runtime panics

A runtime panic writes `panic: <message>` plus a newline to stderr and exits with code 101. Panics are triggered by:
- Division or modulo by zero (`division by zero`).
- An out-of-range `byte_at` (`index out of bounds: index <i>, length <n>`).
- An invalid `substring` range (`substring out of bounds: <start>..<end>, length <n>`).
- `panic(msg)`.

## 4. Compiler architecture

### 4.1 Pipeline

Each stage is a pure function over the previous stage's output. Stages communicate only through their data types.

```
lex(source, file)  → { tokens: Token[], diagnostics }
parse(tokens)      → { ast: Program, diagnostics }
check(ast)         → { typed: TypedProgram, diagnostics }   // skipped if lexing/parsing reported errors; pipeline stops here on any error
lower(typed)       → IrProgram
emitC(ir)          → string
driver             → writes .c, invokes cc with the runtime, produces an executable
```

Design constraint: the implementation avoids TypeScript-specific idioms that would be awkward to port to Aster later. That means data as discriminated unions with a `kind` tag, no class hierarchies, and plain functions.

### 4.2 AST and typed program

- AST nodes are discriminated unions (`kind`) with a `span` (`file`, start/end offset; line and column computed on demand for diagnostics).
- The checker does not mutate the AST. It produces a `TypedProgram`, in which every expression carries its type and every name reference points to a resolved symbol (local ID, function or builtin).
- The checker uses an internal `error` type. Any rule involving an `error`-typed operand is suppressed to avoid cascading diagnostics.

### 4.3 IR

The IR is deliberately not SSA. That keeps lowering simple and maps one-to-one onto LLVM's `alloca`/`load`/`store`, which `mem2reg` can promote later.

- `IrProgram` holds a list of `IrFunction` and a table of string literal constants.
- `IrFunction` has a name, typed params, typed **locals** (user variables and compiler temporaries, each with a unique ID), a return type and a list of **basic blocks**.
- `BasicBlock` has a label, a list of instructions and exactly one terminator.
- Operands are a local reference or an immediate constant (int, bool, string-constant ID).
- Instructions:
  - `copy dst, operand`
  - `unop dst, op, operand`
  - `binop dst, op, a, b`: arithmetic, comparisons and string concat/equality
  - `call dst?, fn, args`
  - `call_builtin dst?, builtin, args`
- Terminators:
  - `jmp label`
  - `br cond, thenLabel, elseLabel`
  - `ret operand?`
  - `unreachable` (after a non-returning builtin such as `panic`)
- Lowering responsibilities:
  - if-expression → temporary + branches + join block
  - `&&`/`||` → short-circuit branches into a bool temporary
  - `while`/`break`/`continue` → header/body/exit blocks with jumps
  - shadowed names → distinct locals
  - unreachable code after `return`/`break`/`continue` → dropped
- A textual IR printer exists for `--emit=ir` and for snapshot tests.

### 4.4 C backend

- Each IR function becomes one C function with every local declared at the top, one label per basic block and `goto` for terminators.
- Mangling: functions become `aster_fn_<name>`, locals `l<id>_<name>` and compiler temporaries `l<id>`, so user identifiers never collide with C keywords, libc or the runtime (whose names all start `aster_rt_`, plus the type `aster_string`).
- Type mapping: `int` → `int64_t`, `bool` → `bool` (`<stdbool.h>`), `string` → `aster_string` (`struct { const char *ptr; int64_t len; }`, passed by value, not NUL-terminated), `void` → `void`.
- Integer arithmetic is emitted as calls to `static inline` helpers in `aster_rt.h`. These compute in `uint64_t` and convert back, so wrapping is well-defined without `-fwrapv`. `aster_div` and `aster_mod` check for a zero divisor (panic) and handle `MIN / -1`.
- String literals become static `aster_string` constants.
- A generated C `main(void)` returns `(int)aster_main()`.
- Generated C must compile cleanly with `-std=c11 -Wall`. Any C compiler failure is reported as an internal compiler error.

### 4.5 Runtime

`packages/asterc/runtime/aster_rt.{h,c}` provides:
- `aster_string`, the arithmetic helpers and the panic function.
- `print` for each type, plus `len`, `byte_at`, `substring`, `int_to_string` and string concat/equality.

Strings are allocated with `malloc` and never freed. Allocation failure panics with `out of memory`.

### 4.6 Driver and CLI

```
aster check <file.aster>
aster build <file.aster> [-o <out>] [--emit=tokens|ast|ir|c]
aster run   <file.aster>
```

- `check` runs lex, parse and check, then prints diagnostics.
- `build` produces an executable (default output: input basename without extension). With `--emit=<stage>` it prints that stage's output to stdout and stops; `tokens` and `ast` are printed as JSON.
- `run` builds into a temporary directory, runs the executable and exits with its exit code (or `128 + signal number` if it was killed by a signal, as shells do).
- The C compiler is `$ASTER_CC`, falling back to `cc`. The invocation is `$CC -std=c11 -O2 <out.c> <runtime>/aster_rt.c -I<runtime> -o <out>`.
- Exit codes: `0` on success, `1` for compile errors in the user program, `2` for usage errors, `3` for internal compiler errors (including C compiler failure).

### 4.7 Diagnostics

- Format:
  ```
  <file>:<line>:<col>: error: <message>
    <source line>
    <caret line>
  ```
  Lines and columns are 1-based.
- The lexer reports and skips invalid characters.
- The parser recovers by synchronising at `;`, `}` or `fn`, so multiple syntax errors are reported per run.
- Diagnostics are sorted by position and deduplicated before printing.

## 5. Testing

### 5.1 Golden program suite (primary)

`tests/programs/<feature>/*.aster`. Each program declares its expectations in leading comments:

```
// expect-stdout:
// 30
// expect-exit: 0
```
```
// expect-error: 3:18 type mismatch: expected int, found string
```
```
// expect-stderr: panic: division by zero
// expect-exit: 101
```

Rules:
- `expect-stdout:` is followed by one `// `-prefixed line per expected output line (`//` alone is an empty line), ending at the first line that is not a comment or that starts another `expect-` directive.
- `expect-error:` may repeat. The listed diagnostics, as `line:col message`, must equal the compiler's diagnostics exactly and in order.
- `expect-exit` defaults to `0` when absent for run tests. Absent `expect-stdout`/`expect-stderr` mean that stream must be empty.
- Golden programs are compiled with `-Werror` added, so every one also proves the generated C is warning-free.
- A program with `expect-error` is only compiled. Every other program is built and run.

`tests/golden.test.ts` discovers every `.aster` file and generates one vitest case per program. The suite is the language's conformance suite: the future self-hosted compiler must pass it unchanged.

Feature folders: `basics/`, `arith/`, `bool/`, `control/`, `functions/`, `strings/`, `scoping/`, `errors/` (compile errors), `panics/`, `programs/` (FizzBuzz, fib, tokenizer).

### 5.2 Unit tests

Vitest files colocated with each stage, kept lean and focused on edges the golden suite cannot pin precisely:
- **Lexer:** token streams, escapes, spans, invalid characters.
- **Parser:** AST snapshots for precedence, if-statement vs if-expression and error recovery producing multiple diagnostics.
- **Checker:** type rules, missing-return analysis, assignment to `let`, `error`-type cascade suppression.
- **Lowering:** IR snapshots for short-circuiting, if-expressions and break/continue.

### 5.3 Workflow and CI

- TDD: write a failing golden program or unit test, then implement.
- `pnpm test` runs both layers.
- GitHub Actions on Ubuntu (Node 24, gcc) runs typecheck, lint and test on push and on PRs.
- No coverage thresholds.

## 6. Future work (informing, not in scope)

- **v0.1:** structs, fixed arrays, compound assignment, stdin/file input.
- An LLVM IR emitter over the existing IR (`--backend=llvm`).
- Growable arrays and memory management strategy (arena or manual).
- Multiple files/modules.
- Port `asterc` to Aster, verified against the golden suite.

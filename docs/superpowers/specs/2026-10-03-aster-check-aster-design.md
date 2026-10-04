# check.aster: the Aster Checker in Aster (Design)

**Date:** 2026-10-03
**Status:** Approved in brainstorming
**Builds on:** [`2026-10-03-aster-parse-aster-design.md`](2026-10-03-aster-parse-aster-design.md) and
[`2026-10-03-aster-v0.6-design.md`](2026-10-03-aster-v0.6-design.md). No language changes.

## 1. Purpose

The friction log's shortlist is empty: v0.4 to v0.6 cleared every item. The next milestone needs new evidence, and the
next piece of the compiler to self-host is the type checker. `check.aster` loads a program and every file it imports,
type-checks it, and prints the same diagnostics as the TypeScript front end (`runFrontend` in
`packages/asterc/src/driver/pipeline.ts`) plus a summary of the typed program. Whatever hurts goes into the friction
log, which ends with a fresh ranked shortlist for v0.7.

It puts the most pressure yet on the flat namespace, which has cost one rename so far, and on generics beyond
`Option`/`Result`.

### Success criteria

1. `tests/programs/programs/check.aster` is a golden program. It checks the program rooted at the file named by its
   only argument and prints the output in §4.
2. `tests/check_aster.test.ts` runs it on every `.aster` file under `tests/programs/` (`check.aster` and the libraries
   it imports included) and on every `fixtures/check_*.txt`. It checks that stdout, stderr and the exit code equal the
   TypeScript front end's result rendered in the same format. No file is skipped.
3. `parse.aster`'s output is unchanged after the parser moves into `parser.aster`: `tests/parse_aster.test.ts` passes
   unmodified apart from the corpus now including `parser.aster`.
4. `docs/self-host/friction.md` has a "Found while building check.aster" section and a new ranked shortlist that scopes
   v0.7. It counts every flat-namespace collision.
5. `pnpm test`, `pnpm lint` and `pnpm typecheck` pass. Compiler source is unchanged unless a compiler bug turns up. Any
   such fix lands in its own commit and is noted in the friction log.

### Non-goals

Language or runtime changes (no `real_path` builtin; see §3), a self-hosted IR or code generator, building a full typed
tree, warnings (the TS checker has none), and performance work.

## 2. Files

All under `tests/programs/programs/`. Libraries start with `// expect-library`, like `lexer.aster`.

| File | Role |
|------|------|
| `lexer.aster` | Unchanged. |
| `parser.aster` | New library: `parse.aster`'s AST types, `Parser` and every `parse_*` function, moved verbatim. Imports `lexer.aster`. |
| `parse.aster` | Keeps its header, the printer and `main`. Imports `parser.aster`. Output unchanged. |
| `loader.aster` | New library: a port of `driver/load.ts` (§3). Imports `parser.aster`. |
| `checker.aster` | New library: a port of `check/checker.ts`, `check/generics.ts`, `check/builtins.ts` and the parts of `types/type.ts` it needs. Imports `parser.aster`. |
| `check.aster` | `main`, diagnostic sorting and output, and the summary printer. Imports `loader.aster` and `checker.aster`. |

`checker.aster` keeps one function per TS function, with the same names in snake_case, so the two can be read side
by side. Where a name collides in the flat namespace, it is renamed, and the rename goes in the friction log.

### Types only, no typed tree

The TS checker builds a `TypedProgram` for lowering. `check.aster` only needs what the summary prints (§4.2), so
`check_expr` returns the expression's type (plus whatever small facts the checker's own rules need, such as whether an
expression is a place). It doesn't return a `TExpr`. Statements return whether they diverge. Locals are recorded per
function, in id order, as in TS.

### Program shape

The parser yields one `[Item]` per file in source order. The loader concatenates them in load order. The checker
reproduces the TS iteration orders exactly, because they decide which of two conflicting declarations is reported:

- types (structs and enums together) by global span start, as `collectTypes` sorts them;
- functions in load order, then source order, as `program.functions` holds them;
- the prelude (`enum Option[T] { Some(T), None }` and `enum Result[T, E] { Ok(T), Err(E) }`) is embedded as a string,
  parsed with the same parser and registered as templates before any user declaration.

## 3. Loader

`loader.aster` follows `loadProgram`:

- Each file gets a global base: the root's is 0, and each later file's is the previous base plus the previous file's
  length in bytes (after a BOM is stripped) plus one. Every span the lexer and parser produce for that file is offset by
  its base. All spans in the checker are global, so sorting by start sorts by load order and then by position, as in
  TS. Byte offsets give the same order as TS's UTF-16 offsets, because both are monotonic within a file.
- The root is read first. If it can't be read, `check.aster` reports a usage-style error and exits with 2 (§4.3).
- Files load depth-first in import order. An import path is used as written when absolute, and otherwise joined as
  `dirname(importing path) + "/" + path`, the same string TS builds. That string is the file's display path.
- **Identity.** TS dedupes by `realpath`. Aster has no way to get one, so `loader.aster` dedupes by a lexical
  normalisation of the display path: it collapses repeated `/`, drops `.` segments, and resolves `name/..` pairs. This
  agrees with TS on every corpus case (cycles, diamonds, self-imports, subdirectories). It differs only for symlinked
  paths, and nothing tests those. The difference goes in the friction log.
- A failed read reports `cannot import '<literal>': <reason>` at the path literal's span. `<literal>` is the literal's
  source text without the quotes, and `<reason>` is `read_file`'s `Err` text.
- Lexical and syntax diagnostics of every file are collected. If there are any, or any import failed, the checker
  doesn't run (as in `runFrontend`).
- `rootEnd` is the root's base plus its length. A `main` declared at or past it is reported as in TS.

## 4. Output

### 4.1 Diagnostics (stderr)

Diagnostics are sorted by global start (stable) and deduplicated by `(start, message)`, as `sortDiagnostics` does.
Each prints as:

```
error <path> <start> <end> <message>
```

`<path>` is the display path of the file containing `start` (the last file whose base is at or below it). `<start>`
and `<end>` are byte offsets within that file, from the start of the raw file, so a stripped BOM's 3 bytes are added
back. That's the same offset convention as `lex.aster` and `parse.aster`.

### 4.2 Summary (stdout)

Printed only when there are no diagnostics. It mirrors the `TypedProgram` the TS checker returns:

```
struct <name>
  field <name> <type>
enum <name>
  variant <name>
  variant <name>(<type>, <type>)
fn <name>(<type>, <type>): <type>
  param <id> <name> <type>
  let <id> <name> <type>
  var <id> <name> <type>
```

- Structs in `TypedProgram.structs` order, fields in declaration order.
- Enums in `TypedProgram.enums` order: the accepted non-generic enums, then every instantiation in order of first use.
  An instantiation's name is its type string (`Option[Token]`). Variants are in declaration order, and a variant with a
  payload lists its types in parentheses.
- Functions in `TypedProgram.functions` order, with the return type always written (`: void` included). Then every
  local in id order: params as `param`, other immutable locals (including `for` variables and match binders) as `let`,
  mutable ones as `var`.
- Types print as `typeToString` writes them: `int`, `[string]`, `Option[Result[int, string]]`.

### 4.3 Exit codes

`0` with no diagnostics, `1` with any. `2` for a wrong argument count (stderr `usage: check <file>`) or an unreadable
root file (stderr holds `read_file`'s `Err` text), as `lex.aster` handles the same cases. The test only covers these
by the golden harness, not the oracle.

## 5. Testing

`tests/check_aster.test.ts` follows `tests/parse_aster.test.ts`:

- `beforeAll` compiles `check.aster` with `-Werror`.
- An oracle runs `runFrontend(makeSource(path, text))` with the Node host, then renders §4.1 by mapping each global
  UTF-16 offset to its file and converting it to a byte offset in that file's raw bytes (BOM included). If there are no
  diagnostics, it renders §4.2 from `typed`. The test compares `{ stdout, stderr, status }`.
- The corpus is every `.aster` under `tests/programs/` plus `fixtures/check_*.txt`. That includes the 50 or so files
  in `errors/`, all of `modules/`, every golden program, and `check.aster` checking itself.
- New fixtures go in only where a checker diagnostic is left untested by the corpus. The plan starts with an audit that
  lists every `report(` message in `checker.ts` and the corpus file that triggers it.
- `check.aster`'s own golden `expect-args` uses `fixtures/check_small.txt`, a valid program whose summary is short.
  Diagnostic output holds paths, so the golden fixture avoids it.

`check.aster` is built up feature by feature, TDD style: declarations and types, then statements and expressions,
generics, `match`, `?` and builtins, and finally imports. While it is incomplete, a skip-list in the test file names
the corpus files that aren't expected to pass yet. It has to be empty before merge.

## 6. Friction log

New entries for whatever hurts, each with a severity and a workaround, as before. The "Found while building
check.aster" section records: every flat-namespace collision and its rename; the symlink identity gap; and anything
the TS checker leans on that Aster lacks (maps and sets are the likely ones). The ranked shortlist at the end is
replaced with a new one, the input to the v0.7 spec.

## 7. Docs

The README gets a quick-start line for `check.aster` and a sentence in the Tests section about
`tests/check_aster.test.ts`. `docs/spec/language.md` does not change.

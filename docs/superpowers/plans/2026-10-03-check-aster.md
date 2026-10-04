# check.aster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the Aster type checker in Aster (`tests/programs/programs/check.aster` plus the `parser.aster`, `loader.aster` and `checker.aster` libraries) and hold its diagnostics and typed-program summary to byte-for-byte parity with the TypeScript front end across the whole golden corpus.

**Architecture:** First the parser moves out of `parse.aster` into an importable `parser.aster`. `loader.aster` ports `driver/load.ts`: global byte bases, depth-first imports, lexical path dedupe. `checker.aster` ports `check/checker.ts`, `generics.ts` and `builtins.ts` function by function, computing types rather than a typed tree. `check.aster` sorts and prints diagnostics, or else the summary. A vitest oracle renders `runFrontend`'s result in the same format and diffs the two on every corpus file.

**Tech Stack:** Aster (compiled by `asterc` to C), TypeScript, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-03-aster-check-aster-design.md`

## Global Constraints

- No changes to `packages/asterc/src/**` unless a compiler bug is found. Such a fix gets its own commit and a friction-log note.
- No language or runtime changes. Path identity is lexical (spec §3).
- Output is exactly spec §4. stderr has `error <path> <start> <end> <message>`, sorted by global start (stable) and deduped on `(start, message)`, with byte offsets in the raw file (BOM included). stdout has the summary, printed only when there are no diagnostics. Exit codes are `0`/`1`/`2`.
- The checker runs only when loading produced no lexical, syntax or import diagnostics (as in `runFrontend`).
- Every Aster file builds with `-Werror`. Libraries start with `// expect-library`.
- `checker.aster` mirrors `checker.ts`: same function names in snake_case, same iteration orders (types sorted by global span start; functions in load order; prelude templates registered first). Any rename forced by the flat namespace goes in the friction log.
- Commit messages follow conventional commits (commitlint runs in a husky hook) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01BEFkosKGhxvKwQnSx37gDJ`.
- Before merge, the test's `PENDING` skip-list is empty, and `pnpm test`, `pnpm lint` and `pnpm typecheck` pass.

## Review Focus

1. **Offsets in imported files with non-ASCII text or a BOM.** The oracle maps global UTF-16 offsets to file and byte offset, and `check.aster` maps global byte offsets the same way. An imported file with a BOM and multi-byte characters before a diagnostic must print the same `<path> <start> <end>`. Task 2 adds `fixtures/check_bom.txt`, which imports `fixtures/check_bom_lib.txt` (BOM, `é` and `😀` in comments, then a type error).
2. **Path spellings of one file.** `"./x"`, `"../fixtures/x"` and a plain `"x"` from the same directory must load once. Task 7 adds `fixtures/check_paths.txt`, which imports `check_paths_lib.txt` three ways and declares nothing twice. A second load would show up as duplicate-declaration diagnostics.
3. **Diagnostic dedupe and ordering ties.** Several diagnostics at one start (for example the same bad payload type reported through two instantiations) must sort stably and dedupe on `(start, message)` only. The corpus's `errors/generic_*` files exercise this, and Task 5 checks them unskipped.
4. **Error-type cascade suppression.** One bad type must not produce follow-on mismatches. The corpus's `errors/*` files are the check, and each task unskips the ones for its feature.
5. **Local numbering.** Shadowing, nested scopes, `for` variables and match binders must give the same ids and `param`/`let`/`var` kinds as TS. The golden programs (`parse.aster`, `check.aster` itself) exercise this through the summary.

---

## File map

- Create `tests/programs/programs/parser.aster` (moved out of `parse.aster`), `loader.aster`, `checker.aster` and `check.aster`.
- Modify `tests/programs/programs/parse.aster`: keeps the header, printer and `main`, and imports `parser.aster`.
- Create `tests/check_aster.test.ts`: the oracle and the conformance runner.
- Create fixtures `tests/programs/programs/fixtures/check_small.txt`, `check_bom.txt`, `check_bom_lib.txt`, `check_paths.txt`, `check_paths_lib.txt`, plus any `check_*.txt` the audit (Task 2) calls for.
- Modify `docs/self-host/friction.md` and `README.md`.

### Task 1: Move the parser into `parser.aster`

**Files:** Create `parser.aster`. Modify `parse.aster`.

**Produces:** `parser.aster` exports everything `parse.aster` defined apart from the printer and `main`, under the same names: the AST types (`Item`, `Expr`, `Stmt`, `TypeExpr`, `Pattern`, `Block`, `Ident` and so on), `Parser`, `parse_program(p: Parser): [Item]`, and the helper that builds a `Parser` from a `Lexer`. Later tasks import it.

- [ ] Move every declaration from the top of `parse.aster` (after its `import "lexer.aster";`) down to, but not including, the printer (`fn line`) into `parser.aster`, verbatim. Give it a `// expect-library` header that describes the AST and parser, in the style of `lexer.aster`'s header. It imports `lexer.aster`.
- [ ] `parse.aster` replaces its `lexer.aster` import with `import "parser.aster";`. Its header and expected output are unchanged. If `main` built the `Parser` inline, factor that into a `new_parser(lx: Lexer): Parser` (or similar) in `parser.aster`, so `loader.aster` can reuse it.
- [ ] Run `pnpm vitest run tests/parse_aster.test.ts tests/lex_aster.test.ts tests/golden.test.ts`. Expected: everything passes, and `parser.aster` now shows up in the parse corpus and passes too.
- [ ] Commit: `refactor: move the Aster parser into parser.aster`.

### Task 2: Harness, oracle, loader and `check.aster` skeleton

**Files:** Create `tests/check_aster.test.ts`, `loader.aster`, `check.aster`, a stub `checker.aster`, and fixtures `check_small.txt`, `check_bom.txt` and `check_bom_lib.txt`.

**Produces:**
- `loader.aster`: `struct SourceFile { path: string, src: string, base: int, bom: int }` (`src` with any BOM stripped; `bom` is 3 or 0), `struct Diag { start: int, end: int, message: string }` (global byte offsets), and `struct Loaded { files: [SourceFile], items: [Item], root_end: int, diags: [Diag] }`. Also `fn load_program(path: string, src: string): Loaded`.
- `checker.aster`: `fn check_program(items: [Item], root_end: int): Checked`, where `Checked` holds `diags: [Diag]` and the summary data (`structs`, `enums`, `functions`, as Task 3 defines them). The stub returns no diagnostics and empty lists.
- `check.aster`: `main`, `sort_diags` (stable insertion or merge sort by start, then dedupe on `(start, message)`), `print_diags` (maps a global start to its file: the last file with `base <= start`; prints `start - base + bom`), and `print_summary`.
- `tests/check_aster.test.ts`: `expected(path)` and the `PENDING` set.

Steps:
- [ ] **Audit.** List every `report(` call site in `packages/asterc/src/check/checker.ts`, every message `load.ts` produces, and the corpus file that triggers each one (`grep -rn` the message text in `tests/programs`). Write the table as a comment block at the top of `tests/check_aster.test.ts`. For each message nothing triggers, plan a line in a `fixtures/check_<feature>.txt` fixture, owned by the task that ports that feature (Tasks 3 to 6 add them).
- [ ] Write `tests/check_aster.test.ts`, modelled on `tests/parse_aster.test.ts` (build once in `beforeAll` with `-Werror`, `spawnSync` with a 10 s timeout, `{ stdout, stderr, status }` comparison).
  - The corpus is every `.aster` under `tests/programs/` plus `fixtures/check_*.txt`.
  - The oracle calls `runFrontend(makeSource(path, text))`, with `path` being the absolute path that is also passed to the binary.
  - For each diagnostic it finds the file in `map.files` (the last one whose `base <= start`) and converts `start - base` and `end - base` (UTF-16 indices into the BOM-stripped text) to byte offsets in that file's raw bytes. The conversion is `bom + Buffer.byteLength(text.slice(0, i))`; `end` is clamped into the same file. The line is `error ${file.path} ${s} ${e} ${message}`.
  - With no diagnostics it renders spec §4.2 from `typed`: `typeToString` for types, `param` for `id < params.length`, `var` when `mutable`, `let` otherwise. Status is `diagnostics.length > 0 ? 1 : 0`.
- [ ] Write `loader.aster` per spec §3, as a straight port of `loadProgram`. It reads with `read_file`, so an error reason is the `Err` text. Strip a BOM before lexing and record `bom`. Each later file's base is the previous file's `base + len(src) + 1`. Offset every span the parser produced by the file's base. The cleanest way is to lex and parse with spans relative to the file, then shift: write `shift_item(item, base)` by walking the AST, or give `Parser` a `base` field it adds when building spans. Prefer the `base` field if it's a smaller diff to `parser.aster`, and check `parse.aster` output stays identical with `base = 0`. Path dedupe is `normalise(path)`: split on `/`, drop empty and `.` segments (keeping a leading `/`), and pop on `..` when the stack's top is a real segment. The import-failure message quotes the literal's source text without its quotes.
- [ ] Write `check.aster`. Its `main` mirrors `lex.aster`'s for usage and read errors (`usage: check <file>`, exit 2). Then: `load_program`; if `diags` is non-empty, print them and `exit(1)`; otherwise `check_program`, then print diagnostics and `exit(1)`, or else print the summary and return 0. The header comment describes the format and has `// expect-args: fixtures/check_small.txt` with the expected summary as `// expect-stdout:`. `check_small.txt` is a small valid program: one struct, one non-generic enum, one `Option[int]` use, and a `main` with a `var`. Write its expected summary by running the oracle.
- [ ] Add `check_bom.txt` (a valid `main` that imports `check_bom_lib.txt`) and `check_bom_lib.txt` (BOM, a comment with `é` and `😀`, then `fn helper(): int { return "x"; }`) (Review Focus 1).
- [ ] `PENDING` starts as every corpus file that fails against the stub checker. Expected: the files whose failure is purely lexical, syntactic or an import error pass now (`errors/lex_errors.aster`, `errors/import_missing.aster`, `errors/import_dir.aster`, `errors/import_syntax.aster`, `errors/import_eof.aster`, `errors/enum_syntax.aster` and similar).
- [ ] Run `pnpm vitest run tests/check_aster.test.ts tests/golden.test.ts`. Expected: no failures, only skips.
- [ ] Commit: `test: add check.aster conformance harness, loader and skeleton`.

### Task 3: Types, declarations and signatures

**Files:** `checker.aster`, `check.aster` (summary printer), `tests/check_aster.test.ts` (shrink `PENDING`), and any audit fixtures for this feature.

**Produces** (in `checker.aster`):
- `enum Type { Int, Bool, Str, Void, Struct(string), Enum(string), Array(Type), Error }`. An instantiation is `Enum("Option[int]")`, with its base and args kept on the `TEnum` record where the checker needs them.
- `type_to_string(t: Type): string` and `type_equals(a: Type, b: Type): bool`.
- Records `TField { name, ty }`, `TStruct { name, fields }`, `TVariant { name, payload: [Type] }`, `TEnum { name, variants }`, `Local { id, name, ty, mutable }` and `TFunction { name, params: int, locals: [Local], ret: Type }`.
- `Env`. Aster has no maps, so each name table is an array searched linearly, with a `find_*` helper that returns `Option[int]` (an index). Record that in the friction log.

Steps:
- [ ] Port `resolveType` (without generics: a named type with args resolves to an error with TS's message, for now), `collectTypes` (struct and non-generic enum parts; templates come in Task 5), the two-pass `check` header (function signature collection, builtin and type-name clashes, the root-only `main` rule using `root_end`, `missing 'fn main(): int'` at offset 0 and `isMainSignature`), and `checkFunction` up to declaring params. Bodies are not checked yet.
- [ ] Port `builtins.ts` as data: the signature builtins and the special-builtin names.
- [ ] Implement `print_summary` in `check.aster` per spec §4.2.
- [ ] Unskip everything that now passes. Expected: `errors/enum_decls.aster`, `errors/builtin_and_unknown_type.aster`, `errors/main_signature.aster`, `errors/main_args_string.aster`, `errors/eprint_exit_redefined.aster`, `errors/import_main.aster`, `errors/import_collisions.aster`, `errors/import_type*.aster` and `errors/import_fn_vs_type.aster`, as far as they don't need body checking. Run the test. No unskipped failures.
- [ ] Commit: `feat(check.aster): types, declarations and signatures`.

### Task 4: Statements and expressions

**Files:** `checker.aster`, the test file and audit fixtures.

**Consumes:** Task 3's `Type`, `Env` and `Local`. **Produces:** `check_block(ctx, b): bool` (diverges), `check_stmt(ctx, s): bool` and `check_expr(ctx, e, expected: Option[Type]): Type`. `Ctx` holds the env reference, signatures, return type, `locals: [Local]`, `scopes: [[int]]` (local indices per scope) and the loop stack.

- [ ] Port `checkBlock`, `checkStmt`, `checkIf`, `checkRangeBound`, `checkForBody`, `declare`/`lookup`, `expectType`, `checkCondition`, `checkExpr` (non-generic, non-match, non-try arms), `checkStructLit`, `checkArrayLit`, `checkPlace`, `checkCompound`, `binaryResultType`, `checkBinary` (including payload-free enum `==`/`!=`), `checkCall`, `checkPrint` and `checkCollectionBuiltin`, plus the missing-return check in `checkFunction`. Keep every message string byte-identical. Copy them from `checker.ts`, don't retype them.
- [ ] Unskip what passes. Expected: the non-generic golden programs (`basics/`, `arith/`, `control/`, `loops/`, `structs/`, `arrays/`, `strings/`, `functions/`, `scoping/`, `bool/`, `compound/`, `io/`, `panics/` as applicable) and `errors/{assign,array,call,for,if_branch_types,immutable_assign,eprint_exit_calls,…}`. Run the test.
- [ ] Commit: `feat(check.aster): statements and expressions`.

### Task 5: Generic enums

**Files:** `checker.aster`, the test file and audit fixtures.

- [ ] Port `generics.ts`: the `Template` record, `mentions_param`, and `find_expanding_enums`. TS uses Tarjan's SCC over `(enum, param)` nodes. In Aster, use node indices into an array of `(enum, param)` pairs. Port `instantiate`, the generic branches of `resolveType` (with its `quiet`/`instantiates` flags and `bindings`), the template validation in `collectTypes`, the prelude (embed `PRELUDE_SOURCE` verbatim and parse it with `parser.aster`), `resolveVariant`, `checkVariantExpr`, `checkGenericVariantExpr` and `unify`. Instantiations append to `env.instances` in first-use order. The summary lists them after the non-generic enums.
- [ ] Unskip what passes: `generics/`, `errors/generic_*.aster`, and every program using `Option`/`Result` that doesn't also need `match` or `?`. Run the test.
- [ ] Commit: `feat(check.aster): generic enums and the prelude`.

### Task 6: `match` and `?`

**Files:** `checker.aster`, the test file and audit fixtures.

- [ ] Port `matchCategory`, `checkMatch`, `resolveAlternative`, `checkReachability`, `missingValues`, `declareBinders`, `resolvePatternVariant`, `checkMatchExpr` and `checkTry`, along with the `read_file` → `Result[string, string]` typing. The typed patterns aren't needed, only the diagnostics, binder locals and divergence.
- [ ] Unskip what passes: `match/`, `try/`, `literals/`, `enums/`, `programs/*` (including `lex.aster`, `parse.aster`, `parser.aster` and `lexer.aster`), `errors/{char_literals,…match…,…try…}`. Run the test.
- [ ] Commit: `feat(check.aster): match and the ? operator`.

### Task 7: Imports parity, self-check and an empty skip-list

**Files:** the test file, fixtures `check_paths.txt` and `check_paths_lib.txt`, and whatever is still failing.

- [ ] Add `check_paths.txt`. It imports `check_paths_lib.txt`, `./check_paths_lib.txt` and `../fixtures/check_paths_lib.txt`, and calls one function from it in a valid `main`. `check_paths_lib.txt` declares that function (Review Focus 2). Expected: a clean summary, so the lib loaded once.
- [ ] Unskip `modules/*` (cycle, diamond, self_import, subdir, generic), the remaining `errors/import_*`, `loader.aster`, `checker.aster` and `check.aster` itself. Fix whatever differs.
- [ ] `PENDING` must be empty. Delete the set and its `it.skip` branch. Run `pnpm test`, `pnpm lint` and `pnpm typecheck`. All three must pass. Check that the self-check of `check.aster` runs well within the 10 s timeout.
- [ ] Commit: `test(check.aster): full corpus parity`.

### Task 8: Friction log and docs

**Files:** `docs/self-host/friction.md`, `README.md`.

- [ ] Add "Found while building check.aster" to the friction log with numbered entries in the existing format (what hurt, a snippet, severity, workaround). It must cover: every flat-namespace collision and its rename (and say if there were none); the lack of maps and sets (count the linear-search helpers); the lexical path identity gap (symlinks); anything Task 5's SCC port or the `?`/`defer` interplay surfaced; and any compiler bug found. Update the header's "Sources so far" with line counts for `parser.aster`, `loader.aster`, `checker.aster` and `check.aster`.
- [ ] Replace the shortlist with a new ranked v0.7 shortlist, each item citing its entry and its evidence (counts).
- [ ] README: add a quick-start line for `check.aster` next to `parse.aster`'s, and a sentence in the Tests section on `tests/check_aster.test.ts`.
- [ ] Run `pnpm test`, `pnpm lint` and `pnpm typecheck` once more.
- [ ] Commit: `docs: check.aster friction log and README`.

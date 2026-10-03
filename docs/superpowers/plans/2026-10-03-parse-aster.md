# parse.aster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the Aster parser in Aster (`tests/programs/programs/parse.aster`) and hold it to byte-for-byte parity with the TypeScript parser across the whole golden corpus.

**Architecture:** One self-contained Aster file: a copy of `lex.aster`'s lexer, an AST of structs wrapping enums (`Expr { start, end, node: ExprNode }`), a recursive-descent parser that mirrors `packages/asterc/src/parser/parser.ts` function by function and replaces exceptions with a `failed` flag, and an indented-tree printer. A vitest file renders the TS parser's output in the same format and diffs the two on every corpus file.

**Tech Stack:** Aster (compiled by `asterc` to C), TypeScript, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-03-aster-parse-aster-design.md`

## Global Constraints

- No changes to `packages/asterc/src/**` unless a compiler bug is found. Such a fix gets its own commit and a friction-log note.
- Output format is exactly spec §3: one node per line, two-space indent per depth, `tag S E attrs…`, `-` for absent optionals, then `error S E message` lines (lexer errors, then parser errors). Exit `0`/`1`/`2`.
- Offsets are byte offsets in the raw file, BOM included.
- `parse.aster` must build with `-Werror` (the test builds it that way).
- Commit messages follow conventional commits (commitlint runs in a husky hook) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before merge, the test's `PENDING` skip-list is empty.

## Review Focus

1. **Missed `failed` checks.** A parse function that keeps consuming tokens after a failed sub-call yields extra diagnostics or a different recovery point. `parse_errors.txt` puts errors at every depth (item header, param list, nested block, expression, struct literal, match arm).
2. **`no_struct_lit` not restored on failure.** An error inside `( … )` within an `if` header must not leave struct literals disabled for the next statement. `parse_errors.txt` has that case.
3. **Integer canonicalisation and range.** Leading zeros, `-0`, `9223372036854775807`/`…808` on both signs. `parse_ints.txt`.
4. **Non-ASCII and BOM offsets.** Byte offsets after multi-byte characters and after a BOM. Covered by the existing `lex_errors.txt` and `lex_bom.txt` fixtures, which are part of the corpus.
5. **Empty and degenerate inputs.** An empty file, a file of only comments, garbage before the first item, and a file that ends inside a block. `parse_errors.txt` and `parse_empty.txt`.

---

## File map

- Create `tests/parse_aster.test.ts`: the oracle printer plus the conformance runner.
- Create `tests/programs/programs/parse.aster`: the parser.
- Create `tests/programs/programs/fixtures/parse_sample.txt`, `parse_errors.txt`, `parse_ints.txt`, `parse_empty.txt`.
- Create `docs/self-host/friction.md`.
- Modify `README.md`: quick start and Tests paragraph.

### Task 1: Oracle, fixtures and conformance runner

**Files:** Create `tests/parse_aster.test.ts`, the four fixtures, and a stub `parse.aster` (the lexer copy plus a `main` that prints only the error lines and `0`/`1` exit). That makes `lex_*` and `parse_empty.txt` pass straight away.

**Produces:** the `expected(text)` oracle and the `PENDING` set later tasks shrink.

- [ ] Write `tests/parse_aster.test.ts`. It is modelled on `tests/lex_aster.test.ts` (same build-once `beforeAll`, same `TextDecoder` read, same `spawnSync`). The oracle:
  - builds a UTF-16-index → byte-offset table once per file;
  - takes `lex(makeSource('corpus', text))` and `parse(tokens)`;
  - merges `functions`, `structs` and `enums` by `span.start`;
  - prints every node per the spec §3 table with a recursive `emit(depth, line)`;
  - prints string literals' raw text as `body.slice(span.start, span.end)`;
  - appends `error S E message` for `lexed.diagnostics` then `parsed.diagnostics`, and sets `status = diagnostics ? 1 : 0`.
- [ ] `PENDING`: a `Set<string>` of corpus paths that run with `it.skip`. Start it with every file that fails against the stub.
- [ ] Add the fixtures. `parse_sample.txt` has one of every node kind. `parse_errors.txt` covers Review Focus items 1, 2 and 5. `parse_ints.txt` covers item 3. `parse_empty.txt` is an empty file.
- [ ] Run `pnpm vitest run tests/parse_aster.test.ts`. Expected: the `lex_*` fixtures and `parse_empty.txt` pass, everything else is skipped.
- [ ] Commit: `test: add parse.aster conformance harness and fixtures`.

### Task 2: AST, parser core, items and types

**Files:** `parse.aster`.

**Produces (exact names later tasks use):**
```
struct Ident { name: string, start: int, end: int }
struct TypeExpr { start: int, end: int, node: TypeNode }
enum TypeNode { Named(string), Array(TypeExpr) }
enum MaybeType { None, Some(TypeExpr) }
struct Typed { name: Ident, ty: TypeExpr }            // params and struct fields
struct VariantDecl { name: Ident, payload: [TypeExpr] }
struct FnDecl { start: int, end: int, name: Ident, params: [Typed], ret: MaybeType, body: Block }
struct StructDecl { start: int, end: int, name: Ident, fields: [Typed] }
struct EnumDecl { start: int, end: int, name: Ident, variants: [VariantDecl] }
enum Item { Fn(FnDecl), Struct(StructDecl), Enum(EnumDecl) }
struct Block { start: int, end: int, stmts: [Stmt] }
struct Parser { src: string, tokens: [Token], pos: int, errors: [LexError], no_struct_lit: bool, failed: bool }
fn peek(p: Parser): Token          fn peek_at(p: Parser, offset: int): Token
fn previous(p: Parser): Token      fn at(p: Parser, kind: string): bool
fn advance(p: Parser): Token       fn eat(p: Parser, kind: string): bool
fn text(p: Parser, t: Token): string
fn describe(p: Parser, t: Token): string
fn fail(p: Parser, message: string, t: Token)       // records the error, sets p.failed
fn expect(p: Parser, kind: string): Token
fn ident_of(p: Parser, t: Token): Ident
```
The lexer's `peek(lx, offset)` is renamed `peek_byte` so the names don't collide.

- [ ] Port `parseProgram`, `syncToItem`, `parseFunction`, `parseStruct`, `parseEnum` and `parseType`. Statements stay a stub: `parse_block` skips to the matching `}` for now, so `fn` items parse. Add the item and type printers.
- [ ] Porting rule for every function: after each call that can fail, write `if p.failed { return <placeholder>; }`. `parse_program` is a catch point: if `p.failed` is set after an item, clear it and call `sync_to_item`.
- [ ] Run the test. Programs whose functions have empty bodies pass. Remove them from `PENDING`.
- [ ] Commit: `feat(parse.aster): items and types`.

### Task 3: Statements

**Produces:** `struct Stmt { start: int, end: int, node: StmtNode }`, `enum StmtNode { Let(bool, Ident, TypeExpr, Expr), Assign(string, Expr, Expr), If(Expr, Block, Else), While(Expr, Block), ForRange(Ident, Expr, Expr, Block), ForEach(Ident, Expr, Block), Match(Ident, Expr, [Arm]), Break, Continue, Return(MaybeExpr), Block(Block), Expr(Expr) }`, `enum Else { None, Block(Block), If(Stmt) }`.

- [ ] Port `parseBlock` (the catch point: drop the failed statement, clear `failed`, `sync_statement`), `syncStatement`, `parseStatement`, `parseSimpleStatement`, `parseFor` and `parseIfStmt`. Expressions are temporarily limited to primaries.
- [ ] Add the statement printers. Run, shrink `PENDING`, and commit: `feat(parse.aster): statements`.

### Task 4: Expressions

**Produces:** `struct Expr { start: int, end: int, node: ExprNode }`, `enum ExprNode { Int(string), Str, Bool(bool), Name(string), Unary(string, Expr), Binary(string, Expr, Expr), Call(Expr, [Expr]), If(Expr, Expr, Expr), Field(Expr, Ident), StructLit(Ident, [FieldInit]), Index(Expr, Expr), ArrayLit([Expr]), Variant(Ident, Ident, [Expr]), Match(Ident, Expr, [Arm]), Bad }`, `struct FieldInit { name: Ident, value: Expr }`, `enum MaybeExpr { None, Some(Expr) }`.

- [ ] Port `parseBinary` (the `LEVELS` table as a function `level_ops(level): [string]` plus `level_chainable(level): bool`), `parseUnary` with int folding, `parsePostfix`, `parsePrimary`, `parseStructLit`, `parseVariantExpr` and `parseIfExpr` (its span ends at `previous()`).
- [ ] `withStructLits(allowed, f)` becomes, inline at each site: `let saved: bool = p.no_struct_lit; p.no_struct_lit = !allowed; let e: Expr = parse_expr(p); p.no_struct_lit = saved; if p.failed { … }`.
- [ ] Integers: `canonical_digits(s)` strips leading zeros. `fits(digits, negative)` compares by length, then byte by byte, against `9223372036854775807` or `9223372036854775808`. On overflow, record `integer literal out of range` without failing.
- [ ] Commit: `feat(parse.aster): expressions`.

### Task 5: Match and patterns

**Produces:** `struct Pattern { start: int, end: int, node: PatternNode }`, `enum PatternNode { Wildcard, Variant(Ident, Ident, [Binder]) }`, `enum Binder { Wild, Named(Ident) }`, `struct Arm { pattern: Pattern, body: ArmBody }`, `enum ArmBody { Block(Block), Expr(Expr) }`.

- [ ] Port `parseMatchStmt`, `parsePattern` and `parseMatchExpr`, plus their printers.
- [ ] Commit: `feat(parse.aster): match and patterns`.

### Task 6: Recovery parity and an empty skip-list

- [ ] Run the full test. Fix each remaining mismatch, which will mostly be missed `failed` checks. Each fix comes with a fixture case if the corpus didn't already pin it.
- [ ] Delete `PENDING` and its `it.skip` branch.
- [ ] Add `// expect-args: fixtures/parse_sample.txt` and its `expect-stdout` block to `parse.aster`'s header, generated from the oracle and checked by eye.
- [ ] Run `pnpm test && pnpm lint && pnpm typecheck`. All green.
- [ ] Commit: `feat(parse.aster): full recovery parity with the TS parser`.

### Task 7: Friction log and docs

- [ ] Write `docs/self-host/friction.md`: entries from `lex.aster` and `parse.aster`, each with severity, snippet and workaround, and a ranked v0.4 shortlist.
- [ ] README: a quick-start line for `parse.aster`, a Tests-paragraph sentence about `tests/parse_aster.test.ts`, and a Docs link to the friction log.
- [ ] Commit: `docs: friction log from the self-hosted lexer and parser`.

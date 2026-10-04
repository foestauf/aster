# checker.aster: the Complete Typed Program (Design)

**Date:** 2026-10-04
**Status:** Approved in brainstorming
**Issue:** #16
**Builds on:** [`2026-10-04-aster-self-hosting-contract-design.md`](2026-10-04-aster-self-hosting-contract-design.md)
(§3 source closure, §6.2 the byte-identical C oracle) and
[`2026-10-03-aster-check-aster-design.md`](2026-10-03-aster-check-aster-design.md). No language changes.

## 1. Purpose

`checker.aster` type-checks a program but throws the function bodies away. `check_expr` returns only a `Type`, and
`check_stmt` returns only whether the statement diverges. Lowering (#17) needs what the TypeScript checker hands
`lower.ts`: a `TypedProgram` whose functions carry fully typed bodies. The contract requires the C to be byte-identical
to stage 0's (§6.2 of the contract), and that only works if Aster lowers from the *same* tree. The goal is therefore a
typed tree that mirrors `packages/asterc/src/check/types.ts` exactly: the same local ids in the same order, the same
desugaring and the same resolved data. A full-tree dump checked against TypeScript proves it.

### Success criteria

1. `lexer.aster`, `parser.aster`, `loader.aster` and `checker.aster` live in `packages/asterc-self/`. `lex.aster`,
   `parse.aster` and `check.aster` stay in `tests/programs/programs/` and import them by relative path. The existing
   parity tests pass with only path changes.
2. `checker.aster`'s `Checked.functions[i].body` holds the typed body of every function in a valid program.
3. `tests/programs/programs/typed.aster` prints the typed program in the dump format of §4.
   `tests/typed_aster.test.ts` checks that its stdout equals the TypeScript dump of `runFrontend(X).typed`, byte for
   byte. `X` is every valid program in the `check_aster` corpus (§5) plus every `fixtures/typed_*.txt`. Nothing is
   skipped.
4. `check_aster.test.ts`'s summaries, diagnostics, stdout, stderr and exit codes are unchanged, including when the
   checker checks itself.
5. `pnpm test`, `pnpm lint` and `pnpm typecheck` pass. The stage-0 compiler under `packages/asterc/src/` is unchanged
   unless a compiler bug turns up. Such a fix lands in its own commit with a friction-log note.
6. `docs/self-host/friction.md` gains a "Found while building the typed program" section.

### Non-goals

Lowering, an IR, C emission, the CLI, the four new builtins, maps and sets, and performance work. A dump format that
the CLI exposes: the contract (§4.5) has no `--emit=ast|ir`, and `typed.aster` is a test driver.

## 2. Approach: one pass, mirroring `checker.ts`

Each checking function returns its typed node alongside what it returns today, as `checker.ts` does with
`Checked<T> = { node, diverges }`:

| Function | Today | After |
|---|---|---|
| `check_expr(ctx, e, expected)` | `Type` | `TExpr`. The type is `TExpr.ty`; callers that wanted the type read `.ty`. |
| `check_stmt(ctx, s)` | `bool` (diverges) | `CheckedStmt { node: TStmt, diverges: bool }` |
| `check_block(ctx, b)` | `bool` | `CheckedBlock { node: TBlock, diverges: bool }` |
| match and pattern helpers | types, coverage | also the `TPattern`s and arm bodies, in arm order |
| `check_function` | `TFunction` without a body | `TFunction` with `body: TBlock` |

We rejected a separate elaboration pass (check, then rebuild the tree from side tables). It would duplicate the scope and
local-id logic, which is exactly where Aster and TypeScript could drift apart.

**Errors.** On a diagnostic, the expression's node is `TExprNode::Error` with type `Type::Error`. A program with any
diagnostic never has its tree read: `typed.aster` prints diagnostics in `check.aster`'s format and exits 1, just as
`runFrontend` returns `typed: null`. The tree that comes out of an erroneous program is unspecified.

**Desugaring is copied from `checker.ts`, not reinvented:**

- `let P = e else { B }` becomes `TStmt::Match(scrutinee, [arm(P, empty block), arm(wildcard, B)])`. The binders are
  declared in the enclosing scope afterwards, with the same local ids as TypeScript assigns.
- `if let` chains become `Match` with the same arm and else structure that `checkIfLet` builds.
- Divergence, `never` arms, payload-free `==`/`!=` (`EnumCompare`) and `read_file`'s `Result` typing follow
  `checker.ts` exactly.

## 3. Data types

A new section in `checker.aster`, "the typed tree", sits next to the existing `Local`/`TStruct`/`TEnum`/`TFunction`. It
mirrors `check/types.ts` field for field. Aster's recursive enums are enough for this, as they already are for the
parser's `Expr`/`ExprNode`.

```
struct TFunction { name, params: int, locals: [Local], ret: Type, body: TBlock }   // body is new
struct TBlock    { stmts: [TStmt] }
enum TStmt {
    Let(Local, TExpr), Assign(TPlace, string, TExpr), If(TExpr, TBlock, Option[TBlock]),
    While(TExpr, TBlock), ForRange(Local, TExpr, TExpr, TBlock), ForEach(Local, TExpr, TBlock),
    Break, Continue, Return(Option[TExpr]), Match(TExpr, [TArm]), Block(TBlock), Expr(TExpr),
}
struct TPlace    { ty: Type, node: TPlaceNode }     // Local(Local) | Field(TExpr, string) | Index(TExpr, TExpr)
struct TExpr     { ty: Type, node: TExprNode }
enum TExprNode {
    Int(string), Str(string), Bool(bool), Local(Local), Unary(string, TExpr), Binary(string, TExpr, TExpr),
    Call(string, [TExpr]), Builtin(string, [TExpr]), If(TExpr, TExpr, TExpr), Field(TExpr, string),
    Index(TExpr, TExpr), ArrayLit([TExpr]), StructLit(string, [TFieldInit]),
    Variant(string, string, int, [TExpr]), EnumCompare(string, TExpr, TExpr), Match(TExpr, [TArm]),
    Try(TTry), Error,
}
struct TArm      { pattern: TPattern, body: TArmBody }    // TArmBody: Block(TBlock) | Expr(TExpr)
enum TPattern    { Wildcard, Variants([TVariantRef], [Option[Local]]), Ints([string]), Strings([string]) }
struct TTry      { operand: TExpr, ok_variant, ok_tag, fail_variant, fail_tag, return_type, return_enum,
                   return_fail_variant, return_fail_tag, fail_payload_type: Option[Type] }
```

**Conventions:**

- **Integers.** `Int` values and `Ints` pattern values are canonical decimal strings (what the parser already
  produces), so the tree carries exact `int64` values without bigints. Char literals and bool patterns are converted as
  `checker.ts` converts them: chars to their code value, bool patterns to `0`/`1`.
- **Operators** are their source spelling (`"+"`, `"&&"`, `"+="`). Builtins are their name.
- **Statement and expression `match`.** Both use `TArm`. A statement arm always has a `Block` body.

The field names above are a proposal. The plan may adjust them. What may not change is the content: every field of the
corresponding `types.ts` node.

## 4. The dump format

There are two printers, one TypeScript and one Aster, with the same output. Both are test-side code.

- `tests/typed_dump.ts` exports `dumpTyped(program: TypedProgram): string`.
- `packages/asterc-self/typed_dump.aster` provides `dump_typed(c: Checked): string`, and
  `tests/programs/programs/typed.aster` prints that. The dumper sits in the compiler directory so #17 can reuse it
  while debugging, but nothing in the compiler's closure imports it.

**Layout.** The output is one node per line, indented two spaces per level, and ends with a newline:

```
struct Point
  field x int
  field y int
enum Option[int]
  variant Some int
  variant None
fn main int
  local 0 p Point let
  local 1 o Option[int] let
  body
    let 0
      struct-lit Point : Point
        init x
          int 1 : int
    match
      local 1 : Option[int]
      arm
        variants Some/0
        binders 2
        block
          return
            local 2 : int
      arm
        wildcard
        block
```

**Rules:**

- **Header.** Structs, then enums (generic instantiations included), in `TypedProgram` order. Each function header is
  `fn <name> <return type>`, followed by every local as `local <id> <name> <type> param|let|var`, in id order.
  (`param` means id < `params`; otherwise `var` if mutable, else `let`.)
- **Expressions.** Every expression line ends with ` : <type>`, using `type_to_string`. Statements and patterns have no
  type suffix.
- **Leaves.** An `int` shows its decimal value. A `str` shows its escaped value. A `bool` shows `true`/`false`. A
  `local` shows its id and name.
- **Non-leaves.** These print their scalar fields on the head line. Examples: `binary + : int`, `call fib : int`,
  `builtin len : int`, `variant Option Some 0 : Option[int]`, `field .x : int`,
  `try Some/0 None/1 -> Option[int] None/1 : int` (with a `fail-payload <type>` line when it exists). Their children
  follow on indented lines.
- **Optional parts.** An absent `else`, return value or binder prints `none`.
- **Lists.** Lists such as call args, array elements and match arms are printed one child per line. An empty list
  prints nothing.
- **Strings.** Strings are printed between `"` and `"` over their **UTF-8 bytes**. `"` becomes `\"`, `\` becomes `\\`,
  newline becomes `\n` and tab becomes `\t`. Any other byte below 0x20 or at 0x7f and above becomes `\xHH` (lowercase
  hex). The TypeScript printer encodes to UTF-8 first, so UTF-16 versus bytes can't cause a mismatch.

The plan fixes the exact head-line spelling of every node kind in one table, which both printers implement. The
examples above are normative for the kinds they show.

## 5. Tests

- **`tests/typed_aster.test.ts`.** It builds `typed.aster` once (as `check_aster.test.ts` does, with `-Werror`). Its
  corpus is every `.aster` under `tests/programs/` that `runFrontend` accepts, the compiler closure under
  `packages/asterc-self/`, and every `tests/programs/programs/fixtures/typed_*.txt`. For each one, `typed.aster`'s
  stdout must equal `dumpTyped(runFrontend(X).typed)`, its stderr must be empty and it must exit 0. Programs with
  errors are already covered by `check_aster.test.ts`, so they are left out here.
- **Focused fixtures, `fixtures/typed_*.txt`.** Each is small and covers one construct family:
  - literals: int limits, chars, escaped strings and non-ASCII strings;
  - operators, short-circuiting and `EnumCompare`;
  - calls and every builtin, including `read_file` and `never` builtins;
  - places (local, field and index assignment, and compound assignment);
  - `if` (statement and expression), `while`, `for` over a range and over an array, and `break`/`continue`;
  - `match` with each pattern kind, or-patterns, binders and wildcards, as a statement and as an expression;
  - `?` on `Option` and on `Result`;
  - `let … else`, chains of `if let` with `else if let` / `else if` / `else`, and `never` arms;
  - shadowing in nested scopes, which pins down local-id order.
- **The existing suites.** `lex_aster`, `parse_aster`, `check_aster`, the golden tests and the TypeScript unit tests
  pass unchanged apart from paths. Their corpora gain `packages/asterc-self/` in place of the moved files.
- **The dump printer itself.** `tests/typed_dump.test.ts` checks `dumpTyped` on two small programs against inline
  expected text. That anchors the format independently of the Aster side.

## 6. Order of work

1. **Move.** `git mv` the four libraries to `packages/asterc-self/` and update imports and test corpora. Nothing else
   changes, and it is its own commit.
2. **TypeScript `dumpTyped`** and its unit test.
3. **The typed-tree types and `typed_dump.aster`.** Add `typed.aster` and `typed_aster.test.ts`. The bodies start out
   empty, so the test is expected to fail until the work is done; it is not skipped.
4. **Typed nodes, one construct family per task**, each adding its fixture and turning more of the corpus green:
   - literals and names,
   - operators and calls/builtins,
   - places and assignment,
   - `if`/loops/`break`/`continue`,
   - `match` and patterns,
   - `?`,
   - `let … else` and `if let`.
5. **Full corpus green**, including the compiler checking itself. Then the friction log.

The `check_aster` summary test must stay green after every task, not only at the end.

## 7. Risks

- **Size.** `checker.aster` is about 2.5k lines, and this touches most of its 98 functions. Doing one construct family
  per task and keeping the summary test green after each limits the blast radius.
- **Local-id drift.** Desugaring `let … else` declares binders *after* the match is checked. A wrong order shows up
  first as a `local` line in the dump, which is the point of having the dump.
- **Memory and speed.** The tree is retained for the whole program. `check.aster` checks itself in 0.03 s and the
  runtime never frees anything. If `typed.aster` checking the compiler closure gets slow, measure it and log it; it
  isn't a blocker for #16.

# parse.aster: the Aster Parser in Aster (Design)

**Date:** 2026-10-03
**Status:** Approved in brainstorming
**Builds on:** [`2026-10-02-aster-v0.3-design.md`](2026-10-02-aster-v0.3-design.md). No language changes.

## 1. Purpose

v0.1–v0.3 gave Aster enough to start self-hosting, and `programs/lex.aster` was the first piece. This is the second: the Aster parser, written in Aster, held to byte-for-byte parity with the TypeScript parser in `packages/asterc/src/parser/parser.ts`.

It is written with the language as it stands. Whatever hurts goes into a friction log, and that log scopes the v0.4 language milestone.

### Success criteria

1. `tests/programs/programs/parse.aster` is a golden program. It parses the file named by its only argument and prints the AST and the syntax diagnostics in the format in §3.
2. `tests/parse_aster.test.ts` runs it on every `.aster` file in `tests/programs/` (itself included) and on every `fixtures/lex_*.txt` and `fixtures/parse_*.txt`, and checks that its stdout and exit code equal the TypeScript lexer and parser's output, rendered in the same format. No file is skipped.
3. `docs/self-host/friction.md` records what hurt while writing `lex.aster` and `parse.aster` and ends with a ranked v0.4 shortlist.
4. `pnpm test`, `pnpm lint` and `pnpm typecheck` pass. Compiler source is unchanged unless a compiler bug turns up. Any such fix lands in its own commit and is noted in the friction log.

### Non-goals

Language changes, a self-hosted checker or code generator, sharing code between `lex.aster` and `parse.aster` (Aster has no modules), and performance work.

## 2. Structure

`parse.aster` is self-contained.

- **Lexer.** A copy of `lex.aster`'s lexer. `lex()` keeps its signature and its token and error output. The copy drops `report` and `main`. `Token` gains nothing: the parser reads token text with `substring(src, t.start, t.end)`.
- **AST.** Enums and structs that mirror `ast.ts`. Each node with several fields is a struct wrapped in an enum variant, e.g. `Expr::Binary(BinaryExpr)`, and spans are `start`/`end` int fields. Items go into one `[Item]` array in source order, so no merge step is needed. `Expr` has an extra `Bad` variant that a failed parse returns (§4). It never reaches output.
- **Parser.** A `Parser` struct holding the tokens, `src`, `pos`, `errors: [LexError]` (the same `start end message` shape), `no_struct_lit: bool` and `failed: bool`. One function per TS parser function, with the same names in snake_case, so the two can be read side by side.
- **Printer.** One function per AST category that prints the format in §3.
- **`main(args)`.** The same usage and read-error handling as `lex.aster`. It prints the AST, then the lexer's errors, then the parser's errors, and returns `1` if there were any errors, otherwise `0`.

Integer literals: the TS parser range-checks `bigint` values. `parse.aster` cannot hold out-of-range values, so it works on digit strings. It strips leading zeros (keeping a lone `0`) and compares the result against `9223372036854775807`, or against `9223372036854775808` after a folded unary minus, by length and then byte by byte. The printed value is that canonical digit string, prefixed with `-` when negative and non-zero, which matches `bigint.toString()`.

## 3. Output format

One line per AST node in source order, indented two spaces per tree depth. There are no closing parentheses: the indentation is the tree. That keeps both printers to one `print` per node, and a failing diff points at the exact node. Every line starts with a tag and the node's span `S E` as byte offsets, then any attributes. Absent optional children print as a line holding only `-`.

| Node | Line | Children, in order |
|------|------|--------------------|
| fn | `fn S E name NS NE` | `param` lines, return type or `-`, block |
| param | `param NS NE name` | type |
| struct | `struct S E name NS NE` | `field` lines |
| field decl | `field NS NE name` | type |
| enum | `enum S E name NS NE` | `variant` lines |
| variant decl | `variant NS NE name` | payload types |
| named type | `type S E name` | — |
| array type | `array-type S E` | element type |
| block | `block S E` | statements |
| let / var | `let S E name NS NE` / `var …` | type, init |
| assign | `assign S E op` | target, value |
| if | `if S E` | cond, then block, else (block, `if` or `-`) |
| while | `while S E` | cond, body |
| for range | `for-range S E name NS NE` | start, end, body |
| for each | `for-each S E name NS NE` | iterable, body |
| break / continue | `break S E` / `continue S E` | — |
| return | `return S E` | value or `-` |
| expr stmt | `expr S E` | expression |
| match stmt | `match S E KS KE` | scrutinee, `arm` lines |
| match expr | `match-expr S E KS KE` | scrutinee, `arm` lines |
| arm | `arm` | pattern, body (block or expression) |
| wildcard | `wildcard S E` | — |
| variant pattern | `pattern S E Enum ES EE Variant VS VE` | binders |
| binder | `bind S E name`, or `_` for a `_` binder | — |
| int | `int S E value` | — |
| string | `string S E raw` | — (`raw` is the literal's source text, quotes and escapes included) |
| bool | `bool S E true` | — |
| name | `name S E x` | — |
| unary | `unary S E op` | operand |
| binary | `binary S E op` | left, right |
| call | `call S E` | callee, arguments |
| if expr | `if-expr S E` | cond, then, else |
| field access | `get S E field FS FE` | object |
| struct literal | `struct-lit S E name NS NE` | `init` lines |
| field init | `init NS NE name` | value |
| index | `index S E` | array, index |
| array literal | `array-lit S E` | elements |
| variant value | `variant-lit S E Enum ES EE Variant VS VE` | arguments |

After the AST, one `error S E message` line per diagnostic: lexer diagnostics in the order the lexer produced them, then parser diagnostics in the order the parser produced them. These are the raw `lex()` and `parse()` results, before the driver sorts and dedupes them. Exit code `0` with no diagnostics, `1` with any, `2` for usage or read errors.

Example, for `fn main(): int { let x: int = 10; return x; }`:

```
fn 0 45 main 3 7
  type 11 14 int
  block 15 45
    let 17 33 x 21 22
      type 24 27 int
      int 30 32 10
    return 34 43
      name 41 42 x
```

## 4. Error recovery without exceptions

The TS parser's `fail()` throws `SYNC`. `parseBlock` catches it per statement and runs `syncStatement`, and `parseProgram` catches it per item and runs `syncToItem`. `parse.aster` reproduces this with the `failed` flag:

- `fail(p, message, start, end)` records the diagnostic and sets `p.failed`. `expect` calls `fail` on a mismatch and returns the current token unchanged.
- Every parse function checks `p.failed` immediately after each call that can fail. If it is set, the function returns at once with a placeholder (`Expr::Bad`, an empty block, and so on) and consumes no more tokens. A missed check shows up as an extra diagnostic or a different recovery point, and the conformance test catches it.
- `parse_block` and `parse_program` are the catch points: when a statement or item comes back failed, they drop it, clear `p.failed` and call `sync_statement` / `sync_to_item`.
- `withStructLits` becomes save, set, call, restore. The restore runs before the `failed` check, so the flag is right whether or not the call failed. That's what the TS `finally` does.
- The out-of-range integer diagnostic is recorded without failing, as in TS.

## 5. Testing

`tests/parse_aster.test.ts` follows `tests/lex_aster.test.ts`:

- `beforeAll` compiles `parse.aster` with `-Werror`.
- An oracle in the test file renders the TS `lex()` + `parse()` result in the §3 format. It merges `functions`, `structs` and `enums` by span start into source order, converts UTF-16 offsets to byte offsets in the raw file (accounting for a BOM, as the lex test does) and takes a string literal's raw text from the source.
- Each corpus file is one case comparing `{ stdout, status }`.
- Fixtures under `tests/programs/programs/fixtures/` cover what the golden corpus may not:
  - `parse_sample.txt`: one of each construct. It is also `parse.aster`'s own `expect-args` fixture.
  - `parse_errors.txt`: errors inside nested blocks, garbage between items, a missing `else` in an if-expression, chained comparisons, `V()`, a missing `}` at EOF, and an error inside a struct-literal header that has to restore `no_struct_lit`.
  - `parse_ints.txt`: leading zeros, `9223372036854775807`, `-9223372036854775808`, out-of-range values both ways, and `-0`.
  - The existing `lex_*.txt` fixtures are parsed too, which covers parsing after lexical errors and with a BOM.

`parse.aster` is built up construct by construct, TDD style: types and items, then statements, expressions, match and patterns, and finally recovery. While it is incomplete, a skip-list in the test file names the files that aren't expected to pass yet. It has to be empty before merge.

## 6. Friction log

`docs/self-host/friction.md` gets one entry per pain point: what hurt, a short snippet, a severity (`annoying` / `costly` / `blocking`) and the workaround used. It is seeded from `lex.aster` and added to while writing `parse.aster`. It ends with a ranked shortlist of candidate v0.4 features, which is the input to the v0.4 spec.

## 7. Docs

The README gets a quick-start line for `parse.aster` and a sentence in the Tests section about `tests/parse_aster.test.ts`. `docs/spec/language.md` does not change.

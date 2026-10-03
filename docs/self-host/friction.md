# Self-hosting friction log

Pain points found while writing Aster's own compiler in Aster. Each entry says what hurt, gives a severity
(`annoying`, `costly` or `blocking`) and describes the workaround. This log fed the v0.4 and v0.5 language specs. Entries 1 and 3 and entries 4 to 6 are now resolved.

Sources so far: `tests/programs/programs/lex.aster` (v0.3) and `tests/programs/programs/parse.aster`, which was 1,797 lines when this log was written (1,501 after v0.5)
and has byte-for-byte parity with the TypeScript parser.

## Entries

### 1. No way to propagate a failure (costly)

The TypeScript parser throws `SYNC` on a syntax error and catches it at statement and item boundaries. Aster has no
exceptions and no `Result`/`?`, so every call that can fail is followed by a check:

```aster
let ty: TypeExpr = parse_type(p);
if p.failed {
    return bad_item();
}
```

`parse.aster` has **100** of these. A single missed check doesn't crash. It changes which tokens the parser consumes,
so the diagnostics drift and only the conformance suite notices. This is the biggest cost to readability and correctness.

**Workaround:** a `failed` flag on the parser, plus placeholder return values (entry 3).

**Resolved in v0.5.** Parse functions return `Option[X]` and propagate failure with `?`. `parse.aster` went from 1,847 to
1,501 lines. `p.failed` went from 110 occurrences to 0, and `?` went from 0 uses to 116. The five `return Option::None`
left are real failure points, each straight after a `fail`. The two recovery points (the statement loop in `parse_block`
and the item loop in `parse_program`) `match` on the `Option` and resynchronise on `None`.

### 2. No modules or includes (costly)

`parse.aster` starts with a 184-line copy of `lex.aster`'s lexer. The checker, IR and code generator would each have to
copy everything before them, so a single-file compiler only gets larger from here.

**Workaround:** copy and paste. `tests/lex_aster.test.ts` guards the original, and the parse test guards the copy only
indirectly.

### 3. No generics, so every optional and every placeholder is hand-written (annoying)

There is `MaybeType`, `MaybeExpr` and `Else { None, … }`, three enums that would be one `Option[T]`. Because there's no
null, a function that bails out still has to return *something* of its type, which takes six `bad_*()` constructors
(`bad_expr`, `bad_type`, `bad_block`, `bad_stmt`, `bad_pattern`, `bad_item`).

**Workaround:** one hand-written `Maybe*` enum per type, and placeholder values that are never printed.

**Resolved in v0.5.** `Option[T]` and `Result[T, E]` are predeclared generic enums, and users can declare their own. In
`parse.aster` the `Maybe*` enums went from 2 to 0, the `bad_*` placeholders from 111 occurrences to 0, and the `failed`
field is gone. `Else` stays, since it isn't an option. `read_file` returns `Result[string, string]` and `ReadResult` is
removed.

### 4. Diagnostics can only go to stdout (costly for a real compiler)

`print` is the only output, so `parse.aster` interleaves its tree and its errors on stdout. That's fine for a
conformance test, but a compiler driver needs errors on stderr and an exit code. (Already listed as missing in v0.3.)

**Workaround:** errors print last, in a fixed `error S E message` form.

**Resolved in v0.4.** The `eprint` and `exit` builtins exist. `lex.aster` and `parse.aster` now write every diagnostic
to stderr with `eprint` and exit with 1 when there were any. Usage and read errors use `exit(2)`, and stdout holds only
tokens or the tree. The conformance tests compare stdout and stderr separately. A `match` arm ending in `exit(2)` needs
no `return` (see `main` in `lex.aster`).

### 5. No string `match` (annoying)

Token kinds are strings, and dispatch on them is an `if` chain: `parse_statement`, `parse_primary` and `describe` contain
26 `k == "…"` comparisons. A typo in a kind string type-checks fine and silently never matches.

**Workaround:** `if` chains. Converting to a payload-free `Kind` enum would need a string-to-enum table, which is itself an
`if` chain.

**Resolved in v0.4.** `match` accepts string scrutinees, with or-patterns. In `parse.aster`, `k == "…"` comparisons
went from 27 to 3. The three left are boolean values, not dispatch (`k == "var"` and `k == "true"` twice). `contains`
survives only for the `level_ops` lookups in `parse_binary`.

### 6. No character literals (annoying)

The lexer compares bytes against magic numbers (27 of them: `48`, `57`, `34`, `92`, `95` and so on), each needing a
comment or a careful read.

**Workaround:** comments and helper predicates like `is_digit`.

**Resolved in v0.4.** `'a'` is an `int`, and byte tests in both files use character literals. Numeric byte literals left
in `lex.aster`: 6. They are `240`, `224` and `192`, the `utf8_len` thresholds, which need range tests that `match` can't
express (no range patterns), and the BOM bytes `239`, `187` and `191`. `parse.aster` has the same ones in its copied
lexer.

**`if` chains kept on purpose:**
- `lex.aster` (and the copy in `parse.aster`): the main dispatch loop, because each branch tests a different predicate or
  lookahead; `lex_char`'s error chain, because the order of the checks matters; the `lex_string` and `lex_char` loop
  bodies, which use `continue` and `break`; and `utf8_len`, which tests ranges.
- `parse.aster`: `parse_program` (a three-way test through `at_item`), `parse_postfix` (`eat` consumes the token as a
  side effect of the test), `parse_unary` and `expect` (single tests), and `bom_len` (a three-byte check).

### 7. No shared fields across enum variants (annoying)

Every AST node needs a span, but reading one from an enum would need a `match` over every variant. Instead each node is
a struct that wraps the enum: `struct Expr { start: int, end: int, node: ExprNode }`. It works well, but it doubles the
type count and adds a `.node` to every match.

**Workaround:** the struct-wraps-enum pattern.

### 8. Small gaps (annoying)

- **No `do … while`.** Comma-separated lists are written `var more: bool = true; while more { …; more = eat(p, ","); }`.
- **No string ordering.** `fits()` range-checks integer literals by comparing lengths and then bytes, because there's no
  `<` on strings and no wider integer.
- **No string repeat.** Indentation is a `for _i in 0..depth { pad += "  "; }` loop.
- **No `match` on ints.** The binary-operator table `level_ops(level)` is an `if` chain. *Resolved in v0.4:* it is now a
  `match` on ints.

### 9. Bugs the self-hosted side found in the bootstrap compiler

- **Fixed:** the TypeScript lexer advanced by two on a one-character punctuator at the very end of the file, so
  `fn main() {}` with no trailing newline gave `}` a span past the end of the file. `parse.aster`'s lexer had the
  right bounds check. The fix is in its own commit, and `fixtures/parse_no_newline.txt` pins it.
- **Open:** for an invalid escape followed by an astral character (`"\😀"`), the TypeScript lexer's message quotes half
  of a surrogate pair. `lex.aster` and `parse.aster` quote the whole character. Spans agree, and no fixture covers it.

## What worked well

- Recursive enums and structs, with references, model the AST directly. The 1,646-line file type-checked on its first
  compile.
- Exhaustive `match` guarantees the printer handles every node kind; a new variant without a printer arm won't compile.
- Performance doesn't matter yet: each conformance run takes about 10 ms.

## Found while building v0.5

- **No `defer` or `finally`.** `parse.aster` saves and restores `no_struct_lit` around some sub-parses. With `?` an early
  return skips the restore, so five sites needed split-out helpers: the inner function does the fallible work and
  returns an `Option`, and the outer one restores the flag before it propagates. Each such site now has two names for one
  value.
- **Wrapping success is noisy.** About 35 `return Option::Some(...)` wraps remain. A cheap way to lift a value into an
  `Option` would help, but it isn't a gap that justifies new syntax yet.
- Inference never needed an annotation, and `unwrap_or` and `?` in `main` were never wanted.

## Found while building v0.4

- Error recovery in pattern syntax hides later errors in the same function, so the error fixtures use one pattern error
  per function.

## Shortlist (ranked)

Items 1 and 3 were done in v0.5 and items 4 to 6 in v0.4. Item 2 remains.

1. ~~**Error propagation**~~: entry 1. Done in v0.5 (`?` on `Option` and `Result`). It removed the 110 `p.failed`
   checks and uses.
2. **Modules or file includes**: entry 2. Without them the checker can't be written without copying 1,600 lines.
   Planned for v0.6.
3. ~~**Generic enums**~~: entry 3. Done in v0.5 (`Option[T]`, `Result[T, E]` and user-declared generic enums).
4. ~~**Writing to stderr and exiting with a code**~~: entry 4. Done in v0.4 (`eprint`, `exit`).
5. ~~**`match` on string and int values**~~: entries 5 and 8. Done in v0.4.
6. ~~**Character literals**~~: entry 6. Done in v0.4.

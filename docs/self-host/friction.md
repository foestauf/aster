# Self-hosting friction log

Pain points found while writing Aster's own compiler in Aster. Each entry says what hurt, gives a severity
(`annoying`, `costly` or `blocking`) and describes the workaround. This log feeds the v0.4 language spec.

Sources so far: `tests/programs/programs/lex.aster` (v0.3) and `tests/programs/programs/parse.aster`, which is 1,646 lines
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

### 4. Diagnostics can only go to stdout (costly for a real compiler)

`print` is the only output, so `parse.aster` interleaves its tree and its errors on stdout. That's fine for a
conformance test, but a compiler driver needs errors on stderr and an exit code. (Already listed as missing in v0.3.)

**Workaround:** errors print last, in a fixed `error S E message` form.

### 5. No string `match` (annoying)

Token kinds are strings, and dispatch on them is an `if` chain: `parse_statement`, `parse_primary` and `describe` contain
26 `k == "…"` comparisons. A typo in a kind string type-checks fine and silently never matches.

**Workaround:** `if` chains. Converting to a payload-free `Kind` enum would need a string-to-enum table, which is itself an
`if` chain.

### 6. No character literals (annoying)

The lexer compares bytes against magic numbers (27 of them: `48`, `57`, `34`, `92`, `95` and so on), each needing a
comment or a careful read.

**Workaround:** comments and helper predicates like `is_digit`.

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
- **No `match` on ints.** The binary-operator table `level_ops(level)` is an `if` chain.

## What worked well

- Recursive enums and structs, with references, model the AST directly. The 1,646-line file type-checked on its first
  compile.
- Exhaustive `match` guarantees the printer handles every node kind; a new variant without a printer arm won't compile.
- Performance doesn't matter yet: each conformance run takes about 10 ms.

## v0.4 shortlist (ranked)

1. **Error propagation**: a built-in `Result`-style return with a `?`-like operator, or exceptions. It removes the
   100 checks from entry 1. It likely needs generics or a predeclared generic enum (see 3).
2. **Modules or file includes**: entry 2. Without them the checker can't be written without copying 1,600 lines.
3. **Generic enums** (at least `Option[T]`/`Result[T, E]`): entry 3, and the foundation for 1.
4. **Writing to stderr and exiting with a code**: entry 4. Small, and needed before a self-hosted driver.
5. **`match` on string and int values**: entries 5 and 8. This would make kind dispatch a `match`.
6. **Character literals** (`'a'` as an `int`): entry 6. Cheap and purely lexical.

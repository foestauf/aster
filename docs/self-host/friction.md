# Self-hosting friction log

Pain points found while writing Aster's own compiler in Aster. Each entry says what hurt, gives a severity
(`annoying`, `costly` or `blocking`) and describes the workaround. This log fed the v0.4, v0.5, v0.6 and v0.7 language specs. Entries 1 to 6 and 10 are now resolved.
Entries 10 to 16 come from check.aster. Entry 10 scoped v0.7, and the rest feed what comes after.

Sources so far: `tests/programs/programs/lex.aster` (v0.3) and `tests/programs/programs/parse.aster`, which was 1,797 lines when this log was written (1,847 after v0.4 growth, 1,501 after v0.5, 1,524 before the v0.6 split, 1,292 after it)
and has byte-for-byte parity with the TypeScript parser. For check.aster the parser moved into `parser.aster` (995 lines),
leaving `parse.aster` at 322 (the tree printer and `main`). The type checker is `checker.aster` (2,558 lines), with
`loader.aster` (220) and `check.aster` (155). With `lexer.aster` (244) that is 4,172 lines, and check.aster matches the
TypeScript front end byte for byte on 205 corpus files.

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

`parse.aster` has **100** of these (110 `p.failed` occurrences counting the field declaration and the resets). A single missed check doesn't crash. It changes which tokens the parser consumes,
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

**Resolved in v0.6.** `import "path";` loads other files into one flat namespace. The lexer now lives in `lexer.aster`,
imported by both `lex.aster` and `parse.aster`. `lex.aster` went from 302 to 73 lines, `parse.aster` from 1,524 (1,501
after v0.5, then growth from the v0.6 syntax) to 1,292, and the new `lexer.aster` is 236. The self-hosted lexer and parser
total went from 1,826 to 1,601 lines. The copy-paste workaround is gone: both programs share one lexer, and both
conformance suites also lex and parse `lexer.aster` itself.

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

## Found while building the typed program

`checker.aster` now builds the whole typed program, mirroring `check/types.ts` (127 lines of TypeScript), and
`typed_dump.aster` (299 lines, 11 `dump_` functions) prints it. `checker.aster` grew from 2,492 lines to 2,713 (+221), and
`typed.aster` matches `tests/typed_dump.ts`'s dump on every program the TypeScript front end accepts, including the
compiler's own closure. No compiler bug turned up and no file needed a rename.

- **No closures, again: `checkMatch`'s callback.** TS's `checkArm` callback became an `Option[Else]` parameter of
  `check_arms` (its `refutable` argument), which `let ... else` and `if let` use to check their desugared wildcard arm.
  `check_arms` returns parallel `patterns` and `bodies` arrays in `MatchArms`, and the 4 call sites (match statement, match
  expression, `let ... else`, `if let`) index them by position (`m.patterns[1]`, `m.bodies[1]`)
  where TS closes over the arms. Entry 12 already counted the `as_expr` flag.
- **No hex literals, no `for _`.** `dump_escape` spells the bytes it escapes as char literals (`'"'`, `'\\'`, `'\n'`,
  `'\t'`) and the decimals `32` and `127`, because `0x22` doesn't lex. `dump_put`'s indent loop needs a named, unused
  variable (`for i in 0..depth`), which `-Werror` accepts.
- **No `chr`: one-byte strings come from a literal table.** A string literal's decoded value needs a string made from an
  escape's byte. `string_literal_value` has 7 one-byte literals in a `match` (`\n`, `\t`, `\r`, `\0`, `\\`, `\"`, `\'`) and
  copies every other byte with `substring(text, i, i + 1)`. It works because only those 7 escapes exist. A `chr` builtin
  would make it a one-liner, and the dump's `\xHH` output also builds its digits with `substring` on a 16-character
  string.
- **No tag on a variant.** `TVariant` has no tag field, so `check_try` writes the `Option` and `Result` tags as the
  literals 0 and 1 (4 sites, `ok_tag` and `fail_tag` in two places) and `TVariantRef.tag` is the variant's index. It
  relies on index == tag, which `missing_values` already assumed.
- **A `match` arm can't be a block with a trailing value.** A first draft of `typed_pattern` used one and failed with
  `expected ';'`. It became early returns.
- **`?` doesn't work in a function that returns `TExpr`.** `check_generic_variant_expr` needed two `let ... else`
  lookups with `panic` instead.
- **The flat namespace held.** New names: `CheckedStmt`, `CheckedBlock`, `ForBody`, `check_else`, `error_expr`,
  `has_field_init`, `string_literal_value`, `typed_pattern`, `refutable_arms`, plus `dump_`-prefixed dumper functions
  (11). The prefix is what keeps the dumper's names clear of the other 227+ in the closure. Nothing collided.
- **No runner for one TypeScript dump.** Diffing a failing file against TS meant a throwaway vitest file that printed
  `dumpTyped`, because the repo has no `tsx` script. A `pnpm dump-typed <file>` would have saved that on every
  mismatch.
- **Timing.** `typed.aster` on `tests/programs/programs/typed.aster` (the compiler's own front end, 17,287 lines of
  dump) takes 0.03 s and about 28 MB, against 0.03 s and about 16 MB for `check.aster`'s summary. Building the typed
  tree costs memory, not time.

## Found while building check.aster

`checker.aster` ports `check/checker.ts`, `check/generics.ts`, `check/builtins.ts` and `types/type.ts` (1,493 lines of
TypeScript) in 2,558 lines, about 1.7 times as long, though it builds no typed tree. Entries 10 and 11 cost the most.

### 10. Unwrapping an `Option` outside `?` takes a match, a sentinel or a wrapper (costly)

`?` only helps a function that itself returns an `Option` or a `Result`. The checker's functions report an error and
carry on, returning a `Type` or a `bool`, so `checker.aster` uses `?` **0** times in 2,558 lines (`parser.aster` uses it
119 times). Every lookup is unwrapped by hand, and there's no way to bail out of a binding:

```aster
var si: int = -1;
match find_struct(ctx.env, name.name) {
    Option::Some(i) => {
        si = i;
    }
    Option::None => {}
}
if si < 0 {
    report(ctx.env, "unknown struct '" + name.name + "'", name.start, name.end);
    return Type::Error;
}
```

The short form doesn't compile. `return` isn't an expression, a block can't be a match-expression arm, and an arm that
calls `panic` is typed `void`, so `let i: int = match o { Option::Some(i) => i, Option::None => panic("…") };` fails
with `match arms have different types: int and void`.

`checker.aster` has 56 `Option::None =>` arms, and 26 of them are an empty `{}` (an `if let` written out in full). There
are four find-or-bail sentinels: `oi` and `ri` in `check_try` (the same dance twice, once per `tryable` call), `si` in
`check_struct_lit`, and `name = ""` in `check_call` (the same shape, but on an `ExprNode`). Five functions exist only
to turn an `Option` into a `bool` (`is_found`, called 15 times, plus `is_signature_builtin`, `is_primitive`, `is_bound`
and `is_local`), and `find_signature_of` only turns an `Option[int]` into an `Option[Signature]`. In
`check_generic_variant_expr` the same `panic("internal: …")` is written out in two nested `None` arms, because neither
arm can leave early.

**Workaround:** sentinel `var`s, wrapper predicates and empty arms. Any one of these would remove most of it:
`let … else { … }`, a diverging type for `return`, `panic` and `exit` so that they can end a match-expression arm, or
`if let`. Generic functions alone would only fold the five wrappers into one `is_some[T]`.

**Resolved in v0.7.** `let P = e else { … };`, `if let`, the `never` type and block arms in `match` expressions all
shipped, and `checker.aster` was rewritten with them. From `e8b38e8` to `bf6fa19`:

| Measure | Before | After |
| --- | ---: | ---: |
| `checker.aster` lines | 2,720 | 2,492 |
| Empty `Option::None => {}` arms | 29 | 0 |
| All `Option::None =>` arms | 59 | 9 (each a full two-arm match) |
| `is_found` | 16 calls on 14 lines plus 1 definition | 0, deleted |
| Wrapper definitions (`is_found`, `is_signature_builtin`, `is_primitive`, `is_bound`, `is_local`) | 5 | 1 (`is_primitive`) |
| Find-or-bail sentinels (`oi`, `ri`, `si`, `name = ""`) | 4 | 0 |
| Duplicated `panic("internal: …")` in `check_generic_variant_expr` | 2 | 1 |
| `let … else` statements | 0 | 23 in `checker.aster`, 1 in `loader.aster` |
| `if let` statements | 0 | 61 in `checker.aster`, 1 each in `parser.aster` and `loader.aster` |
| `_ => {}` arms in `checker.aster` | 25 | 5 |

`?` now appears 6 times in `checker.aster` code, in `tryable`, `find_field`, `variant_payload` and
`resolve_alternative`, where an `Option`-returning helper made it possible. The sentinel dance is gone, so a forgotten
`if si < 0` can no longer type-check. `parse_if_stmt` lost its three placeholder variables, and each driver
(`lex.aster`, `parse.aster`, `check.aster`) gained a `die(msg): never` helper. The "before" counts are
higher than the ones quoted above (2,558 lines, 26 empty arms), because `checker.aster` kept growing between that
measurement and `e8b38e8`.

### 11. No maps or sets (costly)

The TS checker leans on `Map` and `Set`: 38 lines of `checker.ts`, `generics.ts` and `load.ts` name one. Aster only has
arrays, so every lookup is a linear-search helper:

```aster
fn find_struct(env: Env, name: string): Option[int] {
    for i in 0..len(env.structs) {
        if env.structs[i].name == name {
            return Option::Some(i);
        }
    }
    return Option::None;
}
```

`checker.aster` has 12 `find_*` lookups. Seven are this exact loop over a different array (`find_signature`,
`find_struct`, `find_enum`, `find_template_in`, `find_tfield`, `find_tvariant`, `find_node`), and `find_template` just calls
`find_template_in` on `env.templates`. Two search
backwards, so that a later entry wins as `Map.set` overwrites (`find_local`, `find_binding`), and two are built from the
others (`find_field`, `find_signature_of`). Sets became `[string]` plus `contains`, with 13 calls (12 in `checker.aster`, 1 in `loader.aster`: covered
pattern keys, seen params, fields and variant names, expanding enums, the loader's seen files). Tarjan's SCC in `generics.ts` keeps its state in five Maps and
Sets. The port turned them into parallel arrays (`nodes`, `successors`, `index`, `low`, `on_stack`, `component`) in an
`ExpansionGraph` struct, with `intern_node`, `find_node` and a string `node_key`. Scopes are `[[Local]]` in place of
`Map<string, Local>[]`. Speed isn't the problem (check.aster checks itself in 0.03 s). The cost is code and the
easy-to-miss last-wins search direction.

**Workaround:** one hand-written search per array type, and `contains` for sets.

### 12. No closures (annoying)

Five TS closures became top-level functions that take their captures as parameters: `walk` and Tarjan's `visit` in
`generics.ts` (`walk_expansion`, `scc_visit`, which take the whole graph), `say` in `resolveType` (now takes `quiet`),
`checkArgs` in `checkCall` (`check_args`) and `checkMatch`'s `checkArm` callback. The last one costs the most. Its two
callers, the match statement and the match expression, pass different callbacks, so `check_arms` takes an `as_expr`
flag and an `expected` type and returns a `MatchArms` struct in which each arm records either its type or whether it
diverges:

```aster
fn check_arms(ctx: Ctx, keyword: Ident, scrutinee: Expr, arms: [Arm], as_expr: bool, expected: Option[Type]): MatchArms {
```

**Workaround:** lift the closure and pass the captures in, or turn a callback into a flag.

### 13. No default arguments or overloading (annoying)

Every optional parameter becomes a second function. `resolveType(env, ref, bindings?, quiet?, instantiates?)` is
`resolve_type_with` with all five, plus a two-argument `resolve_type`. The wrapper is called 5 times. Of the other 5
calls to `resolve_type_with`, 2 only pass their own arguments on, and 3 spell out non-default values. The same shape
shows up three more times: `lex` and `lex_from` (the loader strips the BOM itself, so it lexes from 0),
`new_parser` and `new_parser_at` (the loader's global span base), and `find_template` and `find_template_in` (the
same search over `env.templates` or over a bare array).

```aster
fn resolve_type(env: Env, ref: TypeExpr): Type {
    return resolve_type_with(env, ref, [], false, true);
}
```

**Workaround:** a thin wrapper per default and a suffix (`_with`, `_from`, `_at`, `_in`) on the full form.

### 14. The flat namespace: every collision and rename (annoying)

check.aster sees 227 top-level names from five files (`lexer.aster`, `parser.aster`, `loader.aster`, `checker.aster`
and `check.aster`). Counting every name clash this port ran into:

- **Collisions between files: 1.** Tarjan's `visit` closure in `generics.ts` became `scc_visit`, because
  `checker.aster` imports `loader.aster`, whose `visit` is `load.ts`'s `visit`. Two TS modules can both have a `visit`.
  One Aster program can't. That makes 2 in total, with v0.6's `peek_byte`.
- **Collisions inside one file: 1.** TS's `checkMatch` became `check_arms`, because the match-statement wrapper the
  port added already took `check_match`. Qualified names wouldn't fix this one.
- **Avoided by design: 1.** TS's statement result type `Checked<T>` would have clashed with check.aster's `Checked`
  result struct. Statements return a plain `bool` (diverges) instead, so it never existed.
- **Shadowing, renamed for clarity: 1.** A local `fits` in `check_compound` would have shadowed `parser.aster`'s `fits`.
  That's legal, but it became `applies`.
- Other renames weren't collisions: `check` → `check_program`, `returnType` → `ret`, `type` → `ty`, the closure lifts
  in entry 12 and the `_with` and `_in` forms in entry 13.

**Workaround:** pick a name nothing else uses. It's cheap so far, but each new library adds to every importer's list of
names to avoid.

### 15. Path identity is lexical, and `read_file` errors carry the path (annoying)

TS dedupes imports by `realpath`. Aster can't get one, so `loader.aster` normalises the display path lexically: it
collapses `//`, drops `.` and resolves `name/..`. That agrees with TS on every corpus case (cycles, diamonds,
self-imports, subdirectories, and the three spellings in `fixtures/check_paths.txt`). It disagrees for symlinked paths,
and for a relative root whose imports climb out of the working directory and back in, which TS resolves against the
working directory. Nothing tests either case.

Separately, `read_file`'s `Err` text is `<path>: <reason>`, while the compiler's `cannot import` message quotes only the
reason. The loader strips the prefix:

```aster
let prefix: string = target + ": ";
reason = msg;
if len(msg) >= len(prefix) && substring(msg, 0, len(prefix)) == prefix {
    reason = substring(msg, len(prefix), len(msg));
}
```

**Workaround:** lexical normalisation, and string surgery on the error text. A `real_path` builtin, and either a bare
reason or a structured error, would close both gaps. Neither matters until a driver must dedupe symlinked imports or load a relative root that climbs out of the working
directory and back (a `cwd` builtin alongside `real_path` would close that).

### 16. Small gaps (annoying)

- **No `join`.** Comma-separated lists are built by hand three times (`instance_name`, `type_list` in `check.aster`,
  and the `missing 'A', 'B'` list in `check_arms`).
- **No sort.** `sort_diags` is a hand-written stable insertion sort followed by a backwards scan to dedupe.
- **No binding pattern in a literal match.** `other => other` in a `match` on an int doesn't parse, because an
  identifier starts a variant pattern (`expected '::', found '=>'`). `escape_value` uses `_ => c`.
- **No test for an enum variant without a `match`.** TS compares `t.kind === 'int'`. The port goes through
  `kind_of_type(t)`, which returns the kind as a string (15 calls), and `type_equals` needs a nested `match` per variant
  to compare two values.
- **No struct extension.** `Ctx` holds an `env: Env` rather than extending it, so `ctx.env` appears 91 times.
- Entry 7 still applies: `checker.aster` reads `.node` 21 times.

### Bugs, and things that turned out not to be gaps

- **No compiler bug found.** The one parity bug was in the port: the loader strips a BOM, then `lex` stripped a second
  one where TS reports `unexpected character`. `lex_from` fixed it (entry 13), and `fixtures/check_bom2.txt` pins it.
- **`continue` works inside a match arm.** `collect_signature` was split out of `check_program`'s pass-1 loop on the
  belief that it didn't, but a `continue` in an arm of a `match` inside a `for` compiles and runs. That function was a
  style choice, not a workaround.
- **`defer`: no new evidence.** The checker never uses `?`, so its four scope and loop push/pop pairs have no early exit
  between them. The five save/restore sites in `parser.aster` are unchanged.

### What worked well

- Generics carried the port: `Option[[string]]`, `[Option[ResolvedAlt]]` and the `FoundVariant` enum all needed no
  workaround.
- Five files with `import` and no build step. The checker is split across files the way the TS front end is.
- Parity came in stages: the corpus went from 181 skipped files to 0 over four tasks, and the last stage passed every
  file on its first build.
- Struct values are heap references, so `Ctx` and `Env` shared mutation the way the TS objects do.
- check.aster checks its own 4,172 lines in 0.03 s and about 16 MB.

## Found while building v0.7

`checker.aster` shrank by 228 lines (2,720 to 2,492). The other files barely moved: `parser.aster` +1, `loader.aster` -4,
and each driver +2.

- **Wrappers and sentinels that stayed.**
  - `is_primitive` stays: its 2 calls sit inside `||` expressions, where there's no statement to put an `if let` on.
  - `collect_types` keeps its `name`/`kind` sentinel, because or-patterns can't bind. The two variants carry
    different payload types (`StructDecl` and `EnumDecl`), so one `let … else` can't express it.
- **What the new forms couldn't express well.**
  - A `let … else` with a guard, or `if let` chains (`if let A = x && let B = f(a)`). `check_try` fails two ways with
    one message and has to hoist the message. Several two-level pyramids, a variant test that feeds a lookup, would flatten: `ExprNode::Field`
    (`Type::Struct`, then `find_field`), `check_arms` and `check_binary` (`Type::Enum`, then `find_enum`),
    `enum_base_name`, and `resolve_alternative`/`check_arms` (`PatternNode::Variant`, then `resolved[0]`).
    `check_generic_variant_expr` is three levels deep (`Some(t)`, then `Type::Enum`, then `find_enum`).
  - A `let … else` whose `else` block can see the `Err` payload. `read_file` in the three drivers' `main`s and in
    `load_import` (four sites) stays a `match`, because the failure arm needs `msg`.
  - `if let` as an expression, or as a boolean test (`is_some`). `check_call`'s builtin-versus-user signature table is
    a `var` plus an `if let`, and `is_primitive` is the same shape.
  - Negated patterns. `if let Option::None = …` works but reads oddly, and `resolve_pattern_variant`'s "anything but
    `Missing`" has no form at all.
  - `while let` has no site. The checker's search loops index arrays, and the parser's loops are driven by `eat`/`at`.
- **The drivers' helper is `die`**, because `parser.aster` already has `fail`. The flat namespace shows up again.
- **Compiler bugs found during the milestone**, all fixed before merge:
  - an inferred `never` (`[panic(..)]`, `Option::Some(panic(..))`) crashed lowering,
  - `never == never` type-checked,
  - `pattern always matches` fired alongside binder errors.
- **No new evidence for `defer`.**

## Found while building v0.6

- **The flat namespace cost one rename.** The lexer's byte reader `peek` became `peek_byte`, because the parser has its
  own `peek`. That is the first concrete cost of having no qualified names. Nothing else collided.
- **No `defer`** is still open from v0.5.
- A checker written in Aster (`check.aster`) is the next dogfood target, importing `lexer.aster` and the parser. The log
  should keep counting flat-namespace collisions as it grows.

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

The v0.4 to v0.7 shortlist items are done: error propagation and generic enums in v0.5
(entries 1 and 3), modules in v0.6 (entry 2), stderr with exit codes, `match` on strings and ints, and character
literals in v0.4 (entries 4, 5 and 6, and `match` on ints from entry 8), and unwrapping an `Option` without `?` in v0.7
(entry 10, previously item 1 here: `let … else`, `if let`, `never` and diverging match arms).

This is the shortlist for what comes after v0.7, ranked by what made the checker port longer, buggier or harder to read.
Maps and sets (item 1) are next. Open items from earlier milestones are ranked on the same terms.

1. **Maps and sets**: entry 11. A built-in map keyed by `string` or `int` (that covers every use here), and a set or an
   idiom for one. The evidence is 12 `find_*` lookups (7 of them the same loop), 13 `contains` calls standing in for
   sets, Tarjan's five Maps and Sets as six parallel arrays, and two last-wins backwards searches that copy `Map.set`
   semantics by hand. TS names a `Map` or `Set` on 38 lines.
2. **Closures**: entry 12. Five closures were lifted. One callback (`checkArm`) turned into an `as_expr` flag and a
   result struct.
3. **Default arguments**: entry 13. Four wrapper and full-form pairs (`resolve_type`/`resolve_type_with`,
   `lex`/`lex_from`, `new_parser`/`new_parser_at`, `find_template`/`find_template_in`).
4. **Qualified names**: entry 14. Two cross-file collisions in two milestones (`peek_byte`, `scc_visit`). It's cheap so far,
   but 227 shared names grow with every library. It ranks above item 5 because collisions force renames and grow with
   every new library, while `.node` is only noise.
5. **Shared fields across enum variants**: entry 7. `.node` appears 21 times in `checker.aster` and the AST still
   doubles its types.
6. **Small gaps**: entries 8 and 16. `join` (3 hand-written loops), a sort (1 insertion sort), binding patterns in
   literal matches, string ordering, `do … while` and string repeat.
7. **`defer`**: the v0.5 section. There's no new evidence. The checker has 0 sites, and the 5 save/restore sites are
   all in `parser.aster`.
8. **`real_path` and bare error reasons**: entry 15. No test needs them. They only matter once a driver has to dedupe
   symlinked imports or load a relative root that climbs out of the working directory and back (a `cwd` builtin
   alongside `real_path` would close that).

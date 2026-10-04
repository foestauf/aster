# checker.aster Typed Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `checker.aster` produce the complete typed program, with fully typed function bodies mirroring `packages/asterc/src/check/types.ts`, and prove it equals the TypeScript checker's tree byte for byte through a canonical dump.

**Architecture:** The four Aster front-end libraries move to `packages/asterc-self/`. A test-side TypeScript printer (`tests/typed_dump.ts`) and an Aster twin (`packages/asterc-self/typed_dump.aster`) render a `TypedProgram` in one line-per-node format. Every `check_*` function in `checker.aster` returns its typed node alongside what it returns today, as `checker.ts` does. A new driver, `typed.aster`, prints the dump, and `tests/typed_aster.test.ts` diffs it against TypeScript on the whole corpus.

**Tech Stack:** Aster (compiled by `asterc` to C, gcc), TypeScript, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-04-aster-typed-program-design.md` (it builds on `docs/superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md`).

## Global Constraints

- No changes to `packages/asterc/src/**` unless a compiler bug is found. Such a fix gets its own commit and a friction-log note.
- No language or runtime changes.
- `checker.aster` mirrors `checker.ts` in function names (snake_case), the order in which locals are declared, desugaring and iteration order. The typed tree mirrors `check/types.ts` field for field.
- `check_aster.test.ts` output (summary, diagnostics, stdout, stderr, exit codes) is unchanged, and it stays green after **every** task.
- Every Aster file builds with `-Werror`. Libraries start with `// expect-library`.
- The flat namespace: every new top-level name in `packages/asterc-self/` must not collide with any name already declared in the closure. The dumper's functions are prefixed `dump_`. Any forced rename goes in the friction log.
- Run tests with `pnpm vitest run <files>`. Before merge, `pnpm test`, `pnpm lint` and `pnpm typecheck` pass and `typed_aster.test.ts`'s `PENDING` is empty.
- Commits use conventional commits (commitlint runs in the `commit-msg` hook) and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FpzzMjPkrLERmoHMVp5kyD
  ```

## Review Focus

1. **Local-id order around `let … else` and `if let`.** Binders are created while the match arm is checked and re-declared in the enclosing scope afterwards, using the *same* `Local`. A fresh id there would shift every later id. Task 7's `typed_unwrap.txt` declares a local after a `let … else` and after an `if let` chain, and the dump pins the ids.
2. **String values with escapes, NULs and non-ASCII bytes.** The typed tree must carry the *decoded* value. That isn't `string_pattern_value`'s comparison key, which writes `\` as `\\` and NUL as `\0`. Task 4's `typed_literals.txt` has `"a\"b\\c\n\t\0é😀"` as an expression and Task 5's `typed_match.txt` has `"\0"` and `"\\"` as string patterns, so the dump's `\xHH` escaping is exercised on both sides.
3. **`int` limits and negative literals.** `-9223372036854775808`, `9223372036854775807`, a char literal `'\n'` and bool patterns must print the values TypeScript's bigints print. That's `typed_literals.txt` and `typed_match.txt`.
4. **Expression-bodied versus block-bodied match arms** in one match expression, including a diverging block arm, whose `never` type must not change the match's type. That's Task 5's `typed_match.txt`.
5. **The compiler checking itself.** `typed.aster` and `check.aster` are corpus roots, so the whole closure is dumped. A missing node kind that no fixture covers shows up there first. Task 8 asserts both are in the accepted corpus.

---

## File map

- Move (`git mv`) from `tests/programs/programs/` to `packages/asterc-self/`: `lexer.aster`, `parser.aster`, `loader.aster` and `checker.aster`.
- Create `packages/asterc-self/report.aster`: `sort_diags` and `print_diags`, moved out of `check.aster` so `typed.aster` can share them.
- Create `packages/asterc-self/typed_dump.aster`: `dump_typed(c: Checked): [string]`.
- Modify `tests/programs/programs/lex.aster`, `parse.aster` and `check.aster`: import paths, and `check.aster` now imports `report.aster`.
- Create `tests/programs/programs/typed.aster`: the dump driver.
- Create `tests/typed_dump.ts` (`dumpTyped`, `escapeDump`), `tests/typed_dump.test.ts` and `tests/typed_aster.test.ts`.
- Modify `tests/lex_aster.test.ts`, `tests/parse_aster.test.ts` and `tests/check_aster.test.ts`: corpus roots and self-inclusion assertions.
- Create fixtures `tests/programs/programs/fixtures/typed_literals.txt`, `typed_ops.txt`, `typed_places.txt`, `typed_control.txt`, `typed_match.txt`, `typed_try.txt` and `typed_unwrap.txt`.
- Modify `docs/self-host/friction.md` and `README.md` (where they name the old paths).

## The dump format (normative for both printers)

The output is one node per line, with two spaces of indentation per depth and `\n` after every line. `T` means `typeToString(type)` / `type_to_string(ty)`. **Expression** lines end with ` : T`. Statement, place-free and pattern lines don't.

| Node | Head line | Children (depth + 1, in order) |
|---|---|---|
| struct (depth 0) | `struct <name>` | `field <name> <T>` per field |
| enum (depth 0) | `enum <name>` | `variant <name>` followed by ` <T>` per payload type |
| function (depth 0) | `fn <name> <ret T>` | `local <id> <name> <T> param\|let\|var` per local in id order, then `body`. The body's statements go at depth 2. |
| block | `block` | each statement |
| `let` | `let <local id>` | init expr |
| `assign` | `assign <op>` (`=`, `+=`, …) | place, value expr |
| `if` stmt | `if` | cond expr, then block, else block or `none` |
| `while` | `while` | cond expr, body block |
| `forRange` | `for-range <local id>` | start expr, end expr, body block |
| `forEach` | `for-each <local id>` | array expr, body block |
| `break` / `continue` | `break` / `continue` | none |
| `return` | `return` | value expr or `none` |
| `match` stmt | `match` | scrutinee expr, then each arm |
| block stmt | `block` | each statement |
| `expr` stmt | `expr` | the expr |
| arm | `arm` | pattern line(s), then the body (block, or expr) |
| pattern wildcard | `wildcard` | none |
| pattern variants | `variants <name>/<tag> …`. Then, only if binders is non-empty, a **sibling** line `binders <id or _> …` | none |
| pattern ints | `ints <decimal> …` | none |
| pattern strings | `strings <escaped> …` | none |
| place local | `place-local <id> <name> : T` | none |
| place field | `place-field .<field> : T` | object expr |
| place index | `place-index : T` | array expr, index expr |
| int | `int <decimal> : T` | none |
| string | `str <escaped> : T` | none |
| bool | `bool true\|false : T` | none |
| local | `local <id> <name> : T` | none |
| unary | `unary <op> : T` | operand |
| binary | `binary <op> : T` | left, right |
| call | `call <fn> : T` | each arg |
| builtin | `builtin <name> : T` | each arg |
| if expr | `if : T` | cond, then, else |
| field | `field .<field> : T` | object |
| index | `index : T` | array, index |
| arrayLit | `array : T` | each element |
| structLit | `struct-lit <struct> : T` | per initialiser: `init <field>` at depth + 1 and its value at depth + 2 |
| variant | `variant <enum> <variant> <tag> : T` | each arg |
| enumCompare | `enum-compare <op> : T` | left, right |
| match expr | `match : T` | scrutinee, then each arm |
| try | `try <ok>/<okTag> <fail>/<failTag> -> <returnEnum> <returnFail>/<returnFailTag> : T` | `return-type <T>`, then `fail-payload <T>` only when non-null, then the operand |

**Lists.** A list head joins its parts with single spaces and has no trailing space when empty (`variants`, `ints`, `strings`).

**Escaping** (`str` values and `strings` patterns). Each value is printed between `"` and `"` over its UTF-8 bytes:

| Byte | Written as |
|---|---|
| `0x22` | `\"` |
| `0x5c` | `\\` |
| `0x0a` | `\n` |
| `0x09` | `\t` |
| any other byte `< 0x20` or `>= 0x7f` | `\xHH` (lowercase hex, two digits) |
| everything else | the byte itself |

---

### Task 1: Move the libraries to `packages/asterc-self/`

**Files:**
- Move: `tests/programs/programs/{lexer,parser,loader,checker}.aster` → `packages/asterc-self/`.
- Modify: `tests/programs/programs/{lex,parse,check}.aster` (imports), `tests/{lex,parse,check}_aster.test.ts` (corpus) and `README.md` / `docs/self-host/friction.md` path mentions.

**Produces:** `packages/asterc-self/` exists and holds the four libraries, which import each other by bare file name, as today. Corpus file keys for files in that directory are `asterc-self/<file>`.

- [ ] `git mv` the four files. Inside them, imports between siblings (`import "lexer.aster";` and so on) stay unchanged.
- [ ] In `lex.aster`, `parse.aster` and `check.aster`, change each import of a moved library to `import "../../../packages/asterc-self/<file>.aster";`.
- [ ] In each of the three tests, extend the corpus to the new directory. Next to `PROGRAMS_DIR`, add
  `const SELF_DIR = fileURLToPath(new URL('../packages/asterc-self/', import.meta.url));` and append
  `readdirSync(SELF_DIR).filter((f) => f.endsWith('.aster')).map((f) => join('..', '..', 'packages', 'asterc-self', f))` to the corpus before `toSorted()`. The `join(PROGRAMS_DIR, file)` the tests already use then resolves to the moved files. Update the self-inclusion assertions from `join('programs', 'lexer.aster')` (and the other moved files) to the new keys.
- [ ] Run `pnpm vitest run tests/lex_aster.test.ts tests/parse_aster.test.ts tests/check_aster.test.ts tests/golden.test.ts`. Expected: all pass. The moved files appear under their new keys, and every case passes with identical output (the check diagnostics print absolute paths, which have changed for the moved files, but the oracle uses the same path so it still matches).
- [ ] `grep -rn "programs/programs/\(lexer\|parser\|loader\|checker\)" README.md docs/self-host` and fix any mention.
- [ ] Commit: `refactor: move the Aster front-end libraries to packages/asterc-self`.

### Task 2: TypeScript `dumpTyped`

**Files:** Create `tests/typed_dump.ts` and `tests/typed_dump.test.ts`.

**Produces:** `dumpTyped(program: TypedProgram): string` and `escapeDump(value: string): string`, implementing the dump format above.

- [ ] Write the failing test `tests/typed_dump.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeSource, runFrontend } from '../packages/asterc/src/index.js';
import { dumpTyped, escapeDump } from './typed_dump.js';

const dump = (text: string): string => {
  const { typed, diagnostics } = runFrontend(makeSource('t.aster', text), { readFile: () => ({ ok: false, reason: 'no imports' }), realPath: (p) => p });
  if (typed === null) throw new Error(diagnostics.map((d) => d.message).join('\n'));
  return dumpTyped(typed);
};

describe('dumpTyped', () => {
  it('escapes over UTF-8 bytes', () => {
    expect(escapeDump('a"b\\c\n\t\0é')).toBe('"a\\"b\\\\c\\n\\t\\x00\\xc3\\xa9"');
  });

  it('dumps structs, locals, a struct literal, a match with binders and a return', () => {
    expect(dump(`struct P { x: int }
fn main(): int {
    let p: P = P { x: 1 };
    let o: Option[int] = Option::Some(p.x);
    match o {
        Option::Some(v) => { return v; }
        Option::None => {}
    }
    return 0;
}
`)).toBe(`struct P
  field x int
enum Option[int]
  variant Some int
  variant None
fn main int
  local 0 p P let
  local 1 o Option[int] let
  local 2 v int let
  body
    let 0
      struct-lit P : P
        init x
          int 1 : int
    let 1
      variant Option[int] Some 0 : Option[int]
        field .x : int
          local 0 p : P
    match
      local 1 o : Option[int]
      arm
        variants Some/0
        binders 2
        block
          return
            local 2 v : int
      arm
        variants None/1
        block
    return
      int 0 : int
`);
  });
});
```

  `runFrontend`'s second argument is a `LoadHost` (`readFile(path): ReadResult` and `realPath(path)`, from `packages/asterc/src/driver/load.ts`). This host fails every import, which is fine because the program imports nothing. If the variant node's `enum` field turns out to be the bare `Option` rather than `Option[int]`, or a binder local's `mutable` differs, correct **the expected text** to what `checker.ts` actually produces. The printer reports, it doesn't decide. Note any such correction in the commit message.
- [ ] Run `pnpm vitest run tests/typed_dump.test.ts`. Expected: FAIL (module not found).
- [ ] Write `tests/typed_dump.ts`:

```ts
import { typeToString, type TBlock, type TExpr, type TPattern, type TPlace, type TStmt, type Type, type TypedProgram } from '../packages/asterc/src/index.js';

/** A dump string value: `"…"` over the value's UTF-8 bytes (see the plan's escaping table). */
export function escapeDump(value: string): string {
  let out = '"';
  for (const b of Buffer.from(value, 'utf8')) {
    if (b === 0x22) out += '\\"';
    else if (b === 0x5c) out += '\\\\';
    else if (b === 0x0a) out += '\\n';
    else if (b === 0x09) out += '\\t';
    else if (b < 0x20 || b >= 0x7f) out += `\\x${b.toString(16).padStart(2, '0')}`;
    else out += String.fromCharCode(b);
  }
  return `${out}"`;
}

const head = (word: string, parts: readonly string[]): string => [word, ...parts].join(' ');

/** The typed program in the canonical dump format shared with packages/asterc-self/typed_dump.aster. */
export function dumpTyped(program: TypedProgram): string {
  const lines: string[] = [];
  const put = (depth: number, text: string): void => {
    lines.push(`${'  '.repeat(depth)}${text}`);
  };
  const t = (type: Type): string => typeToString(type);

  function block(d: number, b: TBlock): void {
    put(d, 'block');
    for (const s of b.statements) stmt(d + 1, s);
  }

  function arm(d: number, pattern: TPattern, body: TExpr | TBlock): void {
    put(d, 'arm');
    pat(d + 1, pattern);
    if ('statements' in body) block(d + 1, body);
    else expr(d + 1, body);
  }

  function pat(d: number, p: TPattern): void {
    switch (p.kind) {
      case 'wildcard':
        return put(d, 'wildcard');
      case 'variants':
        put(d, head('variants', p.variants.map((v) => `${v.name}/${v.tag}`)));
        if (p.binders.length > 0) put(d, head('binders', p.binders.map((b) => (b === null ? '_' : String(b.id)))));
        return;
      case 'ints':
        return put(d, head('ints', p.values.map(String)));
      case 'strings':
        return put(d, head('strings', p.values.map(escapeDump)));
    }
  }

  function place(d: number, p: TPlace): void {
    switch (p.kind) {
      case 'local':
        return put(d, `place-local ${p.local.id} ${p.local.name} : ${t(p.type)}`);
      case 'field':
        put(d, `place-field .${p.field} : ${t(p.type)}`);
        return expr(d + 1, p.object);
      case 'index':
        put(d, `place-index : ${t(p.type)}`);
        expr(d + 1, p.array);
        return expr(d + 1, p.index);
    }
  }

  function stmt(d: number, s: TStmt): void {
    switch (s.kind) {
      case 'let':
        put(d, `let ${s.local.id}`);
        return expr(d + 1, s.init);
      case 'assign':
        put(d, `assign ${s.op}`);
        place(d + 1, s.place);
        return expr(d + 1, s.value);
      case 'if':
        put(d, 'if');
        expr(d + 1, s.cond);
        block(d + 1, s.then);
        if (s.else === null) put(d + 1, 'none');
        else block(d + 1, s.else);
        return;
      case 'while':
        put(d, 'while');
        expr(d + 1, s.cond);
        return block(d + 1, s.body);
      case 'forRange':
        put(d, `for-range ${s.local.id}`);
        expr(d + 1, s.start);
        expr(d + 1, s.end);
        return block(d + 1, s.body);
      case 'forEach':
        put(d, `for-each ${s.local.id}`);
        expr(d + 1, s.array);
        return block(d + 1, s.body);
      case 'break':
      case 'continue':
        return put(d, s.kind);
      case 'return':
        put(d, 'return');
        if (s.value === null) put(d + 1, 'none');
        else expr(d + 1, s.value);
        return;
      case 'match':
        put(d, 'match');
        expr(d + 1, s.scrutinee);
        for (const a of s.arms) arm(d + 1, a.pattern, a.body);
        return;
      case 'block':
        return block(d, s);
      case 'expr':
        put(d, 'expr');
        return expr(d + 1, s.expr);
    }
  }

  function expr(d: number, e: TExpr): void {
    const at = (text: string): void => put(d, `${text} : ${t(e.type)}`);
    const kids = (es: readonly TExpr[]): void => {
      for (const c of es) expr(d + 1, c);
    };
    switch (e.kind) {
      case 'int':
        return at(`int ${e.value}`);
      case 'string':
        return at(`str ${escapeDump(e.value)}`);
      case 'bool':
        return at(`bool ${e.value}`);
      case 'local':
        return at(`local ${e.local.id} ${e.local.name}`);
      case 'unary':
        at(`unary ${e.op}`);
        return kids([e.operand]);
      case 'binary':
        at(`binary ${e.op}`);
        return kids([e.left, e.right]);
      case 'call':
        at(`call ${e.fn}`);
        return kids(e.args);
      case 'builtin':
        at(`builtin ${e.builtin}`);
        return kids(e.args);
      case 'if':
        at('if');
        return kids([e.cond, e.then, e.else]);
      case 'field':
        at(`field .${e.field}`);
        return kids([e.object]);
      case 'index':
        at('index');
        return kids([e.array, e.index]);
      case 'arrayLit':
        at('array');
        return kids(e.elements);
      case 'structLit':
        at(`struct-lit ${e.struct}`);
        for (const f of e.fields) {
          put(d + 1, `init ${f.field}`);
          expr(d + 2, f.value);
        }
        return;
      case 'variant':
        at(`variant ${e.enum} ${e.variant} ${e.tag}`);
        return kids(e.args);
      case 'enumCompare':
        at(`enum-compare ${e.op}`);
        return kids([e.left, e.right]);
      case 'match':
        at('match');
        expr(d + 1, e.scrutinee);
        for (const a of e.arms) arm(d + 1, a.pattern, a.body);
        return;
      case 'try':
        at(`try ${e.okVariant}/${e.okTag} ${e.failVariant}/${e.failTag} -> ${e.returnEnum} ${e.returnFailVariant}/${e.returnFailTag}`);
        put(d + 1, `return-type ${t(e.returnType)}`);
        if (e.failPayloadType !== null) put(d + 1, `fail-payload ${t(e.failPayloadType)}`);
        return expr(d + 1, e.operand);
    }
  }

  for (const s of program.structs) {
    put(0, `struct ${s.name}`);
    for (const f of s.fields) put(1, `field ${f.name} ${t(f.type)}`);
  }
  for (const e of program.enums) {
    put(0, `enum ${e.name}`);
    for (const v of e.variants) put(1, head(`variant ${v.name}`, v.payload.map(t)));
  }
  for (const f of program.functions) {
    put(0, `fn ${f.name} ${t(f.returnType)}`);
    for (const l of f.locals) {
      const kind = l.id < f.params.length ? 'param' : l.mutable ? 'var' : 'let';
      put(1, `local ${l.id} ${l.name} ${t(l.type)} ${kind}`);
    }
    put(1, 'body');
    for (const s of f.body.statements) stmt(2, s);
  }
  return lines.map((l) => `${l}\n`).join('');
}
```

- [ ] Run `pnpm vitest run tests/typed_dump.test.ts && pnpm typecheck && pnpm lint`. Expected: PASS. If the test fails only because the expected text doesn't match what `checker.ts` really produces (see the note in step 1), fix the expected text. Never bend the printer to fit the test.
- [ ] Commit: `test: add the canonical typed-program dump (TypeScript side)`.

### Task 3: Typed-tree types, the Aster dumper, `typed.aster` and the parity harness

**Files:**
- Modify: `packages/asterc-self/checker.aster` (types only), `tests/programs/programs/check.aster`.
- Create: `packages/asterc-self/report.aster`, `packages/asterc-self/typed_dump.aster`, `tests/programs/programs/typed.aster`, `tests/typed_aster.test.ts`.

**Consumes:** `dumpTyped` (Task 2), `Checked`, `TFunction`, `Local`, `Type` and `type_to_string` (`checker.aster`), `load_program`/`Loaded`/`SourceFile`/`Diag` (`loader.aster`).

**Produces**, in `checker.aster`, a new section "the typed tree (check/types.ts)" placed after `TFunction`:

```
struct TBlock { stmts: [TStmt] }
struct TArm { pattern: TPattern, body: TArmBody }
enum TArmBody { Block(TBlock), Expr(TExpr) }
struct TVariantRef { name: string, tag: int }
enum TPattern { Wildcard, Variants([TVariantRef], [Option[Local]]), Ints([string]), Strings([string]) }
struct TPlace { ty: Type, node: TPlaceNode }
enum TPlaceNode { Local(Local), Field(TExpr, string), Index(TExpr, TExpr) }
struct TFieldInit { field: string, value: TExpr }
struct TTry {
    operand: TExpr, ok_variant: string, ok_tag: int, fail_variant: string, fail_tag: int, return_type: Type,
    return_enum: string, return_fail_variant: string, return_fail_tag: int, fail_payload_type: Option[Type],
}
struct TExpr { ty: Type, node: TExprNode }
enum TExprNode {
    Int(string), Str(string), Bool(bool), Local(Local), Unary(string, TExpr), Binary(string, TExpr, TExpr),
    Call(string, [TExpr]), Builtin(string, [TExpr]), If(TExpr, TExpr, TExpr), Field(TExpr, string),
    Index(TExpr, TExpr), ArrayLit([TExpr]), StructLit(string, [TFieldInit]), Variant(string, string, int, [TExpr]),
    EnumCompare(string, TExpr, TExpr), Match(TExpr, [TArm]), Try(TTry), Error,
}
enum TStmt {
    Let(Local, TExpr), Assign(TPlace, string, TExpr), If(TExpr, TBlock, Option[TBlock]), While(TExpr, TBlock),
    ForRange(Local, TExpr, TExpr, TBlock), ForEach(Local, TExpr, TBlock), Break, Continue, Return(Option[TExpr]),
    Match(TExpr, [TArm]), Block(TBlock), Expr(TExpr),
}
```

**Also produces:**
- `TFunction` gains `body: TBlock`. Until Task 4, `check_function` sets `TBlock { stmts: [] }`.
- `typed_dump.aster` provides `fn dump_typed(c: Checked): [string]` and `fn dump_escape(s: string): string`.
- `report.aster` provides `sort_diags(diags: [Diag]): [Diag]` and `print_diags(files: [SourceFile], diags: [Diag])`, moved verbatim from `check.aster`.

Recursive types are fine in Aster (see `parser.aster`'s `Expr`/`ExprNode`). If the checker rejects any of these declarations, for example an infinite-size cycle through structs alone, wrap the offending field in an array or enum and log it in the friction log.

- [ ] Move `sort_diags` and `print_diags` (and any helper only they use) from `check.aster` into a new `// expect-library` `packages/asterc-self/report.aster`, which imports `loader.aster`. `check.aster` imports it. Run `pnpm vitest run tests/check_aster.test.ts`. Expected: PASS, unchanged.
- [ ] Add the types above and `body` to `checker.aster`, with `check_function` filling in the empty body. Run `pnpm vitest run tests/check_aster.test.ts`. Expected: PASS.
- [ ] Write `typed_dump.aster` (`// expect-library`, importing `checker.aster`) as a line-for-line port of `tests/typed_dump.ts`.
  - Lines accumulate in a `[string]` passed down to the `dump_*` functions (`dump_block`, `dump_stmt`, `dump_expr`, `dump_place`, `dump_pattern` and `dump_arm`), each taking `(out: [string], depth: int, node)`.
  - `dump_put(out, depth, text)` pushes `"  "` repeated `depth` times followed by `text`.
  - `dump_escape` walks bytes with `byte_at` and writes `\xHH` using a 16-character `"0123456789abcdef"` string and `substring`.
  - `TExprNode::Error` prints `error : <T>`. It never appears in a valid program's dump.
- [ ] Write `tests/programs/programs/typed.aster`, a program, not a library. Its header comment says it prints the typed program in the canonical dump format and that `tests/typed_aster.test.ts` checks it, and includes `// expect-args: fixtures/check_small.txt`. Leave its `// expect-stdout:` block for Task 8: no expectation directives yet means no stdout check, so check how `tests/harness.ts` treats a program with args and no stdout block, and add `// expect-stdout:` with the real output now if the harness requires it. It imports `loader.aster`, `checker.aster`, `report.aster` and `typed_dump.aster`. Its `main` is `check.aster`'s `main` with `print_summary(checked)` replaced by `for l in dump_typed(checked) { print(l); }`, and the usage text is `usage: typed <file>`.
- [ ] Write `tests/typed_aster.test.ts`, modelled on `check_aster.test.ts`:
  - **Corpus.** The same file list as `check_aster.test.ts` (the `tests/programs` `.aster` files, the `asterc-self` files and `fixtures/check_*.txt`) plus `fixtures/typed_*.txt`. Keep only files where `runFrontend` reports **no** diagnostics. Compute that once, at module level.
  - **Build.** Build `typed.aster` once in `beforeAll` with `-Werror`.
  - **Each case.** `spawnSync(exe, [path], { encoding: 'utf8', timeout: 20_000, maxBuffer: 256 * 1024 * 1024 })` and `expect({ stdout, stderr, status }).toEqual({ stdout: dumpTyped(typed), stderr: '', status: 0 })`.
  - **Pending.** `const PENDING = new Set<string>([...])`. A file in `PENDING` runs as `it.skip`. Start with every accepted file whose dump has a non-empty body; to build the list, run once, collect the failures and paste them in sorted.
  - **Corpus assertion.** One `it` asserts the accepted corpus contains `join('programs', 'check.aster')`, `join('programs', 'typed.aster')` and each `fixtures/typed_*.txt` that exists so far.
- [ ] Run `pnpm vitest run tests/typed_aster.test.ts tests/check_aster.test.ts tests/golden.test.ts`. Expected: everything not in `PENDING` passes. That's only programs whose functions all have empty bodies, which may be none. That's fine, because the header lines (structs, enums, locals) are still being compared for the files that do pass.
- [ ] Commit: `test: typed-tree types, Aster dumper and typed.aster parity harness`.

### Task 4: Typed nodes for expressions and statements (everything except `match`, `?`, `let … else` and `if let`)

**Files:** `packages/asterc-self/parser.aster`, `tests/programs/programs/parse.aster`, `packages/asterc-self/checker.aster`, fixtures `typed_literals.txt`, `typed_ops.txt`, `typed_places.txt` and `typed_control.txt`, and `tests/typed_aster.test.ts` (shrink `PENDING`).

**Consumes:** the Task 3 types.

**Produces:**
- `fn check_expr(ctx: Ctx, e: Expr, expected: Option[Type]): TExpr`. Every caller that used the old `Type` result reads `.ty`.
- `struct CheckedStmt { node: TStmt, diverges: bool }` and `fn check_stmt(ctx: Ctx, s: Stmt): CheckedStmt`.
- `struct CheckedBlock { node: TBlock, diverges: bool }` and `fn check_block(ctx: Ctx, b: Block): CheckedBlock`.
- `check_place` returns `TPlace`.
- `check_function` stores the real body.
- `fn string_literal_value(text: string): string`, which decodes a string literal's source text, quotes included, to its actual bytes.
- In the parser, `ExprNode::Str` becomes `ExprNode::Str(string)`, holding the literal's source text (quotes included), like `PatternNode::StringPat`.

Each typed node is built in the same function, and in the same order, as `checker.ts` builds its node. Read the matching TS function next to each Aster one. Constructs not yet covered return placeholders, which later tasks replace:
- `ExprNode::Match` and `ExprNode::Try` return `TExpr { ty: <the type computed today>, node: TExprNode::Error }`.
- `StmtNode::Match`, `LetElse` and `IfLet` return `TStmt::Block(TBlock { stmts: [] })` with today's `diverges`.

Steps:
- [ ] **Parser.** Change `ExprNode::Str` to `Str(string)` and set it to `text(p, t)` in `parser.aster`'s string literal case. Update every `ExprNode::Str` match in `parse.aster` and `checker.aster` to `ExprNode::Str(_)` (or bind it where needed). Run `pnpm vitest run tests/parse_aster.test.ts tests/check_aster.test.ts`. Expected: PASS, unchanged.
- [ ] **`string_literal_value`.** Write it next to `string_pattern_value`. It walks bytes 1 to `len - 2` exactly as `string_pattern_value` does, but appends the decoded byte. A one-byte string for an escape comes from a table of literals: `'n'` → `"\n"`, `'t'` → `"\t"`, `'r'` → `"\r"`, `'0'` → `"\0"`, `'\\'` → `"\\"`, `'"'` → `"\""`, `'\''` → `"'"`. Aster has no chr builtin. Ordinary bytes are `substring(text, i, i + 1)`, which keeps UTF-8 sequences intact byte by byte. Leave `string_pattern_value` (the comparison key) as it is.
- [ ] **Fixtures.** Write them now (red first). Each is a complete program with `fn main(): int`, and each must be accepted by the TS front end; check with `pnpm aster check <file>` after `pnpm build`.

`fixtures/typed_literals.txt`:
```
fn main(): int {
    let a: int = 9223372036854775807;
    let b: int = -9223372036854775808;
    let c: int = 'a';
    let d: int = '\n';
    let s: string = "a\"b\\c\n\t\0é😀";
    let t: bool = true;
    let f: bool = false;
    print(s);
    return a + b + c + d;
}
```

`fixtures/typed_ops.txt`:
```
enum Dir { Up, Down }
fn add(a: int, b: int): int { return a + b; }
fn main(): int {
    let x: int = -add(1, 2) * 3 / 4 % 5 - 6;
    let ok: bool = !(x < 0) && x <= 1 || x > 2 && x >= 3 && x == 4 && x != 5;
    let same: bool = Dir::Up == Dir::Down;
    let differ: bool = Dir::Up != Dir::Down;
    let s: string = "a" + int_to_string(len("bc"));
    let eq: bool = s == "a2";
    let arr: [int] = [1, 2, 3];
    push(arr, 4);
    let last: int = pop(arr);
    let n: int = len(arr) + byte_at(s, 0) + len(substring(s, 0, 1));
    eprint(n);
    print(ok);
    print(same || differ || eq);
    let r: Result[string, string] = read_file("/nonexistent");
    if x > 100 { exit(3); }
    if x > 200 { panic("big"); }
    let input: string = read_stdin();
    return last + len(input);
}
```

`fixtures/typed_places.txt`:
```
struct Inner { v: int }
struct Outer { inner: Inner, items: [int] }
fn main(): int {
    var o: Outer = Outer { items: [1, 2], inner: Inner { v: 3 } };
    o.inner.v = 4;
    o.items[1] = 5;
    o.items[0] += 6;
    o.inner.v -= 1;
    var n: int = 0;
    n *= 2;
    n /= 1;
    n %= 7;
    let grid: [[int]] = [[1], [2]];
    grid[1][0] = 9;
    return o.inner.v + o.items[1] + grid[1][0] + n;
}
```

`fixtures/typed_control.txt`:
```
fn pick(b: bool): int {
    let x: int = if b { 1 } else { 2 };
    if b {
        return x;
    } else if !b {
        return x + 1;
    }
    return 0;
}
fn main(): int {
    var total: int = 0;
    var i: int = 0;
    while i < 10 {
        i += 1;
        if i == 3 { continue; }
        if i == 8 { break; }
        total += i;
    }
    for j in 0..3 {
        total += j;
    }
    for v in [4, 5] {
        let total: int = v;
        print(total);
    }
    {
        let inner: int = pick(true);
        total += inner;
    }
    return total;
}
```

  (If a fixture uses syntax the TS front end rejects, for instance a block statement or compound assignment through an index, fix the fixture to valid syntax, keeping the construct's intent. Check `tests/programs/` for the accepted form.)
- [ ] Run `pnpm vitest run tests/typed_aster.test.ts`. Expected: the four new fixtures FAIL (bodies empty).
- [ ] **`check_expr`.** Convert it arm by arm, reading `checkExpr` and its helpers (`checkBinary`, `checkCall`, `checkPrint`, `checkCollectionBuiltin`, `checkStructLit`, `checkArrayLit`, `checkVariantExpr` and `checkGenericVariantExpr`) for the exact node each one returns:
  - **Literals.** An int is `Int(canonical digits)`, with any sign folding exactly as TS does: compare TS `checkExpr`'s `'unary'` case for a negated literal. A char is `Int(int_to_string(char_pattern_value(text)))`. A string is `Str(string_literal_value(text))`.
  - **Names, unary, binary, field, index, if-expression and array literals.** Recurse.
  - **`enumCompare`.** Binary `==` or `!=` on a payload-free enum (mirror the TS condition).
  - **Calls.** A user function is `Call(name, args)`. A builtin is `Builtin(name, args)`, with argument nodes in TS's order.
  - **Struct literals.** Initialisers in **written order**, not declaration order.
  - **Variants.** `Variant(enum name, variant, tag, args)`, with the enum name as TS stores it. Check `checkGenericVariantExpr` for whether that's the instance name.
  - **Errors.** Wherever the old code returned `Type::Error`, return `TExpr { ty: Type::Error, node: TExprNode::Error }`.
- [ ] **`check_place`, `check_compound`, `check_stmt` and `check_block`.** Mirror `checkPlace`, `checkCompound`, `checkStmt` and `checkBlock`. `let` declares the local and builds `Let(local, init)`; the order of `declare` relative to checking the initialiser must match TS. `forRange` and `forEach` declare their local the way TS does. Then `check_function` stores `check_block(...).node`.
- [ ] Run `pnpm vitest run tests/typed_aster.test.ts tests/check_aster.test.ts`. Expected: the four fixtures PASS. Remove from `PENDING` every corpus file that now passes (programs with no `match`, `?`, `let … else` or `if let`), and every check_aster case passes.
- [ ] Commit: `feat: checker.aster builds typed expressions and statements`.

### Task 5: Typed `match` (statement and expression) and patterns

**Files:** `packages/asterc-self/checker.aster`, fixture `typed_match.txt`, `tests/typed_aster.test.ts`.

**Consumes:** `CheckedStmt`, `CheckedBlock`, `TExpr` (Task 4).

**Produces:**
- `fn typed_pattern(...)`, a port of TS `typedPattern`, which returns a `TPattern`.
- `check_match`/`check_arms` return the scrutinee `TExpr`, the arms' `TPattern`s and the checked bodies, as TS `checkMatch` returns `{ scrutinee, patterns }` and passes bodies through its callback.
- `StmtNode::Match` builds `TStmt::Match(scrutinee, arms)` with `TArmBody::Block` bodies. `ExprNode::Match` (`check_match_expr`) builds `TExprNode::Match` with `Block` or `Expr` bodies, as written.

Steps:
- [ ] Write `fixtures/typed_match.txt`:
```
enum Shape { Circle(int), Rect(int, int), Empty }
fn area(s: Shape): int {
    return match s {
        Shape::Circle(r) => r * r * 3,
        Shape::Rect(w, _) => {
            return w;
        }
        Shape::Empty => 0,
    };
}
fn main(): int {
    let n: int = 3;
    match n {
        1 | 2 => print("small"),
        -9223372036854775808 => print("min"),
        _ => {}
    }
    let c: int = 'x';
    let k: int = match c {
        'a' | '\n' => 1,
        _ => 2,
    };
    let s: string = "\\";
    match s {
        "\0" | "\\" => print("esc"),
        "é" => print("e"),
        _ => {}
    }
    let b: bool = n > 1;
    match b {
        true => print("t"),
        false => print("f"),
    }
    let o: Option[int] = Option::Some(1);
    match o {
        Option::Some(v) => print(v),
        Option::None => {}
    }
    return area(Shape::Rect(2, 3)) + area(Shape::Circle(1)) + area(Shape::Empty) + k;
}
```
  Adjust it to TS-accepted syntax if needed (check `tests/programs/match/` for arm forms). Keep: or-patterns over ints, chars and strings; a negative int pattern; bool patterns; a variant with a `_` binder; and a match expression mixing an expr arm with a diverging block arm.
- [ ] Run `pnpm vitest run tests/typed_aster.test.ts -t typed_match`. Expected: FAIL.
- [ ] Port `typedPattern` and wire up `check_match`, `check_arms`, `check_match_expr`, `declare_binders` and `resolve_alternative`, so the arms' patterns and bodies come back in arm order.
  - `Ints` values are decimal strings. Use `int_pattern_value` for ints, `int_to_string(char_pattern_value(..))` for chars, and `"0"`/`"1"` for `false`/`true`.
  - `Strings` values are `string_literal_value(text)`, **not** `string_pattern_value`.
  - `Variants` binders hold one `Option[Local]` per payload slot when exactly one variant is resolved, and are empty otherwise, as `types.ts` documents.
  - The order of unresolved alternatives matches TS.
- [ ] Run `pnpm vitest run tests/typed_aster.test.ts tests/check_aster.test.ts`. Expected: `typed_match` passes. Remove newly passing files from `PENDING`. check_aster is green.
- [ ] Commit: `feat: checker.aster builds typed matches and patterns`.

### Task 6: Typed `?`

**Files:** `packages/asterc-self/checker.aster`, fixture `typed_try.txt`, `tests/typed_aster.test.ts`.

**Produces:** `check_try` returns `TExpr { ty, node: TExprNode::Try(TTry { … }) }` with all eleven fields as TS `checkTry` sets them. `fail_payload_type` is `Option::Some(err slot type)` for `Result` and `Option::None` for `Option`.

- [ ] Write `fixtures/typed_try.txt`:
```
fn first(xs: [int]): Option[int] {
    if len(xs) == 0 { return Option::None; }
    return Option::Some(xs[0]);
}
fn double_first(xs: [int]): Option[int] {
    let v: int = first(xs)?;
    return Option::Some(v * 2);
}
fn parse_digit(s: string): Result[int, string] {
    if len(s) != 1 { return Result::Err("bad"); }
    return Result::Ok(byte_at(s, 0) - '0');
}
fn sum_digits(a: string, b: string): Result[int, string] {
    return Result::Ok(parse_digit(a)? + parse_digit(b)?);
}
fn main(): int {
    match double_first([4]) {
        Option::Some(v) => print(v),
        Option::None => {}
    }
    match sum_digits("1", "2") {
        Result::Ok(v) => print(v),
        Result::Err(e) => print(e),
    }
    return 0;
}
```
- [ ] Run it. Expected: FAIL (`error` node).
- [ ] Port the node construction from TS `checkTry`. The variant names and tags come from the resolved operand enum and the function's return enum. `return_enum` is the return type's enum name as TS stores it.
- [ ] Run `pnpm vitest run tests/typed_aster.test.ts tests/check_aster.test.ts`. Expected: `typed_try` passes. Shrink `PENDING`. check_aster is green.
- [ ] Commit: `feat: checker.aster builds typed ? expressions`.

### Task 7: Typed `let … else` and `if let`

**Files:** `packages/asterc-self/checker.aster`, fixture `typed_unwrap.txt`, `tests/typed_aster.test.ts`.

**Produces:**
- `check_let_else` returns `CheckedStmt { node: TStmt::Match(scrutinee, [TArm(pattern0, Block(empty)), TArm(Wildcard, Block(else block))]), diverges: false }`, exactly as `checker.ts`'s `letElse` case does, and re-declares the binders with the **same** `Local`s through `declare_existing`.
- `check_if_let` returns what TS `checkIfLet` returns for each `else` shape (none, block, `else if`, `else if let`).

Steps:
- [ ] Write `fixtures/typed_unwrap.txt`:
```
fn get(i: int): Option[int] {
    if i > 0 { return Option::Some(i); }
    return Option::None;
}
fn fail(msg: string): never {
    panic(msg);
}
fn main(): int {
    let Option::Some(a) = get(1) else {
        return 1;
    };
    let after_let: int = a + 1;
    if let Option::Some(b) = get(2) {
        print(b);
    } else if let Option::Some(c) = get(0) {
        print(c);
    } else if after_let > 100 {
        print("big");
    } else {
        print("none");
    }
    if let Option::Some(d) = get(3) {
        print(d);
    }
    let after_if: int = after_let + 1;
    let Option::Some(e) = get(after_if) else {
        fail("no");
    };
    let v: int = match get(4) {
        Option::Some(x) => x,
        Option::None => fail("none"),
    };
    return e + v;
}
```
  Fix the syntax against `tests/programs/unwrap/` if needed. Keep: a local declared after each construct (to pin ids), an `else if let` and an `else if` in one chain, a `never` function in a `let … else` and as a match arm.
- [ ] Run it. Expected: FAIL.
- [ ] Port the desugaring from `checker.ts` (`case 'letElse'` and `checkIfLet`), including the arm order, the synthetic wildcard arm and its span, the empty-block body, and the moment binders are re-declared.
- [ ] Run `pnpm vitest run tests/typed_aster.test.ts tests/check_aster.test.ts`. Expected: `typed_unwrap` passes. Shrink `PENDING`. check_aster is green.
- [ ] Commit: `feat: checker.aster builds typed let-else and if-let`.

### Task 8: Whole corpus, self-dump and wrap-up

**Files:** `tests/typed_aster.test.ts`, `packages/asterc-self/checker.aster` (any remaining fixes), `tests/programs/programs/typed.aster` (header), `docs/self-host/friction.md`, `README.md`.

- [ ] Run `pnpm vitest run tests/typed_aster.test.ts` with `PENDING` emptied. Every failure is a real mismatch: fix it in `checker.aster` (or report a TS compiler bug as its own commit, per Global Constraints). Expected at the end: all pass, including `programs/check.aster` and `programs/typed.aster`, which dump the whole compiler closure.
- [ ] Delete the `PENDING` mechanism from `typed_aster.test.ts` entirely. Assert the accepted corpus contains `check.aster`, `typed.aster` and all seven `typed_*.txt` fixtures (Review Focus 5).
- [ ] Give `typed.aster`'s header its `// expect-stdout:` block for `fixtures/check_small.txt`, generated by `dumpTyped`, so the golden test pins it too.
- [ ] Time `typed.aster` on `tests/programs/programs/typed.aster` (`time <exe> <path> > /dev/null`) and note the figure in the friction log.
- [ ] Update `checker.aster`'s header comment: it no longer says "types only". Describe the typed tree and point to the dump test.
- [ ] Add a "Found while building the typed program" section to `docs/self-host/friction.md`: what hurt (expect: no closures for the dump walkers, no maps, flat-namespace prefixes, building one-byte strings without a chr builtin), with counts, as the existing sections do. Update `README.md` where it describes the self-hosted front end's location and status.
- [ ] Run `pnpm test && pnpm lint && pnpm typecheck`. Expected: all pass, with no skips added by this branch.
- [ ] Commit: `docs: typed-program friction log and README` (plus a separate `fix:` commit for any `checker.aster` mismatch fixed in step 1).

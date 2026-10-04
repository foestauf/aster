# lower.aster IR Lowering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `packages/asterc/src/ir/` (the IR types, `lower.ts` and `print.ts`) to Aster, so that for every accepted program the Aster lowering prints byte for byte what `printIr(lower(typed))` prints.

**Architecture:** Three new libraries go in `packages/asterc-self/`. `ir.aster` holds the IR types, `lower.aster` turns `checker.aster`'s `Checked` into an `IrProgram` (a line-for-line port of `lower.ts`, with its closures turned into data), and `ir_print.aster` renders it (a port of `print.ts`). A driver, `tests/programs/programs/ir.aster`, prints the lowered program. `tests/ir_aster.test.ts` diffs that output against TypeScript on the whole accepted corpus. A TS structural validator, `tests/ir_validate.ts`, runs on the same corpus.

**Tech Stack:** Aster (compiled by `asterc` to C, gcc), TypeScript, vitest, pnpm, oxlint.

**Spec:** `docs/superpowers/specs/2026-10-04-aster-ir-lowering-design.md`. It builds on `docs/superpowers/specs/2026-10-04-aster-typed-program-design.md` and `docs/superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md`.

## Global Constraints

- No changes to `packages/asterc/src/**` unless a compiler bug is found. Such a fix gets its own commit and a friction-log note.
- No language or runtime changes.
- `lower.aster` mirrors `lower.ts`: snake_case names and **the same allocation order** for temps (`ir_new_temp`), labels (`ir_new_label`) and interned strings (`intern_ir_string`). The output is compared byte for byte, so nothing is normalised.
- `ir.aster` mirrors `ir.ts` field for field. `ir_print.aster` mirrors `print.ts` character for character.
- The flat namespace already has `Loop`, `Block`, `Local` and 250-odd other names. Every new type starts with `Ir`, and every new function starts with `ir_`, `lower_`, `print_ir` or `intern_ir_`.
- Every Aster file builds with `-Werror`. Libraries start with `// expect-library`. Every `let`/`var` has a type annotation, which Aster requires.
- `check_aster.test.ts`, `typed_aster.test.ts`, `golden.test.ts` and the TS unit tests stay green after **every** task.
- Run tests with `pnpm vitest run <files>`. Before merge, `pnpm test`, `pnpm lint` and `pnpm typecheck` pass and `ir_aster.test.ts`'s `PENDING` is empty.
- Commits use conventional commits with a **lower-case subject** (commitlint runs in the `commit-msg` hook) and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FpzzMjPkrLERmoHMVp5kyD
  ```

### Seeing the TypeScript IR for one file

The repo has no `tsx`, but the built compiler exports `lower` and `printIr`:

```bash
pnpm build >/dev/null && node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { lower, makeSource, printIr, runFrontend } from './packages/asterc/dist/index.js';
const p = process.argv[1];
const r = runFrontend(makeSource(p, readFileSync(p, 'utf8')));
if (r.diagnostics.length > 0) { console.error(r.diagnostics); process.exit(1); }
process.stdout.write(printIr(lower(r.typed)));" tests/programs/programs/fixtures/ir_basics.txt > <scratch>/ts.ir
```

To see the Aster side, build the driver once (`node packages/asterc/dist/cli/bin.js build tests/programs/programs/ir.aster -o <scratch>/ir`; run `node packages/asterc/dist/cli/bin.js --help` if the flags differ). Then run `<scratch>/ir <file> | diff <scratch>/ts.ir -`. **The first differing line is the bug.** A shifted `%N` or label number means a temp or label was allocated in a different order from `lower.ts`.

## Review Focus

1. **Allocation in unreachable positions.** `lower.ts` returns the placeholder at the *top* of `lowerExpr` when the position is unreachable, but statement-level code (`forRange`'s counter temps, `if`'s labels, `lowerMatch`'s labels, `lowerStringTests`' temps) still allocates after a diverging sub-expression. The port must allocate exactly where TS does. `ir_diverge.txt` (Task 4) has a `for` over `0..die()`, an `if die_bool() { … }` and a `match` on a never call, each followed by more code.
2. **String-table order.** The table is shared across functions in function order and deduplicated. String patterns are interned even when they are lowered after divergence, because TS builds the `binop` object, interning included, before `emit` drops it. `ir_try.txt` (Task 4) repeats literals across two functions and in a string match.
3. **`JSON.stringify` escaping over bytes.** That means `\0` (`\u0000`), `\r`, `\n`, `\t`, `"`, `\`, `é` and an astral character. `ir_try.txt` holds them all, and Task 1's `ir_basics.txt` has `\0` and `\r` already.
4. **Loop step blocks.** A `for` gets a `for_stepN` block only if its body falls through or some `continue` targets it (`IrLoop.continued`, mutated through the `st.loops` alias). `ir_control.txt` (Task 3) has a `for` whose body ends in `continue` inside an `if`/`else`, so it never falls through, and a `for` whose body always `break`s.
5. **The compiler lowering itself.** `ir.aster` is a corpus root, so its closure (lexer → parser → loader → checker → lower → print, about 5k lines) is lowered. A construct that no fixture covers shows up there first. Task 5 asserts `programs/ir.aster` is in the corpus and records the timing.

---

## File map

- Create `packages/asterc-self/ir.aster`: the IR types (Task 1).
- Create `packages/asterc-self/ir_print.aster`: `print_ir(p: IrProgram): [string]` (Task 1).
- Create `packages/asterc-self/lower.aster`: `lower_program(c: Checked): IrProgram` (Tasks 1–4).
- Create `tests/programs/programs/ir.aster`: the driver (Task 1, golden header finished in Task 5).
- Create `tests/corpus.ts`: the shared accepted corpus. `tests/typed_aster.test.ts` moves onto it (Task 1).
- Create `tests/ir_validate.ts` and `tests/ir_validate.test.ts` (Task 1).
- Create `tests/ir_aster.test.ts` (Task 1).
- Create fixtures `tests/programs/programs/fixtures/ir_basics.txt` (Task 1), `ir_effects.txt` (Task 2), `ir_control.txt` (Task 3), `ir_match.txt`, `ir_try.txt` and `ir_diverge.txt` (Task 4).
- Modify `docs/self-host/friction.md` and `README.md` (Task 5).

## Aster idioms used throughout

- Structs are heap references: `st.label_count += 1;` inside a function mutates the caller's `IrState`, and `push(st.loops, lp)` followed by `lp.continued = true` is visible through `st.loops`.
- `match` is an expression. An arm that needs statements uses `=> { … }`. An arm can't be a block with a trailing value, so use early `return`s or a `var`.
- `panic(msg)` has type `never` and may end a non-void function or stand in a value `match` arm.
- `if let P = e { … }`, `let P = e else { …; };` (note the `;`), `Option::Some(x)`/`Option::None`, and generic variant inference from the expected type all work as in `checker.aster`.
- No hex literals, so write decimals (`8`, `12`, `32`). Char literals (`'"'`, `'\\'`, `'\n'`, `'\r'`, `'\t'`) compare with `byte_at`.

---

### Task 1: IR types, printer, validator, harness and the basic lowering

**Files:**
- Create: `packages/asterc-self/ir.aster`, `packages/asterc-self/ir_print.aster`, `packages/asterc-self/lower.aster`
- Create: `tests/programs/programs/ir.aster`, `tests/programs/programs/fixtures/ir_basics.txt`
- Create: `tests/corpus.ts`, `tests/ir_validate.ts`, `tests/ir_validate.test.ts`, `tests/ir_aster.test.ts`
- Modify: `tests/typed_aster.test.ts` (use `tests/corpus.ts`)

**Interfaces:**
- Consumes: `checker.aster`'s `Checked { diags, structs: [TStruct], enums: [TEnum], functions: [TFunction] }`, `TFunction { name, params: int, locals: [Local], ret: Type, body: TBlock }`, `Type`, `kind_of_type`, `type_to_string`, and the typed tree (`TStmt`, `TExpr`, `TExprNode`, …).
- Produces: every `ir.aster` type below, `print_ir(p: IrProgram): [string]`, `lower_program(c: Checked): IrProgram`, the plumbing (`ir_new_label`, `ir_new_temp`, `ir_emit`, `ir_terminate`, `ir_start_block`, `ir_reachable`, `intern_ir_string`, `ir_current_loop`, `ir_ref`, `ir_placeholder`, `ir_type`, `lower_block`, `lower_stmt`, `lower_value`, `lower_expr`, `lower_args`). It also produces `acceptedCorpus()`/`PROGRAMS_DIR` in `tests/corpus.ts`, `validateIr(p: IrProgram): string[]`, and `PENDING` in `ir_aster.test.ts`.

- [ ] **Step 1: Write `tests/corpus.ts` and move `typed_aster.test.ts` onto it**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSource, runFrontend, type TypedProgram } from '../packages/asterc/src/index.js';

export const PROGRAMS_DIR = fileURLToPath(new URL('./programs/', import.meta.url));
const SELF_DIR = fileURLToPath(new URL('../packages/asterc-self/', import.meta.url));

/** The TypeScript front end's typed program for the file at `path`, or null if it reports any diagnostic. */
function typedOf(path: string): TypedProgram | null {
  const result = runFrontend(makeSource(path, readFileSync(path, 'utf8')));
  return result.diagnostics.length === 0 ? result.typed : null;
}

/**
 * Every program the TypeScript front end accepts, with its typed program: each `.aster` under tests/programs/, each
 * `fixtures/{check,typed,ir}_*.txt`, and the libraries in packages/asterc-self/ (which have no main, so none is
 * accepted: the drivers cover them through their closures). Paths are relative to PROGRAMS_DIR, sorted.
 */
export function acceptedCorpus(): { file: string; typed: TypedProgram }[] {
  return readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.aster') || /fixtures[\\/](check|typed|ir)_\w+\.txt$/.test(f))
    .concat(readdirSync(SELF_DIR).filter((f) => f.endsWith('.aster')).map((f) => join('..', '..', 'packages', 'asterc-self', f)))
    .toSorted()
    .flatMap((file) => {
      const typed = typedOf(join(PROGRAMS_DIR, file));
      return typed === null ? [] : [{ file, typed }];
    });
}
```

In `tests/typed_aster.test.ts`, delete `PROGRAMS_DIR`, `SELF_DIR`, `typedOf`, `candidates` and the `accepted` computation, along with any imports that are now unused. Replace them with:

```ts
import { acceptedCorpus, PROGRAMS_DIR } from './corpus.js';
// …
/** The accepted corpus, each file with its typed program. */
const accepted = acceptedCorpus();
const corpus = accepted.map((c) => c.file);
```

Keep the file's header comment, but change "the `fixtures/typed_*.txt` files" to "the `fixtures/typed_*.txt` and `fixtures/ir_*.txt` files".

Run: `pnpm vitest run tests/typed_aster.test.ts`
Expected: PASS, with the same test count as before.

- [ ] **Step 2: Write the validator test (it fails because `ir_validate.ts` doesn't exist)**

`tests/ir_validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { INT, lower, type IrProgram } from '../packages/asterc/src/index.js';
import { acceptedCorpus } from './corpus.js';
import { validateIr } from './ir_validate.js';

const accepted = acceptedCorpus();

describe('validateIr', () => {
  it('reports broken programs', () => {
    const broken: IrProgram = {
      structs: [],
      enums: [],
      strings: [],
      functions: [
        {
          name: 'f',
          paramCount: 0,
          locals: [{ id: 0, name: null, type: INT }],
          returnType: INT,
          blocks: [
            { label: 'start', instrs: [{ kind: 'copy', dst: 0, src: { kind: 'bool', value: true } }], term: { kind: 'jmp', target: 'nowhere' } },
            { label: 'start', instrs: [], term: { kind: 'br', cond: { kind: 'local', id: 3 }, then: 'start', else: 'start' } },
            { label: 'other', instrs: [{ kind: 'binop', dst: 0, op: 'add', left: { kind: 'string', index: 0 }, right: { kind: 'int', value: 1n } }], term: { kind: 'ret', value: null } },
          ],
        },
      ],
    };
    expect(validateIr(broken)).toEqual([
      'f: the first block is start, not entry',
      'f: duplicate label start',
      'f: copy writes bool into %0: int',
      'f: jump to unknown label nowhere',
      'f: operand %3 is out of range',
      'f: string #0 is out of range',
      'f: add operand is string, expected int',
      'f: ret without a value in a function returning int',
    ]);
  });

  it.for(accepted)('$file lowers to valid IR', ({ typed }) => {
    expect(validateIr(lower(typed))).toEqual([]);
  });
});
```

Run: `pnpm vitest run tests/ir_validate.test.ts`
Expected: FAIL with `Cannot find module './ir_validate.js'` (or equivalent).

- [ ] **Step 3: Write `tests/ir_validate.ts`**

```ts
import { typeToString, type Instr, type IrFunction, type IrProgram, type Operand, type Terminator } from '../packages/asterc/src/index.js';

const INT_OPS = new Set(['add', 'sub', 'mul', 'div', 'mod', 'lt', 'le', 'gt', 'ge']);
const COMPARISONS = new Set(['lt', 'le', 'gt', 'ge', 'eq', 'ne', 'str_eq', 'str_ne']);

/**
 * Structural problems in `program`, one message per problem, prefixed by the function's name; empty for a well-formed
 * program. It checks labels, targets, local and string ranges and the operand types the IR fixes. It is not a full type
 * checker: calls, fields, arrays and enums are only range-checked.
 */
export function validateIr(program: IrProgram): string[] {
  const problems: string[] = [];
  for (const fn of program.functions) checkFunction(program, fn, (msg) => problems.push(`${fn.name}: ${msg}`));
  return problems;
}

function checkFunction(program: IrProgram, fn: IrFunction, report: (msg: string) => void): void {
  const labels = new Set<string>();
  if (fn.blocks.length > 0 && fn.blocks[0].label !== 'entry') report(`the first block is ${fn.blocks[0].label}, not entry`);
  for (const b of fn.blocks) {
    if (labels.has(b.label)) report(`duplicate label ${b.label}`);
    labels.add(b.label);
  }
  fn.locals.forEach((l, i) => {
    if (l.id !== i) report(`local ${i} has id ${l.id}`);
    if (l.type.kind === 'void') report(`local %${i} is void`);
  });

  /** The type of a local id as a string, or null (after reporting) when it is out of range. */
  const localType = (id: number): string | null => {
    const l = fn.locals[id];
    if (l === undefined) {
      report(`operand %${id} is out of range`);
      return null;
    }
    return typeToString(l.type);
  };
  const typeOf = (o: Operand): string | null => {
    switch (o.kind) {
      case 'local':
        return localType(o.id);
      case 'int':
        return 'int';
      case 'bool':
        return 'bool';
      case 'string':
        if (o.index < 0 || o.index >= program.strings.length) report(`string #${o.index} is out of range`);
        return 'string';
    }
  };
  const want = (what: string, actual: string | null, wanted: string): void => {
    if (actual !== null && actual !== wanted) report(`${what} is ${actual}, expected ${wanted}`);
  };
  const target = (label: string): void => {
    if (!labels.has(label)) report(`jump to unknown label ${label}`);
  };

  const checkInstr = (i: Instr): void => {
    switch (i.kind) {
      case 'copy': {
        const dst = localType(i.dst);
        const src = typeOf(i.src);
        if (dst !== null && src !== null && dst !== src) report(`copy writes ${src} into %${i.dst}: ${dst}`);
        return;
      }
      case 'unop': {
        const operandType = i.op === 'neg' ? 'int' : 'bool';
        want(`${i.op} operand`, typeOf(i.operand), operandType);
        want(`${i.op} result`, localType(i.dst), operandType);
        return;
      }
      case 'binop': {
        const left = typeOf(i.left);
        const right = typeOf(i.right);
        if (INT_OPS.has(i.op)) {
          want(`${i.op} operand`, left, 'int');
          want(`${i.op} operand`, right, 'int');
        } else if (i.op === 'concat' || i.op === 'str_eq' || i.op === 'str_ne') {
          want(`${i.op} operand`, left, 'string');
          want(`${i.op} operand`, right, 'string');
        } else if (left !== null && right !== null && (left !== right || (left !== 'int' && left !== 'bool'))) {
          report(`${i.op} compares ${left} with ${right}`);
        }
        want(`${i.op} result`, localType(i.dst), COMPARISONS.has(i.op) ? 'bool' : i.op === 'concat' ? 'string' : 'int');
        return;
      }
      case 'call':
      case 'call_builtin':
        if (i.dst !== null) localType(i.dst);
        i.args.forEach(typeOf);
        return;
      case 'struct_new':
        localType(i.dst);
        i.fields.forEach((f) => typeOf(f.value));
        return;
      case 'field_get':
        localType(i.dst);
        typeOf(i.object);
        return;
      case 'field_set':
        typeOf(i.object);
        typeOf(i.value);
        return;
      case 'array_new':
        localType(i.dst);
        i.elements.forEach(typeOf);
        return;
      case 'index_get':
        localType(i.dst);
        typeOf(i.array);
        want('index', typeOf(i.index), 'int');
        return;
      case 'index_set':
        typeOf(i.array);
        want('index', typeOf(i.index), 'int');
        typeOf(i.value);
        return;
      case 'array_len':
        want('array_len result', localType(i.dst), 'int');
        typeOf(i.array);
        return;
      case 'array_push':
        typeOf(i.array);
        typeOf(i.value);
        return;
      case 'array_pop':
        localType(i.dst);
        typeOf(i.array);
        return;
      case 'enum_new':
        localType(i.dst);
        i.args.forEach(typeOf);
        return;
      case 'enum_tag':
        want('enum_tag result', localType(i.dst), 'int');
        typeOf(i.value);
        return;
      case 'enum_field':
        localType(i.dst);
        typeOf(i.value);
        return;
      case 'read_file':
        want('read_file ok', localType(i.ok), 'bool');
        want('read_file text', localType(i.text), 'string');
        want('read_file path', typeOf(i.path), 'string');
        return;
    }
  };

  const checkTerm = (t: Terminator): void => {
    switch (t.kind) {
      case 'jmp':
        return target(t.target);
      case 'br':
        want('br condition', typeOf(t.cond), 'bool');
        target(t.then);
        return target(t.else);
      case 'switch': {
        const v = typeOf(t.value);
        if (v !== null && v !== 'int' && v !== 'bool') report(`switch value is ${v}, expected int or bool`);
        t.cases.forEach((c) => target(c.target));
        if (t.default !== null) target(t.default);
        return;
      }
      case 'ret': {
        const ret = typeToString(fn.returnType);
        if (t.value === null) {
          if (ret !== 'void') report(`ret without a value in a function returning ${ret}`);
        } else if (ret === 'void') {
          report('ret with a value in a void function');
        } else {
          want('ret value', typeOf(t.value), ret);
        }
        return;
      }
      case 'unreachable':
        return;
    }
  };

  for (const b of fn.blocks) {
    b.instrs.forEach(checkInstr);
    checkTerm(b.term);
  }
}
```

`switch` accepts `bool` because `lower.ts` switches on a bool scrutinee directly, and `eq`/`ne` accept two `bool`s (`a == b` on bools).

Run: `pnpm vitest run tests/ir_validate.test.ts`
Expected: PASS. If a corpus program reports a problem, look at the TS IR before changing the validator. A real stage-0 bug is a compiler-bug commit and a friction note. A rule that is too strict gets loosened, with a comment saying why. If the broken-program test's message order differs only because blocks are checked in order, reorder the expected array to match the traversal; the messages themselves must not change.

- [ ] **Step 4: Write `packages/asterc-self/ir.aster`**

```
// expect-library
// The compiler IR, written in Aster: a port of packages/asterc/src/ir/ir.ts, field for field. It is deliberately not
// SSA: every value lives in a typed, mutable local slot, and control flow is explicit basic blocks that each end in
// exactly one terminator. Names start with `Ir` because the flat namespace already has `Loop`, `Block` and `Local`.

import "checker.aster";

// A local slot. `name` is the source name of a user variable or param, and `None` for a compiler temporary.
struct IrLocal { id: int, name: Option[string], ty: Type }

struct IrField { name: string, ty: Type }

// Fields in declaration order.
struct IrStruct { name: string, fields: [IrField] }

// `tag` is the variant's index in its enum.
struct IrVariant { name: string, tag: int, payload: [Type] }

// `payload_free` is true when no variant has a payload: values are plain int64 tags, not heap objects.
struct IrEnum { name: string, payload_free: bool, variants: [IrVariant] }

// `Int` is a canonical decimal, as in the typed tree. `Str` is an index into `IrProgram.strings`.
enum IrOperand { Local(int), Int(string), Bool(bool), Str(int) }

struct IrFieldValue { name: string, value: IrOperand }

// One instruction. A destination is a local id, and `Option[int]` destinations are `None` for void calls.
// Operators and builtins use the IR spelling: `add`, `str_eq`, `neg`, `print_int`.
//   Copy(dst, src)                          Unop(dst, op, operand)            Binop(dst, op, left, right)
//   Call(dst, fn, args)                     CallBuiltin(dst, builtin, args)
//   StructNew(dst, struct, fields)          FieldGet(dst, object, field)      FieldSet(object, field, value)
//   ArrayNew(dst, elem, elements)           IndexGet(dst, array, index)       IndexSet(array, index, value)
//   ArrayLen(dst, array)                    ArrayPush(array, value)           ArrayPop(dst, array)
//   EnumNew(dst, enum, variant, tag, args)  EnumTag(dst, value)
//   EnumField(dst, value, enum, variant, tag, index)                          ReadFile(ok, text, path)
enum IrInstr {
    Copy(int, IrOperand),
    Unop(int, string, IrOperand),
    Binop(int, string, IrOperand, IrOperand),
    Call(Option[int], string, [IrOperand]),
    CallBuiltin(Option[int], string, [IrOperand]),
    StructNew(int, string, [IrFieldValue]),
    FieldGet(int, IrOperand, string),
    FieldSet(IrOperand, string, IrOperand),
    ArrayNew(int, Type, [IrOperand]),
    IndexGet(int, IrOperand, IrOperand),
    IndexSet(IrOperand, IrOperand, IrOperand),
    ArrayLen(int, IrOperand),
    ArrayPush(IrOperand, IrOperand),
    ArrayPop(int, IrOperand),
    EnumNew(int, string, string, int, [IrOperand]),
    EnumTag(int, IrOperand),
    EnumField(int, IrOperand, string, string, int, int),
    ReadFile(int, int, IrOperand),
}

// A `switch` case: a decimal value and the label it jumps to.
struct IrCase { value: string, target: string }

// `Switch(value, cases, default)`: a `None` default means no other value can occur.
enum IrTerm {
    Jmp(string),
    Br(IrOperand, string, string),
    Switch(IrOperand, [IrCase], Option[string]),
    Ret(Option[IrOperand]),
    Unreachable,
}

struct IrBlock { label: string, instrs: [IrInstr], term: IrTerm }

// Params are locals[0 .. param_count). `locals` is indexed by id, and blocks[0] is the entry block.
struct IrFunction { name: string, param_count: int, locals: [IrLocal], ret: Type, blocks: [IrBlock] }

// `strings` holds the interned string literals, referenced by index.
struct IrProgram { structs: [IrStruct], enums: [IrEnum], functions: [IrFunction], strings: [string] }
```

- [ ] **Step 5: Write `packages/asterc-self/ir_print.aster`**

```
// expect-library
// The IR in packages/asterc/src/ir/print.ts's format, character for character. `print_ir` returns the output's lines
// without their newlines. Sections (structs, enums, strings, then each function) are separated by one blank line, as
// printIr's join does. tests/ir_aster.test.ts checks it, through ir.aster, against printIr.

import "ir.aster";

fn ir_join(items: [string], sep: string): string {
    var out: string = "";
    for i in 0..len(items) {
        if i > 0 {
            out += sep;
        }
        out += items[i];
    }
    return out;
}

fn ir_braces(items: [string]): string {
    if len(items) == 0 {
        return "{}";
    }
    return "{ " + ir_join(items, ", ") + " }";
}

// JSON.stringify of `s`, over its bytes: `"` and `\` escaped, \b \f \n \r \t short, other bytes below 32 as \u00xx
// (lowercase), and everything else, including 127 and every byte of a multi-byte UTF-8 sequence, copied through.
fn ir_json_string(s: string): string {
    let hex: string = "0123456789abcdef";
    var out: string = "\"";
    for i in 0..len(s) {
        let b: int = byte_at(s, i);
        if b == '"' {
            out += "\\\"";
        } else if b == '\\' {
            out += "\\\\";
        } else if b == 8 {
            out += "\\b";
        } else if b == 12 {
            out += "\\f";
        } else if b == '\n' {
            out += "\\n";
        } else if b == '\r' {
            out += "\\r";
        } else if b == '\t' {
            out += "\\t";
        } else if b < 32 {
            out += "\\u00" + substring(hex, b / 16, b / 16 + 1) + substring(hex, b % 16, b % 16 + 1);
        } else {
            out += substring(s, i, i + 1);
        }
    }
    return out + "\"";
}

fn ir_operand(o: IrOperand): string {
    return match o {
        IrOperand::Local(id) => "%" + int_to_string(id),
        IrOperand::Int(value) => value,
        IrOperand::Bool(value) => ir_bool_text(value),
        IrOperand::Str(index) => "str#" + int_to_string(index),
    };
}

fn ir_bool_text(b: bool): string {
    if b {
        return "true";
    }
    return "false";
}

fn ir_operands(os: [IrOperand]): string {
    let parts: [string] = [];
    for o in os {
        push(parts, ir_operand(o));
    }
    return ir_join(parts, ", ");
}

fn ir_dst(d: Option[int]): string {
    return match d {
        Option::Some(id) => "%" + int_to_string(id) + " = ",
        Option::None => "",
    };
}

fn ir_instr_text(i: IrInstr): string {
    return match i {
        IrInstr::Copy(dst, src) => "%" + int_to_string(dst) + " = copy " + ir_operand(src),
        IrInstr::Unop(dst, op, operand) => "%" + int_to_string(dst) + " = " + op + " " + ir_operand(operand),
        IrInstr::Binop(dst, op, left, right) => "%" + int_to_string(dst) + " = " + op + " " + ir_operand(left) + ", " + ir_operand(right),
        IrInstr::Call(dst, name, args) => ir_dst(dst) + "call " + name + "(" + ir_operands(args) + ")",
        IrInstr::CallBuiltin(dst, name, args) => ir_dst(dst) + "call_builtin " + name + "(" + ir_operands(args) + ")",
        IrInstr::StructNew(dst, name, fields) => "%" + int_to_string(dst) + " = struct_new " + name + " " + ir_braces(ir_field_values(fields)),
        IrInstr::FieldGet(dst, object, field) => "%" + int_to_string(dst) + " = field_get " + ir_operand(object) + "." + field,
        IrInstr::FieldSet(object, field, value) => "field_set " + ir_operand(object) + "." + field + ", " + ir_operand(value),
        IrInstr::ArrayNew(dst, elem, elements) => "%" + int_to_string(dst) + " = array_new " + type_to_string(elem) + " [" + ir_operands(elements) + "]",
        IrInstr::IndexGet(dst, array, index) => "%" + int_to_string(dst) + " = index_get " + ir_operand(array) + "[" + ir_operand(index) + "]",
        IrInstr::IndexSet(array, index, value) => "index_set " + ir_operand(array) + "[" + ir_operand(index) + "], " + ir_operand(value),
        IrInstr::ArrayLen(dst, array) => "%" + int_to_string(dst) + " = array_len " + ir_operand(array),
        IrInstr::ArrayPush(array, value) => "array_push " + ir_operand(array) + ", " + ir_operand(value),
        IrInstr::ArrayPop(dst, array) => "%" + int_to_string(dst) + " = array_pop " + ir_operand(array),
        IrInstr::EnumNew(dst, name, variant, _, args) => "%" + int_to_string(dst) + " = enum_new " + name + "::" + variant + ir_variant_args(args),
        IrInstr::EnumTag(dst, value) => "%" + int_to_string(dst) + " = enum_tag " + ir_operand(value),
        IrInstr::EnumField(dst, value, name, variant, _, index) => "%" + int_to_string(dst) + " = enum_field " + ir_operand(value) + ", " + name + "::" + variant + "." + int_to_string(index),
        IrInstr::ReadFile(ok, text, path) => "%" + int_to_string(ok) + ", %" + int_to_string(text) + " = read_file " + ir_operand(path),
    };
}

fn ir_field_values(fields: [IrFieldValue]): [string] {
    let parts: [string] = [];
    for f in fields {
        push(parts, f.name + ": " + ir_operand(f.value));
    }
    return parts;
}

fn ir_variant_args(args: [IrOperand]): string {
    if len(args) == 0 {
        return "";
    }
    return "(" + ir_operands(args) + ")";
}

fn ir_term_text(t: IrTerm): string {
    match t {
        IrTerm::Jmp(target) => return "jmp " + target;
        IrTerm::Br(cond, then, otherwise) => return "br " + ir_operand(cond) + ", " + then + ", " + otherwise;
        IrTerm::Switch(value, cases, fallback) => {
            let parts: [string] = [];
            for c in cases {
                push(parts, c.value + ": " + c.target);
            }
            var d: string = "unreachable";
            if let Option::Some(label) = fallback {
                d = label;
            }
            return "switch " + ir_operand(value) + " [" + ir_join(parts, ", ") + "], default " + d;
        }
        IrTerm::Ret(value) => {
            if let Option::Some(v) = value {
                return "ret " + ir_operand(v);
            }
            return "ret";
        }
        IrTerm::Unreachable => return "unreachable";
    }
}

fn ir_local_decl(l: IrLocal): string {
    var name: string = "";
    if let Option::Some(n) = l.name {
        name = " " + n;
    }
    return "%" + int_to_string(l.id) + name + ": " + type_to_string(l.ty);
}

fn ir_variant_decl(v: IrVariant): string {
    if len(v.payload) == 0 {
        return v.name;
    }
    let parts: [string] = [];
    for p in v.payload {
        push(parts, type_to_string(p));
    }
    return v.name + "(" + ir_join(parts, ", ") + ")";
}

// Appends one function's lines: its signature, its non-param locals, then each block's label, instructions and
// terminator.
fn print_ir_function(out: [string], f: IrFunction) {
    let params: [string] = [];
    for i in 0..f.param_count {
        push(params, ir_local_decl(f.locals[i]));
    }
    push(out, "fn " + f.name + "(" + ir_join(params, ", ") + "): " + type_to_string(f.ret));
    for i in f.param_count..len(f.locals) {
        push(out, "  local " + ir_local_decl(f.locals[i]));
    }
    for b in f.blocks {
        push(out, b.label + ":");
        for i in b.instrs {
            push(out, "  " + ir_instr_text(i));
        }
        push(out, "  " + ir_term_text(b.term));
    }
}

fn print_ir(p: IrProgram): [string] {
    let out: [string] = [];
    if len(p.structs) > 0 {
        for s in p.structs {
            let fields: [string] = [];
            for f in s.fields {
                push(fields, f.name + ": " + type_to_string(f.ty));
            }
            push(out, "struct " + s.name + " " + ir_braces(fields));
        }
    }
    if len(p.enums) > 0 {
        if len(out) > 0 {
            push(out, "");
        }
        for e in p.enums {
            let variants: [string] = [];
            for v in e.variants {
                push(variants, ir_variant_decl(v));
            }
            push(out, "enum " + e.name + " " + ir_braces(variants));
        }
    }
    if len(p.strings) > 0 {
        if len(out) > 0 {
            push(out, "");
        }
        for i in 0..len(p.strings) {
            push(out, "string #" + int_to_string(i) + " = " + ir_json_string(p.strings[i]));
        }
    }
    for f in p.functions {
        if len(out) > 0 {
            push(out, "");
        }
        print_ir_function(out, f);
    }
    return out;
}
```

If the checker rejects `match` arms of the form `=> return …;` in `ir_term_text`, rewrite it as `return match t { … };` with the `Switch` and `Ret` arms calling small helpers (`ir_switch_text`, `ir_ret_text`). Check whether `then` is a reserved word. If it is, rename the binder `yes`.

- [ ] **Step 6: Write the basic `packages/asterc-self/lower.aster`**

This is the whole file for Task 1. Later tasks replace `lower_stmt` and `lower_expr` wholesale and add functions.

```
// expect-library
// Lowering, written in Aster: a port of packages/asterc/src/ir/lower.ts, function by function. `lower_program` turns
// the checked program into the IR. It allocates temps, labels and interned strings in exactly the order lower.ts does,
// because tests/ir_aster.test.ts compares the printed IR byte for byte.
//
// Aster has no closures or maps. lower.ts's callbacks become data: `lower_match`'s `into`, `lower_for`'s `IrForKind`
// and `IrPlaceRef`. Its maps become linear scans: `intern_ir_string`, `ir_find_struct` and `ir_block_index`.

import "ir.aster";

// The interned string literals, in first-use order, shared by every function.
struct IrStrings { values: [string] }

// An enclosing loop: where `continue` and `break` jump, and whether a `continue` targets it (so its continue block is
// reachable).
struct IrLoop { continue_label: string, break_label: string, continued: bool }

// The block being filled.
struct IrOpen { label: string, instrs: [IrInstr] }

// Per-function lowering state. `current` is the open block, or `None` when the position is unreachable.
struct IrState {
    locals: [IrLocal],
    blocks: [IrBlock],
    current: Option[IrOpen],
    label_count: int,
    loops: [IrLoop],
    strings: IrStrings,
    structs: [TStruct],
}

fn lower_program(c: Checked): IrProgram {
    let strings: IrStrings = IrStrings { values: [] };
    let functions: [IrFunction] = [];
    for f in c.functions {
        push(functions, lower_function(f, strings, c.structs));
    }
    let structs: [IrStruct] = [];
    for s in c.structs {
        let fields: [IrField] = [];
        for f in s.fields {
            push(fields, IrField { name: f.name, ty: ir_type(f.ty) });
        }
        push(structs, IrStruct { name: s.name, fields: fields });
    }
    let enums: [IrEnum] = [];
    for e in c.enums {
        let variants: [IrVariant] = [];
        for i in 0..len(e.variants) {
            let payload: [Type] = [];
            for p in e.variants[i].payload {
                push(payload, ir_type(p));
            }
            push(variants, IrVariant { name: e.variants[i].name, tag: i, payload: payload });
        }
        push(enums, IrEnum { name: e.name, payload_free: e.payload_free, variants: variants });
    }
    return IrProgram { structs: structs, enums: enums, functions: functions, strings: strings.values };
}

// Every type except the checker-only `error` and `never`.
fn ir_type(t: Type): Type {
    return match t {
        Type::Error => panic("internal: error type reached lowering"),
        Type::Never => panic("internal: never type reached lowering"),
        _ => t,
    };
}

fn lower_function(f: TFunction, strings: IrStrings, structs: [TStruct]): IrFunction {
    let locals: [IrLocal] = [];
    for l in f.locals {
        push(locals, IrLocal { id: l.id, name: Option::Some(l.name), ty: ir_type(l.ty) });
    }
    let st: IrState = IrState {
        locals: locals,
        blocks: [],
        current: Option::Some(IrOpen { label: "entry", instrs: [] }),
        label_count: 0,
        loops: [],
        strings: strings,
        structs: structs,
    };
    lower_block(st, f.body);
    // The checker guarantees non-void functions never fall off the end. A never function is void in the IR: its body
    // diverges, so this is a no-op for it.
    let ret: Type = match f.ret {
        Type::Never => Type::Void,
        _ => ir_type(f.ret),
    };
    if kind_of_type(ret) == "void" {
        ir_terminate(st, IrTerm::Ret(Option::None));
    } else {
        ir_terminate(st, IrTerm::Unreachable);
    }
    return IrFunction { name: f.name, param_count: f.params, locals: st.locals, ret: ret, blocks: prune_unreachable(st.blocks) };
}

fn ir_block_index(blocks: [IrBlock], label: string): int {
    for i in 0..len(blocks) {
        if blocks[i].label == label {
            return i;
        }
    }
    panic("internal: no block " + label);
}

// Keeps only the blocks reachable from the entry block, in their original order.
fn prune_unreachable(blocks: [IrBlock]): [IrBlock] {
    if len(blocks) == 0 {
        return blocks;
    }
    let reached: [bool] = [];
    for b in blocks {
        push(reached, false);
    }
    let work: [string] = [blocks[0].label];
    while len(work) > 0 {
        let i: int = ir_block_index(blocks, pop(work));
        if reached[i] {
            continue;
        }
        reached[i] = true;
        match blocks[i].term {
            IrTerm::Jmp(target) => push(work, target),
            IrTerm::Br(_, then, otherwise) => {
                push(work, then);
                push(work, otherwise);
            }
            IrTerm::Switch(_, cases, fallback) => {
                for c in cases {
                    push(work, c.target);
                }
                if let Option::Some(d) = fallback {
                    push(work, d);
                }
            }
            _ => {}
        }
    }
    let kept: [IrBlock] = [];
    for i in 0..len(blocks) {
        if reached[i] {
            push(kept, blocks[i]);
        }
    }
    return kept;
}

// ---- block plumbing

fn ir_new_label(st: IrState, hint: string): string {
    st.label_count += 1;
    return hint + int_to_string(st.label_count);
}

fn ir_new_temp(st: IrState, ty: Type): int {
    let id: int = len(st.locals);
    push(st.locals, IrLocal { id: id, name: Option::None, ty: ty });
    return id;
}

// Code after a never expression is unreachable: it is dropped rather than emitted.
fn ir_emit(st: IrState, i: IrInstr) {
    if let Option::Some(open) = st.current {
        push(open.instrs, i);
    }
}

// Closes the open block with `t`. A no-op when the position is already unreachable.
fn ir_terminate(st: IrState, t: IrTerm) {
    if let Option::Some(open) = st.current {
        push(st.blocks, IrBlock { label: open.label, instrs: open.instrs, term: t });
        st.current = Option::None;
    }
}

// Opens a new block, falling through into it from the open block if there is one.
fn ir_start_block(st: IrState, label: string) {
    ir_terminate(st, IrTerm::Jmp(label));
    st.current = Option::Some(IrOpen { label: label, instrs: [] });
}

fn ir_reachable(st: IrState): bool {
    return match st.current {
        Option::Some(_) => true,
        Option::None => false,
    };
}

fn intern_ir_string(table: IrStrings, value: string): int {
    for i in 0..len(table.values) {
        if table.values[i] == value {
            return i;
        }
    }
    push(table.values, value);
    return len(table.values) - 1;
}

fn ir_current_loop(st: IrState): IrLoop {
    if len(st.loops) == 0 {
        panic("internal: break/continue outside loop");
    }
    return st.loops[len(st.loops) - 1];
}

fn ir_ref(id: int): IrOperand {
    return IrOperand::Local(id);
}

// Stands in for the value of an expression in unreachable code. It is only ever used there, and that code is pruned.
fn ir_placeholder(): IrOperand {
    return IrOperand::Int("0");
}

// ---- statements

fn lower_block(st: IrState, b: TBlock) {
    for s in b.stmts {
        if !ir_reachable(st) {
            return; // the rest is unreachable
        }
        lower_stmt(st, s);
    }
}

fn lower_stmt(st: IrState, s: TStmt) {
    match s {
        TStmt::Let(local, init) => {
            let v: IrOperand = lower_value(st, init);
            ir_emit(st, IrInstr::Copy(local.id, v));
        }
        TStmt::Expr(e) => {
            lower_expr(st, e);
        }
        TStmt::Block(b) => lower_block(st, b),
        TStmt::Return(value) => {
            if let Option::Some(e) = value {
                let v: IrOperand = lower_value(st, e);
                ir_terminate(st, IrTerm::Ret(Option::Some(v)));
            } else {
                ir_terminate(st, IrTerm::Ret(Option::None));
            }
        }
        _ => panic("internal: statement not lowered yet"),
    }
}

// ---- expressions

fn lower_value(st: IrState, e: TExpr): IrOperand {
    return match lower_expr(st, e) {
        Option::Some(v) => v,
        Option::None => panic("internal: void expression used as a value"),
    };
}

// Lowers each of `es` in order.
fn lower_args(st: IrState, es: [TExpr]): [IrOperand] {
    let out: [IrOperand] = [];
    for e in es {
        push(out, lower_value(st, e));
    }
    return out;
}

// Lowers an expression and returns its value, or `None` for a void expression.
fn lower_expr(st: IrState, e: TExpr): Option[IrOperand] {
    if !ir_reachable(st) {
        return Option::Some(ir_placeholder());
    }
    return match e.node {
        TExprNode::Int(value) => Option::Some(IrOperand::Int(value)),
        TExprNode::Bool(value) => Option::Some(IrOperand::Bool(value)),
        TExprNode::Str(value) => Option::Some(IrOperand::Str(intern_ir_string(st.strings, value))),
        TExprNode::Local(l) => Option::Some(ir_ref(l.id)),
        _ => panic("internal: expression not lowered yet"),
    };
}
```

Notes for the implementer:
- If `-Werror` or the checker rejects the unused loop variable `b` in `for b in blocks { push(reached, false); }`, use `for i in 0..len(blocks)`.
- If `lower_expr(st, e);` as an expression statement is rejected because its value is unused, write `let ignored: Option[IrOperand] = lower_expr(st, e);` and note it in the friction log.
- If `if let … { } else { }` isn't accepted, use a `match` on `value`.
- `panic` at the end of `ir_block_index` is a diverging tail. If the checker reports "missing return", that is a friction note: add `return -1;` after it only if the checker requires it.

- [ ] **Step 7: Write the fixture `tests/programs/programs/fixtures/ir_basics.txt`**

```
// IR fixture: declarations, literals, locals, let, return, nested blocks and the string table.
struct Point { x: int, y: int }
enum Color { Red, Green }
enum Shape { Dot(Point), Empty }

fn nothing() {
}

fn answer(): int {
    let a: int = 42;
    {
        let b: int = a;
        return b;
    }
}

fn main(): int {
    let s: string = "hi";
    let t: string = "hi";
    let u: string = "tab\tquote\"back\\nul\0cr\r";
    let yes: bool = true;
    let no: bool = false;
    var n: int = -1;
    let m: int = n;
    return 0;
}
```

If the TS front end rejects it (run the TS recipe above), fix the fixture rather than the compiler. For example, unused locals may be fine but unused functions may warn. `-1` is a `unary -` in the typed tree, so if that isn't lowered until Task 2, change it to `var n: int = 1;` here and move `-1` to `ir_effects.txt`.

- [ ] **Step 8: Write the driver `tests/programs/programs/ir.aster`**

```
// Prints the lowered program in packages/asterc/src/ir/print.ts's format. It loads the program rooted at the file named
// by its only argument, with every file it imports, type-checks it and lowers it (lower_program in
// packages/asterc-self/lower.aster). Diagnostics go to stderr exactly as check.aster prints them, exiting with status 1
// if there are any; with none it prints the IR (print_ir in packages/asterc-self/ir_print.aster) to stdout.
// tests/ir_aster.test.ts checks it against the compiler's own printIr(lower(typed)).
// expect-args: fixtures/ir_basics.txt
// expect-stdout:
// (filled in at Step 10)

import "../../../packages/asterc-self/loader.aster";
import "../../../packages/asterc-self/checker.aster";
import "../../../packages/asterc-self/report.aster";
import "../../../packages/asterc-self/lower.aster";
import "../../../packages/asterc-self/ir_print.aster";

// Prints `msg` to stderr and exits with status 2, for a usage or read error.
fn die(msg: string): never {
    eprint(msg);
    exit(2);
}

fn main(args: [string]): int {
    if len(args) != 1 {
        die("usage: ir <file>");
    }
    match read_file(args[0]) {
        Result::Ok(src) => {
            let loaded: Loaded = load_program(args[0], src);
            if len(loaded.diags) > 0 {
                print_diags(loaded.files, sort_diags(loaded.diags));
                exit(1);
            }
            let checked: Checked = check_program(loaded.items, loaded.root_end);
            if len(checked.diags) > 0 {
                print_diags(loaded.files, sort_diags(checked.diags));
                exit(1);
            }
            for l in print_ir(lower_program(checked)) {
                print(l);
            }
            return 0;
        }
        Result::Err(msg) => die(msg),
    }
}
```

- [ ] **Step 9: Write `tests/ir_aster.test.ts`**

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExecutable, compileToC, formatDiagnostic, lower, makeSource, printIr } from '../packages/asterc/src/index.js';
import { acceptedCorpus, PROGRAMS_DIR } from './corpus.js';

// Checks tests/programs/programs/ir.aster, which lowers a program with packages/asterc-self/lower.aster and prints it
// with packages/asterc-self/ir_print.aster, against the compiler's own printIr(lower(typed)), byte for byte, on the
// accepted corpus (tests/corpus.ts). Nothing is normalised: temp, label and string numbering must match exactly.

/** Files the port can't lower yet: each must still differ from TypeScript. It shrinks every task and is empty at merge. */
const PENDING = new Set<string>([]);

const accepted = acceptedCorpus();
const corpus = accepted.map((c) => c.file);

const workDir = mkdtempSync(join(tmpdir(), 'aster-ir-'));
const exe = join(workDir, 'ir');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

beforeAll(() => {
  const path = join(PROGRAMS_DIR, 'programs', 'ir.aster');
  const compiled = compileToC(makeSource(path, readFileSync(path, 'utf8')));
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
  const built = buildExecutable(compiled.c, exe, ['-Werror']);
  if (!built.ok) throw new Error(built.message);
});

describe('ir.aster matches the TypeScript IR', () => {
  it('has a corpus that includes the drivers and the IR fixtures', () => {
    expect(corpus).toContain(join('programs', 'ir.aster'));
    for (const name of readdirSync(join(PROGRAMS_DIR, 'programs', 'fixtures')).filter((n) => /^ir_\w+\.txt$/.test(n))) {
      expect(corpus).toContain(join('programs', 'fixtures', name));
    }
  });

  it('lists only corpus files as pending', () => {
    for (const file of PENDING) expect(corpus).toContain(file);
  });

  it.for(accepted)('$file', ({ file, typed }) => {
    const run = spawnSync(exe, [join(PROGRAMS_DIR, file)], { encoding: 'utf8', timeout: 20_000, maxBuffer: 256 * 1024 * 1024 });
    const actual = { stdout: run.stdout, stderr: run.stderr, status: run.status };
    const expected = { stdout: printIr(lower(typed)), stderr: '', status: 0 };
    if (PENDING.has(file)) expect(actual).not.toEqual(expected);
    else expect(actual).toEqual(expected);
  });
});
```

- [ ] **Step 10: Run, fill in `PENDING`, and fill in the driver's golden header**

Run: `pnpm vitest run tests/ir_aster.test.ts --reporter=json --outputFile=<scratch>/ir.json`, then list the failing files:

```bash
node -e "const r=require('<scratch>/ir.json');for(const f of r.testResults)for(const a of f.assertionResults)if(a.status==='failed')console.log(a.title)"
```

Expected: `programs/fixtures/ir_basics.txt` **passes**. If it doesn't, diff it with the recipe in Global Constraints and fix `lower.aster`/`ir_print.aster` until it does. Nearly everything else fails with a `panic: internal: … not lowered yet`. Put every failing file into `PENDING` as a sorted list of string literals, one per line, using the path the test title shows (for example `join('programs', 'check.aster')` shows as `programs/check.aster`).

Then generate the golden header. Run the TS recipe on `tests/programs/programs/fixtures/ir_basics.txt` and paste its output under `// expect-stdout:` in `ir.aster`, each line prefixed with `// `. An empty line becomes `//`. Check `tests/harness.ts`'s `commentBody` to confirm that `//` reads back as an empty line. If it doesn't, note it in the friction log and pick an `expect-args` fixture whose IR has no blank line. Since every program has structs or strings before its functions, use one with only `main`, such as a new `fixtures/ir_tiny.txt` containing `fn main(): int { return 0; }`, if necessary.

- [ ] **Step 11: Run every suite touched**

Run: `pnpm vitest run tests/ir_aster.test.ts tests/ir_validate.test.ts tests/typed_aster.test.ts tests/check_aster.test.ts tests/golden.test.ts`
Expected: PASS (`PENDING` files pass by still differing).
Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 12: Commit**

```bash
git add packages/asterc-self/ir.aster packages/asterc-self/ir_print.aster packages/asterc-self/lower.aster \
  tests/programs/programs/ir.aster tests/programs/programs/fixtures/ir_basics.txt \
  tests/corpus.ts tests/ir_validate.ts tests/ir_validate.test.ts tests/ir_aster.test.ts tests/typed_aster.test.ts
git commit -m "feat: IR types, printer and basic lowering in Aster" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FpzzMjPkrLERmoHMVp5kyD"
```

---

### Task 2: Straight-line expressions and assignment

**Files:**
- Modify: `packages/asterc-self/lower.aster`
- Create: `tests/programs/programs/fixtures/ir_effects.txt`
- Modify: `tests/ir_aster.test.ts` (`PENDING`)

**Interfaces:**
- Consumes: Task 1's plumbing and `lower_value`/`lower_args`.
- Produces: `ir_bin_op(op: string, t: Type): string`, `ir_compound_base(op: string): string`, `ir_enum_tag(st: IrState, value: IrOperand): IrOperand`, `ir_find_struct(structs: [TStruct], name: string): TStruct`, `IrPlaceRef`, and the expression helpers named below. Tasks 3 and 4 use `ir_bin_op` and `ir_enum_tag`.

- [ ] **Step 1: Write the failing fixture `tests/programs/programs/fixtures/ir_effects.txt`**

```
// IR fixture: operators, calls, builtins, field and index places, compound assignment and evaluation order.
struct Pair { a: int, b: string }
struct Box { items: [int], pair: Pair }
enum Op { Add, Sub }
enum Val { Num(int), Text(string) }

fn tick(log: [string], s: string): int {
    push(log, s);
    return len(log);
}

fn say(s: string) {
    print(s);
}

fn main(): int {
    let log: [string] = [];
    let x: int = -tick(log, "a") + 2 * 3 - 4 / 2 % 3;
    let flag: bool = !(x < 1) == (x >= 2);
    let s: string = "x" + int_to_string(x);
    let same: bool = s == "x1" != (s != "y");
    // Written out of declaration order: b's call runs first.
    let p: Pair = Pair { b: substring("hello", tick(log, "b"), 3), a: tick(log, "c") };
    let box: Box = Box { pair: p, items: [1, 2, tick(log, "d")] };
    box.items[tick(log, "e") - 5] += tick(log, "f");
    box.pair.a -= 1;
    box.pair.b = "z";
    box.items[0] = box.pair.a;
    var n: int = 10;
    n *= x;
    n = n + byte_at(s, 0);
    push(box.items, n);
    let last: int = pop(box.items);
    let count: int = len(box.items) + len(s);
    let op: Op = Op::Sub;
    let same_op: bool = op == Op::Add;
    let other_op: bool = op != Op::Sub;
    let v: Val = Val::Text("t");
    let w: Val = Val::Num(last + count);
    print(flag);
    print(same);
    print(same_op || other_op);
    eprint(count);
    eprint(true);
    eprint("e");
    say(s);
    print(len(read_stdin()));
    return 0;
}
```

`same_op || other_op` uses short-circuit lowering, which is Task 3. Replace it with `print(same_op); print(other_op);` here. Also check `v` and `w` with the TS recipe: if TS warns about unused locals, `print` them through a call. The fixture must be accepted by `runFrontend` with zero diagnostics. Run the TS recipe on it to confirm.

Run: `pnpm vitest run tests/ir_aster.test.ts -t ir_effects`
Expected: FAIL (`panic: internal: … not lowered yet`).

- [ ] **Step 2: Add the operator, place and expression helpers to `lower.aster`**

Add these after `ir_placeholder`, in a section `// ---- operators and places`:

```
// The IR operator for source operator `op` (never `&&` or `||`) on operands of type `t`.
fn ir_bin_op(op: string, t: Type): string {
    if kind_of_type(t) == "string" {
        if op == "+" {
            return "concat";
        }
        if op == "==" {
            return "str_eq";
        }
        if op == "!=" {
            return "str_ne";
        }
    }
    return match op {
        "+" => "add",
        "-" => "sub",
        "*" => "mul",
        "/" => "div",
        "%" => "mod",
        "<" => "lt",
        "<=" => "le",
        ">" => "gt",
        ">=" => "ge",
        "==" => "eq",
        "!=" => "ne",
        _ => panic("internal: short-circuit operator in binOp"),
    };
}

// `+=` to `+` (ast.ts's binaryOpOf).
fn ir_compound_base(op: string): string {
    return substring(op, 0, len(op) - 1);
}

// Reads the tag of an enum value into a new int temporary.
fn ir_enum_tag(st: IrState, value: IrOperand): IrOperand {
    let dst: int = ir_new_temp(st, Type::Int);
    ir_emit(st, IrInstr::EnumTag(dst, value));
    return ir_ref(dst);
}

fn ir_find_struct(structs: [TStruct], name: string): TStruct {
    for s in structs {
        if s.name == name {
            return s;
        }
    }
    panic("internal: unknown struct " + name);
}

// An assignment target whose sub-expressions are already lowered (so they run exactly once).
enum IrPlaceRef { Field(IrOperand, string), Index(IrOperand, IrOperand) }

fn ir_place_read(r: IrPlaceRef, dst: int): IrInstr {
    return match r {
        IrPlaceRef::Field(object, field) => IrInstr::FieldGet(dst, object, field),
        IrPlaceRef::Index(array, index) => IrInstr::IndexGet(dst, array, index),
    };
}

fn ir_place_write(r: IrPlaceRef, value: IrOperand): IrInstr {
    return match r {
        IrPlaceRef::Field(object, field) => IrInstr::FieldSet(object, field, value),
        IrPlaceRef::Index(array, index) => IrInstr::IndexSet(array, index, value),
    };
}
```

Then the statements, after `lower_block`:

```
fn lower_assign(st: IrState, place: TPlace, op: string, value: TExpr) {
    match place.node {
        TPlaceNode::Local(l) => {
            // A local can't change while the right-hand side runs, so it can be read after it.
            let v: IrOperand = lower_value(st, value);
            if op == "=" {
                ir_emit(st, IrInstr::Copy(l.id, v));
            } else {
                ir_emit(st, IrInstr::Binop(l.id, ir_bin_op(ir_compound_base(op), place.ty), ir_ref(l.id), v));
            }
        }
        TPlaceNode::Field(object, field) => {
            let o: IrOperand = lower_value(st, object);
            ir_store_through_place(st, IrPlaceRef::Field(o, field), place.ty, op, value);
        }
        TPlaceNode::Index(array, index) => {
            let a: IrOperand = lower_value(st, array);
            let i: IrOperand = lower_value(st, index);
            ir_store_through_place(st, IrPlaceRef::Index(a, i), place.ty, op, value);
        }
    }
}

// Finishes an assignment to a place whose sub-expressions are lowered: computes the new value (reading the place first
// for a compound operator) and writes it.
fn ir_store_through_place(st: IrState, r: IrPlaceRef, ty: Type, op: string, rhs: TExpr) {
    var value: IrOperand = ir_placeholder();
    if op == "=" {
        value = lower_value(st, rhs);
    } else {
        value = ir_combine(st, op, ty, r, rhs);
    }
    ir_emit(st, ir_place_write(r, value));
}

// For `place op= rhs`: loads the place's current value, evaluates `rhs`, applies `op` and returns the result.
fn ir_combine(st: IrState, op: string, ty: Type, r: IrPlaceRef, rhs: TExpr): IrOperand {
    let old: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, ir_place_read(r, old));
    let value: IrOperand = lower_value(st, rhs);
    let dst: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, IrInstr::Binop(dst, ir_bin_op(ir_compound_base(op), ty), ir_ref(old), value));
    return ir_ref(dst);
}
```

Then the expression helpers, after `lower_expr`:

```
fn lower_unary(st: IrState, ty: Type, op: string, operand: TExpr): IrOperand {
    let v: IrOperand = lower_value(st, operand);
    let dst: int = ir_new_temp(st, ir_type(ty));
    if op == "-" {
        ir_emit(st, IrInstr::Unop(dst, "neg", v));
    } else {
        ir_emit(st, IrInstr::Unop(dst, "not", v));
    }
    return ir_ref(dst);
}

fn lower_binary(st: IrState, ty: Type, op: string, left: TExpr, right: TExpr): IrOperand {
    let l: IrOperand = lower_value(st, left);
    let r: IrOperand = lower_value(st, right);
    let dst: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, IrInstr::Binop(dst, ir_bin_op(op, left.ty), l, r));
    return ir_ref(dst);
}

fn lower_call(st: IrState, ty: Type, name: string, args: [TExpr]): Option[IrOperand] {
    let a: [IrOperand] = lower_args(st, args);
    let k: string = kind_of_type(ty);
    if k == "void" || k == "never" {
        ir_emit(st, IrInstr::Call(Option::None, name, a));
        if k == "never" {
            ir_terminate(st, IrTerm::Unreachable);
            return Option::Some(ir_placeholder());
        }
        return Option::None;
    }
    let dst: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, IrInstr::Call(Option::Some(dst), name, a));
    return Option::Some(ir_ref(dst));
}

// The IR builtin for a call of `name`: print and eprint split by argument type.
fn ir_builtin_name(name: string, args: [TExpr]): string {
    if name == "print" || name == "eprint" {
        let k: string = kind_of_type(args[0].ty);
        if k == "int" {
            return name + "_int";
        }
        if k == "bool" {
            return name + "_bool";
        }
        return name + "_string";
    }
    return name;
}

fn lower_builtin(st: IrState, ty: Type, name: string, args: [TExpr]): Option[IrOperand] {
    let a: [IrOperand] = lower_args(st, args);
    if name == "read_file" {
        panic("internal: read_file is lowered in Task 4");
    }
    if name == "push" {
        ir_emit(st, IrInstr::ArrayPush(a[0], a[1]));
        return Option::None;
    }
    if name == "pop" {
        let dst: int = ir_new_temp(st, ir_type(ty));
        ir_emit(st, IrInstr::ArrayPop(dst, a[0]));
        return Option::Some(ir_ref(dst));
    }
    if name == "len" && kind_of_type(args[0].ty) == "array" {
        let dst: int = ir_new_temp(st, ir_type(ty));
        ir_emit(st, IrInstr::ArrayLen(dst, a[0]));
        return Option::Some(ir_ref(dst));
    }
    let k: string = kind_of_type(ty);
    if k == "void" || k == "never" {
        ir_emit(st, IrInstr::CallBuiltin(Option::None, ir_builtin_name(name, args), a));
        if k == "never" {
            ir_terminate(st, IrTerm::Unreachable);
            return Option::Some(ir_placeholder());
        }
        return Option::None;
    }
    let dst: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, IrInstr::CallBuiltin(Option::Some(dst), ir_builtin_name(name, args), a));
    return Option::Some(ir_ref(dst));
}

fn lower_field(st: IrState, ty: Type, object: TExpr, field: string): IrOperand {
    let o: IrOperand = lower_value(st, object);
    let dst: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, IrInstr::FieldGet(dst, o, field));
    return ir_ref(dst);
}

fn lower_index(st: IrState, ty: Type, array: TExpr, index: TExpr): IrOperand {
    let a: IrOperand = lower_value(st, array);
    let i: IrOperand = lower_value(st, index);
    let dst: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, IrInstr::IndexGet(dst, a, i));
    return ir_ref(dst);
}

fn lower_array_lit(st: IrState, ty: Type, elements: [TExpr]): IrOperand {
    let els: [IrOperand] = lower_args(st, elements);
    let t: Type = ir_type(ty);
    let elem: Type = match t {
        Type::Array(e) => e,
        _ => panic("internal: array literal without an array type"),
    };
    let dst: int = ir_new_temp(st, t);
    ir_emit(st, IrInstr::ArrayNew(dst, ir_type(elem), els));
    return ir_ref(dst);
}

fn lower_variant(st: IrState, ty: Type, enum_name: string, variant: string, tag: int, args: [TExpr]): IrOperand {
    let a: [IrOperand] = lower_args(st, args);
    let dst: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, IrInstr::EnumNew(dst, enum_name, variant, tag, a));
    return ir_ref(dst);
}

fn lower_enum_compare(st: IrState, op: string, left: TExpr, right: TExpr): IrOperand {
    let l: IrOperand = ir_enum_tag(st, lower_value(st, left));
    let r: IrOperand = ir_enum_tag(st, lower_value(st, right));
    let dst: int = ir_new_temp(st, Type::Bool);
    if op == "==" {
        ir_emit(st, IrInstr::Binop(dst, "eq", l, r));
    } else {
        ir_emit(st, IrInstr::Binop(dst, "ne", l, r));
    }
    return ir_ref(dst);
}

// The value of field `name` among the written-order `values`.
fn ir_field_value(values: [IrFieldValue], name: string): IrOperand {
    for v in values {
        if v.name == name {
            return v.value;
        }
    }
    panic("internal: missing field " + name);
}

// Evaluates the fields in written order, then hands the values over in declaration order. Reordering operands is safe
// because no Aster expression can assign to a local.
fn lower_struct_lit(st: IrState, ty: Type, name: string, fields: [TFieldInit]): IrOperand {
    let values: [IrFieldValue] = [];
    for f in fields {
        push(values, IrFieldValue { name: f.field, value: lower_value(st, f.value) });
    }
    let decl: TStruct = ir_find_struct(st.structs, name);
    let ordered: [IrFieldValue] = [];
    for d in decl.fields {
        push(ordered, IrFieldValue { name: d.name, value: ir_field_value(values, d.name) });
    }
    let dst: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, IrInstr::StructNew(dst, name, ordered));
    return ir_ref(dst);
}
```

`ir_field_value` collides with nothing in the closure, but `ir_print.aster` has `ir_field_values` (plural). Both names are fine. Just check that `lower.aster` and `ir_print.aster` don't define the same name twice when the driver imports both.

- [ ] **Step 3: Extend `lower_stmt` and `lower_expr`**

In `lower_stmt`, add an arm before `_`:

```
        TStmt::Assign(place, op, value) => lower_assign(st, place, op, value),
```

Replace `lower_expr`'s `match` with:

```
    return match e.node {
        TExprNode::Int(value) => Option::Some(IrOperand::Int(value)),
        TExprNode::Bool(value) => Option::Some(IrOperand::Bool(value)),
        TExprNode::Str(value) => Option::Some(IrOperand::Str(intern_ir_string(st.strings, value))),
        TExprNode::Local(l) => Option::Some(ir_ref(l.id)),
        TExprNode::Unary(op, operand) => Option::Some(lower_unary(st, e.ty, op, operand)),
        TExprNode::Binary(op, left, right) => Option::Some(lower_binary(st, e.ty, op, left, right)),
        TExprNode::Call(name, args) => lower_call(st, e.ty, name, args),
        TExprNode::Builtin(name, args) => lower_builtin(st, e.ty, name, args),
        TExprNode::Field(object, field) => Option::Some(lower_field(st, e.ty, object, field)),
        TExprNode::Index(array, index) => Option::Some(lower_index(st, e.ty, array, index)),
        TExprNode::ArrayLit(elements) => Option::Some(lower_array_lit(st, e.ty, elements)),
        TExprNode::StructLit(name, fields) => Option::Some(lower_struct_lit(st, e.ty, name, fields)),
        TExprNode::Variant(enum_name, variant, tag, args) => Option::Some(lower_variant(st, e.ty, enum_name, variant, tag, args)),
        TExprNode::EnumCompare(op, left, right) => Option::Some(lower_enum_compare(st, op, left, right)),
        TExprNode::Error => panic("internal: error expression reached lowering"),
        _ => panic("internal: expression not lowered yet"),
    };
```

`&&`/`||` reach `lower_binary` until Task 3, where `ir_bin_op` panics on them. That is expected while files using them are pending.

- [ ] **Step 4: Run and shrink `PENDING`**

Run: `pnpm vitest run tests/ir_aster.test.ts`
Expected: `ir_effects.txt` and `ir_basics.txt` pass. Some formerly pending files now fail with "expected … not to equal", because they pass now. Remove exactly those from `PENDING`. Any other failure is a bug: diff it with the recipe.

- [ ] **Step 5: Run the guard suites and commit**

Run: `pnpm vitest run tests/ir_aster.test.ts tests/ir_validate.test.ts tests/golden.test.ts tests/check_aster.test.ts tests/typed_aster.test.ts && pnpm lint`
Expected: PASS.

```bash
git add packages/asterc-self/lower.aster tests/programs/programs/fixtures/ir_effects.txt tests/ir_aster.test.ts
git commit -m "feat: lower.aster lowers expressions and assignments" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FpzzMjPkrLERmoHMVp5kyD"
```

---

### Task 3: Control flow

**Files:**
- Modify: `packages/asterc-self/lower.aster`
- Create: `tests/programs/programs/fixtures/ir_control.txt`
- Modify: `tests/ir_aster.test.ts` (`PENDING`)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `IrForKind`, `lower_for`, `lower_if_expr(st, ty, cond, then, otherwise): IrOperand` and `lower_short_circuit(st, op, left, right): IrOperand`. `lower_stmt` handles everything except `Match`.

- [ ] **Step 1: Write the failing fixture `tests/programs/programs/fixtures/ir_control.txt`**

```
// IR fixture: if/else chains, while, both for loops, nested break/continue, a for that only continues, if expressions
// and short-circuit operators with side effects.
fn check(log: [int], v: int, r: bool): bool {
    push(log, v);
    return r;
}

fn classify(n: int): string {
    if n < 0 {
        return "neg";
    } else if n == 0 {
        return "zero";
    }
    return "pos";
}

fn main(): int {
    let log: [int] = [];
    var total: int = 0;
    var i: int = 0;
    while i < 10 {
        i += 1;
        if i % 2 == 0 {
            continue;
        }
        for j in 0..i {
            if j == 3 {
                break;
            }
            if j == 1 {
                continue;
            }
            total += j;
        }
        if total > 100 {
            break;
        }
    }
    // The body never falls through: every path continues, so the step block exists only because of `continued`.
    for k in 0..3 {
        if k == 1 {
            total += 1;
            continue;
        } else {
            continue;
        }
    }
    // The body always breaks: no step block.
    for v in [1, 2, 3] {
        total += v;
        break;
    }
    for w in log {
        if w > 0 {
            total -= w;
        }
    }
    while true {
        break;
    }
    let pick: int = if total > 5 { 1 } else { 2 };
    let both: bool = check(log, 1, true) && check(log, 2, false);
    let either: bool = check(log, 3, false) || check(log, 4, true) && both;
    if both {
        print(classify(pick));
    }
    if either {
        print(classify(-pick));
    } else {
        print("neither");
    }
    return 0;
}
```

Confirm with the TS recipe that `runFrontend` accepts it (check the `if` expression syntax against an existing golden program, and adjust if Aster spells it differently).

Run: `pnpm vitest run tests/ir_aster.test.ts -t ir_control`
Expected: FAIL.

- [ ] **Step 2: Add the control-flow code**

Add to `lower.aster`, after `lower_assign`'s helpers:

```
// What a for loop iterates: `Range(limit, local)` counts the hidden counter up to the `limit` local and binds it to
// `local`; `Each(array, local)` walks the `array` local and binds each element to `local`.
enum IrForKind { Range(int, int), Each(int, int) }

// The shared shape of both for loops (`counter` is the hidden int local that the step block increments):
//   head: br cond, body, end
//   body: bind the loop variable; body; jmp step
//   step: counter += 1; jmp head   (only when the body can fall through or continue; an unused label would warn)
//   end:
fn lower_for(st: IrState, body: TBlock, counter: int, kind: IrForKind) {
    let head: string = ir_new_label(st, "for_head");
    let body_label: string = ir_new_label(st, "for_body");
    let step: string = ir_new_label(st, "for_step");
    let end: string = ir_new_label(st, "for_end");
    ir_start_block(st, head);
    var cond: int = 0;
    match kind {
        IrForKind::Range(limit, _) => {
            cond = ir_new_temp(st, Type::Bool);
            ir_emit(st, IrInstr::Binop(cond, "lt", ir_ref(counter), ir_ref(limit)));
        }
        IrForKind::Each(array, _) => {
            let n: int = ir_new_temp(st, Type::Int);
            ir_emit(st, IrInstr::ArrayLen(n, ir_ref(array)));
            cond = ir_new_temp(st, Type::Bool);
            ir_emit(st, IrInstr::Binop(cond, "lt", ir_ref(counter), ir_ref(n)));
        }
    }
    ir_terminate(st, IrTerm::Br(ir_ref(cond), body_label, end));
    ir_start_block(st, body_label);
    match kind {
        IrForKind::Range(_, local) => ir_emit(st, IrInstr::Copy(local, ir_ref(counter))),
        IrForKind::Each(array, local) => ir_emit(st, IrInstr::IndexGet(local, ir_ref(array), ir_ref(counter))),
    }
    let lp: IrLoop = IrLoop { continue_label: step, break_label: end, continued: false };
    push(st.loops, lp);
    lower_block(st, body);
    pop(st.loops);
    if ir_reachable(st) || lp.continued {
        ir_start_block(st, step);
        ir_emit(st, IrInstr::Binop(counter, "add", ir_ref(counter), IrOperand::Int("1")));
        ir_terminate(st, IrTerm::Jmp(head));
    }
    ir_start_block(st, end);
}
```

Replace `lower_stmt` with the full version, keeping the `Match` arm pending until Task 4:

```
fn lower_stmt(st: IrState, s: TStmt) {
    match s {
        TStmt::Let(local, init) => {
            let v: IrOperand = lower_value(st, init);
            ir_emit(st, IrInstr::Copy(local.id, v));
        }
        TStmt::Assign(place, op, value) => lower_assign(st, place, op, value),
        TStmt::Match(_, _) => panic("internal: statement not lowered yet"),
        TStmt::Expr(e) => {
            lower_expr(st, e);
        }
        TStmt::Block(b) => lower_block(st, b),
        TStmt::Return(value) => {
            if let Option::Some(e) = value {
                let v: IrOperand = lower_value(st, e);
                ir_terminate(st, IrTerm::Ret(Option::Some(v)));
            } else {
                ir_terminate(st, IrTerm::Ret(Option::None));
            }
        }
        TStmt::Break => {
            let lp: IrLoop = ir_current_loop(st);
            ir_terminate(st, IrTerm::Jmp(lp.break_label));
        }
        TStmt::Continue => {
            let lp: IrLoop = ir_current_loop(st);
            lp.continued = true;
            ir_terminate(st, IrTerm::Jmp(lp.continue_label));
        }
        TStmt::If(cond, then, otherwise) => lower_if_stmt(st, cond, then, otherwise),
        TStmt::While(cond, body) => {
            let head: string = ir_new_label(st, "while_head");
            let body_label: string = ir_new_label(st, "while_body");
            let end: string = ir_new_label(st, "while_end");
            ir_start_block(st, head);
            let c: IrOperand = lower_value(st, cond);
            ir_terminate(st, IrTerm::Br(c, body_label, end));
            ir_start_block(st, body_label);
            push(st.loops, IrLoop { continue_label: head, break_label: end, continued: false });
            lower_block(st, body);
            pop(st.loops);
            ir_terminate(st, IrTerm::Jmp(head));
            ir_start_block(st, end);
        }
        TStmt::ForRange(local, start, end, body) => {
            let s0: IrOperand = lower_value(st, start);
            let e0: IrOperand = lower_value(st, end);
            let counter: int = ir_new_temp(st, Type::Int);
            let limit: int = ir_new_temp(st, Type::Int);
            ir_emit(st, IrInstr::Copy(counter, s0));
            ir_emit(st, IrInstr::Copy(limit, e0));
            lower_for(st, body, counter, IrForKind::Range(limit, local.id));
        }
        TStmt::ForEach(local, array, body) => {
            let source: IrOperand = lower_value(st, array);
            let arr: int = ir_new_temp(st, ir_type(array.ty));
            let index: int = ir_new_temp(st, Type::Int);
            ir_emit(st, IrInstr::Copy(arr, source));
            ir_emit(st, IrInstr::Copy(index, IrOperand::Int("0")));
            lower_for(st, body, index, IrForKind::Each(arr, local.id));
        }
    }
}

fn lower_if_stmt(st: IrState, cond: TExpr, then: TBlock, otherwise: Option[TBlock]) {
    let c: IrOperand = lower_value(st, cond);
    let then_label: string = ir_new_label(st, "then");
    var else_label: string = "";
    if let Option::Some(_) = otherwise {
        else_label = ir_new_label(st, "else");
    }
    let end_label: string = ir_new_label(st, "endif");
    if else_label == "" {
        ir_terminate(st, IrTerm::Br(c, then_label, end_label));
    } else {
        ir_terminate(st, IrTerm::Br(c, then_label, else_label));
    }
    ir_start_block(st, then_label);
    lower_block(st, then);
    var reaches_end: bool = ir_reachable(st) || else_label == "";
    ir_terminate(st, IrTerm::Jmp(end_label));
    if let Option::Some(b) = otherwise {
        ir_start_block(st, else_label);
        lower_block(st, b);
        if ir_reachable(st) {
            reaches_end = true;
        }
        ir_terminate(st, IrTerm::Jmp(end_label));
    }
    if reaches_end {
        ir_start_block(st, end_label);
    }
}
```

`lp.continued = true` must be visible through `st.loops`. If the checker rejects assignment through an immutable `let` binding, use `var lp: IrLoop`. Structs are references, so either way it mutates the shared `IrLoop`. The `for k in 0..3` loop in the fixture proves it: without the alias there is no `for_step` block and the IR differs.

Add the expression forms after `lower_binary`:

```
fn lower_short_circuit(st: IrState, op: string, left: TExpr, right: TExpr): IrOperand {
    let l: IrOperand = lower_value(st, left);
    var rhs: string = "";
    var end: string = "";
    if op == "&&" {
        rhs = ir_new_label(st, "and_rhs");
        end = ir_new_label(st, "and_end");
    } else {
        rhs = ir_new_label(st, "or_rhs");
        end = ir_new_label(st, "or_end");
    }
    let dst: int = ir_new_temp(st, Type::Bool);
    ir_emit(st, IrInstr::Copy(dst, l));
    if op == "&&" {
        ir_terminate(st, IrTerm::Br(l, rhs, end));
    } else {
        ir_terminate(st, IrTerm::Br(l, end, rhs));
    }
    ir_start_block(st, rhs);
    let r: IrOperand = lower_value(st, right);
    ir_emit(st, IrInstr::Copy(dst, r));
    ir_terminate(st, IrTerm::Jmp(end));
    ir_start_block(st, end);
    return ir_ref(dst);
}

// When both branches diverge nothing reaches the end, so the position stays unreachable.
fn lower_if_expr(st: IrState, ty: Type, cond: TExpr, then: TExpr, otherwise: TExpr): IrOperand {
    let c: IrOperand = lower_value(st, cond);
    let then_label: string = ir_new_label(st, "then");
    let else_label: string = ir_new_label(st, "else");
    let end_label: string = ir_new_label(st, "endif");
    let never: bool = kind_of_type(ty) == "never";
    var dst: int = -1;
    if !never {
        dst = ir_new_temp(st, ir_type(ty));
    }
    ir_terminate(st, IrTerm::Br(c, then_label, else_label));
    ir_start_block(st, then_label);
    let tv: IrOperand = lower_value(st, then);
    if !never {
        ir_emit(st, IrInstr::Copy(dst, tv));
    }
    ir_terminate(st, IrTerm::Jmp(end_label));
    ir_start_block(st, else_label);
    let ev: IrOperand = lower_value(st, otherwise);
    if !never {
        ir_emit(st, IrInstr::Copy(dst, ev));
    }
    ir_terminate(st, IrTerm::Jmp(end_label));
    if never {
        return ir_placeholder();
    }
    ir_start_block(st, end_label);
    return ir_ref(dst);
}
```

In `lower_binary`, add a first line:

```
    if op == "&&" || op == "||" {
        return lower_short_circuit(st, op, left, right);
    }
```

In `lower_expr`'s `match`, add:

```
        TExprNode::If(cond, then, otherwise) => Option::Some(lower_if_expr(st, e.ty, cond, then, otherwise)),
```

- [ ] **Step 3: Run, shrink `PENDING`, guard suites, commit**

Run: `pnpm vitest run tests/ir_aster.test.ts`
Expected: `ir_control.txt`, `ir_effects.txt` and `ir_basics.txt` pass. Remove newly passing files from `PENDING`.
Run: `pnpm vitest run tests/ir_validate.test.ts tests/golden.test.ts tests/check_aster.test.ts tests/typed_aster.test.ts && pnpm lint`
Expected: PASS.

```bash
git add packages/asterc-self/lower.aster tests/programs/programs/fixtures/ir_control.txt tests/ir_aster.test.ts
git commit -m "feat: lower.aster lowers control flow" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FpzzMjPkrLERmoHMVp5kyD"
```

---

### Task 4: Matches, `?`, `read_file` and divergence

**Files:**
- Modify: `packages/asterc-self/lower.aster`
- Create: `tests/programs/programs/fixtures/ir_match.txt`, `ir_try.txt`, `ir_diverge.txt`
- Modify: `tests/ir_aster.test.ts` (`PENDING`)

**Interfaces:**
- Consumes: Tasks 1–3, `ir_enum_tag` and `intern_ir_string`.
- Produces: `lower_match(st, scrutinee: TExpr, arms: [TArm], into: Option[int])`, `lower_match_expr`, `lower_try` and `lower_read_file`. After this task `lower_stmt` and `lower_expr` have no "not lowered yet" arm.

- [ ] **Step 1: Write the three failing fixtures**

`fixtures/ir_match.txt`:

```
// IR fixture: enum (payload-free and payload, or-patterns, binders, `_` binders), int, bool and string matches, with and
// without `_`, as statements and as expressions.
enum Dir { North, East, South, West }
enum Msg { Move(int, int), Say(string), Quit }

fn turn(d: Dir): Dir {
    return match d {
        Dir::North => Dir::East,
        Dir::East | Dir::South => Dir::West,
        _ => Dir::North,
    };
}

fn handle(m: Msg): int {
    match m {
        Msg::Move(x, _) => {
            return x;
        }
        Msg::Say(text) => print(text),
        Msg::Quit => {}
    }
    return 0;
}

fn word(n: int): string {
    return match n {
        0 | 1 => "few",
        7 => "lucky",
        _ => "many",
    };
}

fn code(s: string): int {
    return match s {
        "a" | "b" => 1,
        "c" => 2,
        _ => 3,
    };
}

fn exact(s: string): int {
    match s {
        "x" => {
            return 1;
        }
        "y" | "c" => {
            return 2;
        }
        _ => {
            return 0;
        }
    }
}

fn yes(b: bool): int {
    return match b {
        true => 1,
        false => 0,
    };
}

fn main(): int {
    let d: Dir = turn(Dir::North);
    print(d == Dir::West);
    print(handle(Msg::Move(1, 2)) + handle(Msg::Say("hi")) + handle(Msg::Quit));
    print(word(7));
    print(code("c") + exact("y") + yes(true));
    return 0;
}
```

`fixtures/ir_try.txt`:

```
// IR fixture: ? on Option and Result, read_file, and string literals in every JSON escape class, repeated across
// functions so the shared string table deduplicates them.
fn first(xs: [int]): Option[int] {
    if len(xs) == 0 {
        return Option::None;
    }
    return Option::Some(xs[0]);
}

fn double_first(xs: [int]): Option[int] {
    let x: int = first(xs)?;
    return Option::Some(x * 2);
}

fn load(path: string): Result[string, string] {
    let text: string = read_file(path)?;
    return Result::Ok("q\"b\\n\nt\tz\0r\ré😀" + text);
}

fn main(): int {
    print("q\"b\\n\nt\tz\0r\ré😀");
    print("é");
    match double_first([4]) {
        Option::Some(v) => print(v),
        Option::None => print("none"),
    }
    match load("/nonexistent") {
        Result::Ok(text) => print(text),
        Result::Err(msg) => eprint("é"),
    }
    return 0;
}
```

`fixtures/ir_diverge.txt`:

```
// IR fixture: early returns from loops and arms, code after diverging calls (pruned), an if expression whose branches
// both diverge, a never match expression, a never function, and statements whose sub-expressions diverge.
fn die(msg: string): never {
    eprint(msg);
    exit(3);
}

fn die_int(): int {
    die("int");
}

fn die_bool(): bool {
    panic("bool");
}

fn find(xs: [int], want: int): int {
    for i in 0..len(xs) {
        if xs[i] == want {
            return i;
        }
    }
    return -1;
}

fn pick(o: Option[int]): int {
    let Option::Some(v) = o else {
        return 0;
    };
    if let Option::Some(w) = o {
        return v + w;
    }
    return v;
}

fn never_if(b: bool): int {
    let x: int = if b { die("a") } else { die("b") };
    return x;
}

fn never_match(o: Option[int]): int {
    let y: int = match o {
        Option::Some(_) => die("some"),
        Option::None => {
            panic("none");
        }
    };
    return y;
}

fn after(flag: bool): int {
    if flag {
        for k in 0..die_int() {
            print(k);
        }
    }
    if die_bool() {
        print("then");
    }
    match die_int() {
        0 => print("zero"),
        _ => print("other"),
    }
    return 1;
}

fn main(): int {
    print(find([1, 2, 3], 2) + pick(Option::Some(4)));
    if false {
        print(never_if(true) + never_match(Option::None) + after(true));
    }
    return 0;
}
```

The TS checker may warn or reject some of these: unreachable code after `die_bool()`, a `never` function body ending in a never call, or `let x: int = if b { die("a") } …`. Run the TS recipe on each fixture. Remove only the construct TS rejects, and record what was removed in the commit message. Keep at least one statement after a diverging sub-expression, which is Review Focus 1.

Run: `pnpm vitest run tests/ir_aster.test.ts -t ir_`
Expected: the three new fixtures FAIL.

- [ ] **Step 2: Add the match code**

```
// The shape of a match:
//   enum:     entry: t = enum_tag s; switch t [tag: armN, ...], default <the `_` arm, or unreachable>
//   int/bool: entry: switch s [value: armN, ...], default <the `_` arm, or unreachable>
//   string:   entry: a chain of `str_eq s, "lit"` tests, each br armN / next test, in arm order;
//             a `_` arm ends the chain with a jmp, otherwise the chain ends in unreachable
//   armN:     binder = enum_field s, Enum::Variant.slot (for each binder); body; jmp endmatch
//   endmatch: (only when some arm falls through; an unused label would warn)
// The scrutinee is evaluated once, and binders are read before the body runs. An expression arm's value is copied
// into `into` when it is `Some`; a statement match and a never match pass `None`.
fn lower_match(st: IrState, scrutinee: TExpr, arms: [TArm], into: Option[int]) {
    let value: IrOperand = lower_value(st, scrutinee);
    let labels: [string] = [];
    for a in arms {
        push(labels, ir_new_label(st, "arm"));
    }
    let end: string = ir_new_label(st, "endmatch");
    var enum_name: string = "";
    match scrutinee.ty {
        Type::Enum(name) => {
            enum_name = name;
            ir_lower_switch(st, ir_enum_tag(st, value), arms, labels);
        }
        Type::Str => ir_lower_string_tests(st, value, arms, labels),
        _ => ir_lower_switch(st, value, arms, labels),
    }
    var reaches_end: bool = false;
    for i in 0..len(arms) {
        ir_start_block(st, labels[i]);
        if let TPattern::Variants(variants, binders) = arms[i].pattern {
            if len(variants) == 1 {
                for slot in 0..len(binders) {
                    if let Option::Some(b) = binders[slot] {
                        ir_emit(st, IrInstr::EnumField(b.id, value, enum_name, variants[0].name, variants[0].tag, slot));
                    }
                }
            }
        }
        match arms[i].body {
            TArmBody::Block(b) => lower_block(st, b),
            TArmBody::Expr(e) => {
                let v: IrOperand = lower_value(st, e);
                if let Option::Some(dst) = into {
                    ir_emit(st, IrInstr::Copy(dst, v));
                }
            }
        }
        if ir_reachable(st) {
            reaches_end = true;
        }
        ir_terminate(st, IrTerm::Jmp(end));
    }
    if reaches_end {
        ir_start_block(st, end);
    }
}

// Terminates the current block with a switch on an enum tag, an int or a bool.
fn ir_lower_switch(st: IrState, on: IrOperand, arms: [TArm], labels: [string]) {
    let cases: [IrCase] = [];
    var fallback: Option[string] = Option::None;
    for i in 0..len(arms) {
        match arms[i].pattern {
            TPattern::Wildcard => {
                fallback = Option::Some(labels[i]);
            }
            TPattern::Variants(variants, _) => {
                for v in variants {
                    push(cases, IrCase { value: int_to_string(v.tag), target: labels[i] });
                }
            }
            TPattern::Ints(values) => {
                for v in values {
                    push(cases, IrCase { value: v, target: labels[i] });
                }
            }
            TPattern::Strings(_) => panic("internal: string pattern on a non-string match"),
        }
    }
    ir_terminate(st, IrTerm::Switch(on, cases, fallback));
}

// A string match is a chain of equality tests, in arm order; a `_` arm ends it. Each literal is interned before the
// test is emitted, even at an unreachable position, as lower.ts builds the instruction before `emit` drops it.
fn ir_lower_string_tests(st: IrState, on: IrOperand, arms: [TArm], labels: [string]) {
    for i in 0..len(arms) {
        match arms[i].pattern {
            TPattern::Wildcard => {
                ir_terminate(st, IrTerm::Jmp(labels[i]));
                return;
            }
            TPattern::Strings(values) => {
                for v in values {
                    let test: int = ir_new_temp(st, Type::Bool);
                    let lit: int = intern_ir_string(st.strings, v);
                    ir_emit(st, IrInstr::Binop(test, "str_eq", on, IrOperand::Str(lit)));
                    let next: string = ir_new_label(st, "test");
                    ir_terminate(st, IrTerm::Br(ir_ref(test), labels[i], next));
                    ir_start_block(st, next);
                }
            }
            _ => panic("internal: non-string pattern on a string match"),
        }
    }
    ir_terminate(st, IrTerm::Unreachable);
}

fn lower_match_expr(st: IrState, ty: Type, scrutinee: TExpr, arms: [TArm]): IrOperand {
    if kind_of_type(ty) == "never" {
        lower_match(st, scrutinee, arms, Option::None);
        return ir_placeholder();
    }
    let dst: int = ir_new_temp(st, ir_type(ty));
    lower_match(st, scrutinee, arms, Option::Some(dst));
    return ir_ref(dst);
}
```

Order check against `lower.ts`'s `lowerMatch`. TS computes `enumName` before the switch and calls `enumTag(st, value)` inside the `if`, so the tag temp is allocated after all the arm labels. The Aster version does the same. If `-Werror` rejects the unused `a` in `for a in arms`, use `for i in 0..len(arms)`.

- [ ] **Step 3: Add `?` and `read_file`**

```
// `operand?`: branch on the tag; the failure path builds the return enum's failure value and returns it.
fn lower_try(st: IrState, ty: Type, x: TTry): IrOperand {
    let operand_enum: string = match x.operand.ty {
        Type::Enum(name) => name,
        _ => panic("internal: ? on a non-enum operand"),
    };
    let value: IrOperand = lower_value(st, x.operand);
    let tag: IrOperand = ir_enum_tag(st, value);
    let is_ok: int = ir_new_temp(st, Type::Bool);
    ir_emit(st, IrInstr::Binop(is_ok, "eq", tag, IrOperand::Int(int_to_string(x.ok_tag))));
    let ok_label: string = ir_new_label(st, "try_ok");
    let fail_label: string = ir_new_label(st, "try_fail");
    ir_terminate(st, IrTerm::Br(ir_ref(is_ok), ok_label, fail_label));
    ir_start_block(st, fail_label);
    let args: [IrOperand] = [];
    if let Option::Some(pt) = x.fail_payload_type {
        let payload: int = ir_new_temp(st, ir_type(pt));
        ir_emit(st, IrInstr::EnumField(payload, value, operand_enum, x.fail_variant, x.fail_tag, 0));
        push(args, ir_ref(payload));
    }
    let fail_value: int = ir_new_temp(st, ir_type(x.return_type));
    ir_emit(st, IrInstr::EnumNew(fail_value, x.return_enum, x.return_fail_variant, x.return_fail_tag, args));
    ir_terminate(st, IrTerm::Ret(Option::Some(ir_ref(fail_value))));
    // The fail block is terminated, so opening the ok block adds no fall-through jump.
    ir_start_block(st, ok_label);
    let dst: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, IrInstr::EnumField(dst, value, operand_enum, x.ok_variant, x.ok_tag, 0));
    return ir_ref(dst);
}

// `read_file(p)`: the runtime fills an ok flag and a string, then each outcome builds its Result variant.
fn lower_read_file(st: IrState, path: IrOperand, ty: Type): IrOperand {
    let result_enum: string = match ty {
        Type::Enum(name) => name,
        _ => panic("internal: read_file without a Result type"),
    };
    let ok: int = ir_new_temp(st, Type::Bool);
    let text: int = ir_new_temp(st, Type::Str);
    let dst: int = ir_new_temp(st, ir_type(ty));
    ir_emit(st, IrInstr::ReadFile(ok, text, path));
    let ok_label: string = ir_new_label(st, "read_ok");
    let err_label: string = ir_new_label(st, "read_err");
    let end_label: string = ir_new_label(st, "read_end");
    ir_terminate(st, IrTerm::Br(ir_ref(ok), ok_label, err_label));
    ir_start_block(st, ok_label);
    ir_emit(st, IrInstr::EnumNew(dst, result_enum, "Ok", 0, [ir_ref(text)]));
    ir_terminate(st, IrTerm::Jmp(end_label));
    ir_start_block(st, err_label);
    ir_emit(st, IrInstr::EnumNew(dst, result_enum, "Err", 1, [ir_ref(text)]));
    ir_terminate(st, IrTerm::Jmp(end_label));
    ir_start_block(st, end_label);
    return ir_ref(dst);
}
```

In `lower_builtin`, replace the `read_file` panic with:

```
    if name == "read_file" {
        return Option::Some(lower_read_file(st, a[0], ty));
    }
```

- [ ] **Step 4: Remove the last "not lowered yet" arms**

In `lower_stmt`, replace the `Match` arm with:

```
        TStmt::Match(scrutinee, arms) => lower_match(st, scrutinee, arms, Option::None),
```

In `lower_expr`, replace `_ => panic("internal: expression not lowered yet"),` with:

```
        TExprNode::Match(scrutinee, arms) => Option::Some(lower_match_expr(st, e.ty, scrutinee, arms)),
        TExprNode::Try(x) => Option::Some(lower_try(st, e.ty, x)),
```

The `match` is now exhaustive with no `_` arm.

- [ ] **Step 5: Run, shrink `PENDING`, guard suites, commit**

Run: `pnpm vitest run tests/ir_aster.test.ts`
Expected: all six `ir_*` fixtures pass. Remove every newly passing file from `PENDING`. It should now be empty or close to it. Diff any remaining file with the recipe and fix it.
Run: `pnpm vitest run tests/ir_validate.test.ts tests/golden.test.ts tests/check_aster.test.ts tests/typed_aster.test.ts && pnpm lint`
Expected: PASS.

```bash
git add packages/asterc-self/lower.aster tests/programs/programs/fixtures/ir_match.txt tests/programs/programs/fixtures/ir_try.txt tests/programs/programs/fixtures/ir_diverge.txt tests/ir_aster.test.ts
git commit -m "feat: lower.aster lowers matches, ? and read_file" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FpzzMjPkrLERmoHMVp5kyD"
```

---

### Task 5: Full corpus, self-lowering, docs

**Files:**
- Modify: `tests/ir_aster.test.ts` (empty `PENDING`, corpus-size guard)
- Modify: `tests/programs/programs/ir.aster` (golden header check)
- Modify: `docs/self-host/friction.md`, `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the merged-ready branch.

- [ ] **Step 1: Empty `PENDING` and guard the corpus size**

Fix every remaining pending file. Diff each with the recipe, fix `lower.aster`, and add a fixture line to the closest `ir_*.txt` for any construct no fixture covered. Then delete the `PENDING` set and its uses (the `lists only corpus files as pending` test and the `if (PENDING.has(file))` branch), so the test is a plain `expect(actual).toEqual(expected)`. In the corpus test, add:

```ts
    // Guards against a TS change silently shrinking the accepted corpus.
    expect(corpus.length).toBeGreaterThanOrEqual(<the accepted count printed by this run, rounded down to a multiple of 10>);
```

Run: `pnpm vitest run tests/ir_aster.test.ts`
Expected: PASS for every file, including `programs/ir.aster`, `programs/typed.aster` and `programs/check.aster` (the compiler lowering itself).

- [ ] **Step 2: Measure self-lowering**

Run: `/usr/bin/time -v <scratch>/ir tests/programs/programs/ir.aster > <scratch>/self.ir` (build `<scratch>/ir` as in the recipe). Record the elapsed time, the maximum RSS, `wc -l <scratch>/self.ir` and `wc -l packages/asterc-self/lower.aster packages/asterc-self/ir.aster packages/asterc-self/ir_print.aster`. If the elapsed time is over 2 s, profile the string-table scan before going on and record the result.

- [ ] **Step 3: Friction log**

In `docs/self-host/friction.md`, add a section `## Found while building lowering` directly above `## Found while building the typed program`, in that section's style: an opening paragraph with the line counts and the outcome, then bullets. Cover:
- **No closures, a third time.** `lower.ts`'s four callbacks (`lowerMatch`'s `lowerBody`, `lowerFor`'s `cond`/`bind`, `storeThroughPlace`'s `read`/`write`, and `lowerExpr`'s match-arm lambdas) became `into: Option[int]`, `IrForKind` and `IrPlaceRef`. Count the extra lines.
- **No maps, a third time.** `intern_ir_string`, `ir_find_struct`, `ir_block_index` and `ir_field_value` are linear scans. Give the self-lowering timing from Step 2.
- **`Option` as `null`.** `IrLocal.name`, `Call`'s destination and `Switch`'s default all became `Option`s.
- Every workaround the notes in Tasks 1–4 asked you to log (unused-value statements, `then` as a binder, `=> return` arms, `var` vs `let` for `lp`), and any compiler bug.
- The namespace: list the new top-level names' prefixes and say whether anything collided.
- The validator: what it checks, and that it found nothing (or what it found).

- [ ] **Step 4: README**

In `README.md`'s paragraph about the self-hosted suites (the one that ends "the next step is a self-hosted back end."), add `ir.aster`, `lower.aster` and `ir_print.aster` to the list of libraries. Add a sentence: "`tests/ir_aster.test.ts` checks `ir.aster`, which lowers the typed program to the compiler's IR (`lower.aster`, a port of `ir/lower.ts`) and prints it (`ir_print.aster`), against `printIr(lower(typed))` byte for byte on the same corpus plus `fixtures/ir_*.txt`, and `tests/ir_validate.test.ts` checks that IR's structure." Change the closing clause to "and lowers it to IR: the next step is C emission."

- [ ] **Step 5: Full verification and commit**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: all pass. Record the test count and wall time from the vitest summary for the PR.

```bash
git add tests/ir_aster.test.ts tests/programs/programs/ir.aster docs/self-host/friction.md README.md packages/asterc-self/lower.aster tests/programs/programs/fixtures
git commit -m "docs: lowering friction log and README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FpzzMjPkrLERmoHMVp5kyD"
```

If Step 1 changed `lower.aster`, commit that first as `fix: lower.aster matches TypeScript on the full corpus`.

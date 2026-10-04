# emit.aster C Emission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `packages/asterc/src/codegen/c/emit.ts` to Aster so that, for every accepted program, the Aster pipeline emits C byte-identical to `emitC(lower(typed))`. Then compile the emitter from its own emitted C (E1) and prove that E1 reproduces the same C.

**Architecture:** `packages/asterc-self/emit.aster` turns `lower.aster`'s `IrProgram` into `emitC`'s line array. A driver, `tests/programs/programs/emit.aster`, prints it. `tests/emit_aster.test.ts` diffs the driver built by stage 0 (E0) against TypeScript on the corpus. It then builds E1 from E0's C for the driver's own closure and diffs E1 the same way.

**Tech Stack:** Aster (compiled by `asterc` to C, gcc), TypeScript, vitest, pnpm, oxlint.

**Spec:** `docs/superpowers/specs/2026-10-04-aster-c-emit-design.md`, which builds on `docs/superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md` (§6.2) and `docs/superpowers/specs/2026-10-04-aster-ir-lowering-design.md`.

## Global Constraints

- No changes to `packages/asterc/src/**` or `packages/asterc/runtime/**`. If a TS behaviour can't reasonably be mirrored, change stage 0 in its own commit with a friction note. A runtime change (memory included) is **not** made here: stop and report it.
- No language changes.
- `emit.aster` mirrors `emit.ts` character for character in its output: line structure, declaration order, mangling, string escaping and integer spelling. Nothing is normalised.
- Flat namespace: every new top-level name in `emit.aster` starts with `emit_` or `c_`. The closure already has `ir_*`, `lower_*`, `Ir*`, `dump_*`, `Loop`, `Block`, `Local` and about 300 more.
- Every Aster file builds with `-Werror`. Libraries start with `// expect-library`. Every `let`/`var` has a type annotation.
- Known Aster quirks: `match` arms of the form `=> return …;` are rejected, so use `return match …` or block arms. Comparison operators can't be chained. Structs are heap references, and assigning through a `let` binding's field works. There are no hex literals and no `chr`, so build digits with `substring` on a digit string.
- `typed_aster`, `ir_aster`, `ir_validate`, `check_aster`, golden and the TS unit tests stay green after every task.
- Commits use conventional commits with a **lower-case subject** (commitlint). End each message with your harness-provided `Co-Authored-By:` line and `Claude-Session: https://claude.ai/code/session_01FpzzMjPkrLERmoHMVp5kyD`.

### Seeing the TypeScript C for one file

```bash
pnpm build >/dev/null && node packages/asterc/dist/cli/bin.js build <file> --emit=c > <scratch>/ts.c
```

To see the Aster side, build the driver with the same CLI (`build tests/programs/programs/emit.aster -o <scratch>/e0`). Then run `<scratch>/e0 <file> | diff <scratch>/ts.c -`. The first differing line is the bug.

## Review Focus

1. **Generic enum mangling.** Underscores must double, and `[`, `]` and `, ` become `_L`, `_R` and `_C`. A nested instantiation like `Option[Result[my_pair, int]]` must mangle exactly as `mangleEnum` does. This goes in `emit_types.txt` (Task 1).
2. **String bytes.** A digit following an escaped byte, `?` next to trigraph characters, and high UTF-8 bytes. The length is the **byte** length, not the character count. This goes in `emit_values.txt` (Task 1).
3. **`INT64_MIN`** as an operand and as a switch case, and `INT64_MAX` beside it. This goes in `emit_values.txt` (Task 1).
4. **Bool switches.** The cast to `(int64_t)` applies to a bool *local* and to a bool *literal* scrutinee. This goes in `emit_values.txt` (Task 1).
5. **E1 on the largest inputs.** E1 runs the whole corpus, including `programs/emit.aster` (its own closure). A runtime difference between the stage-0-built and E1-built binaries shows up there. This is Task 2.

---

## File map

- Create `packages/asterc-self/emit.aster` (Task 1).
- Create `tests/programs/programs/emit.aster`, the driver (Task 1).
- Create `tests/emit_aster.test.ts` (Task 1, extended in Task 2).
- Create `tests/programs/programs/fixtures/emit_types.txt`, `emit_values.txt`, `emit_arrays.txt` and `emit_main_args.txt` (Task 1).
- Modify `tests/corpus.ts`: add `emit` to the fixture pattern (Task 1).
- Modify `docs/self-host/friction.md` and `README.md` (Task 3).

---

### Task 1: The emitter, its driver, fixtures and E0 parity

**Files:**
- Create: `packages/asterc-self/emit.aster`, `tests/programs/programs/emit.aster`, `tests/emit_aster.test.ts`
- Create: `tests/programs/programs/fixtures/emit_types.txt`, `emit_values.txt`, `emit_arrays.txt`, `emit_main_args.txt`
- Modify: `tests/corpus.ts` (the line with `(check|typed|ir)`)

**Interfaces:**
- Consumes these from `packages/asterc-self/ir.aster`:
  - `IrProgram { structs: [IrStruct], enums: [IrEnum], functions: [IrFunction], strings: [string] }`
  - `IrStruct { name, fields: [IrField] }` and `IrField { name, ty: Type }`
  - `IrEnum { name, payload_free: bool, variants: [IrVariant] }` and `IrVariant { name, tag: int, payload: [Type] }`
  - `IrFunction { name, param_count: int, locals: [IrLocal], ret: Type, blocks: [IrBlock] }`
  - `IrLocal { id: int, name: Option[string], ty: Type }`
  - `IrBlock { label, instrs: [IrInstr], term: IrTerm }`
  - `IrOperand`, `IrInstr`, `IrTerm` and `IrCase { value: string, target: string }`; read the enums' variant comments in `ir.aster`.

  It also consumes `lower_program(c: Checked): IrProgram` from `lower.aster`, `kind_of_type` and `Type` from `checker.aster`, and the loader and report APIs exactly as `tests/programs/programs/ir.aster` uses them.
- Produces: `emit_c(p: IrProgram): [string]`. Task 2 relies on the driver binary's CLI: `emit <file>` prints C to stdout, prints diagnostics to stderr and exits 1, or exits 2 on usage or read errors.

- [ ] **Step 1: Add `emit` to the corpus pattern**

In `tests/corpus.ts`, change `/fixtures[\\/](check|typed|ir)_\w+\.txt$/` to `/fixtures[\\/](check|typed|ir|emit)_\w+\.txt$/` and update the doc comment's `{check,typed,ir}` to `{check,typed,ir,emit}`.

- [ ] **Step 2: Write the four fixtures**

`tests/programs/programs/fixtures/emit_types.txt`:

```
// Emit fixture: struct and enum declarations, self and mutual references, generic-instantiation mangling, and C
// keywords used as Aster names.
struct Empty {}
struct my_pair { char: int, long: string }
struct Node { value: int, children: [Node], shape: Shape }
enum Shape { Dot, Line(int, int), Group([Shape]) }
enum Color { Red, Green, FILE }

fn wrap(p: my_pair): Option[Result[my_pair, int]] {
    return Option::Some(Result::Ok(p));
}

fn main(): int {
    let e: Empty = Empty {};
    let p: my_pair = my_pair { char: 1, long: "c" };
    let n: Node = Node { value: 2, children: [], shape: Shape::Line(1, 2) };
    let unsigned: Color = Color::FILE;
    print(unsigned == Color::Red);
    match n.shape {
        Shape::Line(a, b) => print(a + b),
        _ => print(0),
    }
    match wrap(p) {
        Option::Some(r) => {
            match r {
                Result::Ok(q) => print(q.char),
                Result::Err(code) => print(code),
            }
        }
        Option::None => print(-1),
    }
    let g: Shape = Shape::Group([Shape::Dot]);
    match g {
        Shape::Group(items) => print(len(items)),
        _ => print(0),
    }
    return 0;
}
```

`tests/programs/programs/fixtures/emit_values.txt`:

```
// Emit fixture: int limits as operands and switch cases, bool switches on a local and on a literal, and string bytes:
// quote, backslash, ? beside trigraph characters, control bytes, a digit right after an escaped byte, UTF-8 and the
// empty string (lengths are byte counts).
fn sign(b: bool): int {
    return match b {
        true => 1,
        false => 0,
    };
}

fn limit(n: int): string {
    return match n {
        9223372036854775807 => "max",
        -9223372036854775808 => "min",
        _ => "other",
    };
}

fn main(): int {
    let max: int = 9223372036854775807;
    let min: int = -9223372036854775808;
    print(limit(max));
    print(limit(min));
    print(sign(max > 0));
    let lit: string = match true {
        true => "t",
        false => "f",
    };
    print(lit);
    print("q\"b\\s ??= ??( ??/ ?? a\01 \n\t\r é 😀");
    print("");
    return 0;
}
```

`tests/programs/programs/fixtures/emit_arrays.txt`:

```
// Emit fixture: arrays of ints, strings, structs, enums and arrays: literals, push, pop, len, indexing, index
// assignment and for-each.
struct P { x: int }
enum E { A, B(int) }

fn main(): int {
    let ints: [int] = [1, 2, 3];
    let strs: [string] = ["a", "b"];
    let ps: [P] = [P { x: 1 }];
    let es: [E] = [E::A, E::B(2)];
    let grid: [[int]] = [[1], [2, 3]];
    push(ints, 4);
    push(strs, "c");
    push(ps, P { x: 2 });
    push(es, E::A);
    push(grid, [5]);
    let last: int = pop(ints);
    ints[0] = last + len(ints);
    grid[1] = ints;
    var total: int = 0;
    for row in grid {
        for v in row {
            total += v;
        }
    }
    for p in ps {
        total += p.x;
    }
    print(total + len(strs) + len(es) + byte_at(strs[0], 0));
    return 0;
}
```

`tests/programs/programs/fixtures/emit_main_args.txt`:

```
// Emit fixture: main taking its arguments (the aster_rt_args shim).
fn main(args: [string]): int {
    print(len(args));
    return 0;
}
```

Run the TS recipe on each fixture. If the TS front end rejects a construct, change only that construct and keep the Review Focus intent. For example, if `Empty {}` or a C keyword as a field name is rejected, use the nearest accepted form. Note each change in your report.

- [ ] **Step 3: Write the failing test `tests/emit_aster.test.ts`**

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExecutable, compileToC, emitC, formatDiagnostic, lower, makeSource } from '../packages/asterc/src/index.js';
import { acceptedCorpus, PROGRAMS_DIR } from './corpus.js';

// Checks tests/programs/programs/emit.aster, which lowers a program with packages/asterc-self/lower.aster and emits C
// with packages/asterc-self/emit.aster, against the compiler's own emitC(lower(typed)), byte for byte, on the accepted
// corpus (tests/corpus.ts). Nothing is normalised (self-hosting contract §6.2).

const accepted = acceptedCorpus().map(({ file, typed }) => ({ file, c: emitC(lower(typed)) }));
const corpus = accepted.map((c) => c.file);
const DRIVER = join('programs', 'emit.aster');

const workDir = mkdtempSync(join(tmpdir(), 'aster-emit-'));
/** The driver built by stage 0. */
const e0 = join(workDir, 'e0');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** Runs an emitter binary on a corpus file. */
function emitWith(exe: string, file: string) {
  const run = spawnSync(exe, [join(PROGRAMS_DIR, file)], { encoding: 'utf8', timeout: 20_000, maxBuffer: 256 * 1024 * 1024 });
  return { stdout: run.stdout, stderr: run.stderr, status: run.status };
}

beforeAll(() => {
  const path = join(PROGRAMS_DIR, DRIVER);
  const compiled = compileToC(makeSource(path, readFileSync(path, 'utf8')));
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
  const built = buildExecutable(compiled.c, e0, ['-Werror']);
  if (!built.ok) throw new Error(built.message);
});

describe('emit.aster (built by stage 0) matches the TypeScript C emitter', () => {
  it('has a corpus that includes the driver and the emit fixtures', () => {
    expect(corpus).toContain(DRIVER);
    for (const name of readdirSync(join(PROGRAMS_DIR, 'programs', 'fixtures')).filter((n) => /^emit_\w+\.txt$/.test(n))) {
      expect(corpus).toContain(join('programs', 'fixtures', name));
    }
  });

  it.for(accepted)('$file', ({ file, c }) => {
    expect(emitWith(e0, file)).toEqual({ stdout: c, stderr: '', status: 0 });
  });
});
```

Run: `pnpm vitest run tests/emit_aster.test.ts`
Expected: FAIL in `beforeAll`, because `programs/emit.aster` doesn't exist yet.

- [ ] **Step 4: Write `packages/asterc-self/emit.aster`**

```
// expect-library
// C emission, written in Aster: a port of packages/asterc/src/codegen/c/emit.ts, function by function. `emit_c`
// returns emitC's `out` array, so the C text is those elements joined by newlines. A multi-statement instruction is one
// element containing "\n    ", as in TS. tests/emit_aster.test.ts compares the C, through emit.aster, with emitC byte
// for byte, and also with the C that the emitter compiled from its own output (E1) produces.
//
// Aster has no maps: emit.ts's enum table is a linear scan, `c_find_enum`.

import "lower.aster";

fn c_join(items: [string], sep: string): string {
    var out: string = "";
    for i in 0..len(items) {
        if i > 0 {
            out += sep;
        }
        out += items[i];
    }
    return out;
}

// ---- types and names

fn c_type(t: Type): string {
    return match t {
        Type::Int => "int64_t",
        Type::Bool => "bool",
        Type::Str => "aster_string",
        Type::Struct(name) => c_mangle_struct(name),
        Type::Enum(name) => c_mangle_enum(name),
        Type::Array(_) => "aster_array",
        Type::Void => "void",
        Type::Error => panic("internal: error type reached codegen"),
        Type::Never => panic("internal: never type reached codegen"),
    };
}

fn c_zero(t: Type): string {
    return match t {
        Type::Int => "0",
        Type::Bool => "false",
        Type::Str => "{0}",
        // A null pointer constant for heap enums and tag 0 for payload-free ones.
        Type::Enum(_) => "0",
        Type::Struct(_) => "NULL",
        Type::Array(_) => "NULL",
        Type::Void => "",
        _ => panic("internal: no zero value"),
    };
}

// Every IR binary operator is a runtime call named after it, except str_ne, which negates str_eq. bool operands of eq
// and ne widen losslessly to int64_t.
fn c_binop(op: string, a: string, b: string): string {
    if op == "str_ne" {
        return "!aster_rt_str_eq(" + a + ", " + b + ")";
    }
    return "aster_rt_" + op + "(" + a + ", " + b + ")";
}

fn c_mangle_fn(name: string): string {
    return "aster_fn_" + name;
}

fn c_mangle_struct(name: string): string {
    return "aster_S_" + name;
}

// Non-generic enums are `aster_E_<name>`. An instantiation (its name contains `[`) is `aster_G_` followed by its type
// string with `_` written as `__`, `[` as `_L`, `]` as `_R` and `, ` as `_C`, so no two names collide.
fn c_mangle_enum(name: string): string {
    var generic: bool = false;
    for i in 0..len(name) {
        if byte_at(name, i) == '[' {
            generic = true;
        }
    }
    if !generic {
        return "aster_E_" + name;
    }
    var out: string = "aster_G_";
    var i: int = 0;
    while i < len(name) {
        let c: int = byte_at(name, i);
        if c == '_' {
            out += "__";
        } else if c == '[' {
            out += "_L";
        } else if c == ']' {
            out += "_R";
        } else if c == ',' {
            out += "_C";
            i += 1; // always followed by one space
        } else {
            out += substring(name, i, i + 1);
        }
        i += 1;
    }
    return out;
}

fn c_mangle_variant(name: string): string {
    return "v_" + name;
}

fn c_mangle_field(name: string): string {
    return "f_" + name;
}

fn c_mangle_local(l: IrLocal): string {
    return match l.name {
        Option::Some(n) => "l" + int_to_string(l.id) + "_" + n,
        Option::None => "l" + int_to_string(l.id),
    };
}

// ---- the program

fn emit_c(p: IrProgram): [string] {
    let out: [string] = ["#include \"aster_rt.h\"", ""];
    if len(p.structs) > 0 || len(p.enums) > 0 {
        // Every typedef comes first, so struct and enum bodies can refer to any type, including themselves.
        for s in p.structs {
            push(out, "typedef struct " + c_mangle_struct(s.name) + " *" + c_mangle_struct(s.name) + ";");
        }
        for e in p.enums {
            push(out, emit_enum_typedef(e));
        }
        push(out, "");
        for s in p.structs {
            push(out, "struct " + c_mangle_struct(s.name) + " {");
            if len(s.fields) == 0 {
                push(out, "    char aster_empty;"); // C11 has no empty structs
            }
            for f in s.fields {
                push(out, "    " + c_type(f.ty) + " " + c_mangle_field(f.name) + ";");
            }
            push(out, "};");
            push(out, "");
        }
        for e in p.enums {
            if !e.payload_free {
                emit_enum_definition(out, e);
                push(out, "");
            }
        }
    }
    if len(p.strings) > 0 {
        // Not static: an unused static const would trip -Wunused-const-variable.
        for i in 0..len(p.strings) {
            push(out, "const aster_string aster_str_" + int_to_string(i) + " = " + c_string_literal(p.strings[i]) + ";");
        }
        push(out, "");
    }
    for f in p.functions {
        push(out, emit_signature(f) + ";");
    }
    push(out, "");
    for f in p.functions {
        emit_function(out, f, p.enums);
        push(out, "");
    }
    var main_takes_args: bool = false;
    for f in p.functions {
        if f.name == "main" && f.param_count == 1 {
            main_takes_args = true;
        }
    }
    if main_takes_args {
        push(out, "int main(int argc, char **argv) {");
        push(out, "    return (int)aster_fn_main(aster_rt_args(argc, argv));");
    } else {
        push(out, "int main(void) {");
        push(out, "    return (int)aster_fn_main();");
    }
    push(out, "}");
    push(out, "");
    return out;
}

// Payload-free enums are plain int64 tags; every other enum is a pointer to a tagged union.
fn emit_enum_typedef(e: IrEnum): string {
    let m: string = c_mangle_enum(e.name);
    if e.payload_free {
        return "typedef int64_t " + m + ";";
    }
    return "typedef struct " + m + " *" + m + ";";
}

// The tagged union behind a heap enum. Only payload variants get a union member, and a heap enum has at least one
// payload variant, so the union is never empty.
fn emit_enum_definition(out: [string], e: IrEnum) {
    push(out, "struct " + c_mangle_enum(e.name) + " {");
    push(out, "    int64_t tag;");
    push(out, "    union {");
    for v in e.variants {
        if len(v.payload) > 0 {
            let slots: [string] = [];
            for i in 0..len(v.payload) {
                push(slots, c_type(v.payload[i]) + " p" + int_to_string(i) + ";");
            }
            push(out, "        struct { " + c_join(slots, " ") + " } " + c_mangle_variant(v.name) + ";");
        }
    }
    push(out, "    } u;");
    push(out, "};");
}

fn c_digit(digits: string, d: int): string {
    return substring(digits, d, d + 1);
}

// A C initializer for an aster_string holding `s`'s bytes: `"`, `\` and `?` (against trigraphs) escaped, printable ASCII
// copied, every other byte a 3-digit octal escape (so a following digit can't extend it), then the byte length.
fn c_string_literal(s: string): string {
    let oct: string = "01234567";
    var body: string = "";
    for i in 0..len(s) {
        let b: int = byte_at(s, i);
        if b == '"' {
            body += "\\\"";
        } else if b == '\\' {
            body += "\\\\";
        } else if b == '?' {
            body += "\\?";
        } else if b >= 32 && b < 127 {
            body += substring(s, i, i + 1);
        } else {
            body += "\\" + c_digit(oct, b / 64) + c_digit(oct, b / 8 % 8) + c_digit(oct, b % 8);
        }
    }
    return "{ \"" + body + "\", " + int_to_string(len(s)) + " }";
}

// ---- functions

fn emit_signature(f: IrFunction): string {
    let params: [string] = [];
    for i in 0..f.param_count {
        push(params, c_type(f.locals[i].ty) + " " + c_mangle_local(f.locals[i]));
    }
    var list: string = "void";
    if len(params) > 0 {
        list = c_join(params, ", ");
    }
    return c_type(f.ret) + " " + c_mangle_fn(f.name) + "(" + list + ")";
}

fn emit_function(out: [string], f: IrFunction, enums: [IrEnum]) {
    push(out, emit_signature(f) + " {");
    for i in f.param_count..len(f.locals) {
        let l: IrLocal = f.locals[i];
        push(out, "    " + c_type(l.ty) + " " + c_mangle_local(l) + " = " + c_zero(l.ty) + ";");
    }
    for i in f.param_count..len(f.locals) {
        push(out, "    (void)" + c_mangle_local(f.locals[i]) + ";");
    }
    for bi in 0..len(f.blocks) {
        let b: IrBlock = f.blocks[bi];
        // The entry block is never a jump target, so it gets no label (avoids -Wunused-label).
        if bi > 0 {
            push(out, b.label + ":;");
        }
        for ins in b.instrs {
            push(out, "    " + emit_instr(f, enums, ins));
        }
        push(out, "    " + emit_term(f, b.term));
    }
    push(out, "}");
}

// INT64_MIN has no single-literal spelling in C.
fn c_int_literal(v: string): string {
    if v == "-9223372036854775808" {
        return "INT64_MIN";
    }
    return "INT64_C(" + v + ")";
}

fn c_operand(f: IrFunction, o: IrOperand): string {
    return match o {
        IrOperand::Local(id) => c_mangle_local(f.locals[id]),
        IrOperand::Int(v) => c_int_literal(v),
        IrOperand::Bool(b) => c_bool(b),
        IrOperand::Str(index) => "aster_str_" + int_to_string(index),
    };
}

fn c_bool(b: bool): string {
    if b {
        return "true";
    }
    return "false";
}

fn c_args(f: IrFunction, args: [IrOperand]): string {
    let parts: [string] = [];
    for a in args {
        push(parts, c_operand(f, a));
    }
    return c_join(parts, ", ");
}

// An lvalue of C type `t` at the address a runtime array call returns.
fn c_slot(t: string, call: string): string {
    return "*(" + t + " *)" + call;
}

// The type of a local operand; array and enum values are never constants, so their operands are locals.
fn c_local_type(f: IrFunction, o: IrOperand): Type {
    return match o {
        IrOperand::Local(id) => f.locals[id].ty,
        _ => Type::Void,
    };
}

fn c_elem_type(f: IrFunction, array: IrOperand): string {
    return match c_local_type(f, array) {
        Type::Array(elem) => c_type(elem),
        _ => panic("internal: array operand is not an array local"),
    };
}

fn c_find_enum(enums: [IrEnum], name: string): Option[IrEnum] {
    for e in enums {
        if e.name == name {
            return Option::Some(e);
        }
    }
    return Option::None;
}

fn c_enum_of(f: IrFunction, enums: [IrEnum], o: IrOperand): IrEnum {
    let found: Option[IrEnum] = match c_local_type(f, o) {
        Type::Enum(name) => c_find_enum(enums, name),
        _ => Option::None,
    };
    return match found {
        Option::Some(e) => e,
        Option::None => panic("internal: enum operand is not an enum local"),
    };
}

// ---- instructions

fn c_assign(f: IrFunction, dst: Option[int], value: string): string {
    return match dst {
        Option::Some(d) => c_mangle_local(f.locals[d]) + " = " + value + ";",
        Option::None => value + ";",
    };
}

fn c_set(f: IrFunction, dst: int, value: string): string {
    return c_assign(f, Option::Some(dst), value);
}

fn c_unop(op: string, a: string): string {
    if op == "neg" {
        return "aster_rt_neg(" + a + ")";
    }
    return "!" + a;
}

fn c_array_at(f: IrFunction, array: IrOperand, index: IrOperand): string {
    return "aster_rt_array_at(" + c_operand(f, array) + ", " + c_operand(f, index) + ")";
}

fn emit_instr(f: IrFunction, enums: [IrEnum], i: IrInstr): string {
    return match i {
        IrInstr::Copy(dst, src) => c_set(f, dst, c_operand(f, src)),
        IrInstr::Unop(dst, op, operand) => c_set(f, dst, c_unop(op, c_operand(f, operand))),
        IrInstr::Binop(dst, op, left, right) => c_set(f, dst, c_binop(op, c_operand(f, left), c_operand(f, right))),
        IrInstr::Call(dst, name, args) => c_assign(f, dst, c_mangle_fn(name) + "(" + c_args(f, args) + ")"),
        IrInstr::CallBuiltin(dst, name, args) => c_assign(f, dst, "aster_rt_" + name + "(" + c_args(f, args) + ")"),
        IrInstr::StructNew(dst, name, fields) => emit_struct_new(f, dst, name, fields),
        IrInstr::FieldGet(dst, object, field) => c_set(f, dst, c_operand(f, object) + "->" + c_mangle_field(field)),
        IrInstr::FieldSet(object, field, value) => c_operand(f, object) + "->" + c_mangle_field(field) + " = " + c_operand(f, value) + ";",
        IrInstr::ArrayNew(dst, elem, elements) => emit_array_new(f, dst, elem, elements),
        IrInstr::IndexGet(dst, array, index) => c_set(f, dst, c_slot(c_elem_type(f, array), c_array_at(f, array, index))),
        IrInstr::IndexSet(array, index, value) => c_slot(c_elem_type(f, array), c_array_at(f, array, index)) + " = " + c_operand(f, value) + ";",
        IrInstr::ArrayLen(dst, array) => c_set(f, dst, c_operand(f, array) + "->len"),
        IrInstr::ArrayPush(array, value) => c_slot(c_elem_type(f, array), "aster_rt_array_push_slot(" + c_operand(f, array) + ")") + " = " + c_operand(f, value) + ";",
        IrInstr::ArrayPop(dst, array) => c_set(f, dst, c_slot(c_elem_type(f, array), "aster_rt_array_pop_slot(" + c_operand(f, array) + ")")),
        IrInstr::EnumNew(dst, name, variant, tag, args) => emit_enum_new(f, enums, dst, name, variant, tag, args),
        IrInstr::EnumTag(dst, value) => c_set(f, dst, c_enum_tag(f, enums, value)),
        IrInstr::EnumField(dst, value, _, variant, _, index) => c_set(f, dst, c_operand(f, value) + "->u." + c_mangle_variant(variant) + ".p" + int_to_string(index)),
        IrInstr::ReadFile(ok, text, path) => c_mangle_local(f.locals[text]) + " = aster_rt_read_file(" + c_operand(f, path) + ", &" + c_mangle_local(f.locals[ok]) + ");",
    };
}

fn emit_struct_new(f: IrFunction, dst: int, name: string, fields: [IrFieldValue]): string {
    let target: string = c_mangle_local(f.locals[dst]);
    let parts: [string] = [target + " = aster_rt_alloc(sizeof(struct " + c_mangle_struct(name) + "));"];
    for fv in fields {
        push(parts, target + "->" + c_mangle_field(fv.name) + " = " + c_operand(f, fv.value) + ";");
    }
    return c_join(parts, "\n    ");
}

fn emit_array_new(f: IrFunction, dst: int, elem: Type, elements: [IrOperand]): string {
    let target: string = c_mangle_local(f.locals[dst]);
    let t: string = c_type(elem);
    let parts: [string] = [target + " = aster_rt_array_new(sizeof(" + t + "), " + int_to_string(len(elements)) + ");"];
    for i in 0..len(elements) {
        push(parts, c_slot(t, "aster_rt_array_at(" + target + ", " + int_to_string(i) + ")") + " = " + c_operand(f, elements[i]) + ";");
    }
    return c_join(parts, "\n    ");
}

fn emit_enum_new(f: IrFunction, enums: [IrEnum], dst: int, name: string, variant: string, tag: int, args: [IrOperand]): string {
    let decl: IrEnum = match c_find_enum(enums, name) {
        Option::Some(e) => e,
        Option::None => panic("internal: unknown enum " + name),
    };
    let target: string = c_mangle_local(f.locals[dst]);
    if decl.payload_free {
        return target + " = INT64_C(" + int_to_string(tag) + ");";
    }
    let member: string = target + "->u." + c_mangle_variant(variant);
    let parts: [string] = [
        target + " = aster_rt_alloc(sizeof(struct " + c_mangle_enum(name) + "));",
        target + "->tag = INT64_C(" + int_to_string(tag) + ");",
    ];
    for i in 0..len(args) {
        push(parts, member + ".p" + int_to_string(i) + " = " + c_operand(f, args[i]) + ";");
    }
    return c_join(parts, "\n    ");
}

fn c_enum_tag(f: IrFunction, enums: [IrEnum], value: IrOperand): string {
    if c_enum_of(f, enums, value).payload_free {
        return c_operand(f, value);
    }
    return c_operand(f, value) + "->tag";
}

// ---- terminators

fn emit_term(f: IrFunction, t: IrTerm): string {
    return match t {
        IrTerm::Jmp(target) => "goto " + target + ";",
        IrTerm::Br(cond, then, otherwise) => "if (" + c_operand(f, cond) + ") goto " + then + "; else goto " + otherwise + ";",
        IrTerm::Switch(value, cases, fallback) => emit_switch(f, value, cases, fallback),
        IrTerm::Ret(value) => c_ret(f, value),
        IrTerm::Unreachable => "aster_rt_unreachable();",
    };
}

fn emit_switch(f: IrFunction, value: IrOperand, cases: [IrCase], fallback: Option[string]): string {
    let parts: [string] = [];
    for c in cases {
        push(parts, "case " + c_int_literal(c.value) + ": goto " + c.target + ";");
    }
    match fallback {
        Option::Some(d) => push(parts, "default: goto " + d + ";"),
        Option::None => push(parts, "default: aster_rt_unreachable();"),
    }
    // gcc rejects a bool switch condition under -Wswitch-bool.
    let is_bool: bool = match value {
        IrOperand::Bool(_) => true,
        IrOperand::Local(id) => kind_of_type(f.locals[id].ty) == "bool",
        _ => false,
    };
    var on: string = c_operand(f, value);
    if is_bool {
        on = "(int64_t)" + on;
    }
    return "switch (" + on + ") { " + c_join(parts, " ") + " }";
}

fn c_ret(f: IrFunction, value: Option[IrOperand]): string {
    return match value {
        Option::Some(v) => "return " + c_operand(f, v) + ";",
        Option::None => "return;",
    };
}
```

If a multi-line `let parts: [string] = [ … ];` literal is rejected, build it with two `push`es. Record every Aster workaround in your report.

- [ ] **Step 5: Write the driver `tests/programs/programs/emit.aster`**

Copy `tests/programs/programs/ir.aster` and make these changes:
- Header comment: "Prints the C that the compiler emits for a program, in packages/asterc/src/codegen/c/emit.ts's exact text. It loads, checks and lowers the program rooted at its only argument, then emits C (emit_c in packages/asterc-self/emit.aster). Diagnostics go to stderr as check.aster prints them, exiting with status 1. tests/emit_aster.test.ts checks it against emitC(lower(typed)), and builds it from its own output."
- `// expect-args: fixtures/emit_main_args.txt`, followed by an `// expect-stdout:` block holding that fixture's C. Generate it with the TS recipe, prefix each line with `// ` and write an empty line as `//`. If a header line of the generated C would end in trailing whitespace, the harness may trim it; check `tests/harness.ts` and pick another `expect-args` fixture if needed.
- Imports: replace `ir_print.aster` with `emit.aster` (keep `loader`, `checker`, `report`, `lower`).
- `die("usage: emit <file>")`.
- Output:

```
            let lines: [string] = emit_c(lower_program(checked));
            // emitC joins `lines` with newlines, and the last element is always "".
            for i in 0..len(lines) - 1 {
                print(lines[i]);
            }
            return 0;
```

- [ ] **Step 6: Run and iterate to green**

Run: `pnpm vitest run tests/emit_aster.test.ts`
Expected: PASS for every corpus file, including `programs/emit.aster` (its own closure) and the four `emit_*` fixtures. For any failure, diff it with the recipe and fix `emit.aster`, and only `emit.aster`.

- [ ] **Step 7: Run the guard suites and commit**

Run: `pnpm vitest run tests/emit_aster.test.ts tests/ir_aster.test.ts tests/typed_aster.test.ts tests/check_aster.test.ts tests/golden.test.ts && pnpm lint && pnpm typecheck`
Expected: all pass.

```bash
git add packages/asterc-self/emit.aster tests/programs/programs/emit.aster tests/emit_aster.test.ts tests/corpus.ts \
  tests/programs/programs/fixtures/emit_types.txt tests/programs/programs/fixtures/emit_values.txt \
  tests/programs/programs/fixtures/emit_arrays.txt tests/programs/programs/fixtures/emit_main_args.txt
git commit -m "feat: emit.aster emits C byte-identical to stage 0"
```

(with the trailers from Global Constraints).

---

### Task 2: The self-compiled emitter (E1)

**Files:**
- Modify: `tests/emit_aster.test.ts`

**Interfaces:**
- Consumes: Task 1's `e0` binary, the `emitWith(exe, file)` helper, `accepted` and `DRIVER`.
- Produces: an `e1` binary, built from E0's output for `programs/emit.aster`, and its parity suite.

- [ ] **Step 1: Add the E1 suite (test first)**

Append to `tests/emit_aster.test.ts`:

```ts
/** The driver compiled from the C that E0 emits for its own closure: an emitter built by Aster. */
const e1 = join(workDir, 'e1');

describe('emit.aster built from its own C (E1) matches the TypeScript C emitter', () => {
  beforeAll(() => {
    const own = emitWith(e0, DRIVER);
    if (own.status !== 0) throw new Error(`E0 failed on its own closure:\n${own.stderr}`);
    const expected = accepted.find((a) => a.file === DRIVER);
    // E0 is checked against TS on DRIVER above; this guards against building E1 from anything else.
    if (expected === undefined || own.stdout !== expected.c) throw new Error('E0 C for its own closure differs from stage 0');
    const built = buildExecutable(own.stdout, e1, ['-Werror']);
    if (!built.ok) throw new Error(built.message);
  });

  it.for(accepted)('$file', ({ file, c }) => {
    expect(emitWith(e1, file)).toEqual({ stdout: c, stderr: '', status: 0 });
  });
});
```

Because E1's output for `DRIVER` equals stage 0's C for `DRIVER`, which is the C E1 was built from, this suite also proves the fixed point C(E0) = C(E1).

Run: `pnpm vitest run tests/emit_aster.test.ts`
Expected: PASS. If E1 crashes, runs out of memory, times out or differs anywhere, **stop**. Record the file, the symptom, and E0's versus E1's behaviour in your report, and return BLOCKED. Don't change the runtime (spec criterion 6). If it fails before E1 is built because of a C warning, that's a stage-0 emission bug. Report it the same way.

- [ ] **Step 2: Measure**

```bash
pnpm build >/dev/null
node packages/asterc/dist/cli/bin.js build tests/programs/programs/emit.aster -o <scratch>/e0
<scratch>/e0 tests/programs/programs/emit.aster > <scratch>/c1.c
cc -std=c11 -O2 -Wall -Werror -Ipackages/asterc/runtime <scratch>/c1.c packages/asterc/runtime/aster_rt.c -o <scratch>/e1
/usr/bin/time -v <scratch>/e0 tests/programs/programs/emit.aster > /dev/null
/usr/bin/time -v <scratch>/e1 tests/programs/programs/emit.aster > /dev/null
wc -lc <scratch>/c1.c
```

Record, for E0 and for E1: elapsed time, maximum resident set size, and the C's line and byte counts. Also record `wc -l` of the closure's `.aster` files (`lexer`, `parser`, `loader`, `checker`, `lower`, `ir`, `emit` and the driver). These go into the friction log in Task 3.

- [ ] **Step 3: Guard suites and commit**

Run: `pnpm vitest run tests/emit_aster.test.ts && pnpm lint && pnpm typecheck`
Expected: PASS.

```bash
git add tests/emit_aster.test.ts
git commit -m "test: build emit.aster from its own C and check E1 parity"
```

---

### Task 3: Friction log and README

**Files:**
- Modify: `docs/self-host/friction.md`, `README.md`

- [ ] **Step 1: Friction log**

Add `## Found while building emission` directly above `## Found while building lowering`, in that section's style: an opening paragraph, then bullets. Cover:
- the line counts (`emit.aster` against `emit.ts`) and the outcome: byte parity on N corpus files with E0 and E1, and the fixed point;
- Task 2's measurements, and what they mean for contract §8's memory question: whether the never-freeing runtime is a problem at this size;
- every Aster workaround the Task 1 and Task 2 reports list;
- the namespace: the `emit_`/`c_` prefixes and whether anything collided;
- any stage-0 change, which should be none.

- [ ] **Step 2: README**

In the self-hosted-suites paragraph, add `emit.aster` to the library list and this sentence: "`tests/emit_aster.test.ts` checks `emit.aster` (a port of `codegen/c/emit.ts`) against `emitC(lower(typed))` byte for byte on the same corpus plus `fixtures/emit_*.txt`, then compiles the emitter from its own C and checks that binary the same way." Then change "and `lower.aster` lowers it to IR: the next step is C emission" to "`lower.aster` lowers it to IR and `emit.aster` emits C: the next step is the compiler driver (#19)", adjusting the grammar to fit the sentence.

- [ ] **Step 3: Full verification and commit**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: all pass. Record the test count and wall time.

```bash
git add docs/self-host/friction.md README.md
git commit -m "docs: emission friction log and README"
```

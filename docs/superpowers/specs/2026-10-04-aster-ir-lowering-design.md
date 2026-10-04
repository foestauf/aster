# lower.aster: Typed Programs to IR (Design)

**Date:** 2026-10-04
**Status:** Approved in brainstorming. Rob approved byte-identical IR dumps, the new `ir.aster`/`lower.aster`
files and end-to-end delivery.
**Issue:** #17
**Builds on:** [`2026-10-04-aster-self-hosting-contract-design.md`](2026-10-04-aster-self-hosting-contract-design.md)
(§6.2 the byte-identical C oracle) and [`2026-10-04-aster-typed-program-design.md`](2026-10-04-aster-typed-program-design.md)
(the typed tree, #16). No language changes.

## 1. Purpose

`checker.aster` now builds the complete typed program (#16). The next stage of stage 0's pipeline is
`packages/asterc/src/ir/lower.ts`: it turns a `TypedProgram` into the basic-block IR of `ir/ir.ts`, which the C emitter
(#18) consumes. This milestone ports the IR and the lowering to Aster. The proof is that, for every accepted program,
Aster's lowered program prints *byte for byte* the same as `printIr(lower(typed))` does in TypeScript.

Byte-identical IR is the strictest oracle available, and it is the one #18 needs. #18 must emit byte-identical C (§6.2
of the contract), and the C emitter numbers its C locals and labels from the IR. Any normalisation here would only move
the mismatch into #18. So **this milestone normalises nothing**: temp ids, label numbers, block order, string-table
order and pruning all match `lower.ts` exactly.

### Success criteria

1. `packages/asterc-self/ir.aster` holds the IR types, `packages/asterc-self/lower.aster` holds `lower_program`, and
   `packages/asterc-self/ir_print.aster` holds `print_ir`. They mirror `ir.ts`, `lower.ts` and `print.ts`.
2. `tests/programs/programs/ir.aster` loads and checks a program as `typed.aster` does, then prints the lowered
   program. `tests/ir_aster.test.ts` checks that its stdout equals `printIr(lower(runFrontend(X).typed))`, byte for
   byte, for every program in `typed_aster.test.ts`'s accepted corpus plus every `fixtures/ir_*.txt`. Nothing is
   skipped, and that includes the compiler closure lowering itself.
3. A TypeScript structural validator (`tests/ir_validate.ts`) runs on the TS IR of the same corpus. Because the Aster
   output equals it byte for byte, the validator covers both. It checks that block labels are unique and the entry
   block comes first, that every jump, branch and switch target names a block, that every local operand and
   destination id is in range, and that operand types match where the IR fixes them: `br` and `switch` conditions are
   `bool` and `int`, `copy` has matching types, and so on (§5).
4. Focused fixtures `fixtures/ir_*.txt` cover nested control flow, side effects and evaluation order, early returns,
   `break`/`continue`, unreachable code, every match kind, `?` and `read_file`.
5. `pnpm test`, `pnpm lint` and `pnpm typecheck` pass. `check_aster`, `typed_aster`, the golden suite and the
   TypeScript unit tests are unchanged. `packages/asterc/src/` is unchanged unless a compiler bug turns up; such a fix
   lands in its own commit with a friction-log note.
6. `docs/self-host/friction.md` gains a "Found while building lowering" section.

### Non-goals

C emission (#18), the CLI and driver (#19), the four POSIX builtins, `--emit=ir` on any CLI (the contract has none),
IR optimisation, and any representation change for LLVM.

## 2. Approach: a line-for-line port without closures

`lower.aster` follows `lower.ts` function by function and statement by statement. It allocates temps, labels and
strings in the same order, because that order *is* the output. Aster has no closures, so the four places where
`lower.ts` passes a callback become data:

| `lower.ts` | `lower.aster` |
|---|---|
| `lowerMatch(st, scrutinee, patterns, lowerBody)` | `lower_match(st, scrutinee, arms: [TArm], into: Option[int])`. Each arm's body is a `TArmBody`: a `Block` arm runs `lower_block`. An `Expr` arm runs `lower_value` and, when `into` is `Some(dst)`, copies the result into `dst`. A statement match passes `None` (its arms are always blocks), and so does a `never` match expression. |
| `lowerFor(st, body, counter, { cond, bind })` | `lower_for(st, body, counter, kind: IrForKind)`, where `IrForKind` is `Range(limit, local)` or `Each(array, local)`. The cond and bind code switches on the kind and emits the same instructions in the same order. |
| `storeThroughPlace(st, stmt, read, write)` | `IrPlaceRef`, which is `Field(object, field)` or `Index(array, index)` with already-lowered operands, plus `place_read(ref, dst)` and `place_write(ref, value)`. |
| `values` (a `Map`) in `structLit` | an array of `(field, operand)` pairs in written order, searched linearly per declared field. |

The other `Map`s become linear scans: the string table (`intern_ir_string`), the struct lookup, and label-to-block
lookup in `prune_unreachable`. Each scan is bounded by one function's blocks or the program's distinct strings. The
friction log records the cost, and maps stay an open shortlist item.

`lower.ts` throws `internal:` errors on impossible input, such as an `error` type or a `break` outside a loop. Aster
reaches these through `panic("internal: …")`, with the same message.

## 3. Data types (`ir.aster`)

The types mirror `ir.ts` field for field. Names take an `Ir` prefix because the flat namespace already has `Loop`,
`Block` and `Local`.

```
struct IrLocal    { id: int, name: Option[string], ty: Type }        // None for compiler temporaries
struct IrField    { name: string, ty: Type }
struct IrStruct   { name: string, fields: [IrField] }
struct IrVariant  { name: string, tag: int, payload: [Type] }
struct IrEnum     { name: string, payload_free: bool, variants: [IrVariant] }
enum IrOperand    { Local(int), Int(string), Bool(bool), Str(int) }   // Int is a canonical decimal, as in the typed tree
struct IrFieldValue { name: string, value: IrOperand }
enum IrInstr {
    Copy(int, IrOperand), Unop(int, string, IrOperand), Binop(int, string, IrOperand, IrOperand),
    Call(Option[int], string, [IrOperand]), CallBuiltin(Option[int], string, [IrOperand]),
    StructNew(int, string, [IrFieldValue]), FieldGet(int, IrOperand, string), FieldSet(IrOperand, string, IrOperand),
    ArrayNew(int, Type, [IrOperand]), IndexGet(int, IrOperand, IrOperand), IndexSet(IrOperand, IrOperand, IrOperand),
    ArrayLen(int, IrOperand), ArrayPush(IrOperand, IrOperand), ArrayPop(int, IrOperand),
    EnumNew(int, string, string, int, [IrOperand]), EnumTag(int, IrOperand),
    EnumField(int, IrOperand, string, string, int, int), ReadFile(int, int, IrOperand),
}
struct IrCase     { value: string, target: string }
enum IrTerm       { Jmp(string), Br(IrOperand, string, string), Switch(IrOperand, [IrCase], Option[string]),
                    Ret(Option[IrOperand]), Unreachable }
struct IrBlock    { label: string, instrs: [IrInstr], term: IrTerm }
struct IrFunction { name: string, param_count: int, locals: [IrLocal], ret: Type, blocks: [IrBlock] }
struct IrProgram  { structs: [IrStruct], enums: [IrEnum], functions: [IrFunction], strings: [string] }
```

**Conventions.**

- **Types.** `Type` is checker.aster's `Type`. Lowering panics on `Error` and maps a `never` return type to `Void`,
  as `irType` and `lowerFunction` do.
- **Operators and builtins** are the IR spelling (`"add"`, `"str_eq"`, `"neg"`, `"print_int"`), not source spelling.
- **Ints** are canonical decimal strings. Typed-tree ints already are, and tags and constants (`0`, `1`) go through
  `int_to_string`. TypeScript's `bigint.toString()` prints the same text.

The field names are a proposal and the plan may adjust them. The content may not change.

## 4. The printer (`ir_print.aster`)

`print_ir(p: IrProgram): [string]` returns the output's lines, as `dump_typed` does. The driver prints each line with a
newline. The lines are a port of `print.ts`, including its section structure. The structs, enums and strings sections
appear only when non-empty, and sections are joined by a blank line. The result must equal `printIr`'s text exactly,
including the trailing newline.

**String literals.** `print.ts` writes `string #i = JSON.stringify(s)`. Aster strings are bytes, so `ir_json_string`
reproduces `JSON.stringify` on UTF-8 bytes:

- `"` becomes `\"` and `\` becomes `\\`.
- `\b`, `\f`, `\n`, `\r` and `\t` become their short escapes.
- Any other byte below 0x20 becomes `\u00xx` (lowercase hex, four digits).
- Every other byte is copied through. That includes 0x7f and every byte of a multi-byte UTF-8 sequence.

Valid source text has no lone surrogates, the one case where `JSON.stringify` would escape a non-ASCII character, so
this rule is exact.

## 5. Tests

- **`tests/ir_aster.test.ts`.** It builds `ir.aster` once with `-Werror`, as `typed_aster.test.ts` does, and reuses its
  corpus rule: every accepted `.aster` under `tests/programs/`, the `packages/asterc-self/` closure, and every
  `fixtures/typed_*.txt` and `fixtures/ir_*.txt`. For each program it expects stdout to be `printIr(lower(typed))`,
  stderr to be empty and the exit status to be 0. While the port is in progress, files that are known to fail sit in a
  `PENDING` set. That set must be empty before merge.
- **`tests/ir_validate.ts`** and its suite `tests/ir_validate.test.ts`. `validateIr(p: IrProgram): string[]` returns
  problems, empty for a valid program. It checks:
  - each function's labels are unique, the first block is `entry`, and every target resolves;
  - local ids in operands and destinations are in `[0, locals.length)`, and no local has type `void`;
  - `br` conditions are `bool`, `switch` values are `int`, and `ret`'s value type equals the return type (with no
    value for `void`);
  - `copy`'s destination and source types match, and `binop`/`unop` operand types match the operator (int ops on
    `int`, `str_*`/`concat` on `string`, `not` on `bool`);
  - string operand indices are in range.

  The suite runs it on every program in the corpus. It also checks two deliberately broken programs to prove that it
  reports problems at all.
- **Focused fixtures, `fixtures/ir_*.txt`.** Each is a small `main` program that the TS front end accepts:
  - `ir_control.txt`: nested `if`/`while`/`for`, `break` and `continue` in nested loops, a `for` whose body only
    `continue`s, and `if` expressions;
  - `ir_effects.txt`: a call inside an index target of `+=`, field and index compound assignment, a struct literal
    written out of declaration order with side-effecting values, and `&&`/`||` with calls;
  - `ir_diverge.txt`: early `return` in loops and arms, code after `return`/`panic`/a `never` call (pruned), an `if`
    expression whose branches both diverge, a `never` match expression, and a `never` function;
  - `ir_match.txt`: enum (payload-free and payload, with binders and or-patterns), int, bool and string matches, with
    and without `_`, as statements and as expressions, and `EnumCompare`;
  - `ir_try.txt`: `?` on `Option` and `Result`, `read_file`, and strings with every JSON escape class (`\0`, `\r`, a
    quote, a backslash, `é`, an astral character).
- **Existing suites** stay green unchanged.

## 6. Order of work

1. **Harness.** Add `ir.aster` types, `ir_print.aster` and a `lower.aster` that lowers structs, enums and every
   function with an empty `entry` block. Add the `ir.aster` driver, `ir_validate.ts` with its test, and
   `ir_aster.test.ts` with everything that fails in `PENDING`. Every program has a `main` with a body, so `PENDING`
   starts as nearly the whole corpus.
2. **Straight-line code.** Block plumbing, pruning, string interning, literals and locals, `let`, `return`, expression
   statements, unary/binary (non-short-circuit), calls, builtins (array builtins, `never` builtins), field and index
   reads, array/struct/variant literals, `EnumCompare` and every assignment form. Add `ir_effects.txt`.
3. **Control flow.** Statement and expression `if`, `while`, both `for` loops, `break`/`continue` and short-circuit
   operators. Add `ir_control.txt`.
4. **Matches, `?` and `read_file`.** The switch and string-chain forms, binders, statement/value/`never` match
   expressions, `?` and `read_file`. Add `ir_match.txt`, `ir_try.txt` and `ir_diverge.txt`.
5. **Full corpus green.** Empty `PENDING`, run the compiler closure through `ir.aster`, then write the friction log.

## 7. Risks

- **Allocation order.** A temp or label allocated one step early shifts every later id in the function. The dump
  shows the first divergence. The port keeps `lower.ts`'s statement order, even where Aster would naturally reorder
  it. For example, `if` expressions allocate `then`/`else`/`endif` labels before the result temp.
- **`st.current` after divergence.** `emit` drops instructions at an unreachable position. `lowerExpr` returns the
  placeholder `0` there and still allocates nothing. The Aster port must keep the early `if !st.current` check at the
  top of `lower_expr`, or it will allocate temps that TypeScript doesn't.
- **Quadratic scans.** Linear string interning over the compiler closure is O(strings²) byte compares. If
  `ir.aster` on the closure exceeds the test timeout, measure it and log it. A sorted index is the fallback, not maps.
- **Struct aliasing.** `lower.ts` mutates `FnState` and the `Loop` objects in place. Aster structs are heap
  references, so `let lp: IrLoop = st.loops[n - 1]; lp.continued = true;` has the same effect. The fixture with a `for`
  whose body only `continue`s pins this down.

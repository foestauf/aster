# emit.aster: IR to C (Design)

**Date:** 2026-10-04
**Status:** Approved in brainstorming. Rob approved the design and chose the self-compiled-emitter proof level.
**Issue:** #18
**Builds on:** [`2026-10-04-aster-self-hosting-contract-design.md`](2026-10-04-aster-self-hosting-contract-design.md)
(§3 source closure, §6.2 the byte-identical C oracle, §8 the open memory question) and
[`2026-10-04-aster-ir-lowering-design.md`](2026-10-04-aster-ir-lowering-design.md) (#17). No language or runtime
changes.

## 1. Purpose

`lower.aster` produces the IR, and its printed form matches TypeScript byte for byte (#17). The last stage of stage 0's
pipeline is `packages/asterc/src/codegen/c/emit.ts` (297 lines). It turns an `IrProgram` into C that includes
`aster_rt.h` and links against `packages/asterc/runtime/aster_rt.c`. This milestone ports it to Aster. Contract §6.2
makes the TS emitter the reference: the C must be byte-identical, with no normalisation.

On top of the byte oracle, this milestone produces the first binary that Aster compiled from Aster. The emit driver
generates C for its own source closure. That C is compiled with `cc`, and the resulting binary (E1) must reproduce the
same C over the whole corpus.

### Success criteria

1. `packages/asterc-self/emit.aster` provides `emit_c(p: IrProgram): [string]`, a port of `emit.ts`. It mirrors
   `emitC`'s line structure, name mangling, declaration order, string escaping and integer spelling.
2. `tests/programs/programs/emit.aster` loads, checks, lowers and emits a program. It prints the C to stdout, with
   diagnostics handled as in `ir.aster`. For every program in `tests/corpus.ts`'s accepted corpus, including
   `fixtures/emit_*.txt`, its stdout equals `emitC(lower(typed))` byte for byte. Its stderr is empty and it exits 0.
3. **Self-compile.**
   - E0 is the driver built by stage 0. The C that E0 emits for `programs/emit.aster` compiles with
     `cc -std=c11 -O2 -Wall -Werror` against the existing runtime, and the result is E1.
   - E1's stdout equals `emitC(lower(typed))` for every corpus program, exactly as E0's does. So E1's C for its own
     closure equals E0's: a fixed point.
4. The time and peak memory of E0 and E1 emitting their own closure are measured and recorded in the friction log.
   That answers contract §8's memory question for a closure of about 6k lines.
5. Focused fixtures `fixtures/emit_*.txt` cover the emitter's edge cases (§4).
6. `pnpm test`, `pnpm lint` and `pnpm typecheck` pass. `packages/asterc/src/**` and `packages/asterc/runtime/**` are
   unchanged, unless a behaviour can't reasonably be mirrored (contract §6.2). Such a change gets its own commit. A
   runtime change, including one for memory, goes back to Rob as a separate decision and isn't made here.
7. `docs/self-host/friction.md` gains a "Found while building emission" section, and the README is updated.

### Non-goals

`runtime.aster` and `pnpm gen:runtime` (contract §4.4). The emitted C only needs `#include "aster_rt.h"`, and embedding
the runtime belongs with the driver that writes files and runs `cc` (#19). Also out: the CLI, the four POSIX builtins,
stage 1/2/3 parity of the full compiler (#20), LLVM, and runtime changes.

## 2. Approach: a line-for-line port

`emit.aster` follows `emit.ts` function by function, under the flat-namespace prefixes `emit_` and `c_`:

| `emit.ts` | `emit.aster` |
|---|---|
| `emitC` | `emit_c(p): [string]`: the exact `out` array of `emitC`, which `out.join('\n')` turns into the C text |
| `cType`, `zeroValue` | `c_type(t: Type): string`, `c_zero(t: Type): string` |
| `mangleFn/Struct/Enum/Variant/Field/Local` | `c_mangle_fn`, `c_mangle_struct`, `c_mangle_enum`, `c_mangle_variant`, `c_mangle_field`, `c_mangle_local(l: IrLocal)` |
| `BINOPS` | `c_binop(op, a, b): string`, a string `match` |
| `enumTypedef`, `enumDefinition` | `emit_enum_typedef`, `emit_enum_definition(out, e)` |
| `stringLiteral` | `c_string_literal(s: string): string`, over bytes: `"`→`\"`, `\`→`\\`, `?`→`\?`, 0x20..0x7e copied, every other byte a 3-digit octal escape, then `, <byte length>` |
| `signature`, `emitFunction` | `emit_signature(f)`, `emit_function(out, f, enums)` |
| `intLiteral` | `c_int_literal(v: string)`: `INT64_MIN` when `v == "-9223372036854775808"`, else `INT64_C(v)`. Operands are canonical decimals (#17). |
| `operand`, `slot`, `elemCType`, `enumOf` | `c_operand(f, o)`, `c_slot(t, call)`, `c_elem_type(f, o)`, `c_enum_of(f, enums, o)` |
| `emitInstr`, `emitTerminator` | `emit_instr(f, enums, i): string` (multi-statement instructions joined by `"\n    "`, as in TS), `emit_term(f, t)` |
| `EnumTable` (`Map`) | `[IrEnum]` searched linearly by `c_find_enum` |

`emit.ts` throws `internal:` errors on impossible input. Aster reaches those through `panic` with the same message.

**Driver output.** `emitC` returns `out.join('\n')`, and `out` always ends with `''` (after the `main` shim). So the C
text is every element of `out` followed by `\n`, except the last. The driver prints `out[0 .. len-1)`, each followed by
a newline, which reproduces the join exactly. The bytes of a string literal can't contain a newline after escaping, so
lines never contain `\n`.

## 3. Tests (`tests/emit_aster.test.ts`)

- **Build E0.** Compile `programs/emit.aster` with stage 0 (`compileToC` + `buildExecutable(…, ['-Werror'])`), as the
  other `*_aster` tests do.
- **Byte parity (E0).** For every accepted corpus program X, run `E0 X` and expect `{ stdout: emitC(lower(typed)),
  stderr: '', status: 0 }`.
- **Self-compile (E1).** Run E0 on `programs/emit.aster` to get C1. Assert that C1 equals stage 0's C for that file,
  then build C1 with `buildExecutable(C1, e1, ['-Werror'])`.
- **Byte parity (E1).** Run E1 over the same corpus with the same expectation.
- **Measurement.** Measure the time and peak RSS of E0 and E1 emitting `programs/emit.aster` (for example with
  `/usr/bin/time -v`, or `process.resourceUsage` around a spawn). Record the numbers in the friction log. The test
  asserts no number; the 20 s spawn timeout is the guard.
- The suites for `typed_aster`, `ir_aster`, `ir_validate`, `check_aster` and golden stay green unchanged.
  `tests/corpus.ts`'s fixture pattern gains `emit`.

## 4. Focused fixtures (`fixtures/emit_*.txt`)

Each fixture is a small `main` program that the TS front end accepts.

- `emit_types.txt`:
  - an empty struct;
  - structs that refer to themselves and to each other (through arrays or enums);
  - a payload-free enum and a heap enum;
  - generic instantiations whose type strings contain `_`, nested brackets and `, `, for example
    `Option[Result[my_pair, int]]` (so `__`, `_L`, `_R` and `_C` all appear);
  - `enum_tag` on both enum kinds;
  - identifiers that look like C keywords (`int`, `char`) as locals, fields and variants.
- `emit_values.txt`:
  - `9223372036854775807` and `-9223372036854775808` as literals and as `match` cases;
  - bools as values, a `match` on a bool (the `(int64_t)` switch cast) and a `match` on a bool literal scrutinee;
  - string bytes: quote, backslash, `?` next to `?`/`=`/`(` (trigraph bait), `\0`, `\n`, `\t`, `\r`, `é`, an astral
    character, and a digit right after an escaped byte;
  - an empty string.
- `emit_arrays.txt`: arrays of ints, strings, structs, enums and arrays, with `push`, `pop`, `len`, indexing, index
  assignment and `for`-each.
- `emit_main_args.txt`: `fn main(args: [string]): int`, the `aster_rt_args` shim. Corpus programs whose `main` has no
  args cover the other shim.

## 5. Order of work

1. **Harness and declarations.** `emit.aster` with `emit_c`'s header, typedefs, struct and enum bodies, string table,
   prototypes, functions with locals and the `main` shim. Every instruction and terminator panics
   (`internal: not emitted yet`). Add the driver, `emit_aster.test.ts` with a `PENDING` set, `emit_types.txt`, and
   the `corpus.ts` pattern.
2. **Instructions and terminators.** All 18 instructions and 5 terminators. Add `emit_values.txt`, `emit_arrays.txt`
   and `emit_main_args.txt`. `PENDING` empties.
3. **Self-compile.** Add the E1 build and E1 parity, then the measurements. If E1 fails because of a runtime limit,
   stop and report (criterion 6).
4. **Docs.** Friction log and README.

## 6. Risks

- **Memory.** The runtime never frees. E0 has already run checker+lower over the closure in 37 MB (#17). Emission adds
  the C text, which is a few MB at most. E1 is `-O2` C of the same program. The real risk is a runtime difference
  between stage-0-built and E1-built binaries on large inputs. That would be a bug worth finding, and it is the point
  of the E1 run.
- **`-Werror` on C1.** C1 equals stage 0's C for the same file, and the golden suite already builds stage-0 C with
  `-Werror`. A warning here would be a stage-0 bug, so it gets its own commit.
- **Octal and hex digits.** Aster has no `chr` and no number formatting beyond `int_to_string`. The octal escape is built
  from `"01234567"` with `substring`, as `dump_escape` builds hex.

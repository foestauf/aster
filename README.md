# Aster

A small, statically typed, compiled language, and a place to learn how compilers work. The bootstrap compiler `asterc` is written in TypeScript. It compiles Aster to C and builds a native executable with your system C compiler. The long-term goals are an LLVM backend and a compiler written in Aster itself.

## Quick start

Requirements: Node 24+, pnpm, and a C compiler (`cc`, or set `ASTER_CC`).

```sh
pnpm install
pnpm build
pnpm aster run tests/programs/basics/hello.aster      # prints 30
pnpm aster run tests/programs/programs/rpn.aster      # an RPN calculator using structs, arrays and for
pnpm aster run tests/programs/programs/calc.aster     # a tokenizer, parser and evaluator using enums and match
pnpm aster run tests/programs/programs/lex.aster -- tests/programs/basics/hello.aster   # the Aster lexer, written in Aster
pnpm aster run tests/programs/programs/parse.aster -- tests/programs/basics/hello.aster # the Aster parser, written in Aster
```

## CLI

```
aster check <file.aster>                                   # type-check only
aster build <file.aster> [-o <out>] [--emit=tokens|ast|ir|c]
aster run   <file.aster> [-- <args>...]                     # build to a temp dir and run
```

Exit codes: `0` ok, `1` compile errors, `2` usage error, `3` internal compiler error. `run` returns the program's own exit code. Arguments after `--` are passed to the program, and stdin passes through. `run` goes through Node, which decodes arguments as UTF-8, so bytes that aren't valid UTF-8 arrive as U+FFFD; run a built executable directly to pass raw bytes.

## How it works

```
source → lexer → parser → checker → IR (basic blocks) → C → cc → executable
```

`--emit=<stage>` prints any intermediate stage. The code lives in `packages/asterc/src/`, one folder per stage, and the C runtime is in `packages/asterc/runtime/`.

## Docs

- Language reference: [`docs/spec/language.md`](docs/spec/language.md)
- v0 design: [`docs/superpowers/specs/2026-10-01-aster-v0-design.md`](docs/superpowers/specs/2026-10-01-aster-v0-design.md)
- v0.1 design (structs, arrays, compound assignment, `for`): [`docs/superpowers/specs/2026-10-01-aster-v0.1-design.md`](docs/superpowers/specs/2026-10-01-aster-v0.1-design.md)
- v0.2 design (enums and `match`): [`docs/superpowers/specs/2026-10-02-aster-v0.2-design.md`](docs/superpowers/specs/2026-10-02-aster-v0.2-design.md)
- v0.3 design (file and stdin input, program arguments): [`docs/superpowers/specs/2026-10-02-aster-v0.3-design.md`](docs/superpowers/specs/2026-10-02-aster-v0.3-design.md)
- parse.aster design (the self-hosted parser): [`docs/superpowers/specs/2026-10-03-aster-parse-aster-design.md`](docs/superpowers/specs/2026-10-03-aster-parse-aster-design.md)
- Self-hosting friction log and v0.4 shortlist: [`docs/self-host/friction.md`](docs/self-host/friction.md)

## Tests

`pnpm test` runs unit tests and the golden suite in `tests/programs/`. Each `.aster` file declares its expected output, exit code or compile errors in `// expect-…` header comments. The golden suite is the language's conformance suite: a future self-hosted compiler must pass it unchanged. `tests/lex_aster.test.ts` checks `lex.aster` against the compiler's lexer on every golden program, and `tests/parse_aster.test.ts` checks `parse.aster`'s syntax tree and diagnostics against the compiler's parser.

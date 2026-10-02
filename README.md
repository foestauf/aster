# Aster

A small, statically typed, compiled language, and a place to learn how compilers work. The bootstrap compiler `asterc` is written in TypeScript. It compiles Aster to C and builds a native executable with your system C compiler. The long-term goals are an LLVM backend and a compiler written in Aster itself.

## Quick start

Requirements: Node 24+, pnpm, and a C compiler (`cc`, or set `ASTER_CC`).

```sh
pnpm install
pnpm build
pnpm aster run tests/programs/basics/hello.aster      # prints 30
```

## CLI

```
aster check <file.aster>                                   # type-check only
aster build <file.aster> [-o <out>] [--emit=tokens|ast|ir|c]
aster run   <file.aster>                                   # build to a temp dir and run
```

Exit codes: `0` ok, `1` compile errors, `2` usage error, `3` internal compiler error. `run` returns the program's own exit code.

## How it works

```
source → lexer → parser → checker → IR (basic blocks) → C → cc → executable
```

`--emit=<stage>` prints any intermediate stage. The code lives in `packages/asterc/src/`, one folder per stage, and the C runtime is in `packages/asterc/runtime/`.

## Docs

- Language reference: [`docs/spec/language.md`](docs/spec/language.md)
- v0 design: [`docs/superpowers/specs/2026-10-01-aster-v0-design.md`](docs/superpowers/specs/2026-10-01-aster-v0-design.md)

## Tests

`pnpm test` runs unit tests and the golden suite in `tests/programs/`. Each `.aster` file declares its expected output, exit code or compile errors in `// expect-…` header comments. The golden suite is the language's conformance suite: a future self-hosted compiler must pass it unchanged.

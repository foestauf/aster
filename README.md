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
pnpm aster run tests/programs/programs/check.aster -- tests/programs/basics/hello.aster # the Aster type checker, written in Aster
```

## CLI

```
aster check <file.aster>                                   # type-check only (follows imports)
aster build <file.aster> [-o <out>] [--emit=tokens|ast|ir|c]
aster run   <file.aster> [-- <args>...]                     # build to a temp dir and run
```

A program can span several files: `import "other.aster";` is a top-level item, and every loaded file joins one flat namespace (no qualified names yet). Paths resolve against the importing file's directory, each file loads once (cycles are fine), and `main` must live in the file you pass to the compiler. `--emit=tokens` and `--emit=ast` show that root file only, and `--emit=ir` and `--emit=c` show the whole program.

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
- v0.4 design (character literals, `match` on ints, bools and strings, or-patterns, `eprint` and `exit`): [`docs/superpowers/specs/2026-10-03-aster-v0.4-design.md`](docs/superpowers/specs/2026-10-03-aster-v0.4-design.md)
- v0.5 design (generic enums, `Option[T]` and `Result[T, E]`, the `?` operator, `read_file` returns `Result`): [`docs/superpowers/specs/2026-10-03-aster-v0.5-design.md`](docs/superpowers/specs/2026-10-03-aster-v0.5-design.md)
- v0.6 design (`import` and multi-file programs): [`docs/superpowers/specs/2026-10-03-aster-v0.6-design.md`](docs/superpowers/specs/2026-10-03-aster-v0.6-design.md)
- check.aster design (the self-hosted type checker): [`docs/superpowers/specs/2026-10-03-aster-check-aster-design.md`](docs/superpowers/specs/2026-10-03-aster-check-aster-design.md)
- Self-hosting friction log and shortlist: [`docs/self-host/friction.md`](docs/self-host/friction.md)

## Tests

`pnpm test` runs unit tests and the golden suite in `tests/programs/`. Each `.aster` file declares its expected output, exit code or compile errors in `// expect-…` header comments. The golden suite is the language's conformance suite: a future self-hosted compiler must pass it unchanged. `tests/lex_aster.test.ts` checks `lex.aster` against the compiler's lexer on every golden program, and `tests/parse_aster.test.ts` checks `parse.aster`'s syntax tree and diagnostics against the compiler's parser. Both self-hosted programs use the v0.4 features (character literals, `match` on strings and ints, `eprint` and `exit`) and v0.5 features (generic enums, `Option`, `Result` and `?`), and the tests compare their stdout and stderr separately. Since v0.6 both programs import a shared `lexer.aster`, a library file marked `// expect-library`, which the golden suite never compiles as a root but both conformance suites still lex and parse. Multi-file golden programs live in `tests/programs/modules/`. `tests/check_aster.test.ts` checks `check.aster`, the self-hosted type checker, against the compiler's front end on every `.aster` file under `tests/programs/` (`check.aster` and its libraries included) and on `fixtures/check_*.txt`. It compares the diagnostics, the summary of the typed program and the exit code.

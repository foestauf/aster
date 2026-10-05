# Aster

A small, statically typed, compiled language, and a place to learn how compilers work. The compiler is written in Aster and compiles itself through C, using your system C compiler to build a native executable. Builds bootstrap from a published release; the original TypeScript compiler is archived at the `seed-final` git tag. An LLVM backend is the next goal.

## Quick start

Requirements: Linux x86_64, gcc 13 as `cc`, Node 24+ and pnpm. See [docs/self-host/building.md](docs/self-host/building.md).

```sh
pnpm install
pnpm bootstrap
pnpm aster run tests/programs/basics/hello.aster      # prints 30
pnpm aster run tests/programs/programs/rpn.aster      # an RPN calculator using structs, arrays and for
pnpm aster run tests/programs/programs/calc.aster     # a tokenizer, parser and evaluator using enums and match
pnpm aster run tests/programs/programs/lex.aster -- tests/programs/basics/hello.aster   # the Aster lexer, written in Aster
pnpm aster run tests/programs/programs/parse.aster -- tests/programs/basics/hello.aster # the Aster parser, written in Aster
pnpm aster run tests/programs/programs/check.aster -- tests/programs/basics/hello.aster # the Aster type checker, written in Aster
```

Since v0.7, `let … else`, `if let` and the `never` type unwrap an `Option` without `?`:

```aster
fn die(msg: string): never {
    eprint(msg);
    exit(1);
}

fn digit(c: int): Option[int] {
    if c >= '0' && c <= '9' {
        return Option::Some(c - '0');
    }
    return Option::None;
}

fn main(): int {
    let Option::Some(d) = digit('7') else {
        die("not a digit");
    };
    if let Option::Some(e) = digit('x') {
        print(e);
    } else {
        print(d);   // 7
    }
    return 0;
}
```

## CLI

```
aster check <file.aster>                                   # type-check only (follows imports)
aster build <file.aster> [-o <out>] [--emit=c|llvm]
aster run   <file.aster> [-- <args>...]                     # build to a temp dir and run
```

A program can span several files: `import "other.aster";` is a top-level item, and every loaded file joins one flat namespace (no qualified names yet). Paths resolve against the importing file's directory, each file loads once (cycles are fine), and `main` must live in the file you pass to the compiler. `--emit=c` and `--emit=llvm` show the whole program.

Exit codes: `0` ok, `1` compile errors, `2` usage error, `3` internal compiler error. `run` returns the program's own exit code. Arguments after `--` are passed to the program, and stdin passes through.

`pnpm aster` is the self-hosted compiler (`build/asterc`, built by `pnpm bootstrap`). `build/asterc run` passes arguments to the program as raw bytes.

## System builtins

```
read_file(path: string): Result[string, string]                   // Ok(file contents)
write_file(path: string, contents: string): Result[int, string]   // Ok(bytes written); creates or truncates the file
make_temp_dir(prefix: string): Result[string, string]             // Ok(path of a new directory <prefix>XXXXXX under $TMPDIR, or /tmp)
remove_path(path: string): Result[int, string]                    // Ok(0); removes a file or an empty directory
run_process(argv: [string]): Result[int, string]                  // Ok(exit status), or Ok(128 + signal) if killed
```

Failures are `Err("<subject>: <reason>")`. The subject is the path; for `make_temp_dir` it is the template, and for `run_process` it is `argv[0]` (or the offending argument, if one contains a NUL byte). `run_process` searches `PATH` for `argv[0]` and shares the caller's stdin, stdout and stderr. These builtins' names are reserved.

## Self-hosted compiler

`packages/asterc-self/asterc.aster` is the compiler written in Aster: lexer, parser, loader, type checker, IR, C emitter and a driver that calls `cc`. `pnpm bootstrap` builds it once with the nearest published release and after that it needs only `cc`. `pnpm build` rebuilds it with itself. See [docs/self-host/building.md](docs/self-host/building.md).

```
pnpm bootstrap
build/asterc check   <file.aster>
build/asterc build   <file.aster> [-o <out>] [--emit=c]
build/asterc run     <file.aster> [-- <args>...]
build/asterc build packages/asterc-self/asterc.aster -o asterc2   # rebuilds itself
```

The commands, output, diagnostics and exit codes are pinned byte for byte as goldens (`tests/asterc_self.test.ts`). S2's `--emit=c` of its own source equals stage 0's (the installed compiler's). It was tested on Linux x86_64 (WSL2, kernel 6.6) with gcc 13.3 as `cc`. It uses `-std=c11 -O2 -Wall`, with a private directory under `$TMPDIR` for the intermediate files.

On that machine S1 builds itself (`asterc build packages/asterc-self/asterc.aster -o s2`) in 2.98 s wall clock with 239,360 kB peak RSS, which includes `cc` on about 1 MB of C. S1's `--emit=c` of the same file takes 0.16 s and 238,208 kB. The runtime never frees memory, and that is fine at this size.

Limits, all listed in [the contract's section 4.5](docs/superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md):

- `ASTER_CC` is ignored: it always runs `cc`.
- `cc`'s stderr streams to yours, so its warnings show even on success, and a failing `cc` prints its output and then `internal compiler error: C compiler 'cc' failed` (exit 3).
- A panic inside the compiler is `panic: <message>` with exit 101, not an internal-compiler-error exit 3.
- Imports are identified by their normalised path, not their real path, so two symlinks to one file load twice.

## Self-hosting

`packages/asterc-self/asterc.aster` is the Aster compiler written in Aster, and it compiles itself. `pnpm selfhost` proves it: stage 0 (the installed compiler, `build/asterc`; in CI, bootstrapped from the base's release and rebuilt from this tree) builds S1, S1 builds S2, S2 builds S3, and the C each stage emits for the compiler must be byte-identical to stage 0's. It then runs the conformance suites against S1, S2 and S3, and writes a report to `.selfhost/`. The last recorded run is in [docs/self-host/proof.md](docs/self-host/proof.md). CI runs the proof on every pull request. It needs Linux x86_64, gcc 13 as `cc`, and Node 24 or later.

The self-hosted compiler is the normal build path: `pnpm bootstrap` installs it as `build/asterc`, and `pnpm build` and `pnpm aster` use it. `pnpm bootstrap` takes a published release as its seed. The original TypeScript compiler is archived at the `seed-final` git tag; the last-resort recovery path that uses it is in [docs/self-host/building.md](docs/self-host/building.md#recovery).

## Remaining work

These are not part of self-hosting:

- `--emit=tokens|ast|ir` and `ASTER_CC` in the self-hosted CLI.
- Import identity through symlinks.
- The runtime never frees memory.
- Compile-time performance.
- An LLVM backend. Planning is next.

## How it works

```
source → lexer → parser → checker → IR (basic blocks) → C → cc → executable
```

`--emit=c` and `--emit=llvm` print the generated code. The compiler lives in `packages/asterc-self/`, one file per stage, and the C runtime is in `runtime/`.

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
- v0.7 design (`let … else`, `if let`, the `never` type, diverging `match` arms): [`docs/superpowers/specs/2026-10-03-aster-v0.7-design.md`](docs/superpowers/specs/2026-10-03-aster-v0.7-design.md)
- check.aster design (the self-hosted type checker): [`docs/superpowers/specs/2026-10-03-aster-check-aster-design.md`](docs/superpowers/specs/2026-10-03-aster-check-aster-design.md)
- Building the compiler (tools, commands, artifacts, recovery): [`docs/self-host/building.md`](docs/self-host/building.md)
- Normal build path design (the self-hosted compiler by default): [`docs/superpowers/specs/2026-10-04-aster-normal-build-path-design.md`](docs/superpowers/specs/2026-10-04-aster-normal-build-path-design.md)
- Self-hosting friction log and shortlist: [`docs/self-host/friction.md`](docs/self-host/friction.md)

## Tests

`pnpm test` runs unit tests and the golden suite in `tests/programs/`. Each `.aster` file declares its expected output, exit code or compile errors in `// expect-…` header comments. The golden suite is the language's conformance suite: the self-hosted compiler passes it unchanged (`pnpm selfhost`). The self-hosted programs (`lex.aster`, `parse.aster` and `check.aster`) use the v0.4 features (character literals, `match` on strings and ints, `eprint` and `exit`) and v0.5 features (generic enums, `Option`, `Result` and `?`), and, since v0.7, `let … else`, `if let` and `never`, and the tests compare their stdout and stderr separately. Since v0.6 they share a `lexer.aster`, imported by `lex.aster` and `parser.aster` (which `parse.aster`, `loader.aster`, `checker.aster` and `check.aster` build on). The libraries (`lexer.aster`, `parser.aster`, `loader.aster`, `checker.aster`, `report.aster`, `typed_dump.aster`, `ir.aster`, `lower.aster`, `ir_print.aster` and `emit.aster`) live in `packages/asterc-self/`. They and the other library files are marked `// expect-library`, so the golden suite never compiles them as a root. Multi-file golden programs live in `tests/programs/modules/`. `tests/check_aster.test.ts` pins `check.aster`'s output on every `.aster` file under `tests/programs/` and in `packages/asterc-self/` as goldens in `tests/golden/check/`, and `tests/asterc_self.test.ts` pins the CLI's output in `tests/golden/cli/`. After a deliberate output change, run `pnpm golden` to refresh them and review the diff. The TypeScript compiler is archived and no longer a test oracle. `pnpm test` needs `build/asterc` (run `pnpm bootstrap` first). The self-hosted front end (lexer, parser, loader and type checker, with the typed program) lives in `packages/asterc-self/` and is complete up to the typed program, `lower.aster` lowers it to IR and `emit.aster` emits C. `asterc.aster` drives them (see Self-hosted compiler above).

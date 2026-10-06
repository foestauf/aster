# Aster

Aster is a small, statically typed language that compiles to native executables, built for fun and to learn how compilers work.

The compiler is written in Aster and compiles itself. C is the default backend; an experimental LLVM backend is also available. Builds bootstrap from a published release, and the original TypeScript compiler is archived at the `seed-final` git tag.

## Vision

The aim is to make Aster unusually easy for humans and coding agents to understand, modify, verify and operate safely. That means making the language regular and giving tools reliable information from the compiler:

- Regular syntax and strong static semantics, with predictable effects that make a change's consequences easier to reason about.
- Clear human diagnostics alongside structured, machine-readable diagnostics.
- Canonical formatting and explicit project metadata, so people and tools share the same conventions and build context.
- Stable AST and IR contracts, plus compiler-backed queries for symbols, types, references and dependencies.
- Safe refactoring primitives that use that information, and incremental compilation for quick feedback.

The longer-term design is one compiler core shared by the CLI, a language server (LSP) and an Agent API. These are design goals, not current guarantees. The CLI described below is available today; the formatter, tooling APIs, effect system, incremental compiler and language server are planned work.

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

Since v0.8, `Map[K, V]` and `Set[K]` (keys are `int` or `string`) are built in. `{}` is the empty one, typed from its context, and iteration follows insertion order:

```aster
fn main(): int {
    let counts: Map[string, int] = {};
    let words: [string] = ["b", "a", "b"];
    for w in words {
        if let Option::Some(n) = map_get(counts, w) {
            map_set(counts, w, n + 1);
        } else {
            map_set(counts, w, 1);
        }
    }
    for k in map_keys(counts) {   // b, then a
        if let Option::Some(n) = map_get(counts, k) {
            print(k);
            print(n);
        }
    }
    print(len(counts));           // 2
    return 0;
}
```

The operations are `map_set`, `map_get`, `map_has`, `map_remove`, `map_keys`, `set_add`, `set_has`, `set_remove`, `set_items` and `len`. Plain `{}` works in `if` and `match` expression arms too (`if c { {} } else { m }`, `_ => {}` where a map is expected); only at the start of a statement does `{` open a block. v0.8a ships the feature; v0.8b uses it for the compiler's name tables, scopes, membership checks and import tracking, bootstrapped from v0.8a's release.

## CLI

```
aster check <file.aster>                                   # type-check only (follows imports)
aster build <file.aster> [-o <out>] [--backend=c|llvm] [--emit=c|llvm]
aster run   <file.aster> [--backend=c|llvm] [-- <args>...]    # build to a temp dir and run
```

C is the default. `--backend=llvm` builds or runs through the experimental LLVM backend and needs clang 18 as `clang` and lld 18 as `ld.lld`. `--emit=llvm` prints LLVM IR without invoking clang. See [the backend setup](docs/self-host/building.md#experimental-llvm-surface).

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

`packages/asterc-self/asterc.aster` is the compiler written in Aster: lexer, parser, loader, type checker, IR, C and LLVM emitters, and a native build driver. `pnpm bootstrap` builds it from the nearest published release; the default C build path needs only `cc` after that. `pnpm build` rebuilds it with itself. See [docs/self-host/building.md](docs/self-host/building.md).

```
pnpm bootstrap
build/asterc check   <file.aster>
build/asterc build   <file.aster> [-o <out>] [--backend=c|llvm] [--emit=c|llvm]
build/asterc run     <file.aster> [--backend=c|llvm] [-- <args>...]
build/asterc build packages/asterc-self/asterc.aster -o asterc2   # rebuilds itself
```

The commands, output, diagnostics and exit codes are pinned byte for byte as goldens (`tests/asterc_self.test.ts`). S2's `--emit=c` of its own source equals stage 0's (the installed compiler's). It was tested on Linux x86_64 (WSL2, kernel 6.6) with gcc 13.3 as `cc`. It uses `-std=c11 -O2 -Wall`, with a private directory under `$TMPDIR` for the intermediate files.

On that machine S1 builds itself (`asterc build packages/asterc-self/asterc.aster -o s2`) in 2.98 s wall clock with 239,360 kB peak RSS, which includes `cc` on about 1 MB of C. S1's `--emit=c` of the same file takes 0.16 s and 238,208 kB. The runtime has no general heap reclamation, and that is fine at this size.

Limits, all listed in [the contract's section 4.5](docs/superpowers/specs/2026-10-04-aster-self-hosting-contract-design.md):

- `ASTER_CC` is ignored: the C backend always runs `cc`.
- `cc`'s stderr streams to yours, so its warnings show even on success, and a failing `cc` prints its output and then `internal compiler error: C compiler 'cc' failed` (exit 3).
- A panic inside the compiler is `panic: <message>` with exit 101, not an internal-compiler-error exit 3.
- Imports are identified by their normalised path, not their real path, so two symlinks to one file load twice.

## Self-hosting

`packages/asterc-self/asterc.aster` is the Aster compiler written in Aster, and it compiles itself. `pnpm selfhost` proves it: stage 0 (the installed compiler, `build/asterc`; in CI, bootstrapped from the base's release and rebuilt from this tree) builds S1, S1 builds S2, S2 builds S3, and S3 builds S4. The C each stage emits for the compiler must be byte-identical to stage 0's. It also builds LLVM stages SL1 and SL2 and checks their fixed point and C output. It runs the conformance suites against S1, S2, S3 and SL1, and writes a report to `.selfhost/`. The last recorded run is in [docs/self-host/proof.md](docs/self-host/proof.md). CI runs the proof on every pull request. The full proof needs Linux x86_64, gcc 13 as `cc`, clang 18, lld 18, and Node 24 or later.

The self-hosted compiler is the normal build path: `pnpm bootstrap` installs it as `build/asterc`, and `pnpm build` and `pnpm aster` use it. `pnpm bootstrap` takes a published release as its seed. The original TypeScript compiler is archived at the `seed-final` git tag; the last-resort recovery path that uses it is in [docs/self-host/building.md](docs/self-host/building.md#recovery).

## Remaining work

Alongside the longer-term vision above, current limitations include:

- `--emit=tokens|ast|ir` and `ASTER_CC` in the self-hosted CLI.
- Import identity through symlinks.
- The runtime has no general heap reclamation (map rebuilds reclaim their replaced internal buffers).
- Compile-time performance.
- The LLVM backend is experimental.

## How it works

```
source → lexer → parser → checker → IR (basic blocks) → C → cc → executable
```

This is the default C path. The experimental path emits LLVM IR and uses clang/lld with the same C runtime. `--emit=c` and `--emit=llvm` print the generated code. The compiler lives in `packages/asterc-self/`, one file per stage, and the C runtime is in `runtime/`.

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
- v0.8 design (`Map[K, V]`, `Set[K]`, the empty `{}` literal, insertion-ordered iteration): [`docs/superpowers/specs/2026-10-05-aster-v0.8-maps-sets-design.md`](docs/superpowers/specs/2026-10-05-aster-v0.8-maps-sets-design.md)
- check.aster design (the self-hosted type checker): [`docs/superpowers/specs/2026-10-03-aster-check-aster-design.md`](docs/superpowers/specs/2026-10-03-aster-check-aster-design.md)
- Building the compiler (tools, commands, artifacts, recovery): [`docs/self-host/building.md`](docs/self-host/building.md)
- Normal build path design (the self-hosted compiler by default): [`docs/superpowers/specs/2026-10-04-aster-normal-build-path-design.md`](docs/superpowers/specs/2026-10-04-aster-normal-build-path-design.md)
- Self-hosting friction log and shortlist: [`docs/self-host/friction.md`](docs/self-host/friction.md)

## Tests

`pnpm test` runs unit tests and the golden suite in `tests/programs/`. Each `.aster` file declares its expected output, exit code or compile errors in `// expect-…` header comments. The golden suite is the language's conformance suite: the self-hosted compiler passes it unchanged (`pnpm selfhost`). The self-hosted programs (`lex.aster`, `parse.aster` and `check.aster`) use the v0.4 features (character literals, `match` on strings and ints, `eprint` and `exit`) and v0.5 features (generic enums, `Option`, `Result` and `?`), and, since v0.7, `let … else`, `if let` and `never`, and the tests compare their stdout and stderr separately. Since v0.6 they share a `lexer.aster`, imported by `lex.aster` and `parser.aster` (which `parse.aster`, `loader.aster`, `checker.aster` and `check.aster` build on). The libraries (`lexer.aster`, `parser.aster`, `loader.aster`, `checker.aster`, `report.aster`, `typed_dump.aster`, `ir.aster`, `lower.aster`, `ir_print.aster` and `emit.aster`) live in `packages/asterc-self/`. They and the other library files are marked `// expect-library`, so the golden suite never compiles them as a root. Multi-file golden programs live in `tests/programs/modules/`. `tests/check_aster.test.ts` pins `check.aster`'s output on every `.aster` file under `tests/programs/` and in `packages/asterc-self/` as goldens in `tests/golden/check/`, and `tests/asterc_self.test.ts` pins the CLI's output in `tests/golden/cli/`. After a deliberate output change, run `pnpm golden` to refresh them and review the diff. The TypeScript compiler is archived and no longer a test oracle. `pnpm test` needs `build/asterc` (run `pnpm bootstrap` first). The self-hosted front end (lexer, parser, loader and type checker, with the typed program) lives in `packages/asterc-self/` and is complete up to the typed program, `lower.aster` lowers it to IR and `emit.aster` emits C. `asterc.aster` drives them (see Self-hosted compiler above).

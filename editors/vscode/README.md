# Aster for VS Code

Syntax highlighting and editing basics for `.aster` files work with no setup and never run anything. If the
workspace is trusted and you set `aster.compilerPath` and `aster.entry`, the extension also shows compiler
diagnostics, hover types and go to definition **for saved files**. It runs the compiler one shot at a time; it is not
a language server. Highlighting follows Aster's
[lexer](https://github.com/foestauf/aster/blob/main/packages/asterc-self/lexer.aster) and
[language reference](https://github.com/foestauf/aster/blob/main/docs/spec/language.md). The compiler answers
come from the public JSON contract in [docs/inspect/README.md](../../docs/inspect/README.md).

## Install

Requires VS Code 1.85 or later. Download the `.vsix`, then run **Extensions: Install from VSIX…** in the Command
Palette and select it. Or, with the VS Code CLI on your PATH:

```sh
code --install-extension /absolute/path/to/aster-syntax-0.2.0.vsix
```

Open a `.aster` file; the language mode should say **Aster**. If it has an existing file association, use **Change
Language Mode → Aster**. Colors come from your theme. Use **Toggle Line Comment** (Cmd+/ on macOS, Ctrl+/ on
Windows/Linux) for `//` comments. Braces, square brackets, parentheses and quotes pair automatically; angle brackets
are comparison operators, not generic delimiters. Editor settings such as `editor.autoClosingQuotes` can override
pairing.

`aster-local.aster-syntax` is a local packaging identifier. No Marketplace listing or registered publisher account is
required to build or install this VSIX. Version 0.2.0 upgrades 0.1.0 in place. Remove it through the Extensions view,
or `code --uninstall-extension aster-local.aster-syntax`.

## Compiler features

| Setting | Meaning |
| --- | --- |
| `aster.compilerPath` | The `aster` executable. A path containing a slash is relative to the workspace folder; a bare name is looked up on `PATH`. Empty (the default): syntax only. |
| `aster.entry` | The program's entry point, the file with `main`, relative to the workspace folder. Empty (the default): syntax only. The extension never guesses one. |
| `aster.timeoutMs` | How long one compiler run may take before it is killed. Default 10000. |

- **Trust.** Both path settings are restricted configurations. In an untrusted workspace (Restricted Mode) no compiler
  runs and the extension highlights syntax only. The compiler is started with an argument list, never through a
  shell, with the first workspace folder as its working directory.
- **Diagnostics.** `aster check --format=json <entry>` runs on activation, when an `aster.*` setting changes and
  whenever a `.aster` file is saved. Its diagnostics replace the previous set, on whichever file they are in. A newer
  run kills an older one that is still going, and an older result is never shown over a newer one.
- **Hover** runs `aster query <entry> --file=<file> --offset=<byte>` for the character under the pointer. It shows
  an expression's type (`int`, `[string]`, `Option[int]`), a callee's signature (`fn area(side: int): int`), or a
  declaration (`local total: int`). A comment, keyword or unsupported position, such as a type annotation, shows
  nothing; that is not an error.
- **Go to definition** (F12) runs the same query with `--caret=<byte>`, so a cursor just after a name still finds
  it. It goes to the declared name, in the same file or an imported one. Builtins and prelude names have no source
  to go to.

The status bar shows one of these:

| Status | Meaning |
| --- | --- |
| `Aster: syntax only` | Untrusted workspace, or a setting is missing; the tooltip says which. |
| `Aster: checking…` | A check is running. |
| `Aster: ✓ saved files` | The program checks; hover and definition answer for the saved files. |
| `Aster: N errors — semantics unavailable` | Fix the errors and save to get hover and definition back. |
| `Aster: saved files only` | An answer was dropped because it might be stale; save your changes. |
| `Aster: compiler problem` | The compiler is missing, timed out, panicked, or didn't answer with aster/1 JSON; the tooltip and the **Aster** output channel say which. A compiler without `query` (a release before v0.10) shows up here too. |

## Saved files only

The compiler reads files from disk, so an answer is shown only when it describes what is saved, and is dropped
otherwise:

- the document is dirty when you ask, or when the answer arrives;
- any file of the program (the entry's import closure) is open with unsaved changes;
- any file's SHA-256 on disk differs from the digest the compiler reported for it, or the file can't be read back;
- a `.aster` file was saved while the compiler ran.

There is no unsaved-buffer analysis. A file with a carriage return that doesn't end a line (a lone `\r`) gets no
answers: VS Code breaks lines there but the compiler doesn't, so positions wouldn't agree. CRLF files are fine.

## Demo

`demo/` is a two-file program: `main.aster` imports `shapes.aster`, shadows a local in a nested block, and has 📐 on
the line with the call. Its `.vscode/settings.json` sets `aster.entry` to `main.aster` and `aster.compilerPath` to
`../../../build/asterc`, the compiler built in this repository.

1. Build the compiler from the repository root: `pnpm bootstrap` once, then `pnpm build`.
2. Open `editors/vscode/demo` as a folder and trust it. The status bar says `Aster: ✓ saved files`.
3. In `shapes.aster`, change `return side * side;` to `return true;` (the body of `shapes.broken.aster`) and save.
   `shapes.aster` shows `type mismatch: expected int, found bool` on `true`, and the status bar says
   `Aster: 1 error — semantics unavailable`. Hover in `main.aster` shows nothing.
4. Put `return side * side;` back and save. The error clears. Edit in the editor: a change made outside it, such as
   `cp` or `git checkout`, fires no save, so the diagnostics wait for the next save (hover is still protected by the
   digests).
5. Hover `side` in `area(side)`: it shows `int`. Hover `area`: `fn area(side: int): int`.
6. F12 on `area` opens `shapes.aster` at `fn area`. F12 on `side` in `print(side)` goes to the inner
   `let side: int = 4;`, and F12 on `side` in `area(side)` goes to the outer one.
7. Type a space in `shapes.aster` without saving, then hover in `main.aster`: nothing is shown, and the status bar
   says `Aster: saved files only`. Undo and save.

An agent gets the same facts from the JSON interface alone, with no editor:

```sh
node editors/vscode/demo/agent.mjs build/asterc
```

It works on a temporary copy, and prints the imported diagnostic, whether the fix checks, the hover type, the
definition target, and whether the answers' digests match the files.

### Manual smoke test

The steps above, run in a real VS Code. **Not yet run:** the extension was developed on Linux without a desktop VS
Code. The `vscode` API is exercised through a recorded mock (`test/extension.test.cjs`), and the adapter through the
real compiler (`tests/vscode_adapter.test.ts`). Record a run here with the date, platform and VS Code version, plus
a result for each of steps 2–7.

## Latency

Each request is one compiler process. Median of three runs of `build/asterc` on Linux x86_64 (2026-10-08),
`/usr/bin/time -f '%e s %M KB'`:

| Program | `check --format=json` | `query` |
| --- | --- | --- |
| The demo (2 files) | 0.00 s, 1.9 MB | 0.00 s, 3.5 MB |
| The compiler (`asterc.aster`, 18 files; `--file=checker.aster --offset=1000`) | 0.15 s, 210 MB | 0.35 s, 327 MB |

A hover on a program the size of the compiler takes about a third of a second. On small programs it is instant.

## Highlighting boundaries

- Keywords, booleans, wildcard `_`, decimal integers, strings, ASCII character literals, their supported escapes,
  operators, punctuation and `//` comments.
- Standard TextMate scope families make the colors theme compatible. Identifiers, including `int`, `bool`, `string`,
  `void`, `never`, `Option`, `Result`, `Map` and `Set`, keep `variable.other.aster` in every position. They can be
  field names; this grammar does not guess types or resolve symbols.
- Only `\n`, `\t`, `\r`, `\\`, `\"`, `\'` and `\0` are valid escapes. Unknown escapes and malformed character bodies
  get `invalid.illegal` scopes. These are lexical hints, not compiler diagnostics.
- Strings and characters end at a quote or line boundary, including during an incomplete edit. No multiline strings,
  block comments, hexadecimal/float literals, Rust lifetimes, macros or angle-bracket generics are inferred.
- No completion, formatting, rename, semantic highlighting or unsaved-buffer analysis; hover, definition and
  diagnostics come from the compiler for saved files only.

## Develop, test and package

From the repository root, with Node 24+ and npm:

```sh
cd editors/vscode
npm ci
npm test
npm run package
```

`npm test` runs four suites, none of which needs a compiler:

- `grammar`: tokenization with VS Code's `vscode-textmate` and Oniguruma engine, over the lexer vocabulary, nested
  constructs and the checked-in compiler and test corpus;
- `convert`: positions (BOM, CRLF, astral characters, lone `\r`), type and hover rendering, diagnostic mapping;
- `adapter`: compiler runs against a fake compiler (no shell, timeout, cancellation, panic, malformed output),
  ordering and freshness;
- `extension`: the VS Code glue against a mock of the API (trust, settings, status, diagnostics).

`pnpm vitest run tests/vscode_adapter.test.ts`, from the repository root, drives the adapter against the real
compiler on a copy of the demo, and checks that `demo/agent.mjs` reports the same facts.

The output is `editors/vscode/aster-syntax-0.2.0.vsix`. Packaging runs the tests and includes only the manifest,
grammar, language configuration, `src/` and this README (plus VSIX metadata), with no runtime dependencies. The
repository has no license file; packaging explicitly allows that and the package is marked `UNLICENSED`. This does
not grant a license or publish anything. CI runs `npm test` and packages a VSIX artifact.

For a visual check without installing, start a separate Extension Development Host:

```sh
code --new-window --extensionDevelopmentPath="$PWD" demo
```

Check a light and dark theme, pairing, comment toggling, and **Developer: Inspect Editor Tokens and Scopes**. Then
remove the closing quote on a line: the following line should retain its original scopes.

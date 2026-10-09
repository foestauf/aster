# Aster VS Code saved-file hover, definition and diagnostics (#60)

**Status:** approved 2026-10-08. Consumes the contract in `docs/inspect/README.md` (v0.9 `check --format=json` and
the #57 `aster query` contract, implemented in PR #64).

## Goal

Show the v0.10 query work in an everyday workflow. You open a small multi-file Aster program in VS Code and see an
error in an imported file. You fix it and save. Then you hover a use for its type and jump to its exact declaration.
An independent agent script gets the same facts through the public JSON interface.

## Decisions

| Question | Decision |
| --- | --- |
| Adapter | Direct VS Code providers (hover, definition, a diagnostic collection), not an LSP wrapper. |
| Code layout | All logic is in modules that never import `vscode`: `editors/vscode/src/convert.cjs` (pure conversions: positions, rendering, diagnostic mapping) and `src/adapter.cjs` (compiler runs, sessions, freshness). `src/extension.cjs` is the glue. Plain CommonJS, no build step, no runtime dependencies. |
| Entry point | The `aster.entry` setting, relative to the first workspace folder. If it is unset the extension stays syntax-only and never guesses. |
| Compiler | The `aster.compilerPath` setting. If it is unset the extension stays syntax-only. The compiler is spawned with an argv array (never a shell), `cwd` = the workspace folder, and a timeout from `aster.timeoutMs` (default 10000). |
| Trust | `capabilities.untrustedWorkspaces = {supported: "limited", restrictedConfigurations: ["aster.compilerPath", "aster.entry"]}`. In an untrusted workspace no compiler runs; syntax highlighting is unchanged. |
| Tests | Unit tests of the adapter under `node --test` with a fake compiler, in the existing VS Code CI job. Workflow tests against the real stage compiler in vitest. A recorded manual smoke test. No `@vscode/test-electron`. |

Rejected: a narrow LSP wrapper. It would let other editors reuse it, but it adds `vscode-languageclient`, a lifecycle
and a position-encoding negotiation that the demo doesn't need. The adapter module is the reusable part; an LSP shell
can wrap it later.

## Behaviour

### Diagnostics

- The extension runs `aster check --format=json <entry>` on activation, when the settings change, and whenever any
  `.aster` document is saved.
- Each diagnostic's `primary` is mapped to `path.resolve(root, primary.path)`. The range comes from the compiler's
  `start_line`/`start_col_utf16`/`end_line`/`end_col_utf16`: line − 1 and column − 1, used as given. A diagnostic
  whose `primary.file` is `null` (a file that failed to load) is placed at the same resolved path when that file
  exists. Otherwise it goes on the entry at 0:0, with its path in the message.
- Each run replaces the whole collection. The message is the compiler's `message`, `source` is `aster` and `code` is
  the diagnostic code.
- A newer run cancels (kills) an older one still running, and an older run's result is never published over a newer
  one's.

### Queries

- **Hover** is `aster query <entry> --file=<rel> --offset=<byte>` (pointer mode). **Definition** is the same with
  `--caret=<byte>`. `<rel>` is the document's path relative to the root.
- What hover shows, as an `aster` code block:
  - for `found` with `site` `expression`, `local` or `field`: the type, rendered as Aster spells it;
  - for `callee`: `fn <name>(<param>: <type>, …): <ret>`, taking the name from the target declaration;
  - for `declaration`: `<kind> <name>: <type>` for a typed declaration, or the signature form for a `fn`.
  - The hover's range is `query.location.range`.
- Definition returns `declarations[target].location`: its resolved path and its name range. A `null` location
  (prelude, instantiation or builtin) gives no result.
- `none`, `unsupported`, a `found` without a target (for definition) and `invalid` give no result and are not errors.
  `invalid` is written to the output channel.
- `unavailable` gives no result. The status bar says semantics are unavailable until the program checks.

### Type rendering

The renderer follows the `inspect` type objects. A primitive kind (`int`, `bool`, `string`, `void`, `never`) is shown
as the kind. `array` is shown as `[<element>]`, `map` as `Map[<key>, <value>]`, and `set` as `Set[<element>]`.
`struct`, `enum` and `param` use their `name`. An unknown kind falls back to its `name`, or else to the kind.

### Positions

- **Into the compiler:** the byte offset is computed from the file's bytes as saved on disk, not from the editor
  buffer. Skip the BOM if there is one. Walk `\n`-separated lines to the editor's line, then count UTF-16 code units
  to the editor's character. The offset is that of the code point there.
- A position past the end of its line maps to the line's end. The position is not converted when the file contains a
  `\r` that is not followed by `\n`: VS Code treats a lone `\r` as a line break and the compiler doesn't, so the
  answer would be for the wrong place. That request gets no semantic answer, and the output channel says why.
  With CRLF line endings both sides agree, because the compiler counts `\r` as the last column of its line and VS
  Code puts it outside the line.
- **Out of the compiler:** ranges use the compiler's line and UTF-16 column fields as they are.

### Freshness (fail closed)

A query result is shown only if all of these hold:

1. the document is not dirty when the request starts or when the response arrives;
2. no document open in the editor whose path is in the response's `files[]` is dirty;
3. every `files[].sha256` equals a SHA-256 of `path.resolve(root, files[i].path)` re-read after the response. A file
   that can't be read counts as a mismatch, and so does a path that doesn't name the same bytes, such as a lossy
   decoded path;
4. no `.aster` save has happened since the request started (a generation counter that every save increments).

When a result is dropped, the status bar says `Aster: saved files only`, and the output channel names the reason.
The extension never claims live unsaved-buffer support.

### Failures

Each of these gives a single status bar state and an output channel line. None throws into the editor, and none
shows an older answer:

- the executable is missing (`ENOENT`) or not executable;
- a timeout or cancellation (the child process is killed);
- stdout that is not one JSON object with `schema: "aster/1"`;
- a compiler that doesn't know `query` (its output is not JSON);
- exit code 101 (a compiler panic);
- an exit status that doesn't match the contract for the response's status.

### Status bar

One item, with these states:

- `Aster: syntax only` — untrusted workspace, or a setting missing; the tooltip says which;
- `Aster: checking…`;
- `Aster: ✓ saved files`;
- `Aster: N errors — semantics unavailable`;
- `Aster: saved files only` — a stale result was dropped;
- `Aster: compiler problem` — the tooltip gives the failure.

## Demo and agent

- `editors/vscode/demo/` contains:
  - `main.aster`: imports `shapes.aster`, has a shadowed local in a nested block and a non-ASCII comment with an
    astral character before the uses;
  - `shapes.aster`;
  - `shapes.broken.aster`: the same file with a type error, which you copy over `shapes.aster` to start the demo;
  - `.vscode/settings.json` with `aster.entry: "main.aster"`.
- `editors/vscode/demo/agent.mjs` is a Node script that shares no code with the adapter. It runs the workflow on a
  copy of the demo through raw `aster` JSON (check with the broken file, fix, check again, query a hover position,
  query a caret position, re-hash) and prints the facts as one JSON object.

## Tests

- `editors/vscode/test/adapter.test.cjs`, run under `node --test`, no compiler needed:
  - position mapping with a BOM, CRLF, astral characters, past the end of a line and a lone `\r`;
  - type and hover rendering;
  - diagnostic mapping;
  - a fake compiler (a Node script driven by environment variables) for a late older response, overlapping
    requests, timeout and cancellation, malformed output, a panic, an unknown command, a stale hash, and an exit
    status that doesn't match.
- `tests/vscode_adapter.test.ts` uses vitest and the stage compiler on a copy of the demo:
  - an imported diagnostic, a saved fix, hover on a use, then definition to the exact name range in the imported
    file;
  - nested shadowing resolves to the inner declaration;
  - hover after the astral comment;
  - an import edited after the response is dropped;
  - `agent.mjs` reports the same facts as the adapter.
- The existing grammar tests and the query consumer test stay as they are.
- The README gets setup, scope ("saved files, one entry point, not a language server"), the recorded manual smoke
  test and the one-shot latency measured on the demo and on the compiler's own closure.

## Packaging

The extension version becomes 0.2.0. Its id stays `aster-local.aster-syntax`, so installs upgrade in place.
`main` is `./src/extension.cjs`, and `activationEvents` is `onLanguage:aster`. `.vscodeignore` adds `src/`.
`demo/` and `test/` stay out of the VSIX. `engines.vscode` stays `^1.85.0`.

## Non-goals

LSP, completion, rename, refactoring, a compiler daemon, unsaved-buffer analysis, Marketplace publication, binary
download or install, multi-root workspaces (only the first folder is used) and a project manifest.

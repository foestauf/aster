# Aster for VS Code

Local syntax highlighting and editing basics for `.aster` files. This declarative
extension has no executable extension entry point, runtime dependencies, telemetry,
or compiler requirement. It follows Aster's [lexer](https://github.com/foestauf/aster/blob/main/packages/asterc-self/lexer.aster)
and [language reference](https://github.com/foestauf/aster/blob/main/docs/spec/language.md).

## Install

Requires VS Code 1.85 or later. Download the `.vsix`, then run **Extensions: Install
from VSIX…** in the Command Palette and select it. Alternatively, with the VS Code
CLI on your PATH:

```sh
code --install-extension /absolute/path/to/aster-syntax-0.1.0.vsix
```

Open a `.aster` file; the language mode should say **Aster**. If it has an existing
file association, use **Change Language Mode → Aster**. Colors come from your theme.
Use **Toggle Line Comment** (Cmd+/ on macOS, Ctrl+/ on Windows/Linux) for `//`
comments. Braces, square brackets, parentheses and quotes pair automatically;
angle brackets are comparison operators, not generic delimiters. Editor settings
such as `editor.autoClosingQuotes` can override pairing.

`aster-local.aster-syntax` is a local packaging identifier. No Marketplace listing
or registered publisher account is required to build or install this VSIX.
Remove it through the Extensions view, or `code --uninstall-extension aster-local.aster-syntax`.

## Highlighting boundaries

- Keywords, booleans, wildcard `_`, decimal integers, strings, ASCII character
  literals, their supported escapes, operators, punctuation and `//` comments.
- Standard TextMate scope families make the colors theme compatible. Identifiers,
  including `int`, `bool`, `string`, `void`, `never`, `Option`, `Result`, `Map` and
  `Set`, keep `variable.other.aster` in every position. They can be field names;
  this grammar does not guess types or resolve symbols.
- Only `\n`, `\t`, `\r`, `\\`, `\"`, `\'` and `\0` are valid escapes. Unknown escapes
  and malformed character bodies get `invalid.illegal` scopes. These are lexical
  hints, not compiler diagnostics. Empty or unterminated literals are not a full
  diagnostic experience; use the compiler for validation.
- Strings and characters end at a quote or line boundary, including during an
  incomplete edit. No multiline strings, block comments, hexadecimal/float
  literals, Rust lifetimes, macros or angle-bracket generics are inferred.
- This provides no language server, completion, formatting, navigation, semantic
  highlighting or compiler integration.

## Develop, test and package

From the repository root, with Node 24+ and npm:

```sh
cd editors/vscode
npm ci
npm test
npm run package
```

The output is `editors/vscode/aster-syntax-0.1.0.vsix`. Packaging runs the tests and
includes only the manifest, grammar, language configuration and this README
(plus VSIX metadata). The repository has no license file; packaging explicitly
allows that and the package is marked `UNLICENSED`. This does not grant a license
or publish anything. Build tools are development dependencies only. This editor
package has its own lockfile and does not require bootstrapping the compiler.

The tests use VS Code's `vscode-textmate` and Oniguruma engine. They assert actual
token spans/scopes for the lexer vocabulary, nested constructs, field names,
escapes, unsupported syntax and incremental/unterminated edits. They also tokenize
the checked-in compiler and test corpus, checking that no literal/comment state
leaks between lines. CI runs these tests and packages a VSIX artifact.

For a visual check without installing, start a separate Extension Development Host:

```sh
code --new-window --extensionDevelopmentPath="$PWD" test/fixtures/nested.aster
```

Check a light and dark theme, pairing, comment toggling, and **Developer: Inspect
Editor Tokens and Scopes**. Then remove the closing quote on a line: the following
line should retain its original scopes. Grammar tests exercise tokenization;
interactive editor behavior still merits this manual smoke check.

# Compiler inspection

`aster check --format=json` reports what the compiler found as one line of JSON, so that tools and agents can read
diagnostics without scraping the human format. Every diagnostic carries a stable code and a file-local range. The
schema is `aster/1`; later releases add `aster inspect` on top of the same response.

## Commands

```
aster check <file.aster> [--format=human|json]
```

- `--format=human` is the default; `aster check` without `--format` is unchanged.
- `--format` is valid only with `check`. Any other value, or `--format` with another command, is a usage error
  (exit 2, human usage text on stderr).

## The response

One response per handled run: a single line of compact JSON followed by `\n` on stdout. Stderr is empty. Keys
appear in the order shown; optional keys are omitted rather than `null` unless stated here.

| Key | Meaning |
| --- | --- |
| `schema` | Always `"aster/1"`. |
| `command` | `"check"` (or `"inspect"` later). |
| `ok` | `true` exactly when `diagnostics` is empty. |
| `files` | Every loaded file, in load order. `id` is the load index (root = 0). `path` is spelled as human diagnostics spell it (the root as given; an import's decoded literal when it is absolute, otherwise `dirname(importer) + "/" + <decoded literal>`). `bom` says whether a UTF-8 byte order mark was stripped. A file that failed to load is not listed. |
| `diagnostics` | In human order: stable by start offset, dropping a diagnostic whose start and message equal an earlier one's. |

A diagnostic is `{"code", "severity", "message", "primary", "related"}`. `code` is the contract (see the catalogue
below). `severity` is always `"error"` for now; consumers must accept other values later. `message` is the human
message verbatim and is not part of the contract. `related` is a list of `{"role", <location fields>}`; the only role
is `"import-target"`.

A worked example, an error in an imported file (the real output is a single line):

```json
{
  "schema": "aster/1",
  "command": "check",
  "ok": false,
  "files": [
    {
      "id": 0,
      "path": "main.aster",
      "bom": false
    },
    {
      "id": 1,
      "path": "./lib.aster",
      "bom": false
    }
  ],
  "diagnostics": [
    {
      "code": "type.mismatch",
      "severity": "error",
      "message": "type mismatch: expected int, found bool",
      "primary": {
        "file": 1,
        "path": "./lib.aster",
        "range": {
          "start": 25,
          "end": 29,
          "start_line": 2,
          "start_col_utf16": 12,
          "end_line": 2,
          "end_col_utf16": 16
        }
      },
      "related": []
    }
  ]
}
```

## Locations

A location is `{"file", "path", "range"}`, plus `"path_exact": false` when the path is not UTF-8 and was written
with U+FFFD for each ill-formed sequence.

- `file` is a `files` id, or `null` for a file that never loaded (a missing root, a failed import's target, a
  malformed file).
- `range` is `null` when no source position exists; otherwise
  `{"start", "end", "start_line", "start_col_utf16", "end_line", "end_col_utf16"}`.
- `start` and `end` are half-open, zero-based byte offsets into the file as stored on disk, a leading BOM included.
  `start <= end`; zero-width ranges are legal, including at end of file. `end` is clamped to the file's length.
- Lines are 1-based and only `\n` ends one (a `\r` is an ordinary character). Columns are 1-based and count UTF-16
  code units: one per UTF-8 lead byte, two for a 4-byte sequence, one for a tab. The BOM is not counted.
- A range into a malformed file is `[B, B+1)` at the first ill-formed byte.

## Failure matrix

| Case | stdout | stderr | exit |
| --- | --- | --- | --- |
| Success | response, `ok:true` | empty | 0 |
| Lexical, syntax or import errors (any file) | response; checking does not run | empty | 1 |
| Type errors | response | empty | 1 |
| Root not well-formed UTF-8 | response, `files:[]`, one `source.invalid-utf8` with `primary` = `{file:null, path:<root>, range:[B,B+1)}` | empty | 1 |
| Root unreadable or missing | response, `files:[]`, one `io.root-unreadable` with `primary` = `{file:null, path:<root>, range:null}` | empty | 2 |
| Import unreadable or missing | `import.unreadable` at the path literal; `related` = `[{role:"import-target", file:null, path:<target>, range:null}]` | empty | 1 |
| Imported file not well-formed UTF-8 | `import.invalid-utf8` at the path literal; `related` = `[{role:"import-target", file:null, path:<target>, range:[B,B+1)}]` | empty | 1 |
| Import path invalid (NUL) | `import.invalid-path` at the literal; `related:[]` | empty | 1 |
| Usage error | nothing | human usage | 2 |
| Internal compiler panic | not guaranteed | not guaranteed | 101 |

Import cycles and diamonds are not errors (each file loads once) and produce no diagnostics.

## Compatibility

- May change within `aster/1`: new keys anywhere (consumers must ignore unknown keys), new codes, new `related`
  roles, message text.
- Never changes within `aster/1`: an existing key's type or meaning, an existing code's meaning, range units. Such a
  change is `aster/2`.
- There is no request version; an unsupported `--format` is a usage error.
- File ids are deterministic for the same source snapshot and entry path. Nothing is stable across edits.

## Validation

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm selfhost` (the full proof: S0-S4 plus SL1/SL2; needs clang 18 and lld).

Last run at b46a85d (2026-10-06): pnpm test 1209/1209; pnpm selfhost PASS (S1-S3 and SL1 1037/1037 each; C fixed point e82e9635120e96e9; LLVM fixed point 3c74ad3b99e231bf).

v0.9b adds `inspect`; this section is refreshed then.

## Diagnostic codes

Every diagnostic the compiler emits carries a stable code. The message column is the human message, with placeholders in angle brackets.

| Code | Message |
| --- | --- |
| `io.root-unreadable` | cannot read '<path>' |
| `source.invalid-utf8` | invalid UTF-8 at line <L>, byte <B> |
| `lex.invalid-escape` | invalid escape sequence '<text>' |
| `lex.unterminated-string` | unterminated string literal |
| `lex.unterminated-char` | unterminated character literal |
| `lex.empty-char` | empty character literal |
| `lex.invalid-char` | character literal must be a single ASCII character |
| `lex.unexpected-character` | unexpected character '<c>' |
| `syntax.expected` | expected <what>, found <token> |
| `syntax.chained-comparison` | comparison operators cannot be chained |
| `syntax.if-without-else` | if expression requires an else branch |
| `syntax.int-out-of-range` | integer literal out of range |
| `import.invalid-path` | cannot import '<literal>': invalid path |
| `import.unreadable` | cannot import '<literal>': <reason> |
| `import.invalid-utf8` | cannot import '<literal>': invalid UTF-8 at line <L>, byte <B> |
| `decl.builtin-type-redefined` | '<name>' is a built-in type and cannot be redefined, or '<name>' is a builtin type and cannot be redefined |
| `decl.builtin-fn-redefined` | '<name>' is a builtin function and cannot be redefined |
| `decl.duplicate` | duplicate <struct\|enum\|function> '<name>' |
| `decl.kind-conflict` | '<name>' is already declared as <a struct\|an enum> |
| `decl.duplicate-field` | duplicate field '<name>' |
| `decl.duplicate-variant` | duplicate variant '<v>' in '<enum>' |
| `decl.void-field` | field cannot have type void |
| `decl.void-payload` | payload cannot have type void |
| `decl.void-param` | parameter cannot have type void |
| `decl.void-variable` | variable cannot have type void |
| `generic.duplicate-param` | duplicate type parameter '<name>' |
| `generic.param-conflict` | type parameter '<name>' conflicts with a type of the same name |
| `generic.unused-param` | type parameter '<name>' is never used |
| `generic.infinite-expansion` | generic enum '<name>' expands infinitely |
| `generic.cannot-infer` | cannot infer type arguments for '<name>' |
| `typeref.unknown` | unknown type '<name>' |
| `typeref.not-generic` | '<name>' is not generic |
| `typeref.arity` | '<name>' expects <n> type <argument\|arguments>, got <m> |
| `typeref.void-argument` | type argument cannot be void |
| `typeref.void-element` | array element type cannot be void |
| `typeref.never-position` | 'never' is only allowed as a return type |
| `typeref.map-key` | map key must be int or string, found <type> |
| `typeref.map-void-value` | map value cannot be void |
| `main.not-in-root` | 'main' must be declared in the root file |
| `main.bad-signature` | 'main' must have signature 'fn main(): int' or 'fn main(args: [string]): int' |
| `main.missing` | missing 'fn main(): int' |
| `flow.never-reaches-end` | function '<name>' returns 'never' but can reach its end |
| `flow.missing-return` | function '<name>' is missing a return on some paths |
| `flow.return-in-never` | cannot return from a function that returns 'never' |
| `flow.missing-return-value` | missing return value: expected <type> |
| `flow.void-return-value` | void function cannot return a value |
| `flow.outside-loop` | '<break\|continue>' outside of loop |
| `flow.let-else-not-diverging` | 'else' block of 'let' must diverge |
| `flow.arm-not-diverging` | match arm block must diverge |
| `name.duplicate-local` | '<name>' is already declared in this scope |
| `name.undefined` | undefined name '<name>' |
| `name.function-as-value` | '<name>' is a function, not a value |
| `name.unknown-enum` | unknown enum '<name>' |
| `name.not-an-enum` | '<name>' is not an enum |
| `name.unknown-variant` | unknown variant '<v>' on '<enum>' |
| `name.unknown-struct` | unknown struct '<name>' |
| `name.unknown-field` | unknown field '<name>' on '<type>' |
| `type.mismatch` | type mismatch: expected <type>, found <type> |
| `type.condition` | condition must be bool, found <type> |
| `type.not-iterable` | cannot iterate over a value of type <type> |
| `type.range-bound` | range bound must be int, found <type> |
| `type.unary-operand` | operator '<op>' cannot be applied to <type> |
| `type.binary-operands` | operator '<op>' cannot be applied to <type> and <type> |
| `type.not-comparable` | cannot compare '<type>' values |
| `type.if-branches` | if branches have different types: <type> and <type> |
| `type.void-if` | if expression cannot have type void |
| `type.index` | array index must be int, found <type> |
| `type.not-indexable` | cannot index a value of type <type> |
| `type.missing-field` | missing field '<name>' in '<struct>' |
| `type.duplicate-field-init` | duplicate field '<name>' |
| `type.empty-array` | cannot infer type of empty array |
| `type.void-element` | array element cannot have type void |
| `type.empty-map` | cannot infer type of empty map or set |
| `type.empty-map-mismatch` | type mismatch: expected <type>, found empty map or set |
| `type.variant-arity` | variant '<enum>::<v>' expects <n> <value\|values>, got <m> |
| `try.operand` | '?' applies to Option or Result, not '<type>' |
| `try.return-type` | '?' needs the function to return <kind>, but it returns '<type>' |
| `try.error-type` | '?' error type '<a>' does not match the function's error type '<b>' |
| `match.scrutinee` | cannot match on '<type>' values |
| `match.unreachable-arm` | unreachable match arm |
| `match.irrefutable` | pattern always matches |
| `match.non-exhaustive` | non-exhaustive match: add a '_' arm, or non-exhaustive match: missing <list> |
| `match.arm-types` | match arms have different types: <type> and <type> |
| `match.void` | match expression cannot have type void |
| `pattern.type` | pattern type '<a>' does not match '<b>' |
| `pattern.duplicate-alternative` | duplicate pattern alternative |
| `pattern.or-binding` | or-pattern alternatives cannot bind names |
| `pattern.duplicate-binding` | duplicate binding '<name>' |
| `assign.immutable` | cannot assign to immutable variable '<name>' |
| `assign.function` | cannot assign to function '<name>' |
| `assign.invalid-target` | invalid assignment target |
| `call.not-named` | only named functions can be called |
| `call.not-function` | '<name>' is not a function |
| `call.undefined` | undefined function '<name>' |
| `call.arity` | function '<name>' expects <n> <argument\|arguments>, found <m> |
| `call.print-type` | cannot print a value of type <type> |
| `call.argument-type` | function '<name>' expects <what>, found <type> |

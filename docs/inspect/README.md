# Compiler inspection

`aster check --format=json` reports what the compiler found as one line of JSON, so that tools and agents can read
diagnostics without scraping the human format. Every diagnostic carries a stable code and a file-local range. The
schema is `aster/1`. `aster inspect` adds the program's declarations, linked to their source, on top of the same
response.

## Commands

```
aster check <file.aster> [--format=human|json]
aster inspect <file.aster>
aster query <file.aster> --file=<path> (--offset=<byte> | --caret=<byte>)
```

- `--format=human` is the default; `aster check` without `--format` is unchanged.
- `--format` is valid only with `check`. Any other value, or `--format` with another command, is a usage error
  (exit 2, human usage text on stderr).
- `inspect` always answers in JSON: the `check --format=json` response with `command:"inspect"` and a `semantics`
  key (below). It takes no options; its exit status follows the failure matrix.
- `query` always answers in JSON: the `inspect` response with `command:"query"`, a `sha256` per file and a `query`
  key (see [Position queries](#position-queries)). `--file` and exactly one of `--offset` and `--caret` are required.

## The response

One response per handled run: a single line of compact JSON followed by `\n` on stdout. Stderr is empty. Keys
appear in the order shown; optional keys are omitted rather than `null` unless stated here.

| Key | Meaning |
| --- | --- |
| `schema` | Always `"aster/1"`. |
| `command` | `"check"`, `"inspect"` or `"query"` (see [Position queries](#position-queries)). |
| `ok` | `true` exactly when `diagnostics` is empty. |
| `files` | Every loaded file, in load order. `id` is the load index (root = 0). `path` is spelled as human diagnostics spell it (the root as given; an import's decoded literal when it is absolute, otherwise `dirname(importer) + "/" + <decoded literal>`). `bom` says whether a UTF-8 byte order mark was stripped. A file that failed to load is not listed. |
| `diagnostics` | In human order: stable by start offset, dropping a diagnostic whose start and message equal an earlier one's. |
| `semantics` | `inspect` only: the declarations (see [Declarations](#declarations-inspect)). |

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

## Declarations (inspect)

`semantics` is available only when the program loaded and checked without diagnostics:

```json
"semantics":{"available":true,"declarations":[ ... ]}
"semantics":{"available":false,"reason":"diagnostics"}
"semantics":{"available":false,"reason":"io"}
```

`reason` is `"io"` when the root could not be read, otherwise `"diagnostics"` (any lexical, syntax, import, UTF-8 or
type error). An unavailable `semantics` has no `declarations` key: a partially checked program is never exposed.

`declarations` lists every named thing in the entry point's closure. Each declaration has `id`, `kind`, `name`,
`origin`, `location` and `decl_range`, in that order, then its kind's extra keys in the order given here:

| `kind` | What | Extra keys |
| --- | --- | --- |
| `fn` | a function | `signature` |
| `param` | a function parameter | `type`, `scope` |
| `local` | `let`/`var`, a `for` variable, a `let … else`, `if let` or `match` binder | `type`, `mutable`, `scope`, `shadows` |
| `struct` | a struct | none |
| `field` | a struct field | `type`, `parent` |
| `enum` | an enum, generic or not, or an instantiation of a generic one | `type_params` (generic), or `of`, `args` (instantiation) |
| `variant` | a variant of an enum or of an instantiation | `payload`, `parent` |
| `type-param` | a generic enum's type parameter | `parent` |
| `builtin-fn` | a builtin function | `signature`, `null` for the builtins the checker types by hand (`print`, `eprint`, `len`, `push`, `pop`, the map and set builtins, `read_file`, `write_file`, `make_temp_dir`, `remove_path`, `run_process`) |
| `builtin-type` | `int`, `bool`, `string`, `void`, `never`, `Map`, `Set` | none |

- `origin` is `"source"`, `"prelude"` (`Option`, `Result`, their type parameters and variants), `"instantiation"`
  (a generic enum at concrete type arguments, such as `Option[int]`, and its variants) or `"builtin"`.
- `location` is a location (see [Locations](#locations)) whose range is the declared **name**. `decl_range` is the
  whole declaration's range in the same file: the item for a function, struct or enum; the name through the type for
  a param or field; the name through the last payload type for a variant; the statement for `let`/`var`; the name for
  a `for` variable or a pattern binder; the name for a type parameter. Both are `null` unless `origin` is `"source"`.
- `scope` is the id of the enclosing `fn`. `shadows` is the id of the param or local that this one hides (the binding
  its name resolved to just before it was declared), or `null`. Redeclaring a name in the same scope is an error, so
  the hidden binding is always in an outer scope.
- `parent` is the id of the owning struct or enum. `type_params` are the ids of the generic enum's `type-param`
  declarations. `of` is the id of an instantiation's generic enum and `args` its type arguments.
- `mutable` is `true` for `var`.

### Types

```
{"kind":"int"} {"kind":"bool"} {"kind":"string"} {"kind":"void"} {"kind":"never"}
{"kind":"array","element":T}
{"kind":"map","key":T,"value":T}
{"kind":"set","element":T}
{"kind":"struct","name":"Point","decl":3}
{"kind":"enum","name":"Shape","decl":7}
{"kind":"enum","name":"Option[int]","decl":41,"args":[T...]}
{"kind":"param","name":"T"}
```

- `decl` is the id of the struct, enum or instantiation; `args` appears only on an instantiation. `name` is the
  display spelling, for humans; consumers follow `decl`.
- Inside a generic enum's own variants, a type parameter is `{"kind":"param","name":…}`, and a generic enum written
  with arguments (`Option[T]`) has the **generic** enum's `decl`. Nowhere else does `param` appear.
- A `signature` is `{"params":[{"name","type","decl"}…],"ret":T}`, where `decl` is the param's id. A builtin's params
  have `"name":null` and `"decl":null`.
- A `payload` is a list of types.

### Ids and order

A declaration's `id` is its index in `declarations`. The order is: source declarations by position (files in load
order, then by offset, each declaration before its children: a function before its params and locals, a struct
before its fields, an enum before its type parameters and variants), then the prelude (`Option`, `Result`), then
instantiations in order of first use, then builtins sorted by name in byte order. Every `scope`, `shadows`,
`parent`, `of`, `type_params` and `decl` refers to an id in the same response. Ids are deterministic for the same
source snapshot and entry path, and nothing more: they change with any edit.

An excerpt of `inspect main.aster` on a root that imports `lib.aster` (`fn twice(n: int): int { return n * 2; }`),
pretty-printed, ranges elided:

```json
"semantics": {
  "available": true,
  "declarations": [
    {"id": 0, "kind": "fn", "name": "main", "origin": "source", "location": {"file": 0, "path": "main.aster", "range": {…}},
     "decl_range": {…}, "signature": {"params": [], "ret": {"kind": "int"}}},
    {"id": 1, "kind": "fn", "name": "twice", "origin": "source", "location": {"file": 1, "path": "./lib.aster", "range": {…}},
     "decl_range": {…}, "signature": {"params": [{"name": "n", "type": {"kind": "int"}, "decl": 2}], "ret": {"kind": "int"}}},
    {"id": 2, "kind": "param", "name": "n", "origin": "source", "location": {"file": 1, "path": "./lib.aster", "range": {…}},
     "decl_range": {…}, "type": {"kind": "int"}, "scope": 1},
    {"id": 3, "kind": "enum", "name": "Option", "origin": "prelude", "location": null, "decl_range": null, "type_params": [4]},
    …
  ]
}
```

The full response is tests/golden/json/inspect-imports.txt.

## Position queries

`aster query` answers what the source at one saved byte position means: an expression's type, a callable's
signature, and the declaration a supported use refers to. The answer comes from the compiler's own checking, never
from a guess at text. It is one request per process, for one entry point's saved import closure, and only a program
that checked without diagnostics has an answer.

The response is the `inspect` response with three differences: `command` is `"query"`; each `files` entry has a
fourth key, `sha256` (the lowercase hex SHA-256 of that file's bytes exactly as read from disk, BOM included; key
order `id`, `path`, `bom`, `sha256`); and a `query` key follows `semantics`. `semantics` is the same declarations
list `aster inspect` prints for the same entry and bytes, and every id a query result mentions indexes it. The full
design, with the complete selection tables, is
[the contract](../superpowers/specs/2026-10-07-aster-source-query-contract-design.md).

- `--file` is required. Exactly one of `--offset` and `--caret` is required. Each may appear once, before or after
  the entry. The position is canonical decimal (`0` or a non-zero digit followed by digits) and at most 2^63-1.
- A missing or repeated flag, both `--offset` and `--caret`, an empty `--file=`, a negative, signed, non-decimal or
  leading-zero position, a position that does not fit, `--format` and any other option are usage errors (exit 2,
  nothing on stdout).
- `--file` and each `files` path are compared after lexical normalisation. Symlinks are not resolved, so query with
  the spelling the response's `files` use.

### The `query` object

Keys appear in this order and are omitted when not listed for a status.

| Key | Meaning |
| --- | --- |
| `request` | `{"path", "mode", "offset", "file"}`. `path` is `--file` as given. `mode` is `"pointer"` for `--offset` and `"caret"` for `--caret`. `file` is the matched `files` id, or `null` when the program is unavailable or the file is not in the closure. |
| `status` | `found`, `none`, `unsupported`, `invalid` or `unavailable`. Consumers must tolerate statuses added later. |
| `reason` | `invalid` and `unavailable` only. |
| `site` | `found` and `unsupported`: what was selected. |
| `location` | `found` and `unsupported`: a location for the selected site's **extent**. Its `path` is the `files` entry's path. |
| `type` | `found`, when the site has a value type: a structured type. |
| `signature` | `found`, when the site is a callable or declares one: a signature, or `null` for a hand-typed builtin. |
| `target` | `found`, when the site refers to a declaration: its id in `semantics.declarations`. |

A consumer locates a target's source through `declarations[target].location`. For a builtin, prelude or
instantiation target that is `null`, exactly as in `inspect`, and the target is not navigable.

### Statuses and exit codes

Statuses are evaluated in this order; the first that applies wins.

| `status` | When | `reason` | Exit |
| --- | --- | --- | --- |
| `unavailable` | `semantics.available` is `false`: any lexical, syntax, import, UTF-8 or type error in any file, or an unreadable root | `semantics.reason`: `diagnostics` or `io` | 1 for `diagnostics`, 2 for `io` |
| `invalid` | the program checked, but `--file` is not a loaded file | `file-not-in-closure` | 2 |
| `invalid` | the position is greater than the file's size in bytes | `offset-out-of-range` | 2 |
| `invalid` | the position is below the size and its byte is a UTF-8 continuation byte (`0x80`-`0xBF`), including bytes 1 and 2 of a BOM | `offset-not-boundary` | 2 |
| `none` | a valid position where selection finds no site, including a pointer at the end of the file | none | 0 |
| `unsupported` | the innermost site is one this version does not answer | none | 0 |
| `found` | the innermost site is answerable | none | 0 |

An unavailable program never reports a position result, even for a position that would be valid, and its
`request.file` is `null`. Exit 0 means "here is the answer", including "there is nothing here". Stderr is empty for
every JSON response.

### Selection

`--offset=b` is pointer mode: it selects the code point that starts at byte `b`, the character a pointer is over
(use it for hover). Offsets are file-local bytes into the file as stored on disk, a leading BOM counted, and ranges
use the units of [Locations](#locations).

Every site has a span (its exact token or expression range) and an **extent**: the span widened to cover any
parentheses that enclose the site or any site inside it. Parentheses are not sites, so every byte of `(n + 1)`,
parentheses included, belongs to the extent of the `n + 1` expression. `location.range` is the extent. The selected
site is the one with the smallest extent containing `b`; when two extents are equal, the one nested deeper in the
source wins. A byte in no extent gives `none`: whitespace (CRLF needs no special rule), comments, statement keywords
(`let`, `var`, `if` as a statement, `while`, `for`, `return`, `break`, `continue`, `import`), statement and block
punctuation, item keywords, and the first byte of a BOM. An operator, `.`, `?`, `::` or a struct literal's braces
select the innermost expression containing them.

**Caret mode.** `--caret=b` names the gap between bytes `b-1` and `b`, so a caret just after a name still finds it
(use it for go-to-definition). It runs at most two pointer selections:

1. If `b` is below the size, select at `b`. If that site is a name site, it is the answer.
2. Otherwise, if `b` is above 0, select at the code point that ends at `b`. If that site is a name site, it is the
   answer.
3. Otherwise the answer is step 1's result, or `none` when `b` equals the size.

The name sites are `declaration`, `local`, `callee` and `field`, plus the unsupported `variant-name`,
`struct-literal-name` and `field-init-name`. A caret touching only operators, punctuation or whitespace gets the
pointer answer at `b`. The `invalid` checks are the same in both modes.

### Sites

`found` sites:

| `site` | Span | `type` | `signature` | `target` |
| --- | --- | --- | --- | --- |
| `declaration` | the declared name, as `inspect`'s `location` (source declarations only) | the declaration's `type`, for a param, local or field | the declaration's `signature`, for a fn | the declaration itself |
| `local` | a name that resolves to a param or local | the binding's type | none | the param or local |
| `callee` | the function name in a call | none | the callee's signature (`null` for a hand-typed builtin) | the `fn` or `builtin-fn` |
| `field` | the field name in `e.f`, on either side of an assignment | the field's type | none | the struct's `field` |
| `expression` | any other source expression | its checked type | none | none |

- A callee is not an expression. A function name is not a value in Aster, so a callee has no `type`. Its call is an
  `expression` whose type is the return type; the call's parentheses and commas select the call.
- Expression types use the structured type representation: `{}` and `[]` get their contextual type, a generic enum
  value its instantiation (`Option[int]`), a diverging expression `never`, `e?` the unwrapped payload type, an enum
  comparison `bool`, and `if` and `match` their unified type.
- Only source nodes are sites. Synthetic nodes are never selected.
- A struct, enum, variant or type-param `declaration` has neither `type` nor `signature`.

`unsupported` sites carry a `site` and a `location` but no `type`, `signature` or `target`, so no navigation target is
invented for them:

| `site` | Span |
| --- | --- |
| `type-annotation` | a whole written type, `Map[string, int]` included, wherever a type is written |
| `variant-name` | the enum name or the variant name token in `Enum::Variant(...)` |
| `struct-literal-name` | the struct name in a struct literal |
| `field-init-name` | a field name inside a struct literal |
| `pattern` | a `match`, `if let` or `let ... else` pattern, apart from its binder names, which are `declaration` sites |
| `import-path` | the path literal of an `import` |

### Expression coverage

Every expression form the checker produces is a `found` `expression` site typed by the checker, unless a more
specific site sits inside it. `target` is absent unless the table says otherwise.

| Form | Selected by | Site | `type` | `target` |
| --- | --- | --- | --- | --- |
| `Int` | the literal | `expression` | `int` | none |
| `Char` | the literal | `expression` | `int` | none |
| `Str` | the literal | `expression` | `string` | none |
| `Bool` | `true`, `false` | `expression` | `bool` | none |
| `Name` | the name | `local` (param or local) | the binding's type | the param or local |
| `Unary` | the operator or its bytes outside the operand | `expression` | the result (`int` for `-`, `bool` for `!`) | none |
| `Binary` | the operator | `expression` | the result (`bool` for comparisons) | none |
| `Call` | `(`, `)` and commas | `expression` | the return type (`never` for `panic`, `void` for `print`) | none |
| `Call` | the function name | `callee` | none (`signature` instead) | the `fn` or `builtin-fn` |
| `If` | `if` in expression position, braces, `else` | `expression` | the unified branch type | none |
| `Field` | `.` | `expression` | the field's type | none |
| `Field` | the field name | `field` | the field's type | the struct's `field` |
| `StructLit` | the braces and separators | `expression` | the struct | none |
| `Index` | `[`, `]` | `expression` | the element type | none |
| `Try` | `?` | `expression` | the unwrapped payload type | none |
| `ArrayLit` | `[`, `]`, commas | `expression` | the array type, with its contextual element type when empty | none |
| `Variant` | `::`, `(`, `)` | `expression` | the enum, instantiated when generic (`Option[int]`) | none |
| `Match` | `match`, braces, `=>` | `expression` | the unified arm type | none |
| `EmptyMap` | `{}` | `expression` | the contextual `Map` or `Set` type | none |
| Assignment place | the root name of `p.x = ...` or `xs[0] = ...` | `local` | the binding's type | the local |
| Assignment place | the field name of `p.x = ...` | `field` | the field's type | the struct's `field` |
| Assignment place | `[` and `]` of `xs[0] = ...` | `expression` | the element type | none |

The `variant-name` positions of a `Variant`, the `type-annotation` of a `let`, the `pattern` of a `match` arm and the
`import-path` of an `import` are `unsupported`, as listed above.

### Freshness

The compiler reads each file once, so the program it checked is exactly the set of byte strings whose digests it
reports. A client accepts a response only if, after receiving it, every `files` entry's current bytes hash to the
reported `sha256`. For the displayed document, that means the bytes the editor shows, encoded as they would be saved;
a dirty buffer is a mismatch and gets no semantic answer.

- An edit to any file in the closure is caught, including a file that changes and changes back (equal digests mean
  equal bytes). Adding an import requires editing a listed file, so a changed closure is caught too.
- It is not an atomic snapshot: a client that sees a mismatch re-queries. A path that now resolves elsewhere through a
  swapped symlink but with the same bytes is not detected.
- Modification times are not part of the contract, and unsaved overlays are out of scope.

### Example

`main.aster` imports `lib.aster`; offset 96 is the `t` of `twice` in `let n: int = twice(p.x);`. The command is
`aster query main.aster --file=main.aster --offset=96`, which exits 0. `semantics` is elided here; `files` is
shortened to the keys that matter.

```json
{
  "schema": "aster/1",
  "command": "query",
  "ok": true,
  "files": [
    {"id": 0, "path": "main.aster", "bom": false, "sha256": "606515c73aa5ccf446da75fdc73a68a0933d4dbfae49b67c0e692616e2d86ff9"},
    {"id": 1, "path": "./lib.aster", "bom": false, "sha256": "316bc697aa723515f5349a25f204c5858eaedb81e52eb52b8dcaec23964e7808"}
  ],
  "diagnostics": [],
  "semantics": {"available": true, "declarations": [ ... ]},
  "query": {
    "request": {"path": "main.aster", "mode": "pointer", "offset": 96, "file": 0},
    "status": "found",
    "site": "callee",
    "location": {"file": 0, "path": "main.aster", "range": {"start": 96, "end": 101, "start_line": 5, "start_col_utf16": 18, "end_line": 5, "end_col_utf16": 23}},
    "signature": {"params": [{"name": "n", "type": {"kind": "int"}, "decl": 11}], "ret": {"kind": "int"}},
    "target": 10
  }
}
```

`declarations[10]` is `twice`, whose `location` is `{"file": 1, "path": "./lib.aster", "range": {"start": 36, "end": 41, ...}}`.
Slicing bytes 36-41 of `lib.aster` gives `twice`. The same answer comes from `--caret=101`, the gap between
`twice` and `(`. The full response is `tests/golden/json/query-callee-import.txt`.

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
| Usage error (including a bad `query` flag or position) | nothing | human usage | 2 |
| Query: program has diagnostics | response; `semantics.available:false`, `query.status:"unavailable"`, `reason:"diagnostics"`, `request.file:null` | empty | 1 |
| Query: root unreadable or missing | response; `query.status:"unavailable"`, `reason:"io"` | empty | 2 |
| Query: `--file` not in the closure | response; `query.status:"invalid"`, `reason:"file-not-in-closure"` | empty | 2 |
| Query: position past the end of the file | response; `query.status:"invalid"`, `reason:"offset-out-of-range"` | empty | 2 |
| Query: position inside a UTF-8 sequence or BOM | response; `query.status:"invalid"`, `reason:"offset-not-boundary"` | empty | 2 |
| Query: nothing at the position, or an unsupported site | response; `query.status:"none"` or `"unsupported"` | empty | 0 |
| Internal compiler panic | not guaranteed | not guaranteed | 101 |

Import cycles and diamonds are not errors (each file loads once) and produce no diagnostics.

## Compatibility

- May change within `aster/1`: new keys anywhere, new codes, new declaration kinds, new type kinds, new `related` roles,
  new `semantics.reason` values, and message text. Consumers must ignore unknown keys and tolerate unknown kinds and
  reasons.
- Never changes within `aster/1`: an existing key's type or meaning, an existing code's meaning, and range units. Such a
  change is `aster/2`.
- There is no request version; an unsupported `--format` is a usage error.
- Additive in `aster/1` for queries: `command:"query"`, `sha256` on each `files` entry in `query` responses only, and the
  trailing `query` key. `check --format=json` and `inspect` output is byte-identical. A new `query` status, `reason`,
  `site` kind or `found` key is additive, and so is turning an `unsupported` site into `found` with a `target`;
  consumers tolerate unknown values. Changing the selection rule or the offset units would be `aster/2`.
- The same argv, working directory and file bytes give a byte-identical response.
- File and declaration ids are deterministic for the same source snapshot, entry path and schema, and are not stable
  across edits.

## Validation

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm selfhost` (the full proof: S0-S4 plus SL1/SL2; needs clang 18 and lld).

Last run on 2026-10-08, on the tree that adds the declaration-site check to `inspect.aster` (on top of e0dcf64), on a machine without clang or lld:

- `pnpm lint` and `pnpm typecheck`: clean.
- `pnpm test`: 1222 of 1361 tests pass; the 139 failures are all `tests/llvm_backend.test.ts` (`spawnSync clang ENOENT`).
  `json_query` (104 of 104) and `query_consumer` (5 of 5) pass.
- Parity with the pre-change compiler: baseline compilers built from bc7a57a (main before this work) and from this
  branch's source each ran `check`, `check --format=json`, `inspect` and `build --emit=c` (from the repo root, stdout,
  stderr and exit code compared) on every `.aster` file that `git ls-files '*.aster'` lists: 1044 comparisons, 0 differences.
  The same run between e0dcf64 and the tree with the declaration-site check also gave 0 differences, and that check never
  fired.
- `pnpm selfhost --suite=S1 --suite=S2 --suite=S3`: did not run. The environment check needs clang and lld and stopped
  with `spawnSync clang ENOENT`. The stage-aware suites ran against S1 inside `pnpm test`. The S2/S3 fixed points, the
  SL1 suites and the full proof are left to CI's `proof` jobs.

## Measurements

Median of three runs, `/usr/bin/time -f '%e s %M KB'`, Linux x86_64, on the compiler (`asterc.aster`, 18 files).
Both compilers were built from source with `build/asterc build`: bc7a57a is main before this work, HEAD is this branch.
The `query` line asks for `--file=checker.aster --offset=1000`.

| Command on `asterc.aster` | bc7a57a | HEAD |
| --- | --- | --- |
| `check` | 0.13 s, 204 MB | 0.15 s, 215 MB |
| `inspect` | 0.20 s, 309 MB | 0.24 s, 334 MB |
| `build --emit=c` | 0.31 s, 446 MB | 0.28 s, 457 MB |
| `query` | n/a | 0.34 s, 337 MB |

Other `query` runs (HEAD, measured earlier on the same source; `inspect` is the matching run):

| Program | `inspect` | `query` |
| --- | --- | --- |
| Small fixture (`main.aster` + `lib.aster`, 402 bytes) | 0.00 s, 2.7 MB | 0.00 s, 3.7 MB |
| Generated 500 KB file (about 5,000 small functions; query at offset 499980) | 0.76 s, 866 MB | 0.84 s, 895 MB |

A query costs at most 1.4 times the matching `inspect` here, so the SHA-256 digests and the position pass are a small
share of the run.

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

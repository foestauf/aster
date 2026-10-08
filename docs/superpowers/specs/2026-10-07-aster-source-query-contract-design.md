# Aster saved-source position query contract (#57)

**Status:** design gate for the provisional v0.10 milestone. It records the contract that #58 (checked provenance),
#59 (the `aster query` command) and #60 (the editor demonstration) implement. Nothing here is shipped. When #59 lands,
the user-facing parts move into `docs/inspect/README.md` next to the v0.9 contract, which they extend.

## Goal

A person or an agent can ask what the source at one saved byte position means: an expression's type, a callable's
signature, and the declaration a supported use refers to. The answer comes from the compiler's own checking and is
never a guess from text. It also carries enough evidence for the client to tell whether the bytes it is showing are
the bytes the answer describes.

## Decisions

| Question | Decision |
| --- | --- |
| Spelling | A new command, `aster query <entry.aster> --file=<path> (--offset=<byte> \| --caret=<byte>)`. `inspect` is unchanged. |
| Schema | Additive within `aster/1`: `command:"query"`, a `sha256` key on each `files` entry in query responses, and a trailing `query` key. No existing key changes type or meaning. |
| Declarations | The response embeds the full `inspect` `semantics`. Every id a query result mentions is an index into that same `declarations` list. |
| File identity | The loader's own key: `--file` and each loaded file's `path` are compared after lexical normalisation. |
| Position | One file-local byte offset into the file as stored on disk, with a leading BOM counted, as in v0.9 ranges. No line/column input. `--offset` names the character at that byte (pointer, for hover); `--caret` names the gap before it and falls back to a name just left of the gap (caret, for go-to-definition). |
| Freshness | `files[].sha256` holds the SHA-256 of the exact bytes the compiler read. The client re-hashes and discards on any mismatch. The digest is implemented in Aster, with no new builtin or operator. |
| Scope | One entry point's saved import closure, one request per process, successfully checked programs only. |

Approaches considered and rejected:
- A referenced-subset declaration map would make responses smaller, but it adds a second declaration container with its own id rules.
- Inlined targets without ids would break v0.9's rule that consumers follow `decl` ids, not display names.
- `inspect --at=` would give an option-free command options and needs a path separator.
- A runtime `sha256` builtin would be new language surface.
- A 64-bit polynomial hash has known structured collisions and needs a custom implementation in every consumer.
- Leaving caret handling to the client would cost a second compiler run per lookup, and the client would have to guess
  name boundaries from text. Making every query caret-shaped would break hover, where pointing at `(` must give the call.

## The command

```
aster query <entry.aster> --file=<path> --offset=<byte>
aster query <entry.aster> --file=<path> --caret=<byte>
```

- `--file` is required. Exactly one of `--offset` and `--caret` is required. Each may appear once, before or after the
  entry.
- The position is canonical decimal (`0` or a non-zero digit followed by digits) and at most 2^63-1.
- The usage line `aster query <file.aster> --file=<path> (--offset=<byte> | --caret=<byte>)` joins `usage_text()`.
- These are **usage errors**, with exit 2, human usage text on stderr and nothing on stdout, as in v0.9:
  - a missing or repeated flag, or both `--offset` and `--caret`
  - an empty `--file=`
  - a negative, signed, non-decimal or leading-zero offset
  - an offset that does not fit
  - `--format` given with `query`
  - any other option
- `query` always answers in JSON. It takes no other options.

## The response

The `query` response is the `inspect` response with three differences:

1. `command` is `"query"`.
2. Each `files` entry has a fourth key, `sha256`: the lowercase hex SHA-256 of that file's bytes exactly as read from disk, BOM included. The key order is `id`, `path`, `bom`, `sha256`.
3. A `query` key follows `semantics`.

Everything else, including `ok`, `diagnostics`, `semantics`, ids, ranges and types, means exactly what
`docs/inspect/README.md` says. When `semantics` is available, it is the same declarations list that `aster inspect`
on the same entry and bytes would print. `query` never changes declaration ids.

### The `query` object

Keys appear in this order and are omitted when not listed for a status.

| Key | Meaning |
| --- | --- |
| `request` | `{"path", "mode", "offset", "file"}`. `path` is `--file` as given. `mode` is `"pointer"` for `--offset` and `"caret"` for `--caret`, and `offset` is the number given to either. `file` is the matched `files` id, or `null` when the program is unavailable or the file is not in the closure. |
| `status` | One of `found`, `none`, `unsupported`, `invalid` or `unavailable`. Consumers must tolerate statuses added later. |
| `reason` | For `invalid` and `unavailable` only (see [Statuses](#statuses)). |
| `site` | For `found` and `unsupported`: what was selected (see [Sites](#sites)). |
| `location` | For `found` and `unsupported`: a v0.9 location `{"file", "path", "range"}` for the selected site's **extent** (see [Selection](#selection)). It always has a range, and `path` is the `files` entry's path, not `request.path`. |
| `type` | For `found`, when the site has a value type: a v0.9 structured type. |
| `signature` | For `found`, when the site is a callable or declares one: a v0.9 signature, or `null` for a hand-typed builtin. The key is present with `null` in that case, as in `inspect`. |
| `target` | For `found`, when the site refers to a declaration: that declaration's id in `semantics.declarations`. |

`type`, `signature` and `target` follow the order shown. A consumer locates a target's source through
`declarations[target].location`. For a builtin, prelude or instantiation target, that is `null`, exactly as in
`inspect`, and the target is not navigable.

### Statuses

Statuses are evaluated in this order, and the first that applies wins.

| `status` | When | `reason` | Exit |
| --- | --- | --- | --- |
| `unavailable` | `semantics.available` is `false`, for any lexical, syntax, import, UTF-8 or type error in any file, or an unreadable root | same as `semantics.reason`: `"diagnostics"` or `"io"` | 1 for `diagnostics`, 2 for `io` |
| `invalid` | the program checked, but `--file` is not a loaded file | `"file-not-in-closure"` | 2 |
| `invalid` | `offset` > the file's size in bytes | `"offset-out-of-range"` | 2 |
| `invalid` | `offset` < size and the byte there is a UTF-8 continuation byte (`0x80`-`0xBF`), including bytes 1 and 2 of a BOM | `"offset-not-boundary"` | 2 |
| `none` | a valid position where selection finds no site, including a pointer at `offset` = size (end of file) | — | 0 |
| `unsupported` | the innermost site is one this version does not answer | — | 0 |
| `found` | the innermost site is answerable | — | 0 |

- An unavailable program never reports a position result, even for a file and offset that would be valid: there is no
  trustworthy closure to validate against, and no partial typed tree is exposed. `request.file` is `null`.
- The `invalid` checks are the same in both modes. A caret at `offset` = size is valid and still looks left.
- `invalid` is a well-formed request about the wrong place, so it is a JSON response rather than a usage error.
- Exit 0 means "here is the answer", including "there is nothing here". Stderr is empty in every JSON case. An internal
  compiler panic keeps v0.9's 101, with no guaranteed output.

### Selection

With `--offset=b` (pointer mode), the query selects the code point that starts at byte `b`: the character a pointer
is over. `--caret=b` names the gap between bytes `b-1` and `b`; see [Caret mode](#caret-mode).

Every **site** has a source span, its exact token or expression range, and an **extent**:

- The extent is the span, widened to cover any parentheses that enclose the site or any site inside it.
- `(n + len(s)) * 2` has a `*` expression whose span starts at `n`. Its extent starts at `(`, so every byte from `(` to `2` belongs to it.
- Parentheses are not sites themselves. The bytes of `(` and `)` belong to the extent of the site they enclose, so `((n))` selects the use of `n` from any of its five bytes.
- Diagnostic ranges are unaffected: extents exist only for queries.

The selected site is the site with the **smallest extent containing `b`**. When two sites have equal extents, the
one nested deeper in the source tree wins. Extents nest, so this is the innermost site. A byte in no extent gives
`none`. That covers whitespace (`\r` is ordinary whitespace, so CRLF needs no special rule), comments, statement
keywords (`let`, `var`, `if` as a statement, `while`, `for`, `return`, `break`, `continue`, `import`), statement and
block punctuation, item keywords, and the first byte of a BOM.

`location.range` is the selected site's extent.

#### Caret mode

Editors place a caret between characters, and a caret just after a name should still find that name, as it does in
most editors. With `--caret=b`, selection runs at most two pointer selections, in this order:

1. If `b` < size, select at `b` (the character after the caret). If the selected site is a **name site**, that is the answer.
2. Otherwise, if `b` > 0, select at the code point that ends at byte `b` (the character before the caret). If the
   selected site is a name site, that is the answer.
3. Otherwise the answer is step 1's result, or `none` when `b` = size.

The **name sites** are `declaration`, `local`, `callee` and `field`, plus the unsupported `variant-name`,
`struct-literal-name` and `field-init-name`. So a caret anywhere on a name, or right after it, finds the name. A
caret touching only operators, punctuation or whitespace gets the same answer as a pointer at `b`. A caret at a
boundary between two names (impossible in Aster's grammar without punctuation between them) prefers the right-hand
one. `location.range` is the chosen site's extent, as in pointer mode.

Hover sends the hovered character as `--offset`. Go-to-definition and any other caret-driven request send
`--caret`. #60's adapter follows this split.

### Sites

`found` sites:

| `site` | Span | `type` | `signature` | `target` |
| --- | --- | --- | --- | --- |
| `declaration` | the declared name, as `inspect`'s `location` (source declarations only) | the declaration's `type`, for a param, local or field | the declaration's `signature`, for a fn | the declaration itself |
| `local` | a name that resolves to a param or local | the binding's type | — | the param or local |
| `callee` | the function name in a call | — | the callee's signature (`null` for a hand-typed builtin) | the `fn` or `builtin-fn` |
| `field` | the field name in a field access `e.f`, on either side of an assignment | the field's type | — | the struct's `field` |
| `expression` | any other source expression | its checked type | — | — |

- **A callee is not an expression.** A function name is not a value in Aster, so a callee has no `type`, and the
  contract never invents a function type. Its call is an `expression` whose type is the return type. The call's
  parentheses and commas select the call.
- **Expression types** are the checked result type in the v0.9 type representation:
  - an empty `{}` or `[]` gets its contextual type
  - a generic enum value gets its instantiation (`{"kind":"enum","name":"Option[int]","decl":…,"args":[…]}`)
  - a diverging expression gets `never`
  - `e?` gets the unwrapped payload type
  - a comparison of enums is still the source `==`, typed `bool`
  - `if` and `match` expressions get their unified type
- An operator, `.`, `?`, `::` or a struct literal's braces select the innermost expression containing them.
- Only source nodes are sites. Desugared or synthetic nodes the checker or lowering creates are never selected and
  never give a range.
- A `declaration` result covers every source declaration kind `inspect` lists: fn, param, local (including `for`
  variables and pattern binders), struct, field, enum, variant and type-param. A struct, enum, variant or type-param
  declaration has neither `type` nor `signature`.

`unsupported` sites (no `type`, `signature` or `target`), reserved for later navigation work:

| `site` | Span |
| --- | --- |
| `type-annotation` | a whole written type, `Map[string, int]` included, wherever a type is written |
| `variant-name` | the enum name or the variant name token in `Enum::Variant(…)` (an expression); `::` between them selects the expression |
| `struct-literal-name` | the struct name in a struct literal |
| `field-init-name` | a field name inside a struct literal |
| `pattern` | a `match`, `if let` or `let … else` pattern, apart from its binder names, which are `declaration` sites |
| `import-path` | the path literal of an `import` |

## Freshness

The compiler reads each file once, so the program it checked is exactly the set of byte strings whose digests it
reports. A client accepts a response only if, **after** receiving it, every `files` entry's current bytes hash to the
reported `sha256`. For the displayed document, that means the bytes the editor shows, encoded as they would be saved;
for every other file, the bytes on disk. A dirty buffer is a mismatch and gets no semantic answer.

- This catches any edit to any file in the closure, in either direction across the run, including a file that changes and
  changes back: equal digests mean equal bytes, so the facts hold.
- Adding an import requires editing a listed file, so a changed closure is caught too.
- A file that failed to load is not listed. Its response is `unavailable` anyway, so there are no facts to protect.
- It does not promise an atomic snapshot. A client may see a mismatch and must then re-query. It does not cover a
  path that now resolves elsewhere through a swapped symlink but with the same bytes. The facts still describe those
  bytes, but `location.path` may name a different file than the user expects.
- Modification times are not part of the contract.
- Unsaved overlays are out of scope.

The digest is computed in Aster, over each loaded file's bytes, in the compiler that already holds them. Aster has no
bitwise operators, so the implementation emulates 32-bit `xor`/`and`/`not`/rotate with byte tables. It must be checked
against the FIPS 180-4 test vectors (for example, the empty input gives
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`). #59 records its cost on the compiler's own closure.

## Determinism and compatibility

- The same argv, working directory and file bytes give a byte-identical response, at every applicable compiler stage.
- File ids, declaration ids and offsets are valid only within one response. A client must not join ids across
  invocations or edits.
- `check --format=json` and `inspect` output is unchanged by this work. The new `sha256` key appears only in `query`
  responses.
- Consumers ignore unknown keys and tolerate unknown `status`, `reason` and `site` values.
- Changing an existing key's meaning, the selection rule or the offset units would be `aster/2`. Adding a site kind,
  turning an `unsupported` site into `found` with a `target`, or adding a status is additive.

## Fixture

The examples use two files in `/work`, queried as `aster query /work/main.aster --file=… --offset=…`. Each file ends
with a newline. `main.aster` (325 bytes) contains `é` (2 bytes) and `😀` (4 bytes):

```aster
import "lib.aster";

fn main(): int {
    let p: Point = Point { x: 1, y: 2 };
    let n: int = twice(p.x);
    let s: string = "héllo 😀"; // note
    let o: Option[int] = Option::Some(n);
    if n > 0 {
        let n: int = n + 1;
        print(n);
    }
    let m: Map[string, int] = {};
    return (n + len(s)) * 2;
}
```

`lib.aster` (77 bytes):

```aster
struct Point { x: int, y: int }

fn twice(n: int): int {
    return n * 2;
}
```

Line start offsets in `main.aster`: 0, 20, 21, 38, 79, 108, 151, 193, 208, 236, 254, 260, 294, 323. Ids from
`aster inspect` at `bc7a57a`:

| id | declaration |
| --- | --- |
| 0 | fn `main` |
| 1 | local `p` |
| 2 | local `n` (outer, line 5) |
| 3 | local `s` |
| 4 | local `o` |
| 5 | local `n` (inner, line 9, `shadows`: 2) |
| 6 | local `m` |
| 7 | struct `Point` |
| 8 | field `x` |
| 10 | fn `twice` |
| 11 | param `n` of `twice` |
| 12 | `Option` (prelude) |
| 21 | `Option[int]` |
| 32 | builtin-fn `len` |
| 42 | builtin-fn `print` |

The digests are `606515c73aa5ccf446da75fdc73a68a0933d4dbfae49b67c0e692616e2d86ff9` (`main.aster`) and
`316bc697aa723515f5349a25f204c5858eaedb81e52eb52b8dcaec23964e7808` (`lib.aster`).

### Selection table

`main.aster` unless stated. *Extent* is the selected site's extent, which is `location.range`'s `[start, end)`.

| Offset | Byte | Status / site | Extent | Result |
| --- | --- | --- | --- | --- |
| 0 | `i` of `import` | `none` | — | statement keyword |
| 7 | `"` of the import path | `unsupported` / `import-path` | 7-18 | |
| 24 | `m` of `main` | `found` / `declaration` | 24-28 | `signature` `{"params":[],"ret":{"kind":"int"}}`, `target` 0 |
| 30 | `:` after `main()` | `none` | — | item punctuation |
| 46 | `p` in `let p` | `found` / `declaration` | 46-47 | `type` struct Point (decl 7), `target` 1 |
| 49 | `P` of the annotation `Point` | `unsupported` / `type-annotation` | 49-54 | |
| 57 | `P` of the literal `Point {` | `unsupported` / `struct-literal-name` | 57-62 | |
| 65 | `x` in `{ x: 1` | `unsupported` / `field-init-name` | 65-66 | |
| 96 | `t` of `twice` | `found` / `callee` | 96-101 | `signature` of `twice`, `target` 10 |
| 101 | `(` of the call | `found` / `expression` | 96-106 | `type` int (the call) |
| 102 | `p` of `p.x` | `found` / `local` | 102-103 | `type` struct Point, `target` 1 |
| 103 | `.` of `p.x` | `found` / `expression` | 102-105 | `type` int |
| 104 | `x` of `p.x` | `found` / `field` | 104-105 | `type` int, `target` 8 |
| 128 | opening `"` | `found` / `expression` | 128-141 | `type` string |
| 130 | `é`'s lead byte | `found` / `expression` | 128-141 | `type` string |
| 131 | `é`'s continuation byte | `invalid` | — | `reason` `offset-not-boundary` |
| 136 | `😀`'s lead byte | `found` / `expression` | 128-141 | `type` string (it is 2 UTF-16 units; columns count it so) |
| 137 | inside `😀` | `invalid` | — | `reason` `offset-not-boundary` |
| 141 | `;` | `none` | — | statement punctuation |
| 143 | `/` of `// note` | `none` | — | comment |
| 176 | `O` of `Option::Some` | `unsupported` / `variant-name` | 176-182 | |
| 182 | `:` of `::` | `found` / `expression` | 176-191 | `type` `Option[int]` (decl 21, `args` [int]) |
| 184 | `S` of `Some` | `unsupported` / `variant-name` | 184-188 | |
| 189 | `n` in `Some(n)` | `found` / `local` | 189-190 | `type` int, `target` 2 |
| 197 | `i` of statement `if` | `none` | — | statement keyword |
| 202 | `>` | `found` / `expression` | 200-205 | `type` bool |
| 220 | inner `n` in `let n` | `found` / `declaration` | 220-221 | `type` int, `target` 5 |
| 229 | `n` in `= n + 1` | `found` / `local` | 229-230 | `type` int, `target` **2**: the inner `n` is not yet declared |
| 231 | `+` | `found` / `expression` | 229-234 | `type` int |
| 244 | `p` of `print` | `found` / `callee` | 244-249 | `signature` `null` (hand-typed), `target` 42 |
| 249 | `(` of `print(` | `found` / `expression` | 244-252 | `type` void |
| 250 | `n` in `print(n)` | `found` / `local` | 250-251 | `type` int, `target` **5** |
| 271 | `M` of `Map[` | `unsupported` / `type-annotation` | 271-287 | |
| 290 | `{` of `{}` | `found` / `expression` | 290-292 | `type` `{"kind":"map","key":{"kind":"string"},"value":{"kind":"int"}}` (contextual) |
| 298 | `r` of `return` | `none` | — | statement keyword |
| 305 | `(` before `n + len` | `found` / `expression` | 305-317 | `type` int (`n + len(s)`, parens included) |
| 306 | `n` | `found` / `local` | 306-307 | `type` int, `target` 2 |
| 310 | `l` of `len` | `found` / `callee` | 310-313 | `signature` `null`, `target` 32 |
| 314 | `s` in `len(s)` | `found` / `local` | 314-315 | `type` string, `target` 3 |
| 316 | `)` closing `(n + len(s))` | `found` / `expression` | 305-317 | `type` int (`n + len(s)`) |
| 318 | `*` | `found` / `expression` | 305-321 | `type` int (the product; its extent includes the left operand's parens) |
| 324 | final `\n` | `none` | — | whitespace |
| 325 | end of file | `none` | — | `offset` = size |
| 326 | past the end | `invalid` | — | `reason` `offset-out-of-range` |
| -1 | — | usage error | — | exit 2, no JSON |
| 42 in `lib.aster` | `n` in `twice(n: int)` | `found` / `declaration` | 42-43 | `type` int, `target` 11 |
| 68 in `lib.aster` | `n` in `n * 2` | `found` / `local` | 68-69 | `type` int, `target` 11 |

A BOM and CRLF file, `crlf.aster`, is the bytes `EF BB BF` then `fn main(): int {\r\n    return 0;\r\n}\r\n` (39
bytes, `bom:true`):

| Offset | Byte | Status / site | Extent | Result |
| --- | --- | --- | --- | --- |
| 0 | BOM lead byte | `none` | — | the BOM is not source |
| 1, 2 | BOM continuation bytes | `invalid` | — | `reason` `offset-not-boundary` |
| 3 | `f` of `fn` | `none` | — | item keyword |
| 6 | `m` of `main` | `found` / `declaration` | 6-10 (line 1, col 4: the BOM is not counted) | `target` 0 |
| 19 | `\r` | `none` | — | whitespace |
| 32 | `0` | `found` / `expression` | 32-33 (line 2, col 12) | `type` int |
| 39 | end of file | `none` | — | |

### Caret table

`--caret=b` on `main.aster` unless stated. `|` marks the caret. *Step* is the step of [Caret mode](#caret-mode) that
decided the answer.

| Caret | At | Step | Status / site | Extent | Result |
| --- | --- | --- | --- | --- | --- |
| 0 | `\|import` | 3 | `none` | — | no left side, and the right side is a keyword |
| 47 | `let p\|:` | 2 | `found` / `declaration` | 46-47 | `target` 1 |
| 96 | `\|twice(` | 1 | `found` / `callee` | 96-101 | `target` 10 |
| 101 | `twice\|(` | 2 | `found` / `callee` | 96-101 | `target` 10. A pointer at 101 gives the call instead. |
| 103 | `p\|.x` | 2 | `found` / `local` | 102-103 | `target` 1 |
| 105 | `p.x\|)` | 2 | `found` / `field` | 104-105 | `target` 8 |
| 131 | inside `é` | — | `invalid` | — | `reason` `offset-not-boundary` |
| 140 | `😀\|"` | 3 | `found` / `expression` | 128-141 | `type` string. Step 2 looks at the 4-byte `😀` ending at 140, which is not a name. |
| 141 | `"\|;` | 3 | `none` | — | a literal is not a name, so the caret gets the pointer answer for `;` |
| 182 | `Option\|::Some` | 2 | `unsupported` / `variant-name` | 176-182 | |
| 190 | `Some(n\|)` | 2 | `found` / `local` | 189-190 | `target` 2 |
| 230 | `n\| + 1` | 2 | `found` / `local` | 229-230 | `target` 2 |
| 231 | `n \|+ 1` | 3 | `found` / `expression` | 229-234 | `type` int. Both sides are inside `n + 1`, neither a name. |
| 251 | `print(n\|)` | 2 | `found` / `local` | 250-251 | `target` 5 |
| 325 | end of file | 3 | `none` | — | the left side is the final `\n` |
| 326 | past the end | — | `invalid` | — | `reason` `offset-out-of-range` |
| 69 in `lib.aster` | `n\| * 2` | 2 | `found` / `local` | 68-69 | `target` 11 |

## Contract examples

Each response is one line. They are shown pretty-printed with `semantics` elided. The fixture's `files` value is:

```json
"files":[{"id":0,"path":"/work/main.aster","bom":false,"sha256":"606515c73aa5ccf446da75fdc73a68a0933d4dbfae49b67c0e692616e2d86ff9"},
         {"id":1,"path":"/work/lib.aster","bom":false,"sha256":"316bc697aa723515f5349a25f204c5858eaedb81e52eb52b8dcaec23964e7808"}]
```

**1. A callee whose target is in an imported file.** `--file=/work/main.aster --offset=96` exits 0. The client
follows `target` 10 to `declarations[10].location`, which is `{"file":1,"path":"/work/lib.aster","range":{"start":36,"end":41,…}}`,
and slices bytes 36-41 of `lib.aster` to get `twice`.

```json
{"schema":"aster/1","command":"query","ok":true,"files":[…],"diagnostics":[],"semantics":{"available":true,"declarations":[…]},
 "query":{"request":{"path":"/work/main.aster","mode":"pointer","offset":96,"file":0},"status":"found","site":"callee",
  "location":{"file":0,"path":"/work/main.aster","range":{"start":96,"end":101,"start_line":5,"start_col_utf16":18,"end_line":5,"end_col_utf16":23}},
  "signature":{"params":[{"name":"n","type":{"kind":"int"},"decl":11}],"ret":{"kind":"int"}},"target":10}}
```

**1b. The same callee from a caret.** `--file=/work/main.aster --caret=101` puts the caret between `twice` and `(`.
The character after the caret is `(`, which is not a name, so the name to its left answers:

```json
"query":{"request":{"path":"/work/main.aster","mode":"caret","offset":101,"file":0},"status":"found","site":"callee",
 "location":{"file":0,"path":"/work/main.aster","range":{"start":96,"end":101,"start_line":5,"start_col_utf16":18,"end_line":5,"end_col_utf16":23}},
 "signature":{"params":[{"name":"n","type":{"kind":"int"},"decl":11}],"ret":{"kind":"int"}},"target":10}
```

**2. Shadowing.** At offset 229, the `n` being read on the inner `let n`'s own line resolves outward. At 250, the
next line, it resolves to the inner binding.

```json
"query":{"request":{"path":"/work/main.aster","mode":"pointer","offset":229,"file":0},"status":"found","site":"local",
 "location":{"file":0,"path":"/work/main.aster","range":{"start":229,"end":230,"start_line":9,"start_col_utf16":22,"end_line":9,"end_col_utf16":23}},
 "type":{"kind":"int"},"target":2}
"query":{"request":{"path":"/work/main.aster","mode":"pointer","offset":250,"file":0},"status":"found","site":"local",
 "location":{"file":0,"path":"/work/main.aster","range":{"start":250,"end":251,"start_line":10,"start_col_utf16":15,"end_line":10,"end_col_utf16":16}},
 "type":{"kind":"int"},"target":5}
```

**3. A builtin call.** At offset 244, the target is source-less and the hand-typed signature is `null`. Offset 249
selects the call itself.

```json
"query":{"request":{"path":"/work/main.aster","mode":"pointer","offset":244,"file":0},"status":"found","site":"callee",
 "location":{"file":0,"path":"/work/main.aster","range":{"start":244,"end":249,"start_line":10,"start_col_utf16":9,"end_line":10,"end_col_utf16":14}},
 "signature":null,"target":42}
"query":{"request":{"path":"/work/main.aster","mode":"pointer","offset":249,"file":0},"status":"found","site":"expression",
 "location":{"file":0,"path":"/work/main.aster","range":{"start":244,"end":252,"start_line":10,"start_col_utf16":9,"end_line":10,"end_col_utf16":17}},
 "type":{"kind":"void"}}
```

Here `declarations[42]` is `{"id":42,"kind":"builtin-fn","name":"print","origin":"builtin","location":null,"decl_range":null,"signature":null}`.

**4. An unavailable program.** Change `lib.aster`'s `return n * 2;` to `return true;` and query any position, for
example `--file=/work/main.aster --offset=96`. The command exits 1. The diagnostic is in the imported file, and no
position result is given.

```json
{"schema":"aster/1","command":"query","ok":false,
 "files":[{"id":0,"path":"/work/main.aster","bom":false,"sha256":"606515c7…"},{"id":1,"path":"/work/lib.aster","bom":false,"sha256":"<digest of the edited lib.aster>"}],
 "diagnostics":[{"code":"type.mismatch","severity":"error","message":"type mismatch: expected int, found bool",
   "primary":{"file":1,"path":"/work/lib.aster","range":{…}},"related":[]}],
 "semantics":{"available":false,"reason":"diagnostics"},
 "query":{"request":{"path":"/work/main.aster","mode":"pointer","offset":96,"file":null},"status":"unavailable","reason":"diagnostics"}}
```

A missing root gives `"reason":"io"` in both places and exits 2.

**5. A file outside the closure.** `--file=/work/other.aster --offset=0`, where `other.aster` exists but is not
imported, exits 2. So does `--file=/alias/lib.aster`, where `/alias` is a symlink to `/work`. It names the same
bytes, but the lexical match does not equate the two spellings, so a client queries with the spelling the response's
`files` use.

```json
"query":{"request":{"path":"/work/other.aster","mode":"pointer","offset":0,"file":null},"status":"invalid","reason":"file-not-in-closure"}
```

## Implementation constraints for #58 and #59

These are part of the contract because they decide observable behaviour.

- Facts come from the checker at resolution time, recorded in a side table keyed by source span. That covers the
  expression type, the resolved local or param, the user or builtin callee, and the resolved field. The query path
  never re-resolves names from text, and never parses the typed dump.
- The typed tree, local numbering, lowering, emitted C and LLVM, and every existing human, `check --format=json` and
  `inspect` output stay byte-identical for unchanged programs.
- Parentheses: the parser keeps returning the inner expression with its own span, as diagnostics rely on that. The
  provenance work records paren pairs separately and computes extents for queries only.
- Local and param targets map from the checker's per-function local to the `inspect` declaration id through the same
  `LocalSite`/`FnSites` order `inspect` uses, so the ids agree by construction.
- One front-end run per request, plus one linear pass to choose the site. No per-fact rescans of the file.

## Non-goals

These are out of scope:
- rename
- all-references search
- type-name, variant or import navigation (the `unsupported` sites)
- several positions per request
- line/column input
- unsaved buffers or overlays
- an LSP server
- a persistent or incremental compiler
- a public AST or IR
- new language features or builtins
- GC
- backend changes

## Acceptance for this issue

- [x] CLI spelling, file identity, offset encoding and response schema, additive in `aster/1`
- [x] Pointer and caret selection modes, so a caret just after a name finds it
- [x] Selection rules and the input → span/result tables, covering name vs expression, nesting, equal extents and parens,
  operators, punctuation, comments, whitespace, UTF-8 continuation bytes, BOM, CRLF, negative and out-of-range offsets, and EOF
- [x] Expression type vs callable signature, with no function type
- [x] The no-result, unsupported, invalid-request and unavailable statuses and their exit codes
- [x] Every reference resolves within one response, and builtin and prelude stay source-less
- [x] Freshness by per-file SHA-256 with a re-hash after the response, and its limits
- [x] Deterministic output and the five contract examples

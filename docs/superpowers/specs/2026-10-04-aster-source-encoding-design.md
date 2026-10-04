# Aster source encoding: reject malformed UTF-8 (#25)

## Problem

Stage 0 reads source with `readFileSync(path, 'utf8')` (`cli/cli.ts`, `driver/load.ts`). That decode is lossy: each
ill-formed sequence becomes U+FFFD. The self-hosted compiler reads bytes and keeps them. Reproduced at `31ad45e` on
Linux/gcc with byte-generated files:

| Malformed bytes in | S0 vs S1 |
|---|---|
| a string literal (`FF`, truncated `C3`, overlong `C0 80`, surrogate `ED A0 80`), directly or in an imported file | different C and different program output: S0 prints `61 EF BF BD 62`, S1 prints `61 FF 62` |
| a bare token or a char literal | both reject; the diagnostics differ (S1's `utf8_len` reads `FF` as a 4-byte lead and swallows the newline) |
| a comment | identical |
| valid UTF-8 controls (`é`, `😀`) | identical |

The parity suites spawn drivers with `encoding: 'utf8'`, so `22 FF 22` and `22 EF BF BD 22` both decode to the same
string. Run against `printIr`, the IR driver's output on the malformed files is equal after decoding and different as
raw bytes. The corpus had no malformed file, so the proof never hit this.

## Decision

Source files must be well-formed UTF-8 (Unicode Table 3-7: no overlongs, surrogates, scalars past U+10FFFF, truncated
sequences or stray continuation bytes). An optional leading BOM is still stripped. Malformed source is a compile
error in both compilers, reported before lexing.

- **The offset** is that of the first byte of the first ill-formed sequence: the lead byte of a bad or truncated
  sequence, or a stray continuation byte itself. It is 0-based and counts the file's bytes as stored, BOM included.
  The line is 1 + the number of `\n` bytes before it.
- **The reason** is `invalid UTF-8 at line <L>, byte <B>`.
- **Root file:** `<file>: error: <reason>\n` on stderr, nothing on stdout, exit 1 (compile error), for every command and
  emit stage. There is no caret excerpt: the line holds the bad bytes.
- **Imported file:** the existing import diagnostic at the path literal, `cannot import '<literal>': <reason>`, sorted
  and formatted with the other diagnostics, exit 1.
- Runtime strings stay byte sequences. `read_file` and string values are untouched.

## Implementation

- **TS:** `driver/utf8.ts` exports `invalidUtf8At(bytes: Uint8Array): number` (-1 when well-formed) and
  `invalidUtf8Reason(bytes, at)`. `nodeHost.readFile` and `cli.ts` read a `Buffer`, validate it, then decode.
- **Aster:** `utf8_invalid_at(raw: string): int` and `utf8_reason(raw, at): string` in `loader.aster`, the same
  algorithm byte for byte. `load_import` reports the reason as an import error; `asterc.aster`'s `main` checks the root
  after `read_file`.
- With malformed input stopped at the loader, the lexer's `utf8_len` never sees it, so the `FF` swallowing needs no
  fix.

## Tests

- `driver/utf8.test.ts`: table cases (each class of ill-formed sequence, at start, middle and end) plus a seeded random
  property: `invalidUtf8At(b) === -1` exactly when `new TextDecoder('utf-8', { fatal: true })` accepts `b`.
- `tests/source_encoding.test.ts` (stage-aware, added to `STAGE_SUITES`): byte-generated files in a temp dir (none in
  `tests/programs/`, whose readers decode as UTF-8). Malformed cases: lone `FF`, truncated `C3` at EOF, overlong,
  surrogate, past U+10FFFF, stray `80`, inside a comment, after a BOM, and in an imported file. Valid controls: `é`,
  `😀`, and a BOM. Each runs `check`, `build --emit=c` and (for the valid ones) `run` through S0 and the stage under
  test; stdout, stderr and status must be equal, and the malformed ones must match the exact expected text.
- **The blind spot:** the parity suites decode child output with `TextDecoder(..., { fatal: true })` through one
  helper, so malformed output throws instead of comparing equal as U+FFFD.

## Docs

`docs/spec/language.md` states the source encoding rule. The contract (§4.1) gets the malformed-source behaviour.
`friction.md`'s open note is marked resolved.

## Out of scope

NUL bytes in source, Unicode normalisation, and the encoding of runtime strings.

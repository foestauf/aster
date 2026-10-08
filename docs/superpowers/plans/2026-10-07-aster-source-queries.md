# Saved-source position queries (#58 + #59) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `aster query <entry> --file=<path> (--offset=<n> | --caret=<n>)`, answering a saved byte position with its
compiler-checked type, callable signature and declaration target, plus per-file SHA-256 freshness digests.

**Architecture:**
- The checker records a side table of source facts as it resolves expressions. These are `Checked.facts`: an
  expression's type, the local a name resolved to, a callee name and a field access. The typed tree is untouched.
- The parser records parenthesis pairs in `Loaded.parens`.
- `inspect.aster`'s declaration walk is kept as a value (`Walk`), with id maps for locals, functions, builtins and
  fields, and with declaration-name sites.
- A new `query.aster` merges the three kinds of site (facts, declaration names, syntactic "unsupported" spans) for
  the requested file. It picks the innermost by paren-widened extent and renders the `query` object.
- A new `sha256.aster` computes digests with byte tables, because Aster has no bitwise operators.

**Tech Stack:** Aster (self-hosted compiler in `packages/asterc-self/`), Vitest suites in `tests/`, Node 24.

**Spec:** `docs/superpowers/specs/2026-10-07-aster-source-query-contract-design.md` (the contract; read it first).
`docs/inspect/README.md` is the shipped v0.9 contract this extends.

## Global Constraints

- The schema stays `aster/1`, and every change is additive. `check --format=json` and `inspect` output stay
  byte-identical. `sha256` appears only in `query` responses.
- Offsets are file-local on-disk bytes, BOM included. Ranges use v0.9's `Range` (lines are 1-based, columns are UTF-16).
- The typed tree, local numbering, lowering, emitted C/LLVM and the human output for any program are unchanged.
- There are no new language features, builtins or operators. Facts are captured at resolution time: no second
  analyzer, no text-name search and no typed-dump parsing.
- Status exit codes:

  | `query.status` | exit |
  | --- | --- |
  | `found` / `none` / `unsupported` | 0 |
  | `invalid` | 2 |
  | `unavailable` | 1 for `diagnostics`, 2 for `io` |

  A usage error exits 2 with an empty stdout. Stderr is empty for every JSON response.
- Same argv, cwd and bytes give a byte-identical response.
- Every `.aster` library file starts with `// expect-library`, and a comment above each function says what it does,
  in the existing style.
- Commits use conventional-commit subjects (commitlint runs in husky) and end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands:
  - Each new or changed suite: `pnpm vitest run <file>`. Vitest builds S1 from `build/asterc` in global setup.
  - Before the PR: `pnpm lint`, `pnpm typecheck` and `pnpm test`.
  - `pnpm build` reinstalls `build/asterc` from the working tree. Use it whenever an `.aster` change must be seen by
    `build/asterc`. The tests use S1, built fresh from the working tree, so they don't need it.

## Review Focus

1. **Path spellings of the same file.** `--file=lib.aster`, `--file=./lib.aster` and `--file=sub/../lib.aster` must all
   match the loaded `./lib.aster` through `normalise`. They must not come back as `file-not-in-closure`. (Task 4 test
   `path spellings`.)
2. **An empty imported file.** `lib.aster` of 0 bytes: `--offset=0` and `--caret=0` are valid and give `none`, and
   `--offset=1` is `offset-out-of-range`. (Task 4 test `empty file`.)
3. **The largest offset.** `--offset=9223372036854775807` parses, then gives `invalid`/`offset-out-of-range`.
   `9223372036854775808` is a usage error. (Task 4 tests.)
4. **A caret between two touching sites.** In `a+b` with no spaces, a caret between `a` and `+` returns the local `a`,
   and a caret between `+` and `b` returns `b`. (Task 4 test `caret between touching sites`.)
5. **An edit after the compiler read the file.** The consumer recomputes SHA-256 after the response, sees the mismatch
   and refuses the answer. (Task 5 consumer test `detects a stale response`.)

---

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `packages/asterc-self/sha256.aster` | create | FIPS 180-4 SHA-256 over a byte prefix plus a string |
| `packages/asterc-self/parser.aster` | modify | `Paren` struct and `Parser.parens`, recorded in the `"("` primary branch |
| `packages/asterc-self/loader.aster` | modify | `Loaded.parens`, copied from each file's parser |
| `packages/asterc-self/checker.aster` | modify | `SourceFact`, `Env.facts`/`fact_at`, `Checked.facts`, recording in `check_expr`, Field, `check_call` and `check_place` |
| `packages/asterc-self/inspect.aster` | modify | `semantics_walk` keeps the `Walk`, with id maps and declaration sites; `response_fields` with optional digests |
| `packages/asterc-self/query.aster` | create | Request validation, sites, extents, pointer/caret selection, the `query` object |
| `packages/asterc-self/asterc.aster` | modify | The `query` command, its flags and usage line |
| `tests/sha256.test.ts` | create | Digest against Node's crypto and the FIPS vectors |
| `tests/provenance.test.ts` | create | #58: facts, scopes, imports, expression coverage, Unicode spans, paren pairs |
| `tests/json_query.test.ts` | create | #59: spec tables, goldens, usage errors, invariants, scale |
| `tests/query_consumer.test.ts` | create | A standalone consumer, using the public JSON only |
| `tests/golden/json/query-*.txt` | create | Contract-example goldens |
| `tests/golden/cli/*.txt` | update | The usage text gains the `query` line |
| `scripts/selfhost.ts` | modify | `STAGE_SUITES` gains the four new suites |
| `package.json` | modify | The `golden` script includes `tests/json_query.test.ts` |
| `docs/inspect/README.md` | modify | The "Position queries" section, validation and measurements |
| `docs/superpowers/specs/2026-10-07-aster-source-query-contract-design.md` | modify | Status line: implemented |

---

### Task 1: SHA-256 in Aster

**Files:**
- Create: `packages/asterc-self/sha256.aster`
- Test: `tests/sha256.test.ts`

**Interfaces:**
- Produces:
  - `struct Sha256`
  - `fn sha256_new(): Sha256`, which builds its tables once
  - `fn sha256_hex(s: Sha256, prefix: [int], text: string): string`: lowercase hex of SHA-256 over the bytes of
    `prefix`, then the bytes of `text`

- [ ] **Step 1: Write the failing test** `tests/sha256.test.ts`

```ts
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDriver, REPO_ROOT } from './stage.js';

// sha256.aster through a driver built by the stage under test. `plain` hashes a file's bytes; `bom` hashes EF BB BF
// followed by them, the way `aster query` hashes a file whose BOM the loader stripped.
const dir = mkdtempSync(join(tmpdir(), 'aster-sha256-'));
const exe = join(dir, 'sha');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeAll(() => {
  const driver = join(dir, 'sha.aster');
  writeFileSync(driver, `
import ${JSON.stringify(join(REPO_ROOT, 'packages/asterc-self/sha256.aster'))};
fn main(args: [string]): int {
    let Result::Ok(text) = read_file(args[1]) else { return 2; };
    let s: Sha256 = sha256_new();
    let prefix: [int] = [];
    if args[0] == "bom" {
        push(prefix, 239);
        push(prefix, 187);
        push(prefix, 191);
    }
    print(sha256_hex(s, prefix, text));
    return 0;
}
`);
  buildDriver(driver, exe);
});

function digest(mode: 'plain' | 'bom', bytes: Buffer): string {
  const input = join(dir, 'input');
  writeFileSync(input, bytes);
  const r = spawnSync(exe, [mode, input], { encoding: 'utf8' });
  expect(r.status).toBe(0);
  return r.stdout.trim();
}

const node = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('sha256', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(digest('plain', Buffer.alloc(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(digest('plain', Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(digest('plain', Buffer.from('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('matches Node across every padding boundary', () => {
    for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129]) {
      const b = randomBytes(n);
      expect(digest('plain', b), `length ${n}`).toBe(node(b));
    }
  });
  it('hashes a BOM prefix as the on-disk bytes', () => {
    const body = Buffer.from('fn main(): int {\r\n    return 0;\r\n}\r\n');
    expect(digest('bom', body)).toBe(node(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])));
  });
  it('hashes 300 KB of arbitrary bytes', () => {
    const b = randomBytes(300_000);
    expect(digest('plain', b)).toBe(node(b));
  }, 60_000);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm vitest run tests/sha256.test.ts`
Expected: FAIL. The driver doesn't build, because `sha256.aster` doesn't exist.

- [ ] **Step 3: Implement** `packages/asterc-self/sha256.aster`

```aster
// expect-library
// SHA-256 (FIPS 180-4) for `aster query`'s freshness digests. Aster has no bitwise operators, so a 32-bit word is an
// int in [0, 2^32): shifts and rotations are division and multiplication by powers of two, and `xor` and `and` work a
// byte at a time through 256 x 256 tables that sha256_new builds once.

struct Sha256 {
    xor8: [int],
    and8: [int],
    // pow2[i] is 2^i, for i in 0..33.
    pow2: [int],
    k: [int],
    // The message schedule, reused for every block.
    w: [int],
}

fn sha256_new(): Sha256 {
    let xor8: [int] = [];
    let and8: [int] = [];
    for a in 0..256 {
        for b in 0..256 {
            var x: int = 0;
            var n: int = 0;
            var bit: int = 1;
            var ra: int = a;
            var rb: int = b;
            for step in 0..8 {
                let abit: int = ra % 2;
                let bbit: int = rb % 2;
                if abit != bbit {
                    x += bit;
                }
                if abit == 1 && bbit == 1 {
                    n += bit;
                }
                ra = ra / 2;
                rb = rb / 2;
                bit = bit * 2;
            }
            push(xor8, x);
            push(and8, n);
        }
    }
    let pow2: [int] = [];
    var p: int = 1;
    for i in 0..33 {
        push(pow2, p);
        p = p * 2;
    }
    let w: [int] = [];
    for i in 0..64 {
        push(w, 0);
    }
    let k: [int] = [
        1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080,
        310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774,
        264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808,
        3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291,
        1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817,
        3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218,
        1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479,
        3329325298,
    ];
    return Sha256 { xor8: xor8, and8: and8, pow2: pow2, k: k, w: w };
}

// `a xor b` (`table` = xor8) or `a and b` (`table` = and8) of two 32-bit words, a byte at a time.
fn bytewise32(table: [int], a: int, b: int): int {
    var out: int = 0;
    var x: int = a;
    var y: int = b;
    var scale: int = 1;
    for step in 0..4 {
        out += table[(x % 256) * 256 + y % 256] * scale;
        x = x / 256;
        y = y / 256;
        scale = scale * 256;
    }
    return out;
}

fn xor32(s: Sha256, a: int, b: int): int {
    return bytewise32(s.xor8, a, b);
}

fn and32(s: Sha256, a: int, b: int): int {
    return bytewise32(s.and8, a, b);
}

fn not32(a: int): int {
    return 4294967295 - a;
}

fn add32(a: int, b: int): int {
    return (a + b) % 4294967296;
}

fn rotr32(s: Sha256, x: int, n: int): int {
    return x / s.pow2[n] + (x % s.pow2[n]) * s.pow2[32 - n];
}

fn shr32(s: Sha256, x: int, n: int): int {
    return x / s.pow2[n];
}

// Byte `i` of the padded message: `prefix`, then `text` (`size` bytes together), then 0x80, zeros, and the bit length
// as 8 big-endian bytes, `total` bytes in all.
fn padded_byte(prefix: [int], text: string, size: int, total: int, i: int): int {
    if i < len(prefix) {
        return prefix[i];
    }
    if i < size {
        return byte_at(text, i - len(prefix));
    }
    if i == size {
        return 128;
    }
    if i < total - 8 {
        return 0;
    }
    var bits: int = size * 8;
    for step in 0..total - 1 - i {
        bits = bits / 256;
    }
    return bits % 256;
}

// Folds the 64-byte block at `at` into the state `h`.
fn sha256_block(s: Sha256, h: [int], prefix: [int], text: string, size: int, total: int, at: int) {
    let w: [int] = s.w;
    for t in 0..16 {
        let i: int = at + t * 4;
        w[t] = padded_byte(prefix, text, size, total, i) * 16777216 + padded_byte(prefix, text, size, total, i + 1) * 65536
            + padded_byte(prefix, text, size, total, i + 2) * 256 + padded_byte(prefix, text, size, total, i + 3);
    }
    for t in 16..64 {
        let x: int = w[t - 15];
        let y: int = w[t - 2];
        let s0: int = xor32(s, xor32(s, rotr32(s, x, 7), rotr32(s, x, 18)), shr32(s, x, 3));
        let s1: int = xor32(s, xor32(s, rotr32(s, y, 17), rotr32(s, y, 19)), shr32(s, y, 10));
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) % 4294967296;
    }
    var a: int = h[0];
    var b: int = h[1];
    var c: int = h[2];
    var d: int = h[3];
    var e: int = h[4];
    var f: int = h[5];
    var g: int = h[6];
    var hh: int = h[7];
    for t in 0..64 {
        let big1: int = xor32(s, xor32(s, rotr32(s, e, 6), rotr32(s, e, 11)), rotr32(s, e, 25));
        let choose: int = xor32(s, and32(s, e, f), and32(s, not32(e), g));
        let t1: int = (hh + big1 + choose + s.k[t] + w[t]) % 4294967296;
        let big0: int = xor32(s, xor32(s, rotr32(s, a, 2), rotr32(s, a, 13)), rotr32(s, a, 22));
        let majority: int = xor32(s, xor32(s, and32(s, a, b), and32(s, a, c)), and32(s, b, c));
        let t2: int = add32(big0, majority);
        hh = g;
        g = f;
        f = e;
        e = add32(d, t1);
        d = c;
        c = b;
        b = a;
        a = add32(t1, t2);
    }
    h[0] = add32(h[0], a);
    h[1] = add32(h[1], b);
    h[2] = add32(h[2], c);
    h[3] = add32(h[3], d);
    h[4] = add32(h[4], e);
    h[5] = add32(h[5], f);
    h[6] = add32(h[6], g);
    h[7] = add32(h[7], hh);
}

// The lowercase hex SHA-256 of `prefix`'s bytes followed by `text`'s.
fn sha256_hex(s: Sha256, prefix: [int], text: string): string {
    let h: [int] = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
    let size: int = len(prefix) + len(text);
    var total: int = size + 9;
    while total % 64 != 0 {
        total += 1;
    }
    var at: int = 0;
    while at < total {
        sha256_block(s, h, prefix, text, size, total, at);
        at += 64;
    }
    let digits: string = "0123456789abcdef";
    var out: string = "";
    for word in h {
        var scale: int = 268435456;
        for step in 0..8 {
            let d: int = (word / scale) % 16;
            out += substring(digits, d, d + 1);
            scale = scale / 16;
        }
    }
    return out;
}
```

If the checker rejects an unused `for step in …` variable, or an array literal that spans several lines, use the
nearest pattern already in `packages/asterc-self/` (`grep -n 'for .* in 0\.\.' packages/asterc-self/*.aster`).

- [ ] **Step 4: Run it and check it passes**

Run: `pnpm vitest run tests/sha256.test.ts`
Expected: 4 passed. The 300 KB case should take well under 10 s; note the time.

- [ ] **Step 5: Commit**

```bash
git add packages/asterc-self/sha256.aster tests/sha256.test.ts
git commit -m "feat: SHA-256 in Aster for query freshness digests (#59)"
```

---

### Task 2: Checked-source provenance (#58)

**Files:**
- Modify: `packages/asterc-self/parser.aster` (the `Parser` struct around line 190; `new_parser` and `new_parser_at` around line 1047; the `"("` branch of the primary parser around line 932)
- Modify: `packages/asterc-self/loader.aster` (`Loaded` at line 49, `visit` at line 285, `load_program` at line 360)
- Modify: `packages/asterc-self/checker.aster` (`Env` at line 531, `Checked` at line 563, `check_program` at line 1136, `check_expr` at line 1549, the `Field` arm, `check_place` at line 2666, `check_call` at line 2803)
- Test: `tests/provenance.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `struct Paren { open: int, close: int, inner_start: int, inner_end: int }`. These are global offsets: `open` is
    the `(` token's start and `close` is the `)` token's end. `inner_*` is the enclosed `Expr`'s span.
  - `Loaded.parens: [Paren]`
  - `struct SourceFact { kind: string, start: int, end: int, ty: Type, func: int, local: int, name: string, owner: string }`
  - `Checked.facts: [SourceFact]`, in recording order (post-order, so an equal span's deeper node comes first).
    - `kind` is `"expr"`, `"local"`, `"callee"` or `"field"`.
    - `func` is the index in `Checked.functions` and `Checked.local_sites`.
    - `local` is the local id, or -1.
    - `name` is the callee name or the field name.
    - `owner` is the struct name, for a field.

- [ ] **Step 1: Write the failing test** `tests/provenance.test.ts`

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDriver, REPO_ROOT } from './stage.js';

// #58: the checker's source facts (Checked.facts) and the parser's paren pairs (Loaded.parens), dumped by a driver
// built from frontend.aster. Each fact line is
// `fact <kind> <file> <start> <end> <type> <func> <local> <name> <owner>`, with file-local on-disk offsets. Each local
// site is `site <func> <local> <file> <start>`, and each paren pair is `paren <file> <open> <close> <inner_start> <inner_end>`.
const dir = mkdtempSync(join(tmpdir(), 'aster-provenance-'));
const exe = join(dir, 'facts');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeAll(() => {
  const driver = join(dir, 'facts.aster');
  writeFileSync(driver, `
import ${JSON.stringify(join(REPO_ROOT, 'packages/asterc-self/frontend.aster'))};
fn file_of(files: [SourceFile], at: int): int {
    var found: int = 0;
    for i in 0..len(files) {
        if files[i].base <= at {
            found = i;
        }
    }
    return found;
}
fn local_offset(files: [SourceFile], at: int): string {
    let f: SourceFile = files[file_of(files, at)];
    return int_to_string(at - f.base + f.bom);
}
fn main(args: [string]): int {
    let FrontEnd::Passed(loaded, checked) = front_end(args[0]) else {
        print("unavailable");
        return 1;
    };
    let files: [SourceFile] = loaded.files;
    for f in checked.facts {
        print("fact " + f.kind + " " + int_to_string(file_of(files, f.start)) + " " + local_offset(files, f.start) + " " + local_offset(files, f.end) + " " + type_to_string(f.ty) + " " + int_to_string(f.func) + " " + int_to_string(f.local) + " " + f.name + " " + f.owner);
    }
    for fi in 0..len(checked.local_sites) {
        let sites: [LocalSite] = checked.local_sites[fi].sites;
        for k in 0..len(sites) {
            print("site " + int_to_string(fi) + " " + int_to_string(k) + " " + int_to_string(file_of(files, sites[k].name.start)) + " " + local_offset(files, sites[k].name.start));
        }
    }
    for q in loaded.parens {
        print("paren " + int_to_string(file_of(files, q.open)) + " " + local_offset(files, q.open) + " " + local_offset(files, q.close) + " " + local_offset(files, q.inner_start) + " " + local_offset(files, q.inner_end));
    }
    return 0;
}
`);
  buildDriver(driver, exe);
});

interface Fact { kind: string; file: number; start: number; end: number; type: string; func: number; local: number; name: string; owner: string }

function dump(files: Record<string, string | Buffer>, entry = 'main.aster') {
  const d = mkdtempSync(join(dir, 'case-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(d, name, '..'), { recursive: true });
    writeFileSync(join(d, name), text);
  }
  const r = spawnSync(exe, [join(d, entry)], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  const facts: Fact[] = lines.filter((l) => l.startsWith('fact ')).map((l) => {
    const [, kind, file, start, end, type, func, local, name = '', owner = ''] = l.split(' ');
    return { kind: kind!, file: +file!, start: +start!, end: +end!, type: type!, func: +func!, local: +local!, name, owner };
  });
  const sites = lines.filter((l) => l.startsWith('site ')).map((l) => l.split(' ').slice(1).map(Number));
  const parens = lines.filter((l) => l.startsWith('paren ')).map((l) => l.split(' ').slice(1).map(Number));
  return { status: r.status, out: r.stdout, facts, sites, parens };
}

/** Byte offsets of `word` as a whole word in `src`, in order. */
function words(src: string, word: string): number[] {
  return [...src.matchAll(new RegExp(`\\b${word}\\b`, 'g'))].map((m) => Buffer.byteLength(src.slice(0, m.index)));
}

/** The byte span of `inner` inside the `nth` occurrence of `snippet` in `src`. */
function spanAt(src: string, snippet: string, inner = snippet, nth = 1): [number, number] {
  const buf = Buffer.from(src);
  let at = -1;
  for (let i = 0; i < nth; i++) at = buf.indexOf(snippet, at + 1);
  expect(at, `${snippet} #${nth}`).toBeGreaterThanOrEqual(0);
  const start = at + Buffer.from(snippet).indexOf(inner);
  return [start, start + Buffer.byteLength(inner)];
}

/** The one fact of `kind` exactly spanning `span` in file `file`. */
function factAt(facts: Fact[], kind: string, [start, end]: [number, number], file = 0): Fact {
  const found = facts.filter((f) => f.kind === kind && f.file === file && f.start === start && f.end === end);
  expect(found, `${kind} at ${start}-${end}`).toHaveLength(1);
  return found[0]!;
}

/** The byte offset of the declaration name the local of `fact` resolves to. */
function declOf(sites: number[][], fact: Fact): number {
  const site = sites.find(([func, local]) => func === fact.func && local === fact.local);
  expect(site).toBeDefined();
  return site![3]!;
}

describe('provenance', () => {
  it('resolves shadowed, outward and binder uses to the right declarations', () => {
    const src = `fn f(i: int): int {
    var t: int = i;
    let n: int = 1;
    if t > 0 {
        let n: int = n + 1;
        t = t + n;
    }
    for i in 0..3 {
        t = t + i;
    }
    match Option::Some(t) {
        Option::Some(i) => {
            t = t + i;
        }
        Option::None => {}
    }
    return t + i + n;
}

fn main(): int {
    return f(1);
}
`;
    const { status, facts, sites } = dump({ 'main.aster': src });
    expect(status).toBe(0);
    // n: [0] outer decl, [1] inner decl, [2] use in `n + 1`, [3] use in `t + n`, [4] the final use.
    // i: [0] param, [1] `= i`, [2] for variable, [3] for-body use, [4] binder, [5] arm use, [6] final use.
    const n = words(src, 'n');
    const i = words(src, 'i');
    const use = (at: number) => declOf(sites, factAt(facts, 'local', [at, at + 1]));
    // On the inner `let n` line the inner n is not yet declared, so the use resolves outward.
    expect(use(n[2]!)).toBe(n[0]);
    expect(use(n[3]!)).toBe(n[1]);
    expect(use(n[4]!)).toBe(n[0]);
    expect(use(i[1]!)).toBe(i[0]);
    expect(use(i[3]!)).toBe(i[2]);
    expect(use(i[5]!)).toBe(i[4]);
    expect(use(i[6]!)).toBe(i[0]);
  });

  it('records imported callees and fields in the imported file', () => {
    const main = 'import "lib.aster";\nfn main(): int {\n    let p: Point = Point { x: 1 };\n    return twice(p.x);\n}\n';
    const lib = 'struct Point { x: int }\nfn twice(n: int): int {\n    return n * 2;\n}\n';
    const { status, facts } = dump({ 'main.aster': main, 'lib.aster': lib });
    expect(status).toBe(0);
    expect(factAt(facts, 'callee', spanAt(main, 'twice(', 'twice')).name).toBe('twice');
    const x = factAt(facts, 'field', spanAt(main, 'p.x', 'x'));
    expect([x.owner, x.name, x.type]).toEqual(['Point', 'x', 'int']);
    expect(factAt(facts, 'local', spanAt(lib, 'n * 2', 'n'), 1).type).toBe('int');
  });

  it('types every expression form', () => {
    const src = `struct P { x: int }
enum E { A, B }
fn pick(o: Option[int]): Option[int] {
    let v: int = o?;
    return Option::Some(v);
}
fn main(): int {
    var p: P = P { x: 1 };
    p.x = 2;
    var xs: [int] = [];
    push(xs, 'a');
    let m: Map[string, int] = {};
    let s: Set[int] = {};
    let e: E = E::A;
    let same: bool = e == E::B;
    let neg: int = -xs[0];
    let ok: bool = !same;
    let t: int = if ok { 1 } else { panic("no") };
    let u: int = match e { E::A => 1, E::B => 2 };
    let w: string = "s";
    let o: Option[int] = pick(Option::None);
    return t + u + neg + len(w);
}
`;
    const { status, facts } = dump({ 'main.aster': src });
    expect(status).toBe(0);
    const ty = (snippet: string, nth = 1) => factAt(facts, 'expr', spanAt(src, snippet, snippet, nth)).type;
    expect(ty('o?')).toBe('int');
    expect(ty('Option::Some(v)')).toBe('Option[int]');
    expect(ty('P { x: 1 }')).toBe('P');
    expect(ty('[]')).toBe('[int]');
    expect(ty("'a'")).toBe('int');
    expect(ty('{}', 1)).toBe('Map[string, int]');
    expect(ty('{}', 2)).toBe('Set[int]');
    expect(ty('E::A')).toBe('E');
    expect(ty('e == E::B')).toBe('bool');
    expect(ty('-xs[0]')).toBe('int');
    expect(ty('xs[0]')).toBe('int');
    expect(ty('!same')).toBe('bool');
    expect(ty('panic("no")')).toBe('never');
    expect(ty('if ok { 1 } else { panic("no") }')).toBe('int');
    expect(ty('match e { E::A => 1, E::B => 2 }')).toBe('int');
    expect(ty('"s"')).toBe('string');
    expect(ty('Option::None')).toBe('Option[int]');
    expect(ty('t + u + neg + len(w)')).toBe('int');
    // Assignment places: the local on the left of `p.x = 2`, and its field.
    expect(factAt(facts, 'local', spanAt(src, 'p.x = 2', 'p')).type).toBe('P');
    expect(factAt(facts, 'field', spanAt(src, 'p.x = 2', 'x')).owner).toBe('P');
    // A callee is a callee fact only: no expr or local fact shares its span.
    for (const name of ['push', 'len', 'pick']) {
      const at = words(src, name).at(-1)!;
      const end = at + name.length;
      expect(facts.filter((f) => f.kind === 'callee' && f.start === at && f.end === end), name).toHaveLength(1);
      expect(facts.filter((f) => f.kind !== 'callee' && f.start === at && f.end === end), name).toHaveLength(0);
    }
  });

  it('keeps exact spans through a BOM, CRLF, astral text and no final newline', () => {
    const body = '// 😀 here\r\nfn main(): int {\r\n    let s: string = "😀";\r\n    return len(s);\r\n}';
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body)]);
    const { status, facts } = dump({ 'main.aster': bytes });
    expect(status).toBe(0);
    const s = facts.find((f) => f.kind === 'local' && f.type === 'string')!;
    expect(bytes.subarray(s.start, s.end).toString()).toBe('s');
    const lit = facts.find((f) => f.kind === 'expr' && f.type === 'string')!;
    expect(bytes.subarray(lit.start, lit.end).toString()).toBe('"😀"');
  });

  it('records paren pairs around the inner span', () => {
    const src = 'fn main(): int {\n    let n: int = 1;\n    return ((n + 1)) * 2;\n}\n';
    const { parens } = dump({ 'main.aster': src });
    const inner = Buffer.from(src).indexOf('n + 1');
    // [open, close, inner_start, inner_end]; the inner pair closes first, so it is recorded first.
    expect(parens.map((p) => p.slice(1))).toEqual([
      [inner - 1, inner + 6, inner, inner + 5],
      [inner - 2, inner + 7, inner, inner + 5],
    ]);
  });

  it('exposes nothing for a program that fails to check', () => {
    const { status, out } = dump({ 'main.aster': 'fn main(): int {\n    return true;\n}\n' });
    expect(status).toBe(1);
    expect(out.trim()).toBe('unavailable');
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm vitest run tests/provenance.test.ts`
Expected: FAIL to build the driver, because `checked.facts` and `loaded.parens` don't exist yet.

- [ ] **Step 3: Record paren pairs in the parser and loader**

In `parser.aster`, after `struct Parser` add:

```aster
// A parenthesised expression's parentheses (global offsets: `open` is the `(` token's start, `close` the `)` token's
// end) and the span of the expression inside, which the parser returns without them. `aster query` widens selection
// extents with these; diagnostics keep the inner spans.
struct Paren {
    open: int,
    close: int,
    inner_start: int,
    inner_end: int,
}
```

Add the field `parens: [Paren],` to `struct Parser`. Add `parens: []` to both `Parser { … }` literals, in `new_parser`
and `new_parser_at`. Replace the `"("` branch of the primary-expression `match` with:

```aster
        "(" => {
            advance(p);
            let inner: Expr = parse_expr_with_struct_lits(p)?;
            let close: Token = expect(p, ")")?;
            push(p.parens, Paren { open: t.start, close: close.end, inner_start: inner.start, inner_end: inner.end });
            return Option::Some(inner);
        }
```

In `loader.aster`:
- Add the field `parens: [Paren],` to `struct Loaded`, with the comment `// Every parenthesised expression's parentheses, from every loaded file.`
- In `load_program`, the literal becomes `Loaded { files: [], items: [], root_end: 0, diags: [], parens: [] }`.
- In `visit`, after the loop that copies `p.errors`, add:

```aster
    for q in p.parens {
        push(ld.parens, q);
    }
```

- [ ] **Step 4: Record facts in the checker**

In `checker.aster`, before `struct Env` add:

```aster
// What the checker resolved at a source span, for `aster query` (docs/inspect/README.md, "Position queries"), kept in
// a side table so the typed tree is unchanged. Offsets are global. `kind` is:
// - "expr": any expression that is not a resolved name; `ty` is its type.
// - "local": a name that resolved to local `local` of function `func` (an index in `Checked.functions`); `ty` is its type.
// - "callee": a call's function name, `name` (a user function or a builtin).
// - "field": field `name` of struct `owner` in a field access; `ty` is the field's type.
struct SourceFact {
    kind: string,
    start: int,
    end: int,
    ty: Type,
    func: int,
    local: int,
    name: string,
    owner: string,
}
```

Then make these changes:
- Add `facts: [SourceFact],` and `fact_at: Map[string, int],` to `struct Env`. Comment: `// \`facts\` in recording order (children before parents); \`fact_at\` maps "kind:start:end" to an index, so a node checked again keeps one fact, the last.`
- Add `facts: [SourceFact],` to `struct Checked`.
- In `check_program`, add `facts: [], fact_at: {},` to the `Env { … }` literal, and `facts: env.facts` to the `Checked { … }` literal.

Add, after `fn error_expr`:

```aster
// Records `f`, replacing the fact of the same kind and span if a node is checked again.
fn record(env: Env, f: SourceFact) {
    let key: string = f.kind + ":" + int_to_string(f.start) + ":" + int_to_string(f.end);
    if let Option::Some(i) = map_get(env.fact_at, key) {
        env.facts[i] = f;
        return;
    }
    map_set(env.fact_at, key, len(env.facts));
    push(env.facts, f);
}

// A fact in the function being checked: functions are checked in order and each pushes its local sites when it ends,
// so the current one's index is the number already pushed.
fn fact(ctx: Ctx, kind: string, start: int, end: int, ty: Type, local: int, name: string, owner: string): SourceFact {
    return SourceFact { kind: kind, start: start, end: end, ty: ty, func: len(ctx.env.local_sites), local: local, name: name, owner: owner };
}
```

Rename the existing `fn check_expr(ctx: Ctx, e: Expr, expected: Option[Type]): TExpr` to `check_expr_node`, keeping
its comment. Do not change the recursive calls inside it: they must keep calling `check_expr`, so that children are
recorded too. Above it, add:

```aster
// check_expr_node, recording the result for `aster query`: a name that resolved to a local as a "local" fact, any other
// expression as "expr". An expression that failed to check records nothing.
fn check_expr(ctx: Ctx, e: Expr, expected: Option[Type]): TExpr {
    let t: TExpr = check_expr_node(ctx, e, expected);
    if is_error(t.ty) {
        return t;
    }
    if let ExprNode::Name(_) = e.node {
        if let TExprNode::Local(l) = t.node {
            record(ctx.env, fact(ctx, "local", e.start, e.end, t.ty, l.id, "", ""));
            return t;
        }
    }
    record(ctx.env, fact(ctx, "expr", e.start, e.end, t.ty, -1, "", ""));
    return t;
}
```

In the `ExprNode::Field` arm of `check_expr_node`, record the field before returning:

```aster
                if let Option::Some(f) = find_field(ctx.env, name, field.name) {
                    record(ctx.env, fact(ctx, "field", field.start, field.end, f.ty, -1, field.name, name));
                    return TExpr { ty: f.ty, node: TExprNode::Field(object, field.name) };
                }
```

In `check_place`'s `ExprNode::Name` arm, after the immutability check and before `return Option::Some(TPlace …)`, add:

```aster
            record(ctx.env, fact(ctx, "local", target.start, target.end, local.ty, local.id, "", ""));
```

In `check_call`, immediately after the `if let Option::Some(_) = lookup(ctx, name) { … }` block, add:

```aster
    if is_function_name(ctx, name) {
        record(ctx.env, fact(ctx, "callee", callee.start, callee.end, Type::Void, -1, name, ""));
    }
```

- [ ] **Step 5: Run it and check it passes, and that nothing else moved**

Run: `pnpm vitest run tests/provenance.test.ts`
Expected: all pass.

Run: `pnpm vitest run tests/check_aster.test.ts tests/asterc_self.test.ts tests/json_check.test.ts tests/json_inspect.test.ts tests/selfhost_golden.test.ts`
Expected: user-program goldens are unchanged. If a golden of the compiler's **own source** changes (for example a
summary listing the compiler's functions or structs), list each changed line and why (new `SourceFact`, `Paren`,
`record`, `fact`, `check_expr_node`). Refresh that golden only, not the user-program goldens, and record the
explanation for the PR body.

- [ ] **Step 6: Commit**

```bash
git add packages/asterc-self/parser.aster packages/asterc-self/loader.aster packages/asterc-self/checker.aster tests/provenance.test.ts tests/golden
git commit -m "feat: retain checked expression and use-site provenance (#58)"
```

---

### Task 3: Keep the inspect walk as a value

**Files:**
- Modify: `packages/asterc-self/inspect.aster` (`json_files`, `inspect_response`, `Walk`, `located`, `emit`, `walk_fn`, `walk_struct`, `walk_builtin`, `json_semantics`)

**Interfaces:**
- Consumes: `Sha256`, `sha256_new` and `sha256_hex` (Task 1).
- Produces:
  - `struct DeclSite { start: int, end: int, id: int }`: a source declaration's name, with global offsets.
  - New `Walk` fields:
    - `decl_sites: [DeclSite]`
    - `decl_type: Map[int, string]`
    - `decl_signature: Map[int, string]`
    - `local_ids: [[int]]`, indexed `[func][local]`
    - `fn_ids: Map[string, int]`
    - `builtin_ids: Map[string, int]`
    - `field_ids: Map[string, int]`, keyed `"Struct.field"`
  - `fn semantics_walk(loaded: Loaded, checked: Checked): Walk`, which runs both passes.
  - `fn json_semantics_of(w: Walk): string`
  - `fn json_unavailable(reason: string): string`
  - `fn response_fields(command: string, path: string, fe: FrontEnd, digests: Option[Sha256]): [string]`, the
    `schema`…`diagnostics` keys. With `digests`, each `files` entry gains `sha256` after `bom`.
  - `fn file_sha256(s: Sha256, f: SourceFile): string`, the digest of a file's on-disk bytes.

- [ ] **Step 1: Pin today's output as the failing gate**

Run: `pnpm vitest run tests/json_check.test.ts tests/json_inspect.test.ts tests/inspect_consumer.test.ts`
Expected: PASS before the change. These suites are the regression gate for this task: after it, the output must be
byte-identical. The new maps are exercised by Task 4's tests, so this task adds no test of its own.

- [ ] **Step 2: Implement**

Add `import "sha256.aster";` after the existing imports. Replace `json_files` with:

```aster
// The `files` list. With `digests` (`aster query`), each entry also has `sha256`, the digest of its on-disk bytes.
fn json_files(files: [SourceFile], digests: Option[Sha256]): string {
    let out: [string] = [];
    for i in 0..len(files) {
        let shown: string = utf8_lossy(files[i].path);
        let fields: [string] = [json_kv("id", json_int(i)), json_kv("path", json_str(shown)), json_kv("bom", json_bool(files[i].bom > 0))];
        if let Option::Some(sha) = digests {
            push(fields, json_kv("sha256", json_str(file_sha256(sha, files[i]))));
        }
        push_path_exact(fields, files[i].path);
        push(out, json_object(fields));
    }
    return json_array(out);
}

// The SHA-256 of a loaded file as stored on disk: the loader strips a BOM, so it goes back in front.
fn file_sha256(sha: Sha256, f: SourceFile): string {
    let prefix: [int] = [];
    if f.bom > 0 {
        push(prefix, 239);
        push(prefix, 187);
        push(prefix, 191);
    }
    return sha256_hex(sha, prefix, f.src);
}
```

Split `inspect_response` into `response_fields` and itself:

```aster
// The keys every response shares, `schema` through `diagnostics`, for `command` on the root `path`.
fn response_fields(command: string, path: string, fe: FrontEnd, digests: Option[Sha256]): [string] {
    var files: string = "[]";
    let diags: [string] = [];
    match fe {
        FrontEnd::Unreadable => {
            push(diags, json_diagnostic("io.root-unreadable", "cannot read '" + utf8_lossy(path) + "'", json_location(-1, path, Option::None), []));
        }
        FrontEnd::Malformed(raw, bad) => {
            push(diags, json_diagnostic("source.invalid-utf8", utf8_reason(raw, bad), json_location(-1, path, Option::Some(invalid_range(raw, bad))), []));
        }
        FrontEnd::Failed(loaded, ds) => {
            files = json_files(loaded.files, digests);
            for d in sort_diags(ds) {
                push(diags, json_diag(loaded.files, d));
            }
        }
        FrontEnd::Passed(loaded, _) => {
            files = json_files(loaded.files, digests);
        }
    }
    return [
        json_kv("schema", json_str("aster/1")), json_kv("command", json_str(command)), json_kv("ok", json_bool(len(diags) == 0)),
        json_kv("files", files), json_kv("diagnostics", json_array(diags)),
    ];
}

// `semantics` for a program that did not check: `reason` is "io" or "diagnostics".
fn json_unavailable(reason: string): string {
    return json_object([json_kv("available", "false"), json_kv("reason", json_str(reason))]);
}

// The whole response for `command` (`check` or `inspect`) on the root `path`, without a final newline.
fn inspect_response(command: string, path: string, fe: FrontEnd): string {
    let fields: [string] = response_fields(command, path, fe, Option::None);
    if command == "inspect" {
        let semantics: string = match fe {
            FrontEnd::Passed(loaded, checked) => json_semantics(loaded, checked),
            FrontEnd::Unreadable => json_unavailable("io"),
            _ => json_unavailable("diagnostics"),
        };
        push(fields, json_kv("semantics", semantics));
    }
    return json_object(fields);
}
```

Before `struct Walk` add:

```aster
// A source declaration's name (global offsets) and its id, for `aster query`'s declaration sites.
struct DeclSite {
    start: int,
    end: int,
    id: int,
}
```

Extend `struct Walk`, and its comment, with what the rendering pass leaves behind for `aster query`:

```aster
    // Filled by the rendering pass for `aster query`: every source declaration's name; each declaration's `type` and
    // `signature` JSON by id; per function (index in `checked.functions`) the declaration id of each local id; and
    // the ids of functions and builtins by name, and of fields by "Struct.field".
    decl_sites: [DeclSite],
    decl_type: Map[int, string],
    decl_signature: Map[int, string],
    local_ids: [[int]],
    fn_ids: Map[string, int],
    builtin_ids: Map[string, int],
    field_ids: Map[string, int],
```

In `located`, record the site. During rendering, the declaration being built is always the next one emitted:

```aster
fn located(w: Walk, source: bool, name: Ident): string {
    if !source {
        return "null";
    }
    if w.render {
        // The declaration being built is the next one emitted.
        push(w.decl_sites, DeclSite { start: name.start, end: name.end, id: len(w.out) });
    }
    let files: [SourceFile] = w.loaded.files;
    let fi: int = file_index(files, name.start);
    return json_location(fi, files[fi].path, Option::Some(indexed_range(w, fi, name.start, name.end)));
}
```

In `emit`, keep each declaration's `type` and `signature`:

```aster
fn emit(w: Walk, id: int, fields: [string]) {
    if len(w.out) != id {
        panic("internal: inspect ids out of step");
    }
    for f in fields {
        if let Option::Some(v) = json_field_value(f, "type") {
            map_set(w.decl_type, id, v);
        }
        if let Option::Some(v) = json_field_value(f, "signature") {
            map_set(w.decl_signature, id, v);
        }
    }
    push(w.out, json_object(fields));
}

// The value of `field`, a json_kv string, when its key is `key`.
fn json_field_value(field: string, key: string): Option[string] {
    let prefix: string = json_str(key) + ":";
    if len(field) >= len(prefix) && substring(field, 0, len(prefix)) == prefix {
        return Option::Some(substring(field, len(prefix), len(field)));
    }
    return Option::None;
}
```

The map fills:
- In `walk_fn`'s `if w.render { … }` block that builds the signature, add `map_set(w.fn_ids, d.name.name, id);` and
  `w.local_ids[fi] = fact;`.
- In `walk_struct`'s per-field render block, add `map_set(w.field_ids, d.name.name + "." + field.name.name, fid);`.
- In `walk_builtin`, after the `if !w.render { return; }` guard and before the `is_builtin_type_name` branch, add
  `map_set(w.builtin_ids, name, id);`.

Replace `json_semantics` with:

```aster
// Both passes of the declaration walk over a program that checked.
fn semantics_walk(loaded: Loaded, checked: Checked): Walk {
    let ids: Ids = Ids { types: {}, enum_index: {}, struct_index: {}, next: 0 };
    for i in 0..len(checked.enums) {
        map_set(ids.enum_index, checked.enums[i].name, i);
    }
    for i in 0..len(checked.structs) {
        map_set(ids.struct_index, checked.structs[i].name, i);
    }
    let fn_index: Map[string, int] = {};
    let local_ids: [[int]] = [];
    for i in 0..len(checked.functions) {
        map_set(fn_index, checked.functions[i].name, i);
        push(local_ids, []);
    }
    let w: Walk = Walk {
        ids: ids, render: false, out: [], loaded: loaded, checked: checked, prelude: prelude_templates(),
        builtins: builtin_signatures(), fn_index: fn_index, lines: [],
        decl_sites: [], decl_type: {}, decl_signature: {}, local_ids: local_ids, fn_ids: {}, builtin_ids: {}, field_ids: {},
    };
    for f in loaded.files {
        push(w.lines, line_starts(f.src));
    }
    walk(w);
    w.render = true;
    walk(w);
    return w;
}

fn json_semantics_of(w: Walk): string {
    return json_object([json_kv("available", "true"), json_kv("declarations", json_array(w.out))]);
}

// The `semantics` of a program that checked: every declaration, linked to its source.
fn json_semantics(loaded: Loaded, checked: Checked): string {
    return json_semantics_of(semantics_walk(loaded, checked));
}
```

If `push(local_ids, [])` fails to type the empty literal, write `let none: [int] = []; push(local_ids, none);`.

- [ ] **Step 3: Run the gate**

Run: `pnpm vitest run tests/json_check.test.ts tests/json_inspect.test.ts tests/inspect_consumer.test.ts`
Expected: PASS with **no** golden changes (`git status tests/golden` is clean).

- [ ] **Step 4: Commit**

```bash
git add packages/asterc-self/inspect.aster
git commit -m "refactor: keep the inspect walk and its id maps for queries (#59)"
```

---

### Task 4: `aster query`

**Files:**
- Create: `packages/asterc-self/query.aster`
- Modify: `packages/asterc-self/asterc.aster` (`CliArgs`, `usage_text`, `parse_cli`, `main`; add `import "query.aster";`)
- Test: `tests/json_query.test.ts`, goldens `tests/golden/json/query-*.txt`, refreshed `tests/golden/cli/*.txt`
- Modify: `package.json` (add `tests/json_query.test.ts` to the `golden` script)

**Interfaces:**
- Consumes:
  - Task 2: `Checked.facts`, `SourceFact`, `Loaded.parens` and `Paren`.
  - Task 3: `semantics_walk`, `json_semantics_of`, `json_unavailable`, `response_fields`, `Walk`'s new maps and `DeclSite`.
  - From `inspect.aster`: `indexed_range`, `json_location` and `json_type`.
  - From `loader.aster`: `normalise`.
- Produces:
  - `struct QueryRequest { path: string, mode: string, offset: int }`, where `mode` is `"pointer"` or `"caret"`.
  - `struct QueryOutcome { text: string, status: int }`.
  - `fn query_response(entry: string, req: QueryRequest, fe: FrontEnd): QueryOutcome`.

- [ ] **Step 1: Write the failing test** `tests/json_query.test.ts`

The test builds the spec's fixture and checks every row of the spec's two selection tables, plus the BOM/CRLF table.
The spec runs from `/work` with absolute paths. Here the test runs with `cwd` set to the fixture directory and the
entry spelled `main.aster`, so the import loads as `./lib.aster` and the goldens are machine-independent.

```ts
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { goldenPath, renderOutcome, REPO_ROOT } from './golden.js';
import { stage } from './stage.js';

// `aster query` (docs/inspect/README.md, "Position queries"; the contract and its tables are in
// docs/superpowers/specs/2026-10-07-aster-source-query-contract-design.md).
const root = mkdtempSync(join(tmpdir(), 'aster-json-query-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const MAIN = `import "lib.aster";

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
`;
const LIB = 'struct Point { x: int, y: int }\n\nfn twice(n: int): int {\n    return n * 2;\n}\n';
const CRLF = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('fn main(): int {\r\n    return 0;\r\n}\r\n')]);

const strict = new TextDecoder('utf-8', { fatal: true });

function fixture(name: string, files: Record<string, string | Buffer>): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

function run(dir: string, argv: string[]) {
  const r = spawnSync(stage().bin, argv, { cwd: dir, env: { ...process.env, LC_ALL: 'C' }, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Runs a query twice; checks determinism, one line, empty stderr, digests and that semantics equal inspect's. */
function query(dir: string, entry: string, file: string, mode: 'offset' | 'caret', at: number) {
  const argv = ['query', entry, `--file=${file}`, `--${mode}=${at}`];
  const first = run(dir, argv);
  const second = run(dir, argv);
  expect(Buffer.compare(first.stdout, second.stdout), 'deterministic').toBe(0);
  expect(first.stderr.toString('latin1')).toBe('');
  const text = strict.decode(first.stdout);
  expect(text.endsWith('\n') && !text.slice(0, -1).includes('\n'), 'one line').toBe(true);
  const doc = JSON.parse(text);
  expect([doc.schema, doc.command]).toEqual(['aster/1', 'query']);
  for (const f of doc.files) {
    expect(f.sha256, f.path).toBe(createHash('sha256').update(readFileSync(join(dir, f.path))).digest('hex'));
  }
  const inspected = JSON.parse(strict.decode(run(dir, ['inspect', entry]).stdout));
  expect(doc.semantics).toEqual(inspected.semantics);
  expect(doc.query.request).toEqual({ path: file, mode: mode === 'offset' ? 'pointer' : 'caret', offset: at, file: doc.query.request.file });
  return { status: first.status, text, doc, q: doc.query };
}

interface Row { file?: string; at: number; status: string; site?: string; extent?: [number, number]; target?: number; type?: unknown; reason?: string; sigNull?: boolean }

const POINTER: Row[] = [
  { at: 0, status: 'none' },
  { at: 7, status: 'unsupported', site: 'import-path', extent: [7, 18] },
  { at: 24, status: 'found', site: 'declaration', extent: [24, 28], target: 0 },
  { at: 30, status: 'none' },
  { at: 46, status: 'found', site: 'declaration', extent: [46, 47], target: 1 },
  { at: 49, status: 'unsupported', site: 'type-annotation', extent: [49, 54] },
  { at: 57, status: 'unsupported', site: 'struct-literal-name', extent: [57, 62] },
  { at: 65, status: 'unsupported', site: 'field-init-name', extent: [65, 66] },
  { at: 96, status: 'found', site: 'callee', extent: [96, 101], target: 10 },
  { at: 101, status: 'found', site: 'expression', extent: [96, 106], type: { kind: 'int' } },
  { at: 102, status: 'found', site: 'local', extent: [102, 103], target: 1 },
  { at: 103, status: 'found', site: 'expression', extent: [102, 105], type: { kind: 'int' } },
  { at: 104, status: 'found', site: 'field', extent: [104, 105], target: 8, type: { kind: 'int' } },
  { at: 128, status: 'found', site: 'expression', extent: [128, 141], type: { kind: 'string' } },
  { at: 130, status: 'found', site: 'expression', extent: [128, 141], type: { kind: 'string' } },
  { at: 131, status: 'invalid', reason: 'offset-not-boundary' },
  { at: 136, status: 'found', site: 'expression', extent: [128, 141], type: { kind: 'string' } },
  { at: 137, status: 'invalid', reason: 'offset-not-boundary' },
  { at: 141, status: 'none' },
  { at: 143, status: 'none' },
  { at: 176, status: 'unsupported', site: 'variant-name', extent: [176, 182] },
  { at: 182, status: 'found', site: 'expression', extent: [176, 191] },
  { at: 184, status: 'unsupported', site: 'variant-name', extent: [184, 188] },
  { at: 189, status: 'found', site: 'local', extent: [189, 190], target: 2 },
  { at: 197, status: 'none' },
  { at: 202, status: 'found', site: 'expression', extent: [200, 205], type: { kind: 'bool' } },
  { at: 220, status: 'found', site: 'declaration', extent: [220, 221], target: 5 },
  { at: 229, status: 'found', site: 'local', extent: [229, 230], target: 2 },
  { at: 231, status: 'found', site: 'expression', extent: [229, 234], type: { kind: 'int' } },
  { at: 244, status: 'found', site: 'callee', extent: [244, 249], target: 42, sigNull: true },
  { at: 249, status: 'found', site: 'expression', extent: [244, 252], type: { kind: 'void' } },
  { at: 250, status: 'found', site: 'local', extent: [250, 251], target: 5 },
  { at: 271, status: 'unsupported', site: 'type-annotation', extent: [271, 287] },
  { at: 290, status: 'found', site: 'expression', extent: [290, 292], type: { kind: 'map', key: { kind: 'string' }, value: { kind: 'int' } } },
  { at: 298, status: 'none' },
  { at: 305, status: 'found', site: 'expression', extent: [305, 317], type: { kind: 'int' } },
  { at: 306, status: 'found', site: 'local', extent: [306, 307], target: 2 },
  { at: 310, status: 'found', site: 'callee', extent: [310, 313], target: 32, sigNull: true },
  { at: 314, status: 'found', site: 'local', extent: [314, 315], target: 3 },
  { at: 316, status: 'found', site: 'expression', extent: [305, 317], type: { kind: 'int' } },
  { at: 318, status: 'found', site: 'expression', extent: [305, 321], type: { kind: 'int' } },
  { at: 324, status: 'none' },
  { at: 325, status: 'none' },
  { at: 326, status: 'invalid', reason: 'offset-out-of-range' },
  { file: 'lib.aster', at: 42, status: 'found', site: 'declaration', extent: [42, 43], target: 11 },
  { file: 'lib.aster', at: 68, status: 'found', site: 'local', extent: [68, 69], target: 11 },
];

const CARET: Row[] = [
  { at: 0, status: 'none' },
  { at: 47, status: 'found', site: 'declaration', extent: [46, 47], target: 1 },
  { at: 96, status: 'found', site: 'callee', extent: [96, 101], target: 10 },
  { at: 101, status: 'found', site: 'callee', extent: [96, 101], target: 10 },
  { at: 103, status: 'found', site: 'local', extent: [102, 103], target: 1 },
  { at: 105, status: 'found', site: 'field', extent: [104, 105], target: 8 },
  { at: 131, status: 'invalid', reason: 'offset-not-boundary' },
  { at: 140, status: 'found', site: 'expression', extent: [128, 141], type: { kind: 'string' } },
  { at: 141, status: 'none' },
  { at: 182, status: 'unsupported', site: 'variant-name', extent: [176, 182] },
  { at: 190, status: 'found', site: 'local', extent: [189, 190], target: 2 },
  { at: 230, status: 'found', site: 'local', extent: [229, 230], target: 2 },
  { at: 231, status: 'found', site: 'expression', extent: [229, 234], type: { kind: 'int' } },
  { at: 251, status: 'found', site: 'local', extent: [250, 251], target: 5 },
  { at: 325, status: 'none' },
  { at: 326, status: 'invalid', reason: 'offset-out-of-range' },
  { file: 'lib.aster', at: 69, status: 'found', site: 'local', extent: [68, 69], target: 11 },
];

const CRLF_ROWS: Row[] = [
  { at: 0, status: 'none' },
  { at: 1, status: 'invalid', reason: 'offset-not-boundary' },
  { at: 2, status: 'invalid', reason: 'offset-not-boundary' },
  { at: 3, status: 'none' },
  { at: 6, status: 'found', site: 'declaration', extent: [6, 10], target: 0 },
  { at: 19, status: 'none' },
  { at: 32, status: 'found', site: 'expression', extent: [32, 33], type: { kind: 'int' } },
  { at: 39, status: 'none' },
];

function check(r: ReturnType<typeof query>, row: Row) {
  const { status, q, doc } = r;
  expect(q.status).toBe(row.status);
  expect(status).toBe(row.status === 'invalid' ? 2 : 0);
  if (row.reason) expect(q.reason).toBe(row.reason);
  if (row.site) expect(q.site).toBe(row.site);
  if (row.extent) expect([q.location.range.start, q.location.range.end]).toEqual(row.extent);
  if (row.target !== undefined) expect(q.target).toBe(row.target);
  if (row.type) expect(q.type).toEqual(row.type);
  if (row.sigNull) expect(q.signature).toBeNull();
  if (q.status === 'found' || q.status === 'unsupported') {
    expect(doc.files[q.location.file].path).toBe(q.location.path);
    for (const k of ['type', 'signature', 'target']) if (q.status === 'unsupported') expect(k in q).toBe(false);
  }
  if (q.site === 'callee') expect('type' in q).toBe(false);
  if (q.target !== undefined) expect(Number.isInteger(q.target) && q.target < doc.semantics.declarations.length).toBe(true);
}

let dir = '';
beforeAll(() => {
  dir = fixture('main', { 'main.aster': MAIN, 'lib.aster': LIB, 'crlf.aster': CRLF });
});

describe('query selection', () => {
  it.for(POINTER)('pointer $file $at', (row) => check(query(dir, 'main.aster', row.file ?? 'main.aster', 'offset', row.at), row));
  it.for(CARET)('caret $file $at', (row) => check(query(dir, 'main.aster', row.file ?? 'main.aster', 'caret', row.at), row));
  it.for(CRLF_ROWS)('bom+crlf $at', (row) => check(query(dir, 'crlf.aster', 'crlf.aster', 'offset', row.at), row));
  it('caret between touching sites', () => {
    const d = fixture('touch', { 'main.aster': 'fn main(): int {\n    let a: int = 1;\n    let b: int = 2;\n    return a+b;\n}\n' });
    const src = Buffer.from(readFileSync(join(d, 'main.aster')));
    const a = src.indexOf('a+b');
    expect(query(d, 'main.aster', 'main.aster', 'caret', a + 1).q).toMatchObject({ site: 'local', location: { range: { start: a, end: a + 1 } } });
    expect(query(d, 'main.aster', 'main.aster', 'caret', a + 2).q).toMatchObject({ site: 'local', location: { range: { start: a + 2, end: a + 3 } } });
  });
});

describe('query requests', () => {
  it('path spellings of the same loaded file', () => {
    for (const spelling of ['lib.aster', './lib.aster', 'sub/../lib.aster']) {
      expect(query(dir, 'main.aster', spelling, 'offset', 42).q.status, spelling).toBe('found');
    }
  });
  it('a file outside the closure', () => {
    writeFileSync(join(dir, 'other.aster'), 'fn other(): int {\n    return 0;\n}\n');
    const r = query(dir, 'main.aster', 'other.aster', 'offset', 0);
    expect(r.status).toBe(2);
    expect(r.q).toEqual({ request: { path: 'other.aster', mode: 'pointer', offset: 0, file: null }, status: 'invalid', reason: 'file-not-in-closure' });
  });
  it('the largest offset is out of range, not a usage error', () => {
    // 2^63 - 1 is not exact as a JS number, so the argv is written out and the offset compared as text.
    const r = run(dir, ['query', 'main.aster', '--file=main.aster', '--offset=9223372036854775807']);
    expect(r.status).toBe(2);
    const text = strict.decode(r.stdout);
    expect(text).toContain('"offset":9223372036854775807,');
    expect(JSON.parse(text).query).toMatchObject({ status: 'invalid', reason: 'offset-out-of-range' });
  });
  it('an empty imported file', () => {
    const d = fixture('empty', { 'main.aster': 'import "lib.aster";\nfn main(): int {\n    return 0;\n}\n', 'lib.aster': '' });
    expect(query(d, 'main.aster', 'lib.aster', 'offset', 0).q.status).toBe('none');
    expect(query(d, 'main.aster', 'lib.aster', 'caret', 0).q.status).toBe('none');
    expect(query(d, 'main.aster', 'lib.aster', 'offset', 1).q.reason).toBe('offset-out-of-range');
  });
  it('an unavailable program answers no position', () => {
    const d = fixture('broken', { 'main.aster': MAIN, 'lib.aster': LIB.replace('n * 2', 'true') });
    const r = query(d, 'main.aster', 'main.aster', 'offset', 999_999);
    expect(r.status).toBe(1);
    expect(r.doc.semantics).toEqual({ available: false, reason: 'diagnostics' });
    expect(r.q).toEqual({ request: { path: 'main.aster', mode: 'pointer', offset: 999_999, file: null }, status: 'unavailable', reason: 'diagnostics' });
    const missing = run(d, ['query', 'gone.aster', '--file=gone.aster', '--offset=0']);
    expect(missing.status).toBe(2);
    expect(JSON.parse(strict.decode(missing.stdout)).query).toMatchObject({ status: 'unavailable', reason: 'io' });
  });
  it.for([
    ['query', 'main.aster', '--offset=1'],
    ['query', 'main.aster', '--file=main.aster'],
    ['query', 'main.aster', '--file=main.aster', '--offset=1', '--caret=1'],
    ['query', 'main.aster', '--file=main.aster', '--offset=1', '--offset=2'],
    ['query', 'main.aster', '--file=main.aster', '--file=lib.aster', '--offset=1'],
    ['query', 'main.aster', '--file=', '--offset=1'],
    ['query', 'main.aster', '--file=main.aster', '--offset=-1'],
    ['query', 'main.aster', '--file=main.aster', '--offset=+1'],
    ['query', 'main.aster', '--file=main.aster', '--offset=01'],
    ['query', 'main.aster', '--file=main.aster', '--offset=1x'],
    ['query', 'main.aster', '--file=main.aster', '--offset='],
    ['query', 'main.aster', '--file=main.aster', '--offset=9223372036854775808'],
    ['query', 'main.aster', '--file=main.aster', '--offset=1', '--format=json'],
    ['query', 'main.aster', '--file=main.aster', '--offset=1', '--backend=c'],
    ['check', 'main.aster', '--file=main.aster'],
    ['inspect', 'main.aster', '--offset=1'],
  ])('usage error: %s', (argv) => {
    const r = run(dir, argv as string[]);
    expect(r.status).toBe(2);
    expect(r.stdout.length).toBe(0);
    expect(r.stderr.toString()).toMatch(/^error: /);
  });
});

describe('query goldens', () => {
  const cases: [string, string[], number][] = [
    ['query-callee-import', ['--file=main.aster', '--offset=96'], 0],
    ['query-caret-callee', ['--file=main.aster', '--caret=101'], 0],
    ['query-shadow-outer', ['--file=main.aster', '--offset=229'], 0],
    ['query-shadow-inner', ['--file=main.aster', '--offset=250'], 0],
    ['query-builtin', ['--file=main.aster', '--offset=244'], 0],
    ['query-outside', ['--file=other.aster', '--offset=0'], 2],
  ];
  it.for(cases)('%s', async ([name, flags, status]) => {
    writeFileSync(join(dir, 'other.aster'), 'fn other(): int {\n    return 0;\n}\n');
    const r = run(dir, ['query', 'main.aster', ...flags]);
    expect(r.status).toBe(status);
    await expect(renderOutcome({ status: r.status, stdout: strict.decode(r.stdout), stderr: r.stderr.toString() })).toMatchFileSnapshot(goldenPath('json', name));
  });
  it('query-unavailable', async () => {
    const d = fixture('broken-golden', { 'main.aster': MAIN, 'lib.aster': LIB.replace('n * 2', 'true') });
    const r = run(d, ['query', 'main.aster', '--file=main.aster', '--offset=96']);
    expect(r.status).toBe(1);
    await expect(renderOutcome({ status: r.status, stdout: strict.decode(r.stdout), stderr: r.stderr.toString() })).toMatchFileSnapshot(goldenPath('json', 'query-unavailable'));
  });
});

describe('query at scale', () => {
  it('answers on the compiler itself, linking a use into another file', () => {
    const checker = readFileSync(join(REPO_ROOT, 'packages/asterc-self/checker.aster'));
    const use = checker.indexOf('lookup(ctx, name)');
    const r = query(REPO_ROOT, 'packages/asterc-self/asterc.aster', 'packages/asterc-self/checker.aster', 'caret', use + 6);
    expect(r.q).toMatchObject({ status: 'found', site: 'callee' });
    const target = r.doc.semantics.declarations[r.q.target];
    expect([target.kind, target.name]).toEqual(['fn', 'lookup']);
  }, 120_000);
  it('answers a large file in near-linear time', () => {
    const parts: string[] = [];
    let size = 0;
    for (let i = 0; size < 500_000; i++) {
      const part = `fn f${i}(a: int, b: string): int {\n    let c: int = a + len(b);\n    var d: int = c * 2;\n    return d;\n}\n\n`;
      parts.push(part);
      size += part.length;
    }
    parts.push('fn main(): int {\n    return 0;\n}\n');
    const d = fixture('large', { 'main.aster': parts.join('') });
    const started = performance.now();
    const r = run(d, ['query', 'main.aster', '--file=main.aster', `--offset=${size - 20}`]);
    expect(r.status).toBe(0);
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 60_000);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm vitest run tests/json_query.test.ts`
Expected: FAIL. Every case gets a usage error (`unknown command 'query'`).

- [ ] **Step 3: Implement** `packages/asterc-self/query.aster`

```aster
// expect-library
// `aster query` (docs/inspect/README.md, "Position queries"; the contract is
// docs/superpowers/specs/2026-10-07-aster-source-query-contract-design.md): what the source at one saved byte position
// means. Sites come from the checker's facts (Checked.facts), the declaration names `inspect` lists, and a syntactic
// pass marking positions this version does not answer. The innermost by paren-widened extent wins.

import "inspect.aster";

struct QueryRequest {
    path: string,
    // "pointer" (`--offset`) or "caret" (`--caret`).
    mode: string,
    offset: int,
}

struct QueryOutcome {
    text: string,
    status: int,
}

// A selectable site in the queried file, global offsets. `kind` is the contract's site name. `fact` indexes
// Checked.facts for local, callee, field and expression sites; `decl` is the id of a declaration site; otherwise -1.
// `ext_start`/`ext_end` are the span widened by enclosing parentheses.
struct Cand {
    kind: string,
    start: int,
    end: int,
    fact: int,
    decl: int,
    ext_start: int,
    ext_end: int,
}

// Paren pairs by the start and by the end of the expression they enclose.
struct ParenIndex {
    by_start: Map[int, [Paren]],
    by_end: Map[int, [Paren]],
}

struct Query {
    w: Walk,
    fi: int,
    file: SourceFile,
    cands: [Cand],
}

struct QueryAnswer {
    json: string,
    status: int,
}

fn add_paren(m: Map[int, [Paren]], key: int, q: Paren) {
    if let Option::Some(list) = map_get(m, key) {
        push(list, q);
        map_set(m, key, list);
        return;
    }
    map_set(m, key, [q]);
}

fn paren_index(parens: [Paren]): ParenIndex {
    let ix: ParenIndex = ParenIndex { by_start: {}, by_end: {} };
    for q in parens {
        add_paren(ix.by_start, q.inner_start, q);
        add_paren(ix.by_end, q.inner_end, q);
    }
    return ix;
}

// The start of the extent of span [start, end): the outermost `(` of a pair enclosing an expression that starts where
// the span does and lies inside it (the span itself, or its leftmost descendant).
fn extent_start(ix: ParenIndex, start: int, end: int): int {
    var s: int = start;
    if let Option::Some(list) = map_get(ix.by_start, start) {
        for q in list {
            if q.inner_end <= end && q.open < s {
                s = q.open;
            }
        }
    }
    return s;
}

// The end of the extent, symmetrically.
fn extent_end(ix: ParenIndex, start: int, end: int): int {
    var e: int = end;
    if let Option::Some(list) = map_get(ix.by_end, end) {
        for q in list {
            if q.inner_start >= start && q.close > e {
                e = q.close;
            }
        }
    }
    return e;
}

fn cand(ix: ParenIndex, kind: string, start: int, end: int, fact: int, decl: int): Cand {
    return Cand { kind: kind, start: start, end: end, fact: fact, decl: decl, ext_start: extent_start(ix, start, end), ext_end: extent_end(ix, start, end) };
}

// ---- unsupported sites: positions this version recognises but does not answer

fn syn_push(out: [Cand], kind: string, start: int, end: int) {
    push(out, Cand { kind: kind, start: start, end: end, fact: -1, decl: -1, ext_start: start, ext_end: end });
}

fn syn_items(items: [Item]): [Cand] {
    let out: [Cand] = [];
    for item in items {
        match item {
            Item::Fn(d) => {
                for p in d.params {
                    syn_push(out, "type-annotation", p.ty.start, p.ty.end);
                }
                if let Option::Some(r) = d.ret {
                    syn_push(out, "type-annotation", r.start, r.end);
                }
                syn_block(out, d.body);
            }
            Item::Struct(d) => {
                for f in d.fields {
                    syn_push(out, "type-annotation", f.ty.start, f.ty.end);
                }
            }
            Item::Enum(d) => {
                for v in d.variants {
                    for t in v.payload {
                        syn_push(out, "type-annotation", t.start, t.end);
                    }
                }
            }
            Item::Import(d) => {
                syn_push(out, "import-path", d.path_start, d.path_end);
            }
        }
    }
    return out;
}

fn syn_block(out: [Cand], b: Block) {
    for s in b.stmts {
        syn_stmt(out, s);
    }
}

fn syn_else(out: [Cand], other: Else) {
    match other {
        Else::Block(b) => {
            syn_block(out, b);
        }
        Else::If(s) => {
            syn_stmt(out, s);
        }
        Else::IfLet(s) => {
            syn_stmt(out, s);
        }
        Else::None => {}
    }
}

fn syn_arms(out: [Cand], arms: [Arm]) {
    for a in arms {
        syn_push(out, "pattern", a.pattern.start, a.pattern.end);
        match a.body {
            ArmBody::Block(b) => {
                syn_block(out, b);
            }
            ArmBody::Expr(x) => {
                syn_expr(out, x);
            }
        }
    }
}

fn syn_stmt(out: [Cand], s: Stmt) {
    match s.node {
        StmtNode::Let(_, _, ty, init) => {
            syn_push(out, "type-annotation", ty.start, ty.end);
            syn_expr(out, init);
        }
        StmtNode::LetElse(pattern, init, _, other) => {
            syn_push(out, "pattern", pattern.start, pattern.end);
            syn_expr(out, init);
            syn_block(out, other);
        }
        StmtNode::Assign(_, target, value) => {
            syn_expr(out, target);
            syn_expr(out, value);
        }
        StmtNode::If(cond, then, other) => {
            syn_expr(out, cond);
            syn_block(out, then);
            syn_else(out, other);
        }
        StmtNode::IfLet(pattern, scrutinee, then, other) => {
            syn_push(out, "pattern", pattern.start, pattern.end);
            syn_expr(out, scrutinee);
            syn_block(out, then);
            syn_else(out, other);
        }
        StmtNode::While(cond, body) => {
            syn_expr(out, cond);
            syn_block(out, body);
        }
        StmtNode::ForRange(_, from, to, body) => {
            syn_expr(out, from);
            syn_expr(out, to);
            syn_block(out, body);
        }
        StmtNode::ForEach(_, iter, body) => {
            syn_expr(out, iter);
            syn_block(out, body);
        }
        StmtNode::Match(_, scrutinee, arms) => {
            syn_expr(out, scrutinee);
            syn_arms(out, arms);
        }
        StmtNode::Return(value) => {
            if let Option::Some(v) = value {
                syn_expr(out, v);
            }
        }
        StmtNode::Block(b) => {
            syn_block(out, b);
        }
        StmtNode::Expr(e) => {
            syn_expr(out, e);
        }
        _ => {}
    }
}

fn syn_expr(out: [Cand], e: Expr) {
    match e.node {
        ExprNode::Unary(_, x) => {
            syn_expr(out, x);
        }
        ExprNode::Binary(_, l, r) => {
            syn_expr(out, l);
            syn_expr(out, r);
        }
        ExprNode::Call(callee, args) => {
            syn_expr(out, callee);
            for a in args {
                syn_expr(out, a);
            }
        }
        ExprNode::If(c, t, o) => {
            syn_expr(out, c);
            syn_expr(out, t);
            syn_expr(out, o);
        }
        ExprNode::Field(x, _) => {
            syn_expr(out, x);
        }
        ExprNode::StructLit(name, inits) => {
            syn_push(out, "struct-literal-name", name.start, name.end);
            for i in inits {
                syn_push(out, "field-init-name", i.name.start, i.name.end);
                syn_expr(out, i.value);
            }
        }
        ExprNode::Index(a, i) => {
            syn_expr(out, a);
            syn_expr(out, i);
        }
        ExprNode::Try(x) => {
            syn_expr(out, x);
        }
        ExprNode::ArrayLit(xs) => {
            for x in xs {
                syn_expr(out, x);
            }
        }
        ExprNode::Variant(en, v, args) => {
            syn_push(out, "variant-name", en.start, en.end);
            syn_push(out, "variant-name", v.start, v.end);
            for a in args {
                syn_expr(out, a);
            }
        }
        ExprNode::Match(_, scrutinee, arms) => {
            syn_expr(out, scrutinee);
            syn_arms(out, arms);
        }
        _ => {}
    }
}

// ---- selection

fn fact_site(kind: string): string {
    return if kind == "expr" { "expression" } else { kind };
}

fn is_name_site(kind: string): bool {
    return kind == "declaration" || kind == "local" || kind == "callee" || kind == "field" || kind == "variant-name"
        || kind == "struct-literal-name" || kind == "field-init-name";
}

fn is_unsupported(kind: string): bool {
    return kind == "type-annotation" || kind == "variant-name" || kind == "struct-literal-name" || kind == "field-init-name"
        || kind == "pattern" || kind == "import-path";
}

// Every site in file `fi`: facts (deepest first, as recorded), declaration names, then unsupported spans.
fn build_query(w: Walk, fi: int): Query {
    let f: SourceFile = w.loaded.files[fi];
    let lo: int = f.base;
    let hi: int = f.base + len(f.src);
    let ix: ParenIndex = paren_index(w.loaded.parens);
    let cands: [Cand] = [];
    let facts: [SourceFact] = w.checked.facts;
    for i in 0..len(facts) {
        if facts[i].start >= lo && facts[i].end <= hi {
            push(cands, cand(ix, fact_site(facts[i].kind), facts[i].start, facts[i].end, i, -1));
        }
    }
    for d in w.decl_sites {
        if d.start >= lo && d.end <= hi {
            push(cands, cand(ix, "declaration", d.start, d.end, -1, d.id));
        }
    }
    for s in syn_items(w.loaded.items) {
        if s.start >= lo && s.end <= hi {
            push(cands, cand(ix, s.kind, s.start, s.end, -1, -1));
        }
    }
    return Query { w: w, fi: fi, file: f, cands: cands };
}

// The innermost site whose extent contains global offset `g`: the smallest extent; on a tie a name site, then the one
// listed first (facts are recorded children first).
fn select_at(q: Query, g: int): Option[int] {
    var best: int = -1;
    for i in 0..len(q.cands) {
        let c: Cand = q.cands[i];
        if c.ext_start <= g && g < c.ext_end {
            if best < 0 {
                best = i;
            } else {
                let b: Cand = q.cands[best];
                let size: int = c.ext_end - c.ext_start;
                let best_size: int = b.ext_end - b.ext_start;
                if size < best_size || (size == best_size && is_name_site(c.kind) && !is_name_site(b.kind)) {
                    best = i;
                }
            }
        }
    }
    if best < 0 {
        return Option::None;
    }
    return Option::Some(best);
}

// The byte at on-disk offset `o` of `f`, BOM included.
fn raw_byte(f: SourceFile, o: int): int {
    if o < f.bom {
        let bom: [int] = [239, 187, 191];
        return bom[o];
    }
    return byte_at(f.src, o - f.bom);
}

fn is_continuation(b: int): bool {
    return b >= 128 && b < 192;
}

// Pointer selection at on-disk offset `o` (a code point start below the file's size). The BOM is not source.
fn pointer(q: Query, o: int): Option[int] {
    if o < q.file.bom || o >= q.file.bom + len(q.file.src) {
        return Option::None;
    }
    return select_at(q, q.file.base + o - q.file.bom);
}

// Caret selection at on-disk offset `o`: the character after the caret if it is a name, else the one before if that
// is, else the pointer answer after it (none at end of file).
fn caret(q: Query, o: int): Option[int] {
    let size: int = q.file.bom + len(q.file.src);
    var right: Option[int] = Option::None;
    if o < size {
        right = pointer(q, o);
        if let Option::Some(i) = right {
            if is_name_site(q.cands[i].kind) {
                return right;
            }
        }
    }
    if o > 0 {
        var k: int = o - 1;
        while k > 0 && is_continuation(raw_byte(q.file, k)) {
            k -= 1;
        }
        let left: Option[int] = pointer(q, k);
        if let Option::Some(i) = left {
            if is_name_site(q.cands[i].kind) {
                return left;
            }
        }
    }
    return right;
}

// ---- the response

fn request_json(req: QueryRequest, fi: int): string {
    return json_object([
        json_kv("path", json_str(utf8_lossy(req.path))), json_kv("mode", json_str(req.mode)), json_kv("offset", json_int(req.offset)),
        json_kv("file", if fi < 0 { "null" } else { json_int(fi) }),
    ]);
}

fn query_json(req: QueryRequest, fi: int, rest: [string]): string {
    let fields: [string] = [json_kv("request", request_json(req, fi))];
    for f in rest {
        push(fields, f);
    }
    return json_object(fields);
}

fn id_of(m: Map[string, int], key: string): int {
    let Option::Some(id) = map_get(m, key) else {
        panic("internal: query has no declaration for '" + key + "'");
    };
    return id;
}

// The status, site, location and answer of the chosen site.
fn site_fields(q: Query, c: Cand): [string] {
    let w: Walk = q.w;
    let found: bool = !is_unsupported(c.kind);
    let fields: [string] = [
        json_kv("status", json_str(if found { "found" } else { "unsupported" })), json_kv("site", json_str(c.kind)),
        json_kv("location", json_location(q.fi, q.file.path, Option::Some(indexed_range(w, q.fi, c.ext_start, c.ext_end)))),
    ];
    if !found {
        return fields;
    }
    if c.kind == "declaration" {
        if let Option::Some(t) = map_get(w.decl_type, c.decl) {
            push(fields, json_kv("type", t));
        }
        if let Option::Some(s) = map_get(w.decl_signature, c.decl) {
            push(fields, json_kv("signature", s));
        }
        push(fields, json_kv("target", json_int(c.decl)));
        return fields;
    }
    let f: SourceFact = w.checked.facts[c.fact];
    if c.kind == "callee" {
        var id: int = -1;
        if let Option::Some(user) = map_get(w.fn_ids, f.name) {
            id = user;
        } else {
            id = id_of(w.builtin_ids, f.name);
        }
        let Option::Some(sig) = map_get(w.decl_signature, id) else {
            panic("internal: query has no signature for '" + f.name + "'");
        };
        push(fields, json_kv("signature", sig));
        push(fields, json_kv("target", json_int(id)));
        return fields;
    }
    push(fields, json_kv("type", json_type(w.ids, w.checked, f.ty)));
    if c.kind == "local" {
        push(fields, json_kv("target", json_int(w.local_ids[f.func][f.local])));
    } else if c.kind == "field" {
        push(fields, json_kv("target", json_int(id_of(w.field_ids, f.owner + "." + f.name))));
    }
    return fields;
}

fn invalid(req: QueryRequest, fi: int, reason: string): QueryAnswer {
    return QueryAnswer { json: query_json(req, fi, [json_kv("status", json_str("invalid")), json_kv("reason", json_str(reason))]), status: 2 };
}

// The `query` object for a program that checked.
fn answer_query(w: Walk, req: QueryRequest): QueryAnswer {
    let files: [SourceFile] = w.loaded.files;
    let want: string = normalise(req.path);
    var fi: int = -1;
    for i in 0..len(files) {
        if fi < 0 && normalise(files[i].path) == want {
            fi = i;
        }
    }
    if fi < 0 {
        return invalid(req, -1, "file-not-in-closure");
    }
    let f: SourceFile = files[fi];
    let size: int = f.bom + len(f.src);
    if req.offset > size {
        return invalid(req, fi, "offset-out-of-range");
    }
    if req.offset < size && is_continuation(raw_byte(f, req.offset)) {
        return invalid(req, fi, "offset-not-boundary");
    }
    let q: Query = build_query(w, fi);
    let chosen: Option[int] = if req.mode == "caret" { caret(q, req.offset) } else { pointer(q, req.offset) };
    let Option::Some(i) = chosen else {
        return QueryAnswer { json: query_json(req, fi, [json_kv("status", json_str("none"))]), status: 0 };
    };
    return QueryAnswer { json: query_json(req, fi, site_fields(q, q.cands[i])), status: 0 };
}

// The whole `aster query` response for the entry `entry`, without a final newline, and its exit status.
fn query_response(entry: string, req: QueryRequest, fe: FrontEnd): QueryOutcome {
    let fields: [string] = response_fields("query", entry, fe, Option::Some(sha256_new()));
    match fe {
        FrontEnd::Passed(loaded, checked) => {
            let w: Walk = semantics_walk(loaded, checked);
            push(fields, json_kv("semantics", json_semantics_of(w)));
            let answer: QueryAnswer = answer_query(w, req);
            push(fields, json_kv("query", answer.json));
            return QueryOutcome { text: json_object(fields), status: answer.status };
        }
        _ => {
            let reason: string = match fe {
                FrontEnd::Unreadable => "io",
                _ => "diagnostics",
            };
            push(fields, json_kv("semantics", json_unavailable(reason)));
            push(fields, json_kv("query", query_json(req, -1, [json_kv("status", json_str("unavailable")), json_kv("reason", json_str(reason))])));
            return QueryOutcome { text: json_object(fields), status: front_end_status(fe) };
        }
    }
}
```

`sha256_new()` builds two 65,536-entry tables. Response time is measured in Task 5. If those tables dominate a
small query, build them only when `fe` has files.

- [ ] **Step 4: Wire the CLI** in `asterc.aster`

- Add `import "query.aster";` after `import "inspect.aster";`.
- Add to `struct CliArgs`:

```aster
    // `query` only: `--file`, and the position: `query_mode` "pointer" (`--offset`) or "caret" (`--caret`).
    query_file: string,
    query_mode: string,
    query_offset: int,
```

- In `usage_text`, add the line `\n  aster query <file.aster> --file=<path> (--offset=<byte> | --caret=<byte>)` after the `inspect` line.
- Add the parser for offsets:

```aster
// A canonical decimal position up to 2^63 - 1: `0`, or a non-zero digit followed by digits.
fn parse_offset(text: string): Option[int] {
    if len(text) == 0 || len(text) > 19 || (len(text) > 1 && byte_at(text, 0) == '0') {
        return Option::None;
    }
    let max: string = "9223372036854775807";
    var bigger: bool = false;
    var decided: bool = len(text) < 19;
    var n: int = 0;
    for i in 0..len(text) {
        let c: int = byte_at(text, i);
        if c < '0' || c > '9' {
            return Option::None;
        }
        if !decided && c != byte_at(max, i) {
            bigger = c > byte_at(max, i);
            decided = true;
        }
        n = n * 10 + (c - '0');
    }
    if bigger {
        return Option::None;
    }
    return Option::Some(n);
}
```

- In `parse_cli`:
  - Accept `query` in the command check, and add `|| command == "query"` to the `--backend` rejection.
  - Declare `var query_file: Option[string] = Option::None; var query_mode: string = ""; var query_offset: int = 0;`.
  - Add these branches before the `cli_starts_with(arg, "-")` branch:

```aster
        } else if cli_starts_with(arg, "--file=") {
            if command != "query" {
                return Result::Err("'--file' is only valid with 'query'");
            }
            if let Option::Some(_) = query_file {
                return Result::Err("'--file' given more than once");
            }
            let value: string = substring(arg, len("--file="), len(arg));
            if value == "" {
                return Result::Err("'--file' requires a path");
            }
            query_file = Option::Some(value);
        } else if cli_starts_with(arg, "--offset=") || cli_starts_with(arg, "--caret=") {
            let flag: string = if cli_starts_with(arg, "--offset=") { "--offset" } else { "--caret" };
            if command != "query" {
                return Result::Err("'" + flag + "' is only valid with 'query'");
            }
            if query_mode != "" {
                return Result::Err("give one position: '--offset' or '--caret', once");
            }
            let Option::Some(n) = parse_offset(substring(arg, len(flag) + 1, len(arg))) else {
                return Result::Err("'" + flag + "' needs a byte offset, 0 to 9223372036854775807");
            };
            query_mode = if flag == "--offset" { "pointer" } else { "caret" };
            query_offset = n;
```

  - After `let Option::Some(path) = file else { … };`, add:

```aster
    var query_path: string = "";
    if command == "query" {
        let Option::Some(qf) = query_file else {
            return Result::Err("'query' requires '--file'");
        };
        if query_mode == "" {
            return Result::Err("'query' requires '--offset' or '--caret'");
        }
        query_path = qf;
    }
```

  - Extend the `CliArgs { … }` literal with `query_file: query_path, query_mode: query_mode, query_offset: query_offset`.

- In `main`, right after `let fe: FrontEnd = front_end(parsed.file);`:

```aster
    if parsed.command == "query" {
        let out: QueryOutcome = query_response(parsed.file, QueryRequest { path: parsed.query_file, mode: parsed.query_mode, offset: parsed.query_offset }, fe);
        print(out.text);
        return out.status;
    }
```

- [ ] **Step 5: Run it, review the goldens, then run again**

Run: `pnpm vitest run tests/json_query.test.ts -u`, then open each new `tests/golden/json/query-*.txt`. Check each
`query` object against the spec's contract examples 1, 1b, 2, 3, 4 and 5: the same keys in the same order, the same
targets and extents, `"mode"` present, and `sha256` on each file. Fix any disagreement in code, not in the golden.

Run: `pnpm vitest run tests/json_query.test.ts`
Expected: all pass.

Add `tests/json_query.test.ts` to the `golden` script in `package.json`.

Run: `pnpm golden`, then `git diff --stat tests/golden`.
Expected: the only changes are the new `query-*.txt` files and the `tests/golden/cli/*` usage goldens, whose one
change is the new `aster query` usage line. Inspect `git diff tests/golden/cli | grep '^[-+]' | sort | uniq -c`: every
changed line must be that usage line. Anything else is a regression to fix.

- [ ] **Step 6: Commit**

```bash
git add packages/asterc-self/query.aster packages/asterc-self/asterc.aster tests/json_query.test.ts tests/golden package.json
git commit -m "feat: aster query, one-shot source type and definition queries (#59)"
```

---

### Task 5: Consumer, stage suites, documentation and measurements

**Files:**
- Create: `tests/query_consumer.test.ts`
- Modify: `scripts/selfhost.ts` (`STAGE_SUITES`), `docs/inspect/README.md`, the spec status line

**Interfaces:**
- Consumes: the public `aster query` JSON only.
- Produces: nothing in code.

- [ ] **Step 1: Write the consumer test** `tests/query_consumer.test.ts`

```ts
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { stage } from './stage.js';

// The acceptance test of issue #59: a consumer that knows only the public JSON contract of `aster query`. It finds
// positions by byte offset, never reads stderr or diagnostic text, and refuses an answer whose digests no longer match.

const dir = mkdtempSync(join(tmpdir(), 'aster-query-consumer-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const strict = new TextDecoder('utf-8', { fatal: true });

const MAIN = 'import "shapes.aster";\n\n// 📐 entry\nfn main(): int {\n    let side: int = 3;\n    return area(side);\n}\n';
const SHAPES = 'fn area(side: int): int {\n    return side * side;\n}\n';

function aster(argv: string[]) {
  const r = spawnSync(stage().bin, argv, { cwd: dir, env: { ...process.env, LC_ALL: 'C' }, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, doc: JSON.parse(strict.decode(r.stdout)) };
}

const sha = (path: string) => createHash('sha256').update(readFileSync(join(dir, path))).digest('hex');
/** Whether every file the answer depends on still has the bytes it was computed from. */
const fresh = (doc: any) => doc.files.every((f: any) => sha(f.path) === f.sha256);

describe('a query consumer', () => {
  it('goes from a caret after a callee to the imported declaration', () => {
    writeFileSync(join(dir, 'main.aster'), MAIN);
    writeFileSync(join(dir, 'shapes.aster'), SHAPES);
    const caret = Buffer.from(MAIN).indexOf('area(') + 'area'.length;
    const { status, doc } = aster(['query', 'main.aster', '--file=main.aster', `--caret=${caret}`]);
    expect(status).toBe(0);
    expect(fresh(doc)).toBe(true);
    expect(doc.query.site).toBe('callee');
    expect(doc.query.signature.ret).toEqual({ kind: 'int' });
    const target = doc.semantics.declarations[doc.query.target];
    const path = doc.files[target.location.file].path;
    expect(readFileSync(join(dir, path)).subarray(target.location.range.start, target.location.range.end).toString()).toBe('area');
  });

  it('reads the type of a use and its declaration', () => {
    const at = Buffer.from(MAIN).indexOf('side);');
    const { doc } = aster(['query', 'main.aster', '--file=main.aster', `--offset=${at}`]);
    expect(doc.query).toMatchObject({ status: 'found', site: 'local', type: { kind: 'int' } });
    expect(doc.semantics.declarations[doc.query.target]).toMatchObject({ kind: 'local', name: 'side' });
  });

  it('treats a comment as no result, not an error', () => {
    const at = Buffer.from(MAIN).indexOf('entry');
    const { status, doc } = aster(['query', 'main.aster', '--file=main.aster', `--offset=${at}`]);
    expect([status, doc.query.status]).toEqual([0, 'none']);
  });

  it('detects a stale response', () => {
    const at = Buffer.from(MAIN).indexOf('side);');
    const { doc } = aster(['query', 'main.aster', '--file=main.aster', `--offset=${at}`]);
    writeFileSync(join(dir, 'shapes.aster'), SHAPES + '// edited after the query\n');
    expect(fresh(doc)).toBe(false);
    writeFileSync(join(dir, 'shapes.aster'), SHAPES);
    expect(fresh(doc)).toBe(true);
  });

  it('gets no semantics from a broken import, by status alone', () => {
    writeFileSync(join(dir, 'shapes.aster'), SHAPES.replace('side * side', 'true'));
    const { status, doc } = aster(['query', 'main.aster', '--file=main.aster', '--offset=0']);
    expect(status).toBe(1);
    expect(doc.query).toMatchObject({ status: 'unavailable', reason: 'diagnostics' });
    expect(doc.diagnostics[0].code).toBe('type.mismatch');
    writeFileSync(join(dir, 'shapes.aster'), SHAPES);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/query_consumer.test.ts`
Expected: PASS. It passes on first run, because Task 4 already provides the interface; this is an acceptance test.

- [ ] **Step 3: Register the stage suites**

In `scripts/selfhost.ts`, append `'tests/sha256.test.ts'`, `'tests/provenance.test.ts'`, `'tests/json_query.test.ts'`
and `'tests/query_consumer.test.ts'` to `STAGE_SUITES`.

Run: `pnpm vitest run tests/selfhost_script.test.ts`
Expected: PASS. Its "lists exactly the suites" test requires every suite that imports `stage.js` to be listed.

- [ ] **Step 4: Measure**

Run each line three times and keep the median elapsed time and the peak resident memory:

```bash
pnpm build
F=$(mktemp -d)   # the small fixture: main.aster + lib.aster from the spec
/usr/bin/time -f '%e s %M KB' build/asterc inspect "$F/main.aster" >/dev/null
/usr/bin/time -f '%e s %M KB' build/asterc query "$F/main.aster" --file="$F/main.aster" --offset=96 >/dev/null
/usr/bin/time -f '%e s %M KB' build/asterc inspect packages/asterc-self/asterc.aster >/dev/null
/usr/bin/time -f '%e s %M KB' build/asterc query packages/asterc-self/asterc.aster --file=packages/asterc-self/checker.aster --offset=1000 >/dev/null
```

Run the same pair on the generated 500 KB input from `json_query.test.ts`, written to a file. Record the revision
(`git rev-parse --short HEAD`).

If a query takes more than three times the matching `inspect`, profile before going on. The likely cause is the
SHA-256 tables or a per-candidate rescan.

- [ ] **Step 5: Document**

In `docs/inspect/README.md`:
- Add `aster query <file.aster> --file=<path> (--offset=<byte> | --caret=<byte>)` to **Commands**.
- Add a `## Position queries` section after **Declarations (inspect)**, carried over from the spec:
  - The `query` object table.
  - Statuses and exit codes.
  - The selection rule, including extents and caret mode.
  - The site table, and the unsupported sites.
  - Freshness.
  - One worked example: contract example 1.
  - A link to the spec, for the full selection tables.
- Add the query rows to the **Failure matrix**.
- Extend **Compatibility** with the additive keys.
- Replace the **Validation** line with this run's revision, commands and results, and add a **Measurements** table
  with the Step 4 numbers.

In the spec, change the **Status** paragraph to say it is implemented by PR #64 (`aster query`), and that
`docs/inspect/README.md` is the user-facing reference.

- [ ] **Step 6: Full verification**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: clean, all tests pass.

Run: `pnpm selfhost --suite=S1 --suite=S2 --suite=S3`
Expected: PASS, with C fixed points at every hop. `SL1` and the full proof need clang 18 and lld. If they are not
installed locally, say so; CI's `proof` jobs run them.

- [ ] **Step 7: Commit**

```bash
git add tests/query_consumer.test.ts scripts/selfhost.ts docs/inspect/README.md docs/superpowers/specs/2026-10-07-aster-source-query-contract-design.md
git commit -m "test: query consumer, stage suites and position query docs (#59)"
```

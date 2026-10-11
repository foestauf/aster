# Where `aster query` spends its time (#71)

[#62's session-cost record](session-cost.md) put a hover on the compiler's 18-file closure at about 360 ms of compiler
work. This record attributes that time, adopts one runtime fix and adds the SHA-256 builtin that the next PR switches
`query` onto. Linux x86_64 (WSL2), AMD Ryzen 7 5800X, gcc 13.3, warm page cache.

Raw data:

- [`data/query-profile/profile-before.md`](data/query-profile/profile-before.md) and
  [`profile-after.md`](data/query-profile/profile-after.md): `node scripts/query-profile.ts`, which shows the user/system
  split, a gprof flat profile and the allocation callers for one query on each input.
- [`data/query-profile/session-cost-before.md`](data/query-profile/session-cost-before.md),
  [`session-cost-concat.md`](data/query-profile/session-cost-concat.md) and
  [`session-cost-after.md`](data/query-profile/session-cost-after.md): `node scripts/session-cost.ts --runs=10
  --compiler=…`, run on the same inputs with main's compiler, main's source with only the new concat, and this branch.

`perf` is not available under this WSL kernel, so the profile uses gprof (`cc -pg`). gprof samples the compiler's own
functions every 10 ms and sees no libc or kernel time. One query gives only 20–33 samples, so each gprof share is good
to about ±20 ms. Wall times are medians of 10 runs, with min–max in the raw files.

## Attribution (main, compiler closure, `query asterc.aster --file=checker.aster --offset=1000`)

`/usr/bin/time` gives a median of 0.38 s real: **0.22 s user, 0.17 s system**, with a 335 MB peak RSS. The
system time is the kernel faulting in fresh pages. The runtime never frees, so every allocated byte is a new page
touched once.

| Cost | Approx. | Evidence |
| --- | ---: | --- |
| Page faults from allocation | ~170 ms (sys) | 307 MB requested. **158 MB of it is `string_literal_value`** in the checker, which decodes a literal by appending one byte at a time: the 17 KB C-runtime literal in `runtime.aster` alone is quadratic. JSON assembly (`json_join`, `json_object`, `json_kv`, `json_str`) requests about 80 MB more. |
| SHA-256 in pure Aster | ~120–150 ms (user) | `sha256_block`, `rotr32` and most of the 38 M `aster_rt_array_at` calls (the 256×256 xor/and tables) are 85% of gprof samples. That matches `query` − `inspect` from #62. |
| Load, lex, parse, check, collect, positions | ~50 ms (user) | Every remaining function is at most one or two samples. |

Neither the stage split in #62 (check ~150 / collect+serialise ~90 / digests+positions ~120 ms) nor the issue's
candidate list predicted that a third of the time was the kernel. Subtracting matched commands moved the allocation
cost into whichever stage happened to allocate.

The generated 467 KiB file differs: the response is 7.9 MB, JSON assembly requests 470 of its 560 MB, and the
page-fault share is about the same as the SHA-256 share (0.33 s sys, 0.44 s user).

## Adopted: in-place concatenation (runtime)

`aster_rt_concat` now takes its memory from a bump arena. When the left operand ends exactly at the arena's top, it
appends the right operand's bytes there and returns a longer view of the same memory. Strings are immutable
`(pointer, length)` views, so the left operand still sees its old bytes. A second append to the same prefix finds the
top has moved and copies (`tests/programs/strings/concat_sharing.aster`). `out += piece` loops become linear without any
change to the language or the compiler's source. An arena that runs out is abandoned, like every other string.

Output is identical: every golden, the C and IR fixed point and `inspect`/`query`/`--emit=c` of the compiler are
unchanged.

| Program | Command | Before ms | After ms | Before RSS KiB | After RSS KiB |
| --- | --- | ---: | ---: | ---: | ---: |
| compiler (18 files) | check | 188.8 (186.1–194.5) | 75.0 (69.4–77.4) | 297192 | 50720 |
| compiler (18 files) | inspect | 291.0 (279.7–309.7) | 154.3 (139.8–186.0) | 412646 | 116412 |
| compiler (18 files) | query | 415.7 (406.9–473.1) | 251.9 (249.0–272.9) | 417896 | 119860 |
| generated (467 KiB) | check | 128.5 (126.2–157.4) | 131.6 (124.3–148.1) | 105468 | 100816 |
| generated (467 KiB) | inspect | 595.4 (575.4–661.2) | 405.5 (391.9–441.5) | 650408 | 415414 |
| generated (467 KiB) | query | 740.8 (729.8–767.2) | 563.5 (554.0–576.7) | 673452 | 430686 |

Before = main's source and runtime, after = main's source with only the new concat. The 1-line and 2-file programs
are unchanged, within ±0.3 ms. This branch's full build (concat plus the unused builtin) measures the same:
`query` on the compiler is 255.1 ms (249.8–294.7).

The "before" `check` here (189 ms) is slower than #62's ~150 ms. The closure grew with this branch's `runtime.aster`,
whose literal the quadratic decoder pays for, and both records ran on a shared desktop.

## Adopted: `sha256_hex` builtin (decision)

Hashing stays in `query`'s contract (per-file `sha256` freshness, docs/inspect/README.md). The choice was between a
runtime builtin and bitwise integer operators in the language. **Decision: a runtime builtin**,
`sha256_hex(s: string): string`, implemented in C in `runtime/aster_rt.c`. It is small, has no effect on the grammar,
and is checked against Node's `crypto` at every padding boundary (`tests/sha256.test.ts`) and against the FIPS vectors
in the corpus (`tests/programs/strings/sha256.aster`). Bitwise operators remain open as a separate language question;
nothing here rules them out.

The compiler can't use the builtin yet: the release that bootstraps it doesn't know the name (the two-step rule in
[building.md](../self-host/building.md)). This PR renames the pure-Aster function to `sha256_digest`, because builtin
names cannot be redefined. A follow-up PR, after this one's release, switches `inspect.aster` to `sha256_hex` and
deletes `sha256.aster`. The gprof share above predicts about 120–150 ms off `query` on the compiler closure. That PR
must measure it.

## Not adopted (yet)

- **JSON assembly.** On the compiler closure it is now small. On the generated file it is still the largest
  allocator: `json_join` is balanced, but each nesting level copies its children's text again. A writer that streams
  pieces in output order would remove that without changing `aster/1`. It is the next candidate if large responses
  matter; the 467 KiB input is synthetic.
- **A smaller query response.** Not proposed: serialisation does not dominate on the compiler closure, and changing the
  response would be a public-contract change.
- **Map rebuilds** (`map_rebuild`, 11 MB on the compiler, 31 MB on the generated file) and lexer/parser allocations are
  each under 5% of requested bytes.

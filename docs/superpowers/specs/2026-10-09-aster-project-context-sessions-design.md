# Project context and bounded compiler sessions — discovery design (#62)

Issue: [#62](https://github.com/foestauf/aster/issues/62). Roadmap: #63. Baseline: main `26d78209aea9078579533c0265b7695021608c9d`.

## Intent

The user feels the friction directly: setup needs an explicit `aster.compilerPath` and a single `aster.entry`,
external disk changes don't refresh, and a hover on a compiler-sized program costs about a third of a second. The
discovery should be pragmatic. It ends in a short, evidence-backed decision that names the smallest worthwhile
change, which is then scoped as its own implementation issue. "Keep explicit configuration and fresh compiler
processes" is a valid outcome.

Out of scope, as the issue says: manifests with package resolution, executable configuration, namespaced modules,
an LSP rewrite, a benchmark framework, and any daemon, cache or GC chosen in advance. Nothing here changes the
compiler, the `aster/1` schema, import identity or the extension's behaviour.

## Approach: evidence first, then decide

Two small committed scripts gather evidence on the current compiler and adapter. A short decision document then
compares the candidates using that evidence. Both scripts can be re-run, so the numbers can be reproduced rather
than taken on trust.

### Track A — `scripts/context-matrix.ts`

It generates throwaway fixtures under a temporary directory and, for each case, runs:

- the **CLI** (`build/asterc check --format=json` and `query`, from the cases' working directories), as an agent
  would;
- the **editor adapter** (`editors/vscode/src/adapter.cjs` `Session`, with an `isDirty` stub and the real runner),
  as the extension would.

Cases: one entry; two entries sharing a library; a focused imported file; two workspace folders; an alternate
working directory; a file outside the selected closure; a missing entry; an ambiguous entry (two files with
`main`); a changed import; a deleted import; an import cycle; a diamond; a symlink alias of an imported file; a
lone-CR file; non-UTF-8 bytes; an external disk change after a check.

Each row records the observed CLI result, the observed adapter result, whether the two agree on entry, closure and
answer, and the **user decision needed**. Two rows cannot be reproduced on Linux ext4 without a real VS Code:
case-insensitive path aliases and a non-UTF-8 editor encoding. Those rows are marked *analysed, not reproduced*,
with the reasoning taken from the adapter source. The script writes `docs/context/matrix.md` and the raw JSON to
`docs/context/data/matrix.json`.

### Track B — `scripts/session-cost.ts`

- **Provenance header:** git revision and dirty flag, the compiler binary's SHA-256, `uname -srm`, CPU model and
  logical CPU count, `cc --version` first line, Node version, the timestamp, and the cache statement (warm page
  cache; the first sample of each case is reported separately as the nearest available approximation of cold).
- **Process runs:** inputs are the two-file demo, the compiler's 18-file closure (`asterc.aster`, query
  `--file=checker.aster --offset=1000`), and a generated ~500 KB single file (5,000 small functions; query near the
  end). Commands are `check --format=json`, `inspect` and `query`. Default 10 samples per case, plus one launch-cost
  case (`check` of a one-line program). Each sample runs under `/usr/bin/time -f '%e %M'` with wall time also taken
  by `process.hrtime` around the spawn. Raw samples are kept: milliseconds, KiB (as reported by `%M`) and stdout
  bytes.
- **Attribution:** launch = the trivial program; load/check = `check`; provenance and position = `query` − `inspect`
  on matched input; serialisation shows up as output bytes alongside inspect's time. The adapter side is timed in
  process on a saved query response: `JSON.parse`, readback and SHA-256 of every file in `files`, and
  `convert.byteOffset`. Every reported difference carries the sample spread (min–max), so all query overhead isn't
  pinned on hashing or startup.
- **Round trip:** `Session.query` end to end on the demo and the compiler closure, compared with the bare process
  time.
- **Workloads**, through `Session` with the real runner:
  - a hover sweep: 20 queries issued 30 ms apart, (a) each awaited in turn, (b) all overlapping without
    cancellation (today's hover path passes VS Code's token, which fires only when the hover is abandoned), (c) with
    each new hover aborting the previous one;
  - save-triggered checks: 5 rapid `saved()` + `check()` calls (the supersede path);
  - invalid → fixed: a check of a broken import, then of the fixed one;
  - a query of a file outside the closure.

  For each workload it records total wall time, per-request latency, peak concurrent compiler processes and peak
  summed RSS, from polling `/proc/<pid>/status` `VmRSS` for live child PIDs every 5 ms. Children are found by
  scanning `/proc/*/stat` for the harness's PID as parent. It also records whether any process outlived its
  cancellation.
- Output: `docs/perf/data/session-cost.json` (raw) and a rendered text report printed to stdout, to be pasted into
  the decision.

The pure helpers in both scripts (median and spread, option parsing, the report and matrix renderers, the fixture
generator for the 500 KB input) get vitest coverage in `tests/context_matrix.test.ts` and
`tests/session_cost.test.ts`. CI runs no measurements.

### Decision — `docs/context/decision.md`

Kept short, it covers:

1. **Evidence:** the matrix summary and the cost tables, both linked to the raw data.
2. **Setup friction observed**, drawn from the matrix.
3. **Track A candidates:** (a) the status quo, explicit `aster.entry` only; (b) an explicit multi-entry setting with
   a stated rule for a file that belongs to several entries or to none; (c) a tiny declarative project file (entries
   plus options, read without executing anything). Each is judged against the matrix rows it resolves.
4. **Track B candidates:** (a) one-shot improvements (cancel superseded hovers, a concurrency cap, skipping queries
   for files known to be outside the closure, compiler hot paths); (b) a bounded worker restarted after N requests;
   (c) retained compiler state. They are judged against the measured cost split and against the runtime fact that
   heap memory is only reclaimed at process exit. Retained state needs a reclamation story plus stress evidence,
   or it is rejected.
5. **The chosen minimum** (or keep as is), with **compatibility boundaries**: explicit CLI use, trust gating,
   syntax-only mode, C as default, LLVM experimental, no change to the public schema, selection or import identity.
6. **Acceptance matrix** for the follow-up: each case is checked against fresh compilation (identical diagnostics
   and query facts after entry or option changes, added or removed imports and failed edits; no older reply shown;
   cleanup after cancellation).
7. **Draft follow-up issue text.** Issues are filed only after the user approves.

## Delivery

One PR from `design/62-context-sessions`, closing #62: this spec, the plan, two scripts with their tests, the
generated matrix, the raw data and the decision. The compiler is rebuilt from the branch base with `pnpm build`
before measuring, so the binary hash in the provenance corresponds to `26d7820`.

## Risks

- WSL2 timing noise: medians with min–max spread, 10 samples, and no other jobs running while sampling.
- `/proc` polling can miss very short-lived children on the two-file demo. Peaks are reported as observed lower
  bounds.
- Driving the adapter outside VS Code doesn't capture the extension's own debounce or hover-provider scheduling.
  The decision says so, and doesn't present the numbers as end-to-end editor latency.

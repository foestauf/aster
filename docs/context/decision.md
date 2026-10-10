# Project context and compiler sessions: decision (#62)

Recorded 2026-10-09 against main `26d78209` (compiler SHA-256 `056f826e…`, rebuilt from that revision). Evidence:

- [The context matrix](matrix.md), from `node scripts/context-matrix.ts --record`.
- [The session cost record](../perf/session-cost.md), from `node scripts/session-cost.ts --record`: 10 samples per
  case, raw data in [`../perf/data/session-cost.json`](../perf/data/session-cost.json).

Machine: AMD Ryzen 7 5800X, 16 logical CPUs, Linux 6.6 under WSL2, warm page cache. Units: ms; memory in MiB
(1,024 KiB, converted from `/usr/bin/time`'s `%M` KiB); response sizes in bytes.

## Decision

**Keep explicit configuration and one fresh compiler process per request.** Fix the editor's context and request
handling, which is where the matrix and the measurements show the friction. Don't add a project file, a worker, a
cache or retained compiler state. The 0.36 s hover on compiler-sized programs is compiler work (checking,
serialising and hashing). Process lifetime doesn't cause it, so it gets its own profiling issue.

## What the evidence shows

### Context (Track A)

Seventeen cases were observed and three analysed (matrix rows in brackets).

- **The minimum context is (working directory, entry).**
  - `check` and `query` take no other options that change the program; `--backend` applies only to `build`/`run`.
  - With the same or an equivalent pair, the CLI and the editor agreed on every case except the refresh and
    saved-file cases below [one-entry, focused-import, cycle, diamond, alt-cwd, missing-entry, non-utf8,
    outside-closure, symlink-alias].
- **The editor can't express that context for more than one program.**
  - With two workspace folders, the second silently gets the first folder's program, and every hover there is
    `file-not-in-closure` [two-folders].
  - A second entry sharing a library is unreachable [two-entries-shared-lib].
  - With no entry set, the editor stays syntax-only, which is correct. An agent faces two candidates that are
    different programs and has to be told which one [ambiguous-entry].
- **The editor misses changes it didn't save.** After an external change, the CLI reports the program's real
  state, but the editor keeps showing diagnostics for the old closure:
  - 2 files where the program now has 3 [changed-import], or 1 [deleted-import];
  - "✓" over a broken import [external-change].

  Queries stay correct throughout, because each run reloads and the digests protect the answers.
- **Disagreements by design:** a lone CR is withheld and a dirty import is stale, both correct for saved-file support
  [lone-cr, dirty-import].
- **Path spelling:**
  - `files[].path` depends on the working directory, and imports are spelled `./lib.aster`. The contract's lexical
    normalisation makes `--file` work with either spelling.
  - The extension's `isDirty` compares exact strings. A case-different `--file` (`Lib.aster` for `lib.aster`) was
    spot-checked by hand on Linux and is `file-not-in-closure`. The matrix doesn't record that run, so the row stays
    *analysed* [case-alias].
  - This is a consumer normalisation rule. It isn't a reason to change import identity.
- **Lifecycle:** changing the configuration drops the old Session but leaves its running check process alive until
  it finishes or times out. Its result is discarded, so no wrong diagnostics appear [config-change, analysed].

### Cost (Track B)

Compiler process, median of 10 runs; min–max is in the record.

| Program | Source | `check` | `inspect` | `query` |
| --- | --- | --- | --- | --- |
| one line | 29 B | 2.3 ms, 1.9 MiB | 2.6 ms, 2.2 MiB | 4.1 ms, 3.2 MiB |
| demo, 2 files | 410 B | 2.2 ms, 1.9 MiB | 2.8 ms, 2.4 MiB | 4.3 ms, 3.5 MiB |
| compiler, 18 files | 371 KiB | 148.9 ms, 210 MiB | 239.5 ms, 322 MiB | 360.5 ms, 328 MiB |
| generated, 1 file | 467 KiB | 122.8 ms, 103 MiB | 573.1 ms, 635 MiB | 737.8 ms, 658 MiB |

The compiler `query` (`--file=checker.aster --offset=1000`, kept for comparison with the README) and the generated
one both point at whitespace and answer `none`. In the sweep below, positions that answer `found` cost the same, at
about 0.36 s and 327 MiB.

- **Launch is negligible.** A one-line program costs 2–4 ms, process included. A long-lived worker would save about
  1% of a compiler-sized hover.
- **On the compiler closure, a query splits into three parts:**
  - about 150 ms of loading and checking (`check`);
  - about 90 ms collecting and serialising declarations (`inspect` − `check`), which makes a 1,743,903-byte
    response;
  - about 120 ms of digests, provenance and selection (`query` − `inspect`).
- **These are differences of medians.** The per-command spread is about 2–15 ms, with single outliers up to 40 ms,
  so each part is good to about ±20 ms.
- **Digests run only for `query`** (`query.aster` builds the hashes; `inspect` never does), so the third part does
  contain all of the SHA-256 work. It is 0.33 ms per KiB of source on the compiler and 0.35 ms per KiB on the
  generated file. Those are two points from very different programs, not a fitted rate. Profiling is needed to
  separate hashing from provenance and selection.
- **Adapter work in process is about 7 ms:** 6.2 ms to `JSON.parse` the response, 0.6 ms to read back and hash 18
  files, 0.2 ms for position conversion.
  - The full `Session.query` round trip measured 367.6 ms. The bare compiler run measured 360.5 ms.
  - The two harnesses aren't matched: the compiler figure is a synchronous spawn under `/usr/bin/time`, the round
    trip an asynchronous spawn without it.
  - The 7 ms gap is within their spread. It says nothing either way about Node's spawn cost.
- **Memory per request is large.** A compiler-sized query peaks at 328 MiB, about 900× its source.

Workloads through the real adapter on the compiler closure (20 hovers 30 ms apart unless stated). RSS peaks come from
5 ms `/proc` polling and are lower bounds. Process counts can be off by one either way: a killed child is counted
until it is reaped, and a short-lived one can be missed.

| Workload | Total | Peak processes | Peak summed RSS | Outcome |
| --- | --- | --- | --- | --- |
| sweep, each hover awaited | 7.6 s | 1 | 327 MiB | 20 responses accepted, 371 ms each |
| sweep, overlapping, no cancellation | 1.3 s | **18** | **3.3 GiB** | 20 responses accepted, 683 ms each |
| sweep, each hover aborts the previous | 1.0 s | 2 | 327 MiB | 19 cancelled, 1 accepted |
| 5 saves 30 ms apart | 0.28 s | 2 | 208 MiB | 4 superseded, 1 result |
| hover in a file outside the closure | 367 ms each | 1 by construction (not sampled) | — | `file-not-in-closure` |

- **"Accepted"** means the adapter showed the compiler's answer. Of the 20 sweep positions, 9 found something and
  11 were `none`.
- **No compiler process outlived its cancellation** in the four sampled workloads: none were left after 200 ms.
- **The overlapping row is an upper bound, not an observed editor trace.** Today a hover's process is killed only
  when VS Code cancels that hover's token. Whether VS Code cancels on every pointer move wasn't measured, so this
  row is the most the adapter currently allows.

## Alternatives considered

| Candidate | Verdict | Why |
| --- | --- | --- |
| A-a: status quo (one `aster.entry`, first folder) | Rejected | Silently wrong for a second folder; can't reach a second entry. |
| A-b: per-folder settings with an entry list | **Selected** | Fixes both context rows using the settings and trust gating that already exist; the CLI is unchanged. |
| A-c: a declarative project file read by every consumer | Deferred | See *How an agent gets the context* below. |
| B-a: one-shot processes with bounded, cancellable requests and skipped pointless requests | **Selected** | Brings the measured worst case from 18 processes and 3.3 GiB down to 2 processes and 327 MiB, and removes 367 ms requests that can only answer `file-not-in-closure`. |
| B-b: a bounded worker restarted after N requests | Rejected | Launch is about 2–4 ms of 360 ms, so nothing worth amortising without retained state. |
| B-c: retained compiler state (daemon, cache) | Rejected for now | One request peaks at 328 MiB, and the runtime never frees strings or general heap allocations; it only reallocates arrays and frees old map tables. A session holding state across edits would therefore be expected to grow by a large share of that per request. This is an inference from the allocation policy (`runtime.aster`), not a measured session. Reopen only with a reclamation design (arenas or regions reset per request, or explicit lifetimes) and stress evidence of a memory bound over repeated edits. |
| Smaller query responses or a batch API | Not selected | The response embeds the full `inspect` semantics by contract. Changing that is a public-contract decision, and its own issue if profiling shows serialisation dominates. |

### How an agent gets the context

Under A-b, the context lives in VS Code settings. An agent can reliably read only a folder's committed
`.vscode/settings.json`, as JSONC, without executing anything. Values set in user settings or a `.code-workspace`
file are invisible to it.

Until then an agent gets the entry from that file or from the person, and passes it to the CLI explicitly. The matrix
shows that is enough for agreement, because the CLI's context is already explicit.

Agent discovery is deferred together with A-c, because this decision is scoped to the friction observed. That
friction is the editor's, and all of it is fixable without a new format. Promote A-c when a consumer outside VS Code
needs the entry list without being told: an agent harness, or an `aster` command with no entry.

## Selected minimum

All of these are editor changes (`editors/vscode/src`). None of them changes the compiler or the `aster/1` schema.

1. **Per-folder context.** One Session per trusted workspace folder, using that folder's `aster.compilerPath` and
   `aster.entry`. These settings declare no `scope` today, so VS Code treats them as window-scoped; they become
   `resource`-scoped. A file is answered only by the Session of the folder that contains it.
2. **An entry list.** `aster.entry` also accepts an array of paths; a single string keeps working.
   - Every entry is checked on activation and on save, in sequence, never concurrently.
   - Diagnostics are the union of the checks, without duplicates.
   - **Ownership:** the first listed entry whose latest check's closure (the check response's `files`) contains the
     file answers for it.
   - Nothing is guessed. A file containing `main` that no entry lists stays without semantics.
3. **Bounded requests.**
   - **One slot per request kind** in each Session: a new hover aborts the previous hover, and a new definition
     request aborts the previous definition request. They don't supersede each other, because Ctrl+hover asks for
     both at once.
   - On configuration change, trust change, folder change and `deactivate()`, the old Sessions' processes are killed.
4. **No pointless requests.** When the file is outside every entry's latest closure and nothing has been saved or
   changed since those checks, skip the compiler and show nothing. Getting this wrong costs a missing hover, never a
   wrong answer.
5. **External changes refresh like saves.** A file-system watcher on `**/*.aster` (create, change, delete) does what
   saving does: `saved()` then a check.
   - The watcher also fires for the editor's own saves. A save that the save handler already handled within the same
     burst should not start a second check; the existing supersede path absorbs it anyway, as it absorbed 4 of 5
     checks above.

### Compatibility boundaries

Unchanged:

- explicit CLI use and argv;
- the `aster/1` schema, lexical file identity and same-response IDs;
- trust gating: no compiler runs without trust, and both path settings stay restricted;
- syntax-only mode when settings are missing;
- one fresh process per request;
- C as the default backend, with LLVM experimental.

A single-string `aster.entry` behaves exactly as today. Symlinks and differently cased paths remain
`file-not-in-closure`; resolving them would be a separate identity decision with its own regression cases.

## Acceptance matrix for the follow-up

The CLI run fresh against the same files is the oracle. Every row is a test against the real compiler, as
`tests/vscode_adapter.test.ts` does, and process counts come from a counting runner (spawns minus `close` events),
not from `/proc`.

| Case | Must hold |
| --- | --- |
| two-folders | A hover in folder `b` gives the facts `aster query` gives from `b` with `b`'s entry. |
| two-entries-shared-lib | A hover in `tool.aster` equals the CLI with `tool.aster`. `lib.aster` is answered by the first listed entry and equals the CLI with that entry. |
| entry list order | Reordering the list changes which entry answers for a shared file, and nothing else. |
| outside-closure | No compiler process starts (0 spawns); nothing is shown. A save, or a new import of the file, makes it answerable again. |
| external-change, deleted-import, changed-import | After a change outside the editor, the shown diagnostics and their closure equal a fresh `aster check` of each entry. |
| hover sweep | Of 20 overlapping hovers, 19 end `cancelled` and only the newest can be shown. Each cancelled process has closed within 100 ms of its abort, and 0 processes remain afterwards. |
| Ctrl+hover | A concurrent hover and definition request for the same position both answer, and both equal the CLI. |
| config change / deactivate | In-flight processes close within 100 ms. No diagnostics or answers from the old context are shown afterwards. |
| invalid → fixed | The diagnostics and query facts after the fix equal a fresh CLI run; no older reply is shown over a newer one. |
| unchanged rows | one-entry, focused-import, alt-cwd, cycle, diamond, symlink-alias, lone-cr, non-utf8, dirty-import, missing-entry and ambiguous-entry behave as in [the matrix](matrix.md). |
| compatibility | A single-string `aster.entry` passes the existing extension and adapter suites unchanged. |

## Draft follow-up issues

These are not filed yet. They need the maintainer's go-ahead.

**1. vscode: per-folder context, entry lists and bounded requests.** Implements items 1–5 of the selected minimum
against the acceptance matrix above. Editor-only; no compiler or schema change. Out of scope: unsaved buffers, a
project file, workers and caches.

**2. perf: attribute `aster query` time on the compiler closure.** On the compiler closure a query takes about
360 ms:

- about 150 ms checking;
- about 90 ms collecting and serialising a 1,743,903-byte response;
- about 120 ms for digests, provenance and selection, which is 0.33–0.35 ms per KiB of source on the two programs
  measured.

Each part is ±20 ms. Profile the stages, then measure the candidate fixes individually:

- a runtime SHA-256 builtin, or bitwise operations so it can be written efficiently in Aster;
- cheaper serialisation;
- as a separate public-contract decision, a smaller response.

Choose none of them before the profile.

## Limits of this evidence

- One machine (WSL2), a warm page cache, and medians of 10.
- The editor was emulated by driving `adapter.cjs` exactly as `extension.cjs` does. VS Code's own hover scheduling and
  cancellation weren't measured.
- `/proc` polling every 5 ms gives lower bounds for RSS. Process counts may be off by one.
- The case-insensitive path and editor-encoding rows are analysed from the source, not reproduced.
- The attribution comes from subtracting matched commands. These are not profiles.

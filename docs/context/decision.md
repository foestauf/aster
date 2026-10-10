# Project context and compiler sessions: decision (#62)

Recorded 2026-10-09 against main `26d78209` (compiler SHA-256 `056f826e…`, rebuilt from that revision). Evidence:
[the context matrix](matrix.md) (`node scripts/context-matrix.ts --record`) and
[the session cost record](../perf/session-cost.md) (`node scripts/session-cost.ts --record`, 10 samples per case,
raw data in [`../perf/data/session-cost.json`](../perf/data/session-cost.json)). Machine: AMD Ryzen 7 5800X, 16
logical CPUs, Linux 6.6 under WSL2, warm page cache.

## Decision

**Keep explicit configuration and one fresh compiler process per request.** Fix the editor's context and request
handling, which is where the matrix and the measurements show the friction. Don't add a project file, a worker, a
cache or retained compiler state. The 0.36 s hover on compiler-sized programs is compiler work (checking,
serialising and hashing). Process lifetime doesn't cause it, so it gets its own profiling issue.

## What the evidence shows

### Context (Track A)

Seventeen cases were observed and three analysed (matrix rows in brackets).

- **The minimum context is (working directory, entry).** `check` and `query` take no other options that change the
  program; `--backend` applies only to `build`/`run`. Whenever the CLI and the editor had the same pair, they agreed
  [one-entry, focused-import, cycle, diamond, alt-cwd, missing-entry, non-utf8, outside-closure, symlink-alias].
- **The editor can't express that context for more than one program.**
  - With two workspace folders, the second silently gets the first folder's program, and every hover there is
    `file-not-in-closure` [two-folders].
  - A second entry sharing a library is unreachable [two-entries-shared-lib].
  - With no entry set, the editor stays syntax-only, which is correct. An agent faces two candidates that are
    different programs and has to be told which one [ambiguous-entry].
- **The editor misses changes it didn't save.** After an external change, the CLI reports the program's real
  state, but the editor keeps showing the old diagnostics ("✓" over a broken import) until the next save. Queries
  stay correct throughout, because each run reloads and the digests protect the answers [external-change,
  deleted-import, changed-import].
- **Disagreements by design:** a lone CR is withheld and a dirty import is stale, both correct for saved-file support
  [lone-cr, dirty-import].
- **Path spelling:** `files[].path` depends on the working directory, and imports are spelled `./lib.aster`. The
  contract's lexical normalisation makes `--file` work with either spelling. A case-different spelling is
  `file-not-in-closure` (verified on Linux), and the extension's `isDirty` is exact-string [case-alias, analysed].
  This is a consumer normalisation rule. It isn't a reason to change import identity.
- **Lifecycle:** changing the configuration drops the old Session but leaves its running check process alive until
  it finishes or times out. Its result is discarded, so no wrong diagnostics appear [config-change, analysed].

### Cost (Track B)

Compiler process, median of 10 runs (min–max in the record):

| Program | Source | `check` | `inspect` | `query` |
| --- | --- | --- | --- | --- |
| one line | 29 B | 2.3 ms, 1.9 MiB | 2.5 ms, 2.3 MiB | 4.0 ms, 3.3 MiB |
| demo, 2 files | 410 B | 2.2 ms, 1.9 MiB | 2.7 ms, 2.4 MiB | 4.3 ms, 3.5 MiB |
| compiler, 18 files | 371 KiB | 144.9 ms, 210 MiB | 239.8 ms, 322 MiB | 363.4 ms, 327 MiB |
| generated, 1 file | 467 KiB | 121.7 ms, 103 MiB | 554.3 ms, 635 MiB | 723.5 ms, 658 MiB |

- **Launch is negligible.** A one-line program costs 2–4 ms, process included. A long-lived worker would save about
  1% of a compiler-sized hover.
- **On the compiler closure, a query splits into three parts:**
  - about 145 ms of loading and checking (`check`);
  - about 95 ms collecting and serialising declarations (`inspect` − `check`), which makes a 1.7 MB response;
  - about 124 ms of digests, provenance and selection (`query` − `inspect`).
- **The third part grows with source size**, at about 0.33 ms/KiB on the compiler and 0.36 ms/KiB on the generated
  file. That fits the pure-Aster SHA-256 being a large share of it, but these runs can't separate hashing from the
  other two steps. Profiling is needed before blaming hashing.
- **The adapter adds about 7 ms:** 6.1 ms to `JSON.parse` the 1.7 MB response, 0.6 ms to read back and hash 18
  files, 0.2 ms for position conversion. The round trip is 365.8 ms against 363.4 ms of compiler process. Spawning
  through Node costs little.
- **Memory per request is large.** A compiler-sized query peaks at 327 MiB, about 900× its source. The runtime
  reclaims nothing before the process exits.

Workloads through the real adapter on the compiler closure (20 hovers 30 ms apart unless stated). Peaks come from 5 ms
`/proc` polling, so they are lower bounds:

| Workload | Total | Peak processes | Peak summed RSS | Outcome |
| --- | --- | --- | --- | --- |
| sweep, each hover awaited | 7.4 s | 1 | 327 MiB | 20 answers, 371 ms each |
| sweep, overlapping, no cancellation | 1.2 s | **17** | **3.0 GiB** | 20 answers, 618 ms each |
| sweep, each hover aborts the previous | 1.0 s | 2 | 324 MiB | 19 cancelled, 1 answer |
| 5 saves 30 ms apart | 0.29 s | 2 | 209 MiB | 4 superseded, 1 result |
| hover in a file outside the closure | 364 ms each | 1 | — | `file-not-in-closure` |

In every workload, no compiler process outlived its cancellation (0 left over after 200 ms). Today a hover's process
is killed only when VS Code cancels that hover's token. Whether VS Code cancels on every pointer move wasn't measured
here, so the overlapping row is the upper bound the adapter currently allows, not an observed editor trace.

## Alternatives considered

| Candidate | Verdict | Why |
| --- | --- | --- |
| A-a: status quo (one `aster.entry`, first folder) | Rejected | Silently wrong for a second folder; can't reach a second entry. |
| A-b: per-folder settings with an entry list | **Selected** | Fixes both context rows using the settings and trust gating that already exist; the CLI is unchanged. |
| A-c: a declarative project file read by every consumer | Deferred | It adds discoverability for agents, not correctness: the CLI already takes the context explicitly, and agents agree when given it. Promote it when a second consumer, such as an agent harness or a future `aster` default, needs the entry list without VS Code settings. |
| B-a: one-shot processes with bounded, cancellable requests and skipped pointless requests | **Selected** | Brings the measured worst case from 17 processes and 3.0 GiB down to 2 processes and 324 MiB, and removes 364 ms requests that can only answer `file-not-in-closure`. |
| B-b: a bounded worker restarted after N requests | Rejected | Launch is about 2–4 ms of 363 ms, so nothing worth amortising without retained state. |
| B-c: retained compiler state (daemon, cache) | Rejected for now | The runtime frees nothing until exit, and one request peaks at 327 MiB, so a session would grow by hundreds of MiB per edit. Reopen only with a reclamation design (arenas or regions reset per request, or explicit lifetimes) and stress evidence of a memory bound over repeated edits. |
| Smaller query responses or a batch API | Not selected | The 1.7 MB response embeds the full `inspect` semantics by contract. Changing that is a public-contract decision, and its own issue if profiling shows serialisation dominates. |

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
   - At most one query runs per Session: a new hover or definition request aborts the previous one.
   - On configuration change, trust change, folder change and `deactivate()`, the old Sessions' processes are killed.
4. **No pointless requests.** When the file is outside every entry's latest closure and nothing has been saved or
   changed since those checks, skip the compiler and show nothing. Getting this wrong costs a missing hover, never a
   wrong answer.
5. **External changes refresh like saves.** A file-system watcher on `**/*.aster` (create, change, delete) does what
   saving does: `saved()` then a check. A burst is absorbed by the existing supersede path, which absorbed 4 of 5
   checks in the burst above.

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
`tests/vscode_adapter.test.ts` does.

| Case | Must hold |
| --- | --- |
| two-folders | A hover in folder `b` gives the facts `aster query` gives from `b` with `b`'s entry. |
| two-entries-shared-lib | A hover in `tool.aster` equals the CLI with `tool.aster`. `lib.aster` is answered by the first listed entry and equals the CLI with that entry. |
| entry list order | Reordering the list changes which entry answers for a shared file, and nothing else. |
| outside-closure | No compiler process starts (a counting runner shows 0 spawns); nothing is shown. A save, or a new import of the file, makes it answerable again. |
| external-change, deleted-import, changed-import | After a change outside the editor, the diagnostics shown equal a fresh `aster check` of each entry. |
| hover sweep | During 20 overlapping hovers there is never more than one query process per Session; superseded requests end `cancelled`; 0 processes remain afterwards. |
| config change / deactivate | In-flight processes are killed. No diagnostics or answers from the old context are shown afterwards. |
| invalid → fixed | The diagnostics and query facts after the fix equal a fresh CLI run; no older reply is shown over a newer one. |
| unchanged rows | one-entry, focused-import, alt-cwd, cycle, diamond, symlink-alias, lone-cr, non-utf8, dirty-import, missing-entry and ambiguous-entry behave as in [the matrix](matrix.md). |
| compatibility | A single-string `aster.entry` passes the existing extension and adapter suites unchanged. |

## Draft follow-up issues

These are not filed yet. They need the maintainer's go-ahead.

**1. vscode: per-folder context, entry lists and bounded requests.** Implements items 1–5 of the selected minimum
against the acceptance matrix above. Editor-only; no compiler or schema change. Out of scope: unsaved buffers, a
project file, workers and caches.

**2. perf: attribute `aster query` time on the compiler closure.** On the compiler closure a query takes 363 ms:
145 ms checking, about 95 ms collecting and serialising a 1.7 MB response, and about 124 ms for digests, provenance
and selection, a share that grows at about 0.34 ms per KiB of source. Profile the stages, then measure the candidate
fixes individually: a runtime SHA-256 builtin, or bitwise operations so it can be written efficiently in Aster;
cheaper serialisation; and, as a separate public-contract decision, a smaller response. Choose none of them before
the profile.

## Limits of this evidence

- One machine (WSL2), a warm page cache, and medians of 10.
- The editor was emulated by driving `adapter.cjs` exactly as `extension.cjs` does. VS Code's own hover scheduling and
  cancellation weren't measured.
- `/proc` polling every 5 ms gives lower bounds for peaks.
- The case-insensitive path and editor-encoding rows are analysed from the source, not reproduced.
- The attribution comes from subtracting matched commands. These are not profiles.

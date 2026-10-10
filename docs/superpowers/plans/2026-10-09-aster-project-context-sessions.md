# Project context and compiler sessions (#62) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce reproducible evidence (a context fixture matrix and a cost/lifetime measurement) and a short decision for #62.

**Architecture:** Two orchestration-only Node scripts in `scripts/` (run with `node scripts/x.ts`, as `bench.ts` is) drive the
released compiler (`build/asterc`) and the unmodified editor adapter (`editors/vscode/src/adapter.cjs`). Pure helpers are
exported and unit-tested; the drivers write raw JSON plus rendered Markdown under `docs/`. A hand-written decision document
interprets the data. No compiler, schema or extension changes.

**Tech Stack:** Node 24 (type stripping), TypeScript (`tsc --noEmit`), vitest 5, `/usr/bin/time`, Linux `/proc`.

**Spec:** `docs/superpowers/specs/2026-10-09-aster-project-context-sessions-design.md`

## Global Constraints

- Baseline main `26d78209aea9078579533c0265b7695021608c9d`; rebuild with `pnpm build` before measuring.
- No change to `packages/`, `runtime/`, `editors/vscode/src/`, the `aster/1` schema, import identity or selection behaviour.
- No manifest, cache, daemon or GC is implemented; "keep the current approach" is a valid outcome.
- Default 10 samples per process case; raw KiB from `%M`, raw ms; report median with min–max.
- CI runs no measurements: tests cover pure helpers only.
- Lint (`pnpm lint`) and typecheck (`pnpm typecheck`) stay clean.
- Commits: conventional (commitlint), ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A compiler that exits non-zero or answers non-JSON during a measurement → the sample is recorded as failed with its status, never silently timed as a success (`runSample` test).
2. Empty or single-sample sets → `summarize` returns min = median = max for one sample and throws on none (tests).
3. The `/proc` sampler meeting a PID that exits between listing and reading → skipped, not a crash (`readRssKiB` returns 0 for a missing pid; test).
4. Generated 500 KB input must be a valid program with `main` and deterministic bytes (test checks size window and a `check` of it in the driver).
5. Matrix rows whose behaviour can't be reproduced are labelled `analysed` and never rendered as `observed` (renderer test).

---

### Task 1: session-cost pure helpers

**Files:**
- Create: `scripts/session-cost.ts`
- Test: `tests/session_cost.test.ts`

**Interfaces:**
- Produces: `summarize(values: number[]): {n, median, min, max}`, `parseOptions(argv: string[]): {runs: number, compiler: string, record: boolean}`, `generateLargeProgram(functions: number): string`, `parseTimeOutput(stderr: string): {elapsedS: number, maxRssKiB: number} | null`, `readRssKiB(pid: number): number`, `renderProcessTable(rows: ProcessRow[]): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { generateLargeProgram, parseOptions, parseTimeOutput, readRssKiB, renderProcessTable, summarize } from '../scripts/session-cost.ts';

describe('summarize', () => {
  it('reports median and spread without mutating', () => {
    const v = [5, 1, 3];
    expect(summarize(v)).toEqual({ n: 3, median: 3, min: 1, max: 5 });
    expect(v).toEqual([5, 1, 3]);
    expect(summarize([4, 1, 3, 2]).median).toBe(2.5);
    expect(summarize([7])).toEqual({ n: 1, median: 7, min: 7, max: 7 });
  });
  it('rejects empty or nonfinite input', () => {
    for (const v of [[], [NaN]]) expect(() => summarize(v)).toThrow(Error);
  });
});

describe('options', () => {
  it('defaults and overrides', () => {
    expect(parseOptions([])).toEqual({ runs: 10, compiler: 'build/asterc', record: false });
    expect(parseOptions(['--runs=3', '--compiler=x/asterc', '--record'])).toEqual({ runs: 3, compiler: 'x/asterc', record: true });
  });
  it('rejects bad input', () => {
    for (const a of [['--runs=0'], ['--runs=1.5'], ['--wat'], ['--compiler=']]) expect(() => parseOptions(a)).toThrow(Error);
  });
});

describe('generateLargeProgram', () => {
  it('is deterministic, has main, and scales', () => {
    const a = generateLargeProgram(5000);
    expect(a).toBe(generateLargeProgram(5000));
    expect(a).toContain('fn main(): int');
    const kb = Buffer.byteLength(a) / 1024;
    expect(kb).toBeGreaterThan(400);
    expect(kb).toBeLessThan(700);
  });
});

describe('parseTimeOutput', () => {
  it('reads the last "%e %M" line', () => {
    expect(parseTimeOutput('noise\n0.35 334848\n')).toEqual({ elapsedS: 0.35, maxRssKiB: 334848 });
    expect(parseTimeOutput('Command exited with non-zero status 1\n0.01 2000\n')).toEqual({ elapsedS: 0.01, maxRssKiB: 2000 });
    expect(parseTimeOutput('garbage')).toBeNull();
  });
});

describe('readRssKiB', () => {
  it('is positive for this process and 0 for a missing pid', () => {
    expect(readRssKiB(process.pid)).toBeGreaterThan(0);
    expect(readRssKiB(2 ** 22 + 12345)).toBe(0);
  });
});

describe('renderProcessTable', () => {
  it('renders medians with spread and marks failures', () => {
    const t = renderProcessTable([
      { program: 'demo', command: 'query', wallMs: [1, 2, 3], rssKiB: [3500, 3600, 3700], outBytes: 900, failures: 0 },
      { program: 'big', command: 'check', wallMs: [10], rssKiB: [100], outBytes: 10, failures: 2 },
    ]);
    expect(t).toContain('| demo | query | 2.0 (1.0–3.0) | 3600 (3500–3700) | 900 | 0 |');
    expect(t).toContain('| big | check | 10.0 (10.0–10.0) | 100 (100–100) | 10 | 2 |');
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/session_cost.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the helpers** in `scripts/session-cost.ts` (exports above; `generateLargeProgram(n)` emits
  `fn f<i>(x: int): int { let y: int = x + <i>; return y * 2; }` per function plus a `main` calling the last one;
  `readRssKiB` parses `VmRSS:` from `/proc/<pid>/status`, returning 0 on any read error; the table header is
  `| Program | Command | Wall ms median (min–max) | Max RSS KiB median (min–max) | Output bytes | Failed |`), with the
  repository main guard copied from `scripts/bench.ts:616`.

- [ ] **Step 4: Run** the test file → PASS; `pnpm typecheck && pnpm lint`.

- [ ] **Step 5: Commit** `test+feat: session-cost helpers (#62)`.

### Task 2: session-cost driver and recorded run

**Files:**
- Modify: `scripts/session-cost.ts` (add `main`)
- Create: `docs/perf/data/session-cost.json`, `docs/perf/session-cost.md` (rendered report)

**Interfaces:**
- Consumes: Task 1 helpers; `adapter.Session`, `adapter.run`, `convert.byteOffset` via `createRequire`.
- Produces: `docs/perf/data/session-cost.json` with keys `environment`, `process`, `adapterSide`, `roundTrip`, `workloads`.

- [ ] **Step 1:** `runSample(compiler, argv, cwd)`: `spawnSync('/usr/bin/time', ['-f', '%e %M', compiler, ...argv])`, hrtime
  around it, returns `{wallMs, rssKiB, status, outBytes, json: boolean}`; a sample whose stdout isn't `aster/1` JSON or whose
  status isn't 0/1 counts as failed.
- [ ] **Step 2:** Process cases: launch (`check` of `fn main(): int { return 0; }`), demo, compiler closure (cwd =
  `packages/asterc-self`, entry `asterc.aster`, query `--file=checker.aster --offset=1000`), generated 500 KB
  (query offset = byte length − 20) × `check --format=json`, `inspect`, `query`. First sample stored separately as `first`.
- [ ] **Step 3:** Adapter side, in process, 50 iterations each on the saved compiler-closure query response: `JSON.parse`,
  readback+SHA-256 of `files`, `byteOffset(checker.aster, line, char)`.
- [ ] **Step 4:** Round trip: `Session.query` × 10 on demo and compiler closure (`isDirty: () => false`).
- [ ] **Step 5:** Workloads with a 5 ms `/proc` sampler of child PIDs (scan `/proc/*/stat` field 4 == `process.pid`; sum
  `readRssKiB`): sweep-sequential, sweep-overlap, sweep-cancel (abort previous `AbortController`), rapid-save checks
  (5× `saved()`+`check()`), invalid→fixed, outside-closure query. Record total ms, per-request ms, outcome kinds, peak
  concurrent processes, peak summed RSS, and live children 200 ms after the workload ends.
- [ ] **Step 6:** `pnpm build`, then `node scripts/session-cost.ts --record` with no other jobs; check the JSON, render
  `docs/perf/session-cost.md` (provenance block + tables).
- [ ] **Step 7: Commit** `perf: record compiler session cost evidence (#62)`.

### Task 3: context-matrix helpers

**Files:**
- Create: `scripts/context-matrix.ts`
- Test: `tests/context_matrix.test.ts`

**Interfaces:**
- Produces: `type Row = { id: string; case: string; evidence: 'observed' | 'analysed'; cli: string; editor: string; agree: 'yes' | 'no' | 'n/a'; decision: string }`, `renderMatrix(rows: Row[]): string`, `CASES: CaseSpec[]` where `CaseSpec = { id; title; files: Record<string, string | Buffer>; symlinks?: Record<string,string>; entry: string | null; cwd: string; focus: string; mutate?: (dir: string) => void }`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { CASES, renderMatrix } from '../scripts/context-matrix.ts';

describe('context matrix', () => {
  it('covers every case the issue names, uniquely', () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['one-entry', 'two-entries-shared-lib', 'focused-import', 'two-folders', 'alt-cwd', 'outside-closure',
      'missing-entry', 'ambiguous-entry', 'changed-import', 'deleted-import', 'cycle', 'diamond', 'symlink-alias',
      'lone-cr', 'non-utf8', 'external-change']) expect(ids).toContain(id);
  });
  it('renders analysed rows distinctly and escapes pipes', () => {
    const md = renderMatrix([
      { id: 'a', case: 'A', evidence: 'observed', cli: 'ok', editor: 'ok', agree: 'yes', decision: 'none' },
      { id: 'b', case: 'B|x', evidence: 'analysed', cli: '—', editor: 'drops', agree: 'n/a', decision: 'pick' },
    ]);
    expect(md).toContain('| a | A | observed | ok | ok | yes | none |');
    expect(md).toContain('| b | B\\|x | **analysed, not reproduced** | — | drops | n/a | pick |');
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** implement `CASES` (one fixture per id; `cycle` = a.aster↔b.aster; `diamond` = main→l,r→base;
  `ambiguous-entry` = two files with `main` and no setting; `non-utf8` = a byte `0xff` in a comment) and `renderMatrix`.
  **Step 4:** PASS + typecheck + lint. **Step 5: Commit** `test+feat: context matrix fixtures (#62)`.

### Task 4: context-matrix driver and generated matrix

**Files:**
- Modify: `scripts/context-matrix.ts` (add `main`)
- Create: `docs/context/matrix.md`, `docs/context/data/matrix.json`

- [ ] **Step 1:** For each case: write the fixture to a temp dir, apply `mutate` at its point, run CLI `check --format=json`
  and `query` (pointer at the first identifier of `focus`) from `cwd`, and the adapter `Session` (root = first folder,
  entry setting) `check()` + `query()`. Summarise each as a short string (`ok, 2 files`, `error io`, `unavailable: not-in-program`, `stale: …`).
  Agreement = same closure files and same answer kind.
- [ ] **Step 2:** Add the two analysed rows (case-insensitive alias; editor encoding ≠ UTF-8) from adapter source reasoning.
- [ ] **Step 3:** Hand-written `decision` text per row in `CASES` (the user decision needed).
- [ ] **Step 4:** Run `node scripts/context-matrix.ts --record`; review the output; commit
  `docs: record project context fixture matrix (#62)`.

### Task 5: decision document and PR

**Files:**
- Create: `docs/context/decision.md`
- Modify: `editors/vscode/README.md` (Latency: link to the new record), `docs/inspect/README.md` (Measurements: link)

- [ ] **Step 1:** Write the decision per spec §Decision (evidence, friction, Track A/B candidates, selected minimum,
  compatibility, acceptance matrix, draft follow-up issue text).
- [ ] **Step 2:** `pnpm test` (full), `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 3:** Commit, push, open PR closing #62.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #62, Track B: what one-shot compiler requests cost, measured on the released compiler and the unmodified editor
// adapter. Orchestration and measurement only; nothing here changes the compiler or the extension.
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const USAGE = 'usage: node scripts/session-cost.ts [--runs=N] [--compiler=PATH] [--record]';

export interface Options { runs: number; compiler: string; record: boolean }
export interface Summary { n: number; median: number; min: number; max: number }
export interface ProcessRow { program: string; command: string; wallMs: number[]; rssKiB: number[]; outBytes: number; failures: number }

// Median and spread of a sample set; the input is left untouched.
export function summarize(values: readonly number[]): Summary {
  if (values.length === 0 || values.some((v) => !Number.isFinite(v))) throw new Error('summarize needs finite samples');
  const s = values.toSorted((a, b) => a - b);
  const mid = s.length >> 1;
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return { n: s.length, median, min: s[0], max: s[s.length - 1] };
}

export function parseOptions(argv: string[]): Options {
  const options: Options = { runs: 10, compiler: 'build/asterc', record: false };
  for (const arg of argv) {
    if (arg.startsWith('--runs=')) {
      const n = Number(arg.slice('--runs='.length));
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error(`bad --runs: ${arg}\n${USAGE}`);
      options.runs = n;
    } else if (arg.startsWith('--compiler=')) {
      const c = arg.slice('--compiler='.length);
      if (c === '') throw new Error(`--compiler needs a path\n${USAGE}`);
      options.compiler = c;
    } else if (arg === '--record') {
      options.record = true;
    } else {
      throw new Error(`unknown argument: ${arg}\n${USAGE}`);
    }
  }
  return options;
}

// A single-file program of `functions` small functions and a `main` that calls the last one: the scaling input.
export function generateLargeProgram(functions: number): string {
  const parts: string[] = [];
  for (let i = 0; i < functions; i++) {
    parts.push(`fn f${i}(x: int): int {\n    let y: int = x + ${i};\n    let z: int = y * ${i % 7 + 1};\n    return z - x;\n}\n`);
  }
  parts.push(`fn main(): int {\n    let r: int = f${functions - 1}(1);\n    return r - r;\n}\n`);
  return parts.join('\n');
}

// The `%e %M` line /usr/bin/time writes last on stderr: elapsed seconds and maximum RSS in KiB.
export function parseTimeOutput(stderr: string): { elapsedS: number; maxRssKiB: number } | null {
  const lines = stderr.trimEnd().split('\n');
  const m = /^(\d+(?:\.\d+)?) (\d+)$/.exec(lines[lines.length - 1] ?? '');
  return m ? { elapsedS: Number(m[1]), maxRssKiB: Number(m[2]) } : null;
}

// A live process's resident set in KiB, or 0 when it has gone (it may exit between listing and reading).
export function readRssKiB(pid: number): number {
  try {
    const m = /^VmRSS:\s+(\d+) kB$/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

const spread = (s: Summary, digits: number) => `${s.median.toFixed(digits)} (${s.min.toFixed(digits)}–${s.max.toFixed(digits)})`;

export function renderProcessTable(rows: readonly ProcessRow[]): string {
  return [
    '| Program | Command | Wall ms median (min–max) | Max RSS KiB median (min–max) | Output bytes | Failed |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.program} | ${r.command} | ${spread(summarize(r.wallMs), 1)} | ${spread(summarize(r.rssKiB), 0)} | ${r.outBytes} | ${r.failures} |`),
  ].join('\n');
}

// The editor position (0-based line, UTF-16 character) of byte `offset` in `bytes`: the inverse of convert.byteOffset.
export function positionOf(bytes: Buffer, offset: number): { line: number; character: number } {
  let line = 0;
  let start = 0;
  for (let i = 0; i < offset; i++) {
    if (bytes[i] === 0x0a) {
      line++;
      start = i + 1;
    }
  }
  const text = bytes.subarray(start, offset).toString('utf8');
  return { line, character: text.length };
}

// ---- Measurement driver (not unit-tested: it needs the real compiler and a quiet machine) ----

const require = createRequire(import.meta.url);
const adapter = require('../editors/vscode/src/adapter.cjs');
const convert = require('../editors/vscode/src/convert.cjs');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const sh = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8' }).stdout?.trim() ?? '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Sample { wallMs: number; rssKiB: number; status: number | null; outBytes: number; ok: boolean }

// One compiler process under /usr/bin/time. A sample counts as failed unless it answered aster/1 JSON with status 0 or 1.
function runSample(compiler: string, argv: string[], cwd: string): Sample {
  const t0 = now();
  const r = spawnSync('/usr/bin/time', ['-f', '%e %M', compiler, ...argv], { cwd, maxBuffer: 1 << 30 });
  const wallMs = now() - t0;
  const t = parseTimeOutput(r.stderr.toString('utf8'));
  let json = false;
  try {
    json = JSON.parse(r.stdout.toString('utf8')).schema === 'aster/1';
  } catch {
    json = false;
  }
  return { wallMs, rssKiB: t?.maxRssKiB ?? 0, status: r.status, outBytes: r.stdout.length, ok: json && (r.status === 0 || r.status === 1) };
}

// Direct children of this process, from every thread's /proc children list.
function childPids(): number[] {
  const pids: number[] = [];
  for (const tid of readdirSync('/proc/self/task')) {
    try {
      for (const p of readFileSync(`/proc/self/task/${tid}/children`, 'utf8').trim().split(/\s+/)) if (p) pids.push(Number(p));
    } catch {
      // the thread exited
    }
  }
  return pids;
}

// Polls children every 5 ms while `body` runs: peak concurrent count and peak summed RSS (observed lower bounds).
async function sampled<T>(body: () => Promise<T>): Promise<{ result: T; totalMs: number; peakProcesses: number; peakRssKiB: number; leftover: number }> {
  let peakProcesses = 0;
  let peakRssKiB = 0;
  const timer = setInterval(() => {
    const pids = childPids().filter((p) => !/\(time\)/.test(safeRead(`/proc/${p}/stat`)));
    peakProcesses = Math.max(peakProcesses, pids.length);
    peakRssKiB = Math.max(peakRssKiB, pids.reduce((sum, p) => sum + readRssKiB(p), 0));
  }, 5);
  const t0 = now();
  const result = await body();
  const totalMs = now() - t0;
  clearInterval(timer);
  await sleep(200);
  return { result, totalMs, peakProcesses, peakRssKiB, leftover: childPids().length };
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function environment(compiler: string) {
  return {
    recorded: new Date().toISOString(),
    gitCommit: sh('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD']),
    gitDirty: sh('git', ['-C', REPO_ROOT, 'status', '--porcelain']) !== '',
    compilerSha256: sha256(readFileSync(compiler)),
    platform: sh('uname', ['-srm']),
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    cc: sh('cc', ['--version']).split('\n')[0],
    node: process.version,
    cache: 'warm page cache; the first sample of each case is reported separately as the nearest approximation of cold',
    timing: 'wall: process.hrtime around spawnSync of /usr/bin/time; RSS: /usr/bin/time %M (KiB, the single process peak)',
  };
}

interface ProcessCase { program: string; cwd: string; entry: string; queryFile: string; queryOffset: number }

function processCases(work: string, compilerDir: string): ProcessCase[] {
  const large = generateLargeProgram(5000);
  mkdirSync(join(work, 'large'));
  writeFileSync(join(work, 'large', 'large.aster'), large);
  mkdirSync(join(work, 'launch'));
  writeFileSync(join(work, 'launch', 'main.aster'), 'fn main(): int { return 0; }\n');
  const demoMain = readFileSync(join(work, 'demo', 'main.aster'));
  return [
    { program: 'launch (1 line)', cwd: join(work, 'launch'), entry: 'main.aster', queryFile: 'main.aster', queryOffset: 3 },
    { program: 'demo (2 files)', cwd: join(work, 'demo'), entry: 'main.aster', queryFile: 'main.aster', queryOffset: demoMain.indexOf('area(side)') + 5 },
    { program: 'compiler (18 files)', cwd: compilerDir, entry: 'asterc.aster', queryFile: 'checker.aster', queryOffset: 1000 },
    { program: `generated (${Math.round(Buffer.byteLength(large) / 1024)} KiB)`, cwd: join(work, 'large'), entry: 'large.aster', queryFile: 'large.aster', queryOffset: Buffer.byteLength(large) - 20 },
  ];
}

// Total on-disk bytes of the entry's closure: what the compiler reads and, for a query, hashes.
function closureBytes(compiler: string, c: ProcessCase): number {
  const r = spawnSync(compiler, ['query', c.entry, `--file=${c.queryFile}`, `--offset=${c.queryOffset}`], { cwd: c.cwd, maxBuffer: 1 << 30 });
  return JSON.parse(r.stdout.toString('utf8')).files.reduce((sum: number, f: { path: string }) => sum + readFileSync(join(c.cwd, f.path)).length, 0);
}

const sourceBytes: Record<string, number> = {};

function measureProcesses(compiler: string, cases: ProcessCase[], runs: number) {
  const rows: (ProcessRow & { first: Sample; samples: Sample[]; argv: string[] })[] = [];
  for (const c of cases) {
    const commands: [string, string[]][] = [
      ['check', ['check', '--format=json', c.entry]],
      ['inspect', ['inspect', c.entry]],
      ['query', ['query', c.entry, `--file=${c.queryFile}`, `--offset=${c.queryOffset}`]],
    ];
    for (const [command, argv] of commands) {
      const first = runSample(compiler, argv, c.cwd);
      if (sourceBytes[c.program] === undefined) sourceBytes[c.program] = closureBytes(compiler, c);
      const samples = Array.from({ length: runs }, () => runSample(compiler, argv, c.cwd));
      const good = samples.filter((s) => s.ok);
      rows.push({
        program: c.program, command, argv, first, samples,
        wallMs: good.map((s) => s.wallMs), rssKiB: good.map((s) => s.rssKiB),
        outBytes: samples[0].outBytes, failures: samples.length - good.length,
      });
      process.stderr.write(`  ${c.program} ${command}: ${summarize(good.map((s) => s.wallMs)).median.toFixed(1)} ms\n`);
    }
  }
  return rows;
}

// The adapter's own work on a saved compiler-closure query response, in process.
function measureAdapterSide(compiler: string, compilerDir: string, iterations: number) {
  const r = spawnSync(compiler, ['query', 'asterc.aster', '--file=checker.aster', '--offset=1000'], { cwd: compilerDir, maxBuffer: 1 << 30 });
  const text = r.stdout.toString('utf8');
  const doc = JSON.parse(text);
  const checker = readFileSync(join(compilerDir, 'checker.aster'));
  const pos = positionOf(checker, 1000);
  const time = (fn: () => void) => summarize(Array.from({ length: iterations }, () => { const t0 = now(); fn(); return now() - t0; }));
  return {
    responseBytes: Buffer.byteLength(text),
    files: doc.files.length,
    jsonParseMs: time(() => JSON.parse(text)),
    readbackHashMs: time(() => { for (const f of doc.files) sha256(readFileSync(join(compilerDir, f.path))); }),
    byteOffsetMs: time(() => convert.byteOffset(checker, pos.line, pos.character)),
  };
}

const newSession = (compiler: string, root: string, entry: string, timeoutMs = 60_000) =>
  new adapter.Session({ compiler, root, entry, timeoutMs, isDirty: () => false });

async function measureRoundTrip(compiler: string, cases: ProcessCase[], runs: number) {
  const out: Record<string, Summary & { kinds: string[] }> = {};
  for (const c of cases.filter((x) => x.program.startsWith('demo') || x.program.startsWith('compiler'))) {
    const s = newSession(compiler, c.cwd, c.entry);
    const file = join(c.cwd, c.queryFile);
    const pos = positionOf(readFileSync(file), c.queryOffset);
    const ms: number[] = [];
    const kinds: string[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = now();
      const r = await s.query(file, 'pointer', pos.line, pos.character, undefined);
      ms.push(now() - t0);
      kinds.push(r.kind);
    }
    out[c.program] = { ...summarize(ms), kinds: [...new Set(kinds)] };
  }
  return out;
}

// Positions spread through checker.aster, as a pointer sweeping across the file would produce.
function sweepPositions(compilerDir: string, count: number) {
  const bytes = readFileSync(join(compilerDir, 'checker.aster'));
  return Array.from({ length: count }, (_, i) => positionOf(bytes, Math.floor((bytes.length * (i + 1)) / (count + 2))));
}

// Per-request latency and how many requests ended in each outcome kind.
const describeRequests = (rs: { kind: string; ms: number }[]) => ({
  perRequestMs: summarize(rs.map((r) => r.ms)),
  kinds: Object.fromEntries([...new Set(rs.map((r) => r.kind))].map((k) => [k, rs.filter((r) => r.kind === k).length])),
});

async function measureWorkloads(compiler: string, compilerDir: string, demoDir: string) {
  const file = join(compilerDir, 'checker.aster');
  const positions = sweepPositions(compilerDir, 20);
  const results: Record<string, unknown> = {};

  for (const mode of ['sequential', 'overlap', 'cancel-previous'] as const) {
    const s = newSession(compiler, compilerDir, 'asterc.aster');
    const m = await sampled(async () => {
      const pending: Promise<{ kind: string; ms: number }>[] = [];
      let previous: AbortController | null = null;
      for (const p of positions) {
        if (mode === 'cancel-previous' && previous) previous.abort();
        const controller = new AbortController();
        previous = controller;
        const t0 = now();
        const request = s.query(file, 'pointer', p.line, p.character, controller.signal).then((r: { kind: string }) => ({ kind: r.kind, ms: now() - t0 }));
        if (mode === 'sequential') pending.push(Promise.resolve(await request));
        else {
          pending.push(request);
          await sleep(30);
        }
      }
      return Promise.all(pending);
    });
    results[`hover sweep, ${mode}`] = { requests: positions.length, totalMs: m.totalMs, peakProcesses: m.peakProcesses, peakRssKiB: m.peakRssKiB, leftover: m.leftover, ...describeRequests(m.result) };
    process.stderr.write(`  sweep ${mode}: ${m.totalMs.toFixed(0)} ms, peak ${m.peakProcesses} procs / ${m.peakRssKiB} KiB\n`);
  }

  {
    const s = newSession(compiler, compilerDir, 'asterc.aster');
    const m = await sampled(async () => {
      const pending: Promise<{ kind: string; ms: number }>[] = [];
      for (let i = 0; i < 5; i++) {
        s.saved();
        const t0 = now();
        pending.push(s.check().then((r: { kind: string }) => ({ kind: r.kind, ms: now() - t0 })));
        await sleep(30);
      }
      return Promise.all(pending);
    });
    results['rapid saves (5 checks, 30 ms apart)'] = { totalMs: m.totalMs, peakProcesses: m.peakProcesses, peakRssKiB: m.peakRssKiB, leftover: m.leftover, ...describeRequests(m.result) };
  }

  {
    const s = newSession(compiler, demoDir, 'main.aster');
    const shapes = join(demoDir, 'shapes.aster');
    const good = readFileSync(shapes);
    cpSync(join(REPO_ROOT, 'editors/vscode/demo/shapes.broken.aster'), shapes);
    let t0 = now();
    const broken = await s.check();
    const brokenMs = now() - t0;
    writeFileSync(shapes, good);
    s.saved();
    t0 = now();
    const fixed = await s.check();
    results['invalid → fixed (demo)'] = { broken: { ok: broken.ok, count: broken.count, ms: brokenMs }, fixed: { ok: fixed.ok, count: fixed.count, ms: now() - t0 } };
  }

  {
    writeFileSync(join(compilerDir, 'outside.aster'), 'fn helper(): int { return 1; }\n');
    const s = newSession(compiler, compilerDir, 'asterc.aster');
    const ms: number[] = [];
    let kind = '';
    for (let i = 0; i < 5; i++) {
      const t0 = now();
      const r = await s.query(join(compilerDir, 'outside.aster'), 'pointer', 0, 3, undefined);
      ms.push(now() - t0);
      kind = `${r.kind}${r.reason ? `: ${r.reason}` : ''}`;
    }
    results['query of a file outside the closure'] = { outcome: kind, ms: summarize(ms) };
  }
  return results;
}

function renderReport(report: Record<string, any>): string {
  const env = report.environment;
  const lines = [
    '# Compiler session cost record (#62)', '',
    'A measurement of the machine and inputs named below, made by `node scripts/session-cost.ts --record`. Raw samples are in',
    '[`data/session-cost.json`](data/session-cost.json). These are not editor end-to-end latencies: VS Code\'s own scheduling is',
    'not included.', '',
    '```text',
    ...Object.entries(env).map(([k, v]) => `${k.padEnd(15)} ${v}`),
    '```', '',
    '## Compiler processes', '',
    `Each row: ${report.runs} timed runs after one separately recorded first run (\`first\` in the JSON). Medians exclude the first run.`, '',
    renderProcessTable(report.process), '',
    'Closure source bytes: ' + Object.entries(report.sourceBytes).map(([k, v]) => `${k} ${v}`).join('; ') + '.', '',
    'First runs (nearest approximation of a cold run):', '',
    '| Program | Command | First wall ms | First max RSS KiB |', '| --- | --- | --- | --- |',
    ...report.process.map((r: any) => `| ${r.program} | ${r.command} | ${r.first.wallMs.toFixed(1)} | ${r.first.rssKiB} |`), '',
    '## Adapter side (in process, compiler-closure query response)', '',
    `Response: ${report.adapterSide.responseBytes} bytes, ${report.adapterSide.files} files.`, '',
    '| Step | ms median (min–max) |', '| --- | --- |',
    ...['jsonParseMs', 'readbackHashMs', 'byteOffsetMs'].map((k) => `| ${k} | ${spread(report.adapterSide[k], 3)} |`), '',
    '## Adapter round trip (`Session.query`, sequential)', '',
    '| Program | ms median (min–max) | Outcomes |', '| --- | --- | --- |',
    ...Object.entries(report.roundTrip).map(([k, v]: [string, any]) => `| ${k} | ${spread(v, 1)} | ${v.kinds.join(', ')} |`), '',
    '## Workloads (compiler closure unless named)', '',
    '```json', JSON.stringify(report.workloads, null, 2), '```', '',
  ];
  return lines.join('\n');
}

async function main(argv: string[]): Promise<number> {
  const options = parseOptions(argv);
  const compiler = resolve(REPO_ROOT, options.compiler);
  const work = mkdtempSync(join(tmpdir(), 'aster-session-cost-'));
  try {
    const compilerDir = join(work, 'asterc-self');
    cpSync(join(REPO_ROOT, 'packages/asterc-self'), compilerDir, { recursive: true });
    cpSync(join(REPO_ROOT, 'editors/vscode/demo'), join(work, 'demo'), { recursive: true });
    const cases = processCases(work, compilerDir);
    process.stderr.write('processes\n');
    const processRows = measureProcesses(compiler, cases, options.runs);
    process.stderr.write('adapter side, round trip, workloads\n');
    const report = {
      environment: environment(compiler),
      runs: options.runs,
      process: processRows,
      sourceBytes,
      adapterSide: measureAdapterSide(compiler, compilerDir, 50),
      roundTrip: await measureRoundTrip(compiler, cases, options.runs),
      workloads: await measureWorkloads(compiler, compilerDir, join(work, 'demo')),
    };
    const text = renderReport(report);
    if (options.record) {
      writeFileSync(join(REPO_ROOT, 'docs/perf/data/session-cost.json'), `${JSON.stringify(report, null, 2)}\n`);
      writeFileSync(join(REPO_ROOT, 'docs/perf/session-cost.md'), text);
    }
    process.stdout.write(text);
    return processRows.some((r) => r.failures > 0) ? 1 : 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}

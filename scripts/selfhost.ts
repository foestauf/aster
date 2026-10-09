import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `pnpm selfhost`: the self-hosting proof (contract §6.4, issue #20). Builds S1 with stage 0, S2 with S1, S3 with S2
// and S4 with S3, requires the compiler's C to be byte-identical at every hop, runs the full test suite and then the
// stage-aware suites once per stage, and writes a report to .selfhost/. Orchestration only: it spawns compilers, cc,
// git and vitest, and never lexes, parses, checks, lowers or emits Aster itself.
// Stage names: S0 is the installed compiler (build/asterc; in CI, bootstrapped from the base's release and rebuilt from this tree), whose C is the reference; S1 to S4 are built
// from the source in this tree. `--record` also writes docs/self-host/proof.md and requires a clean tree.
// `--suite=<name>` (repeatable; one of SUITES) builds and compares every stage as usual but runs only the named test
// runs, so CI can spread them over parallel jobs. It can't be combined with `--record`.

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const COMPILER = 'packages/asterc-self/asterc.aster';
const INSTALLED = 'build/asterc';
const INSTALLED_ABS = join(REPO_ROOT, INSTALLED);
export const STAGE_SUITES = [
  'tests/asterc_self.test.ts',
  'tests/llvm_backend.test.ts',
  'tests/selfhost_golden.test.ts',
  'tests/load_symlink.test.ts',
  'tests/source_encoding.test.ts',
  'tests/check_aster.test.ts',
  'tests/compiler_tables.test.ts',
  'tests/runtime_aster.test.ts',
  'tests/json_writer.test.ts',
  'tests/json_check.test.ts',
  'tests/json_inspect.test.ts',
  'tests/inspect_consumer.test.ts',
  'tests/provenance.test.ts',
  'tests/sha256.test.ts',
  'tests/json_query.test.ts',
  'tests/query_consumer.test.ts',
  'tests/vscode_adapter.test.ts',
] as const;

/** The test runs, in the order a full proof runs them: the full suite, then the stage-aware suites once per stage. */
export const SUITES = ['full', 'S1', 'S2', 'S3', 'SL1'] as const;
export type Suite = (typeof SUITES)[number];

const USAGE = `usage: pnpm selfhost [--record | --suite=<${SUITES.join('|')}> ...]`;

/** Parses the arguments, or returns the error to print. `suites` is every suite unless `--suite` narrows it. */
export function parseArgs(argv: string[]): { record: boolean; suites: Suite[] } | { error: string } {
  let record = false;
  const picked = new Set<Suite>();
  for (const a of argv) {
    if (a === '--record') {
      record = true;
      continue;
    }
    const m = /^--suite=(.*)$/.exec(a);
    if (m === null) return { error: `selfhost: unknown argument '${a}'\n${USAGE}` };
    const name = SUITES.find((s) => s === m[1]);
    if (name === undefined) return { error: `selfhost: unknown suite '${m[1]}'\n${USAGE}` };
    picked.add(name);
  }
  if (record && picked.size > 0) return { error: `selfhost: --record runs every suite, so it can't take --suite\n${USAGE}` };
  return { record, suites: picked.size === 0 ? [...SUITES] : SUITES.filter((s) => picked.has(s)) };
}

const END = '<end of file>';

/** Line `i` of `own` for the report. Past the end, or the empty tail after a final newline when `other` has a real line, is the end of file. */
function shown(own: string[], other: string[], i: number): string {
  if (own[i] === undefined) return END;
  return own[i] === '' && i === own.length - 1 && other[i] !== undefined ? END : own[i];
}

/** The first line where `a` and `b` differ (1-based), or null when they are identical. */
export function firstDifference(a: string, b: string): { line: number; a: string; b: string } | null {
  if (a === b) return null;
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return { line: i + 1, a: shown(la, lb, i), b: shown(lb, la, i) };
  }
  return null;
}

/** `--record` pins the revision it ran at, so it is refused on a dirty tree. */
export function recordAllowed(dirty: boolean, record: boolean): boolean {
  return !(dirty && record);
}

interface Counts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

interface StageReport {
  name: string;
  cSha256: string;
  llvmSha256?: string;
  matchesS0: boolean;
  suite: Counts | null;
}

interface Report {
  commit: string;
  dirty: boolean;
  uname: string;
  cc: string;
  clang: string;
  lld: string;
  node: string;
  locale: string;
  stages: StageReport[];
  fullSuite: Counts | null;
  suites: Suite[];
  ok: boolean;
  failedStep: string | null;
}

class StepFailure extends Error {}

function fail(message: string): never {
  throw new StepFailure(message);
}

function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, LC_ALL: 'C' },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });
  if (r.error) throw r.error;
  return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), status: r.status };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function readCounts(path: string): Counts {
  const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
  const total = json.numTotalTests;
  if (typeof total !== 'number') throw new Error(`${path}: no numTotalTests (did the vitest json schema change?)`);
  return {
    total,
    passed: json.numPassedTests ?? 0,
    failed: json.numFailedTests ?? 0,
    skipped: (json.numPendingTests ?? 0) + (json.numTodoTests ?? 0),
  };
}

function showCounts(c: Counts | null): string {
  return c === null ? 'not run' : `${c.passed}/${c.total}`;
}

function renderReport(r: Report): string {
  const lines = [
    'Aster self-hosting proof',
    `commit  ${r.commit}  (dirty: ${r.dirty ? 'yes' : 'no'})`,
    `cc      ${r.cc}`,
    `clang   ${r.clang}`,
    `lld     ${r.lld}`,
    `uname   ${r.uname}`,
    `node    ${r.node}`,
    `locale  ${r.locale}`,
    '',
    'stage  C sha256          = C(S0)  tests',
  ];
  for (const s of r.stages) {
    const tests =
      s.name === 'S0' ? `${showCounts(r.fullSuite)} (pnpm test)` : s.name === 'S4' ? '(built by S3; C only)' : s.name === 'SL2' ? '(LLVM fixed point; C oracle)' : showCounts(s.suite);
    const matches = s.name === 'S0' ? '—' : s.matchesS0 ? 'yes' : 'NO';
    lines.push(`${s.name.padEnd(7)}${s.cSha256.slice(0, 16).padEnd(18)}${matches.padEnd(9)}${tests}${s.llvmSha256 ? `; LLVM ${s.llvmSha256.slice(0, 16)}` : ''}`);
  }
  const partial = r.suites.length < SUITES.length ? ` (suites: ${r.suites.join(', ')})` : '';
  lines.push('', r.ok ? `PASS${partial}` : `FAIL (${r.failedStep ?? 'unknown step'})${partial}`);
  return lines.join('\n') + '\n';
}

export function main(argv: string[]): number {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const { record, suites } = parsed;

  const report: Report = {
    commit: '',
    dirty: false,
    uname: '',
    cc: '',
    clang: '',
    lld: '',
    node: process.version,
    locale: 'LC_ALL=C',
    stages: [],
    fullSuite: null,
    suites,
    ok: false,
    failedStep: null,
  };
  const outDir = join(REPO_ROOT, '.selfhost');
  let work: string | undefined;

  const step = <T>(name: string, fn: () => T): T => {
    process.stdout.write(`• ${name}… `);
    try {
      const v = fn();
      console.log('ok');
      return v;
    } catch (e) {
      console.log('FAILED');
      report.failedStep = name;
      throw e instanceof StepFailure ? e : new StepFailure(e instanceof Error ? e.message : String(e));
    }
  };
  try {
    step('environment', () => {
      report.commit = run('git', ['rev-parse', 'HEAD']).stdout.trim();
      report.dirty = run('git', ['status', '--porcelain']).stdout.trim() !== '';
      report.uname = run('uname', ['-sm']).stdout.trim();
      const ccVersion = run('cc', ['--version']).stdout;
      report.cc = ccVersion.split('\n')[0] ?? '';
      const ccMajor = run('cc', ['-dumpversion']).stdout.trim().split('.')[0];
      if (report.uname !== 'Linux x86_64') fail(`needs Linux x86_64, not '${report.uname}'`);
      if (ccMajor !== '13' || !ccVersion.includes('Free Software Foundation')) fail(`needs gcc 13 as cc, not '${report.cc}'`);
      report.clang = run('clang', ['--version']).stdout.split('\n')[0] ?? '';
      report.lld = run('ld.lld', ['--version']).stdout.trim();
      if (!/clang version 18\./.test(report.clang)) fail(`needs clang 18, not '${report.clang}'`);
      if (!/LLD 18\./.test(report.lld)) fail(`needs lld 18, not '${report.lld}'`);
      if (Number(process.versions.node.split('.')[0]) < 24) fail(`needs Node 24 or later, not ${process.version}`);
      if (!recordAllowed(report.dirty, record)) fail('--record needs a clean tree');
    });

    step('stage 0 (build/asterc)', () => {
      try {
        accessSync(INSTALLED_ABS, constants.X_OK);
      } catch {
        fail('aster: no compiler at build/asterc; run `pnpm bootstrap` first');
      }
    });

    mkdirSync(outDir, { recursive: true });
    for (const f of readdirSync(outDir)) {
      if (/\.(c|ll|json)$/.test(f) || f.startsWith('report.')) rmSync(join(outDir, f));
    }
    const dir = mkdtempSync(join(tmpdir(), 'aster-selfhost-'));
    work = dir;
    const bin = (n: number) => join(dir, `s${n}`);

    const cs: string[] = [];
    step('stage C', () => {
      const s1 = run(INSTALLED_ABS, ['build', COMPILER, '-o', bin(1)]);
      if (s1.status !== 0 || s1.stderr !== '') fail(`S0 failed to build S1 (status ${s1.status}):\n${s1.stderr}`);
      const c0 = run(INSTALLED_ABS, ['build', COMPILER, '--emit=c']);
      if (c0.status !== 0 || c0.stderr !== '') fail(`S0 --emit=c failed (status ${c0.status}):\n${c0.stderr}`);
      cs.push(c0.stdout);
      for (let n = 1; n <= 4; n++) {
        const c = run(bin(n), ['build', COMPILER, '--emit=c']);
        if (c.status !== 0 || c.stderr !== '') fail(`S${n} --emit=c failed (status ${c.status}):\n${c.stderr}`);
        cs.push(c.stdout);
        if (n <= 3) {
          const next = run(bin(n), ['build', COMPILER, '-o', bin(n + 1)]);
          if (next.status !== 0 || next.stderr !== '') fail(`S${n} failed to build S${n + 1} (status ${next.status}):\n${next.stderr}`);
        }
      }
      cs.forEach((c, n) => writeFileSync(join(outDir, `c${n}.c`), c));
    });

    step('C oracle', () => {
      const c0 = cs[0]!;
      let drift = '';
      cs.forEach((c, n) => {
        const d = firstDifference(c0, c);
        report.stages.push({ name: `S${n}`, cSha256: sha256(c), matchesS0: d === null, suite: null });
        if (d !== null && drift === '') drift = `C(S${n}) differs from C(S0) at line ${d.line}:\n  S0: ${d.a}\n  S${n}: ${d.b}\n(is build/asterc current with this tree? run \`pnpm build\`)`;
      });
      if (drift !== '') fail(drift);
    });

    const llvmBin = (n: number) => join(dir, `sl${n}`);
    step('LLVM stages and fixed point', () => {
      const first = run(bin(1), ['build', COMPILER, '--backend=llvm', '-o', llvmBin(1)]);
      if (first.status !== 0 || first.stderr !== '') fail(`S1 failed to build SL1: ${first.status}\n${first.stderr}`);
      const second = run(llvmBin(1), ['build', COMPILER, '--backend=llvm', '-o', llvmBin(2)]);
      if (second.status !== 0 || second.stderr !== '') fail(`SL1 failed to build SL2: ${second.status}\n${second.stderr}`);
      let previous: string | null = null;
      for (const n of [1, 2]) {
        const emitted = run(llvmBin(n), ['build', COMPILER, '--emit=llvm']);
        const c = run(llvmBin(n), ['build', COMPILER, '--emit=c']);
        if (emitted.status !== 0 || emitted.stderr !== '' || c.status !== 0 || c.stderr !== '') fail(`SL${n} emission failed`);
        if (c.stdout !== cs[0]) fail(`C(SL${n}) differs from C(S0)`);
        if (previous !== null && previous !== emitted.stdout) fail('LLVM(SL1) differs from LLVM(SL2)');
        previous = emitted.stdout;
        writeFileSync(join(outDir, `sl${n}.ll`), emitted.stdout);
        writeFileSync(join(outDir, `sl${n}.c`), c.stdout);
        report.stages.push({ name: `SL${n}`, cSha256: sha256(c.stdout), llvmSha256: sha256(emitted.stdout), matchesS0: true, suite: null });
      }
    });

    const vitest = (name: string, files: readonly string[], json: string, env: Record<string, string | undefined>): Counts => {
      const file = join(outDir, json);
      const args = ['exec', 'vitest', 'run', ...files, '--reporter=default', '--reporter=json', `--outputFile=${file}`];
      const r = run('pnpm', args, { stdio: 'inherit', env: { ...process.env, LC_ALL: 'C', ...env } });
      let counts: Counts;
      try {
        counts = readCounts(file);
      } catch {
        return fail(`${name}: vitest wrote no report (status ${r.status})`);
      }
      if (r.status !== 0 || counts.failed > 0) fail(`${name}: ${counts.failed} failed test(s) (status ${r.status})`);
      if (counts.skipped > 0) fail(`${name}: ${counts.skipped} skipped test(s)`);
      return counts;
    };

    if (suites.includes('full')) {
      step('full suite (pnpm test)', () => {
        report.fullSuite = vitest('full suite', [], 'full.json', { ASTER_STAGE_BIN: undefined, ASTER_STAGE: undefined });
      });
    }
    for (const n of [1, 2, 3] as const) {
      if (!suites.includes(`S${n}`)) continue;
      step(`suites against S${n}`, () => {
        report.stages[n]!.suite = vitest(`S${n} suites`, STAGE_SUITES, `S${n}.json`, {
          ASTER_STAGE_BIN: bin(n),
          ASTER_STAGE: `S${n}`,
        });
      });
    }
    if (suites.includes('SL1')) {
      step('suites against SL1', () => {
        report.stages.find((s) => s.name === 'SL1')!.suite = vitest('SL1 suites', STAGE_SUITES, 'SL1.json', {
          ASTER_STAGE_BIN: llvmBin(1), ASTER_STAGE: 'SL1',
        });
      });
    }
    step('suite totals', () => {
      const ran = report.stages.filter((s) => s.suite !== null);
      const totals = ran.map((s) => `${s.name} ${s.suite!.total}`).join(', ');
      if (new Set(ran.map((s) => s.suite!.total)).size > 1) fail(`the stages ran different numbers of stage-aware tests: ${totals}`);
    });
    report.ok = true;
  } catch (e) {
    console.error(`\nselfhost: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  }

  const text = renderReport(report);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(outDir, 'report.txt'), text);
  console.log('\n' + text);
  if (report.ok && record) {
    const doc = [
      '# Self-hosting proof',
      '',
      `Generated by \`pnpm selfhost --record\` at commit \`${report.commit}\`, so it is always one commit behind the commit that adds it.`,
      '',
      '```',
      text.trimEnd(),
      '```',
      '',
      'Reproduce it with `pnpm selfhost` on Linux x86_64 with gcc 13, clang 18, lld 18 and Node 24 or later.',
      '',
    ].join('\n');
    mkdirSync(join(REPO_ROOT, 'docs', 'self-host'), { recursive: true });
    writeFileSync(join(REPO_ROOT, 'docs', 'self-host', 'proof.md'), doc);
  }
  return report.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

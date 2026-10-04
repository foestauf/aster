import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `pnpm selfhost`: the self-hosting proof (contract §6.4, issue #20). Builds S1 with stage 0, S2 with S1, S3 with S2
// and S4 with S3, requires the compiler's C to be byte-identical at every hop, runs the full test suite and then the
// stage-aware suites once per stage, and writes a report to .selfhost/. Orchestration only: it spawns compilers, cc,
// git and vitest, and never lexes, parses, checks, lowers or emits Aster itself.
// `--record` also writes docs/self-host/proof.md and requires a clean tree.

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const COMPILER = 'packages/asterc-self/asterc.aster';
const S0 = 'packages/asterc/dist/cli/bin.js';
export const STAGE_SUITES = [
  'tests/asterc_self.test.ts',
  'tests/selfhost_golden.test.ts',
  'tests/load_symlink.test.ts',
  'tests/lex_aster.test.ts',
  'tests/parse_aster.test.ts',
  'tests/check_aster.test.ts',
  'tests/typed_aster.test.ts',
  'tests/ir_aster.test.ts',
  'tests/emit_aster.test.ts',
] as const;

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
  matchesS0: boolean;
  suite: Counts | null;
}

interface Report {
  commit: string;
  dirty: boolean;
  uname: string;
  cc: string;
  node: string;
  stages: StageReport[];
  fullSuite: Counts | null;
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
  return {
    total: json.numTotalTests ?? 0,
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
    `uname   ${r.uname}`,
    `node    ${r.node}`,
    '',
    'stage  C sha256          = C(S0)  tests',
  ];
  for (const s of r.stages) {
    const tests =
      s.name === 'S0' ? `${showCounts(r.fullSuite)} (pnpm test)` : s.name === 'S4' ? '(built by S3; C only)' : showCounts(s.suite);
    const matches = s.name === 'S0' ? '—' : s.matchesS0 ? 'yes' : 'NO';
    lines.push(`${s.name.padEnd(7)}${s.cSha256.slice(0, 16).padEnd(18)}${matches.padEnd(9)}${tests}`);
  }
  lines.push('', r.ok ? 'PASS' : `FAIL (${r.failedStep ?? 'unknown step'})`);
  return lines.join('\n') + '\n';
}

export function main(argv: string[]): number {
  const bad = argv.filter((a) => a !== '--record');
  if (bad.length > 0) {
    console.error(`selfhost: unknown argument '${bad[0]}'\nusage: pnpm selfhost [--record]`);
    return 2;
  }
  const record = argv.includes('--record');

  const report: Report = {
    commit: '',
    dirty: false,
    uname: '',
    cc: '',
    node: process.version,
    stages: [],
    fullSuite: null,
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
      if (Number(process.versions.node.split('.')[0]) < 24) fail(`needs Node 24 or later, not ${process.version}`);
      if (!recordAllowed(report.dirty, record)) fail('--record needs a clean tree');
    });

    step('stage 0 (pnpm build)', () => {
      if (run('pnpm', ['build'], { stdio: 'inherit' }).status !== 0) fail('pnpm build failed');
    });

    mkdirSync(outDir, { recursive: true });
    for (const f of readdirSync(outDir)) {
      if (/\.(c|json)$/.test(f) || f.startsWith('report.')) rmSync(join(outDir, f));
    }
    const dir = mkdtempSync(join(tmpdir(), 'aster-selfhost-'));
    work = dir;
    const bin = (n: number) => join(dir, `s${n}`);

    const cs: string[] = [];
    step('stage C', () => {
      const s1 = run('node', [S0, 'build', COMPILER, '-o', bin(1)]);
      if (s1.status !== 0) fail(`S0 failed to build S1 (status ${s1.status}):\n${s1.stderr}`);
      const c0 = run('node', [S0, 'build', COMPILER, '--emit=c']);
      if (c0.status !== 0) fail(`S0 --emit=c failed (status ${c0.status}):\n${c0.stderr}`);
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
        if (d !== null && drift === '') drift = `C(S${n}) differs from C(S0) at line ${d.line}:\n  S0: ${d.a}\n  S${n}: ${d.b}`;
      });
      if (drift !== '') fail(drift);
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

    step('full suite (pnpm test)', () => {
      report.fullSuite = vitest('full suite', [], 'S0+S1.json', { ASTER_STAGE_BIN: undefined, ASTER_STAGE: undefined });
    });
    for (const n of [1, 2, 3]) {
      step(`suites against S${n}`, () => {
        report.stages[n]!.suite = vitest(`S${n} suites`, STAGE_SUITES, `S${n}.json`, {
          ASTER_STAGE_BIN: bin(n),
          ASTER_STAGE: `S${n}`,
        });
      });
    }
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
      'Reproduce it with `pnpm selfhost` on Linux x86_64 with gcc 13 and Node 24 or later.',
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

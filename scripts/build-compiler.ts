import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, copyFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRelease, RELEASE_TAG } from './release-bootstrap.ts';
import { firstDifference } from './selfhost.ts';

// `pnpm bootstrap`, `pnpm bootstrap:seed` and `pnpm build` (issue #21): install the self-hosted compiler as
// build/asterc. `bootstrap` uses the nearest ancestor release (or --release <tag>, or ASTER_BOOTSTRAP_DIR);
// `bootstrap-seed` is the TypeScript seed; `build` uses the installed compiler. The builder builds c1 from
// packages/asterc-self/asterc.aster, c1 builds c2,
// and c2 is installed only if c1 and c2 emit identical C. A failure leaves any installed compiler untouched.
// Orchestration only: it spawns compilers and never imports the TypeScript compiler.

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const INSTALLED = 'build/asterc';
export const MISSING = 'aster: no compiler at build/asterc; run `pnpm bootstrap` first';
const COMPILER = 'packages/asterc-self/asterc.aster';
const S0 = 'packages/asterc/dist/cli/bin.js';

export interface Builder {
  cmd: string;
  args: string[];
}
export type BuildResult = { ok: true } | { ok: false; step: string; message: string };

export type Mode = 'bootstrap' | 'bootstrap-seed' | 'build';
export const TWO_STEP =
  'the release cannot build this compiler source; land the feature first, then use it (two-step rule, docs/self-host/building.md)';

export function parseArgs(argv: string[]): { mode: Mode; release: string | null } | null {
  if (argv.length === 1 && (argv[0] === 'bootstrap' || argv[0] === 'bootstrap-seed' || argv[0] === 'build')) return { mode: argv[0], release: null };
  if (argv.length === 3 && argv[0] === 'bootstrap' && argv[1] === '--release' && RELEASE_TAG.test(argv[2]!)) return { mode: 'bootstrap', release: argv[2]! };
  return null;
}

export function parseMode(argv: string[]): Mode | null {
  return parseArgs(argv)?.mode ?? null;
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, LC_ALL: 'C' },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), status: r.status, error: r.error };
}

export function buildCompiler(builder: Builder, source: string, dest: string): BuildResult {
  const work = mkdtempSync(join(tmpdir(), 'aster-build-compiler-'));
  try {
    const c1 = join(work, 'c1');
    const c2 = join(work, 'c2');
    const builds: [string, Builder, string][] = [
      ['build c1', builder, c1],
      ['build c2', { cmd: c1, args: [] }, c2],
    ];
    for (const [step, b, out] of builds) {
      const r = run(b.cmd, [...b.args, 'build', source, '-o', out]);
      if (r.error) return { ok: false, step, message: r.error.message };
      if (r.status !== 0 || r.stderr !== '') return { ok: false, step, message: `status ${r.status}\n${r.stderr}` };
    }
    const emitted: string[] = [];
    for (const [name, bin] of [['c1', c1], ['c2', c2]] as const) {
      const r = run(bin, ['build', source, '--emit=c']);
      if (r.error) return { ok: false, step: `${name} --emit=c`, message: r.error.message };
      if (r.status !== 0 || r.stderr !== '') return { ok: false, step: `${name} --emit=c`, message: `status ${r.status}\n${r.stderr}` };
      emitted.push(r.stdout);
    }
    const d = firstDifference(emitted[0]!, emitted[1]!);
    if (d !== null) {
      return { ok: false, step: 'fixed point', message: `C(c1) differs from C(c2) at line ${d.line}:\n  c1: ${d.a}\n  c2: ${d.b}` };
    }
    const staged = `${dest}.tmp-${process.pid}`;
    try {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(c2, staged);
      chmodSync(staged, 0o755);
      renameSync(staged, dest);
    } catch (e) {
      rmSync(staged, { force: true });
      return { ok: false, step: 'install', message: e instanceof Error ? e.message : String(e) };
    }
    return { ok: true };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args === null) {
    console.error('usage: node scripts/build-compiler.ts bootstrap [--release <tag>] | bootstrap-seed | build');
    return 2;
  }
  const { mode } = args;
  const installed = join(REPO_ROOT, INSTALLED);
  const work = mkdtempSync(join(tmpdir(), 'aster-bootstrap-'));
  try {
    let builder: Builder;
    let from: string;
    if (mode === 'bootstrap') {
      const assetsDir = process.env.ASTER_BOOTSTRAP_DIR;
      const p = prepareRelease({ root: REPO_ROOT, release: args.release, assetsDir: assetsDir === undefined ? undefined : resolve(assetsDir), work });
      if (!p.ok) {
        console.error(p.message);
        return 1;
      }
      for (const note of p.notes) console.error(note);
      builder = p.builder;
      from = `from ${p.source}, ${p.origin}`;
    } else if (mode === 'bootstrap-seed') {
      const seed = spawnSync('pnpm', ['build:seed'], { cwd: REPO_ROOT, stdio: 'inherit' });
      if (seed.error || seed.status !== 0) {
        console.error('bootstrap-seed: pnpm build:seed failed');
        return 1;
      }
      builder = { cmd: process.execPath, args: [join(REPO_ROOT, S0)] };
      from = 'from the TypeScript seed';
    } else {
      if (!executable(installed)) {
        console.error(MISSING);
        return 2;
      }
      builder = { cmd: installed, args: [] };
      from = 'rebuilt by itself';
    }
    const r = buildCompiler(builder, COMPILER, installed);
    if (!r.ok) {
      console.error(`${mode}: ${r.step} failed: ${r.message}`);
      if (mode === 'bootstrap' && r.step === 'build c1') console.error(TWO_STEP);
      console.error(mode === 'build' ? 'build/asterc is unchanged; `pnpm bootstrap` rebuilds it from a release' : 'build/asterc is unchanged');
      return 1;
    }
    console.log(`${mode}: installed ${INSTALLED} (${from})`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

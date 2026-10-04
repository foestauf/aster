import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, copyFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstDifference } from './selfhost.ts';

// `pnpm bootstrap` and `pnpm build` (issue #21): install the self-hosted compiler as build/asterc. The builder (stage
// 0 for bootstrap, the installed compiler for build) builds c1 from packages/asterc-self/asterc.aster, c1 builds c2,
// and c2 is installed only if c1 and c2 emit identical C. A failure leaves any installed compiler untouched.
// Orchestration only: it spawns compilers and never imports the TypeScript compiler.

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const INSTALLED = 'build/asterc';
export const MISSING = 'aster: no compiler at build/asterc; run `pnpm bootstrap` first';
const COMPILER = 'packages/asterc-self/asterc.aster';
const S0 = 'packages/asterc/dist/cli/bin.js';

export type Mode = 'bootstrap' | 'build';
export interface Builder {
  cmd: string;
  args: string[];
}
export type BuildResult = { ok: true } | { ok: false; step: string; message: string };

export function parseMode(argv: string[]): Mode | null {
  return argv.length === 1 && (argv[0] === 'bootstrap' || argv[0] === 'build') ? argv[0] : null;
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, LC_ALL: 'C' },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), status: r.status };
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
      if (r.status !== 0 || r.stderr !== '') return { ok: false, step, message: `status ${r.status}\n${r.stderr}` };
    }
    const emitted: string[] = [];
    for (const [name, bin] of [['c1', c1], ['c2', c2]] as const) {
      const r = run(bin, ['build', source, '--emit=c']);
      if (r.status !== 0 || r.stderr !== '') return { ok: false, step: `${name} --emit=c`, message: `status ${r.status}\n${r.stderr}` };
      emitted.push(r.stdout);
    }
    const d = firstDifference(emitted[0]!, emitted[1]!);
    if (d !== null) {
      return { ok: false, step: 'fixed point', message: `C(c1) differs from C(c2) at line ${d.line}:\n  c1: ${d.a}\n  c2: ${d.b}` };
    }
    mkdirSync(dirname(dest), { recursive: true });
    const staged = `${dest}.tmp-${process.pid}`;
    copyFileSync(c2, staged);
    chmodSync(staged, 0o755);
    renameSync(staged, dest);
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
  const mode = parseMode(argv);
  if (mode === null) {
    console.error('usage: node scripts/build-compiler.ts bootstrap|build');
    return 2;
  }
  const installed = join(REPO_ROOT, INSTALLED);
  let builder: Builder;
  if (mode === 'bootstrap') {
    const seed = spawnSync('pnpm', ['build:seed'], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (seed.error || seed.status !== 0) {
      console.error('bootstrap: pnpm build:seed failed');
      return 1;
    }
    builder = { cmd: process.execPath, args: [join(REPO_ROOT, S0)] };
  } else {
    if (!executable(installed)) {
      console.error(MISSING);
      return 2;
    }
    builder = { cmd: installed, args: [] };
  }
  const r = buildCompiler(builder, COMPILER, installed);
  if (!r.ok) {
    console.error(`${mode}: ${r.step} failed: ${r.message}`);
    console.error(mode === 'build' ? 'build/asterc is unchanged; `pnpm bootstrap` rebuilds it from the TypeScript seed' : 'build/asterc is unchanged');
    return 1;
  }
  console.log(`${mode}: installed ${INSTALLED} (${mode === 'bootstrap' ? 'from the TypeScript seed' : 'rebuilt by itself'})`);
  return 0;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

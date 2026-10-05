import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLED, MISSING } from './build-compiler.ts';

// `pnpm release` (release pipeline R1): the three assets of a GitHub release, built from the installed compiler. The
// binary is linked statically and must rebuild the compiler to the fixed point before anything is written to --out.
// Orchestration only: it spawns the compiler, cc, tar and gzip and never imports the TypeScript compiler.

// Defined locally, not imported from build-compiler.ts: release-bootstrap will make build-compiler import this module,
// and a top-level use of an imported REPO_ROOT would hit the temporal dead zone in that cycle.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const BINARY = 'asterc-linux-x86_64';
export const SEED = 'asterc-c-seed.tar.gz';
export const SUMS = 'SHA256SUMS';
export const SEED_DIR = 'asterc-c-seed';
export const BUILD_TXT = 'cc -std=c11 -O2 -I. asterc.c aster_rt.c -o asterc\n';
export const RUNTIME_DIR = join(REPO_ROOT, 'packages', 'asterc', 'runtime');
export const COMPILER_SOURCE = 'packages/asterc-self/asterc.aster';

export type StepResult = { ok: true } | { ok: false; step: string; message: string };

/** The release tag for a commit: its UTC committer date and the first seven hex digits of its SHA. */
export function releaseTag(sha: string, committedAt: number): string {
  const day = new Date(committedAt * 1000).toISOString().slice(0, 10).replaceAll('-', '');
  return `build-${day}-${sha.slice(0, 7)}`;
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** `sha256sum` output for the named files in dir. */
export function renderSums(dir: string, names: string[]): string {
  return names.map((n) => `${sha256File(join(dir, n))}  ${n}\n`).join('');
}

function run(cmd: string, args: string[], cwd = REPO_ROOT) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), status: r.status, error: r.error };
}

/** Runs a step that must exit 0 with an empty stderr; returns its stdout, or the failure. */
function step(name: string, cmd: string, args: string[], cwd?: string): { ok: true; stdout: string } | { ok: false; step: string; message: string } {
  const r = run(cmd, args, cwd);
  if (r.error) return { ok: false, step: name, message: r.error.message };
  if (r.status !== 0 || r.stderr !== '') return { ok: false, step: name, message: `status ${r.status}\n${r.stderr}` };
  return { ok: true, stdout: r.stdout };
}

export function makeRelease(opts: { compiler: string; out: string; mtime: number }): StepResult {
  const work = mkdtempSync(join(tmpdir(), 'aster-release-'));
  try {
    const seed = join(work, SEED_DIR);
    mkdirSync(seed);
    const emitted = step('emit C', opts.compiler, ['build', COMPILER_SOURCE, '--emit=c']);
    if (!emitted.ok) return emitted;
    writeFileSync(join(seed, 'asterc.c'), emitted.stdout);
    copyFileSync(join(RUNTIME_DIR, 'aster_rt.c'), join(seed, 'aster_rt.c'));
    copyFileSync(join(RUNTIME_DIR, 'aster_rt.h'), join(seed, 'aster_rt.h'));
    writeFileSync(join(seed, 'BUILD.txt'), BUILD_TXT);

    const binary = join(work, BINARY);
    const linked = step('link', 'cc', ['-std=c11', '-O2', '-static', `-I${seed}`, join(seed, 'asterc.c'), join(seed, 'aster_rt.c'), '-o', binary]);
    if (!linked.ok) return linked;

    const smoke = join(work, 'smoke');
    const rebuilt = step('smoke build', binary, ['build', COMPILER_SOURCE, '-o', smoke]);
    if (!rebuilt.ok) return rebuilt;
    const again = step('smoke emit C', smoke, ['build', COMPILER_SOURCE, '--emit=c']);
    if (!again.ok) return again;
    if (again.stdout !== emitted.stdout) return { ok: false, step: 'smoke fixed point', message: 'the static binary rebuilt a compiler whose C differs' };

    const tar = step('tar', 'tar', [
      '--sort=name', '--owner=0', '--group=0', '--numeric-owner', `--mtime=@${opts.mtime}`, '--mode=a+rX,u+w,go-w',
      '-C', work, '-cf', join(work, 'asterc-c-seed.tar'), SEED_DIR,
    ]);
    if (!tar.ok) return tar;
    const gz = step('gzip', 'gzip', ['-n', '-9', join(work, 'asterc-c-seed.tar')]);
    if (!gz.ok) return gz;
    writeFileSync(join(work, SUMS), renderSums(work, [BINARY, SEED]));

    // Everything succeeded: only now touch --out.
    mkdirSync(opts.out, { recursive: true });
    const names = [BINARY, SEED, SUMS];
    try {
      for (const name of names) copyFileSync(join(work, name), join(opts.out, `${name}.tmp-${process.pid}`));
      for (const name of names) renameSync(join(opts.out, `${name}.tmp-${process.pid}`), join(opts.out, name));
    } catch (e) {
      for (const name of names) rmSync(join(opts.out, `${name}.tmp-${process.pid}`), { force: true });
      return { ok: false, step: 'write assets', message: e instanceof Error ? e.message : String(e) };
    }
    return { ok: true };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function git(args: string[]): string {
  const r = run('git', args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export function main(argv: string[]): number {
  if (argv.length === 1 && argv[0] === 'tag') {
    console.log(releaseTag(git(['rev-parse', 'HEAD']), Number(git(['log', '-1', '--format=%ct', 'HEAD']))));
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== '--out') {
    console.error('usage: node scripts/release.ts tag | --out <dir>');
    return 2;
  }
  const installed = join(REPO_ROOT, INSTALLED);
  try {
    accessSync(installed, constants.X_OK);
  } catch {
    console.error(MISSING);
    return 2;
  }
  const r = makeRelease({ compiler: installed, out: argv[1]!, mtime: Number(git(['log', '-1', '--format=%ct', 'HEAD'])) });
  if (!r.ok) {
    console.error(`release: ${r.step} failed: ${r.message}`);
    return 1;
  }
  console.log(`release: wrote ${BINARY}, ${SEED} and ${SUMS} to ${argv[1]}`);
  return 0;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

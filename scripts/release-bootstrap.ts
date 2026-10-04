import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Builder } from './build-compiler.ts';
import { BINARY, SEED, SEED_DIR, sha256File, SUMS } from './release.ts';

// `pnpm bootstrap` from a GitHub release (release pipeline R1): resolve the nearest ancestor build-* tag, fetch and
// verify its assets, and hand back the release binary, or the compiler built from its C seed, as the builder.
// Orchestration only: it spawns git, gh, tar and sh and never imports the TypeScript compiler.

export const NO_TAG = 'bootstrap: no build-* release is an ancestor of HEAD; use --release <tag> or pnpm bootstrap:seed';
export const FELL_BACK = 'bootstrap: release binary did not run; built the C seed instead';
export const GH_HINT = 'install and authenticate gh, or set ASTER_BOOTSTRAP_DIR';

/** The only tags `--release` may name: also the cache directory's name, so no path separators or dots can get in. */
export const RELEASE_TAG = /^build-\d{8}-[0-9a-f]{7}$/;

export type Origin = 'binary' | 'c seed';
export type PrepareResult =
  | { ok: true; builder: Builder; origin: Origin; source: string; notes: string[] }
  | { ok: false; message: string };

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), status: r.status, error: r.error };
}

export function resolveTag(root: string): string | null {
  const r = run('git', ['describe', '--tags', '--match', 'build-*', '--abbrev=0', 'HEAD'], root);
  return r.status === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null;
}

export function repoSlug(remoteUrl: string): string | null {
  const m = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return m ? m[1]! : null;
}

export function verifyAssets(dir: string): { ok: true } | { ok: false; message: string } {
  if (!existsSync(join(dir, SUMS))) return { ok: false, message: `missing ${SUMS}` };
  const want = new Map<string, string>();
  for (const line of readFileSync(join(dir, SUMS), 'utf8').split('\n')) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (m) want.set(m[2]!, m[1]!);
  }
  for (const name of [BINARY, SEED]) {
    if (!want.has(name)) return { ok: false, message: `${SUMS} has no entry for ${name}` };
    if (!existsSync(join(dir, name))) return { ok: false, message: `missing ${name}` };
    if (sha256File(join(dir, name)) !== want.get(name)) return { ok: false, message: `checksum mismatch for ${name}` };
  }
  return { ok: true };
}

/** Downloads a release's three assets into dest via a sibling temp dir, so dest is all-or-nothing. */
function download(root: string, gh: string, tag: string, dest: string): { ok: true } | { ok: false; message: string } {
  const remote = run('git', ['remote', 'get-url', 'origin'], root);
  const slug = remote.status === 0 ? repoSlug(remote.stdout) : null;
  if (slug === null) return { ok: false, message: `bootstrap: no GitHub origin remote to download release ${tag} from; ${GH_HINT}` };
  const partial = `${dest}.partial-${process.pid}`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  const args = ['release', 'download', tag, '--repo', slug, '--dir', partial];
  for (const name of [BINARY, SEED, SUMS]) args.push('--pattern', name);
  const r = run(gh, args, root);
  if (r.error || r.status !== 0) {
    rmSync(partial, { recursive: true, force: true });
    const why = r.error ? r.error.message : r.stderr.trim();
    return { ok: false, message: `bootstrap: could not download release ${tag}: ${why}\n${GH_HINT}` };
  }
  renameSync(partial, dest);
  return { ok: true };
}

const PROBE = 'fn main(): int {\n    return 0;\n}\n';

function runs(bin: string, work: string): boolean {
  const probe = join(work, 'probe.aster');
  writeFileSync(probe, PROBE);
  const r = spawnSync(bin, ['check', probe], { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

export function prepareRelease(opts: {
  root: string;
  release: string | null;
  assetsDir: string | undefined;
  work: string;
  fetch?: boolean;
  gh?: string;
}): PrepareResult {
  let dir: string;
  let source: string;
  const notes: string[] = [];
  if (opts.assetsDir !== undefined) {
    if (opts.release !== null) notes.push(`bootstrap: --release ${opts.release} ignored because ASTER_BOOTSTRAP_DIR is set`);
    dir = opts.assetsDir;
    source = `ASTER_BOOTSTRAP_DIR ${dir}`;
    const v = verifyAssets(dir);
    if (!v.ok) return { ok: false, message: `bootstrap: ${source}: ${v.message}` };
  } else {
    if (opts.fetch !== false) {
      const f = run('git', ['fetch', '--quiet', '--tags', '--force', 'origin'], opts.root);
      if (f.status !== 0) process.stderr.write(`bootstrap: git fetch --tags failed; using local tags\n`);
    }
    const tag = opts.release ?? resolveTag(opts.root);
    if (tag === null) return { ok: false, message: NO_TAG };
    if (!RELEASE_TAG.test(tag)) return { ok: false, message: `bootstrap: invalid release tag '${tag}'` };
    source = `release ${tag}`;
    const cache = join(opts.root, 'build', 'bootstrap');
    dir = join(cache, tag);
    if (!existsSync(dir)) {
      mkdirSync(dirname(dir), { recursive: true });
      const d = download(opts.root, opts.gh ?? 'gh', tag, dir);
      if (!d.ok) return d;
    }
    const v = verifyAssets(dir);
    if (!v.ok) {
      if (dirname(dir) === cache) rmSync(dir, { recursive: true, force: true });
      return { ok: false, message: `bootstrap: ${source}: ${v.message}` };
    }
  }

  // Never run or chmod the assets in place: ASTER_BOOTSTRAP_DIR is the caller's, and downloads arrive without +x.
  const bin = join(opts.work, 'asterc-release');
  copyFileSync(join(dir, BINARY), bin);
  chmodSync(bin, 0o755);
  if (runs(bin, opts.work)) return { ok: true, builder: { cmd: bin, args: [] }, origin: 'binary', source, notes };

  const untar = run('tar', ['-xzf', join(dir, SEED), '-C', opts.work], opts.work);
  if (untar.status !== 0) return { ok: false, message: `bootstrap: ${source}: could not unpack ${SEED}: ${untar.stderr.trim()}` };
  const seedDir = join(opts.work, SEED_DIR);
  const built = run('sh', ['BUILD.txt'], seedDir);
  const seedBin = join(seedDir, 'asterc');
  if (built.status !== 0 || !runs(seedBin, opts.work)) {
    return { ok: false, message: `bootstrap: ${source}: neither the binary nor the C seed produced a working compiler\n${built.stderr}` };
  }
  return { ok: true, builder: { cmd: seedBin, args: [] }, origin: 'c seed', source, notes: [...notes, FELL_BACK] };
}

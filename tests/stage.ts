import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'vitest';
import { buildExecutable, compileToC, formatDiagnostic, makeSource } from '../packages/asterc/src/index.js';

// The self-hosted compiler under test. `pnpm test` uses S1, which tests/global-setup.ts builds once from stage 0.
// `pnpm selfhost` runs the stage-aware suites once per stage with ASTER_STAGE_BIN and ASTER_STAGE set.

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

export interface Stage {
  name: 'S1' | 'S2' | 'S3';
  bin: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    s1Bin: string;
  }
}

export function resolveStage(
  env: Record<string, string | undefined>,
  s1: string | undefined,
  exists: (path: string) => boolean,
): Stage {
  const bin = env.ASTER_STAGE_BIN;
  const name = env.ASTER_STAGE;
  if ((bin === undefined) !== (name === undefined)) throw new Error('ASTER_STAGE_BIN and ASTER_STAGE must be set together');
  if (bin === undefined || name === undefined) {
    if (s1 === undefined) throw new Error('no S1: global setup (tests/global-setup.ts) should have built it');
    return { name: 'S1', bin: s1 };
  }
  if (name !== 'S1' && name !== 'S2' && name !== 'S3') throw new Error(`ASTER_STAGE must be S1, S2 or S3, not '${name}'`);
  if (!isAbsolute(bin)) throw new Error(`ASTER_STAGE_BIN '${bin}' must be an absolute path`);
  if (!exists(bin)) throw new Error(`ASTER_STAGE_BIN '${bin}' does not exist`);
  return { name, bin };
}

let cached: Stage | undefined;

export function stage(): Stage {
  cached ??= resolveStage(process.env, inject('s1Bin'), existsSync);
  return cached;
}

export function buildWithStage(src: string, out: string): void {
  const { name, bin } = stage();
  const r = spawnSync(bin, ['build', src, '-o', out], {
    cwd: REPO_ROOT,
    env: { ...process.env, LC_ALL: 'C' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  if (r.error) throw r.error;
  if (r.status !== 0 || r.stderr !== '') throw new Error(`${name} failed to build ${src} (status ${r.status}):\n${r.stderr}`);
}

/** Builds the driver at `src` into `out`: with stage 0 in process under `pnpm test`, with the stage under `pnpm selfhost`. */
export function buildDriver(src: string, out: string): void {
  if (process.env.ASTER_STAGE_BIN !== undefined) return buildWithStage(src, out);
  const compiled = compileToC(makeSource(src, readFileSync(src, 'utf8')));
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
  const built = buildExecutable(compiled.c, out, ['-Werror']);
  if (!built.ok) throw new Error(built.message);
}

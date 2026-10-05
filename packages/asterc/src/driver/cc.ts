import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** runtime/ at the repo root, resolved from both src/driver/ and dist/driver/. */
export const RUNTIME_DIR = fileURLToPath(new URL('../../../../runtime/', import.meta.url));

export const cCompiler = (): string => process.env.ASTER_CC || 'cc';

export type BuildResult = { ok: true } | { ok: false; message: string };

/** Compiles generated C plus the runtime into an executable at `outPath`. */
export function buildExecutable(cSource: string, outPath: string, extraFlags: readonly string[] = []): BuildResult {
  const dir = mkdtempSync(join(tmpdir(), 'aster-cc-'));
  try {
    const cPath = join(dir, 'program.c');
    writeFileSync(cPath, cSource);
    const cc = cCompiler();
    const args = [
      '-std=c11',
      '-O2',
      '-Wall',
      ...extraFlags,
      `-I${RUNTIME_DIR}`,
      cPath,
      join(RUNTIME_DIR, 'aster_rt.c'),
      '-o',
      outPath,
    ];
    const result = spawnSync(cc, args, { encoding: 'utf8' });
    if (result.error) return { ok: false, message: `failed to run C compiler '${cc}': ${result.error.message}` };
    if (result.status !== 0) return { ok: false, message: `C compiler '${cc}' failed:\n${result.stderr}` };
    return { ok: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

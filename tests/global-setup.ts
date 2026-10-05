import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Unless ASTER_STAGE_BIN names a stage, builds S1 from packages/asterc-self/asterc.aster with the installed compiler,
// build/asterc, once for every test file.
export default function setup(project: TestProject): () => void {
  if (process.env.ASTER_STAGE_BIN !== undefined) return () => {};
  const installed = join(REPO_ROOT, 'build', 'asterc');
  try {
    accessSync(installed, constants.X_OK);
  } catch {
    throw new Error('aster: no compiler at build/asterc; run `pnpm bootstrap` first');
  }
  const dir = mkdtempSync(join(tmpdir(), 'aster-s1-'));
  const out = join(dir, 's1');
  const r = spawnSync(installed, ['build', 'packages/asterc-self/asterc.aster', '-o', out], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0 || r.stderr !== '') throw new Error(`build/asterc failed to build S1 (status ${r.status}):\n${r.stderr}`);
  project.provide('s1Bin', out);
  return () => rmSync(dir, { recursive: true, force: true });
}

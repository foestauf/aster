import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Builds stage 0's dist (`pnpm build:seed`; the self-host suites compare against its CLI) and, unless ASTER_STAGE_BIN names a stage,
// S1 from packages/asterc-self/asterc.aster, once for every test file.
export default async function setup(project: TestProject): Promise<() => void> {
  execFileSync('pnpm', ['build:seed'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (process.env.ASTER_STAGE_BIN !== undefined) return () => {};
  const { buildExecutable, compileToC, formatDiagnostic, makeSource } = await import('../packages/asterc/src/index.js');
  const dir = mkdtempSync(join(tmpdir(), 'aster-s1-'));
  const src = join(REPO_ROOT, 'packages', 'asterc-self', 'asterc.aster');
  const compiled = compileToC(makeSource(src, readFileSync(src, 'utf8')));
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
  const built = buildExecutable(compiled.c, join(dir, 's1'), ['-Werror']);
  if (!built.ok) throw new Error(built.message);
  project.provide('s1Bin', join(dir, 's1'));
  return () => rmSync(dir, { recursive: true, force: true });
}

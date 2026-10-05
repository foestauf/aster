import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The TypeScript seed is archived (R2). Nothing in CI, scripts or tests may depend on it, apart from the allowlist below.
// R2b empties the allowlist.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'tests/seed_guard.test.ts';
const SEED_ALLOWLIST: string[] = ['scripts/build-compiler.ts', 'scripts/ci-bootstrap.sh', 'scripts/normal-path.sh'];
const FORBIDDEN = ['packages/asterc/src', 'packages/asterc/dist', 'build:seed', 'aster:seed'];

function files(dir: string): string[] {
  return readdirSync(join(REPO_ROOT, dir), { recursive: true, encoding: 'utf8', withFileTypes: false })
    .map((f) => `${dir}/${f.split('\\').join('/')}`)
    .filter((f) => !f.split('/').includes('node_modules') && !f.startsWith('tests/golden/') && f !== SELF)
    .filter((f) => !relative(REPO_ROOT, join(REPO_ROOT, f)).startsWith('..'))
    .filter((f) => {
      try {
        readFileSync(join(REPO_ROOT, f), 'utf8');
        return true;
      } catch {
        return false;
      }
    });
}

const scanned = ['.github/workflows', 'scripts', 'tests'].flatMap(files);

describe('seed guard', () => {
  it('scans the expected files', () => {
    expect(scanned).toContain('.github/workflows/ci.yml');
    expect(scanned).toContain('scripts/selfhost.ts');
    expect(scanned).toContain('tests/stage.ts');
    expect(scanned).not.toContain(SELF);
  });

  it('keeps every file free of the TypeScript seed, except the allowlist', () => {
    const offenders = scanned
      .filter((f) => !SEED_ALLOWLIST.includes(f))
      .filter((f) => {
        const text = readFileSync(join(REPO_ROOT, f), 'utf8');
        return FORBIDDEN.some((w) => text.includes(w));
      });
    expect(offenders).toEqual([]);
  });

  it('only allows files that exist', () => {
    for (const f of SEED_ALLOWLIST) expect(scanned).toContain(f);
  });

  it('never lets a workflow update goldens', () => {
    const workflows = scanned.filter((f) => f.startsWith('.github/workflows/'));
    expect(workflows.length).toBeGreaterThan(0);
    const updating = workflows.flatMap((f) =>
      readFileSync(join(REPO_ROOT, f), 'utf8')
        .split('\n')
        .filter((line) => /vitest/.test(line) && /(^|\s)(-u|--update)(\s|$)/.test(line))
        .map((line) => `${f}: ${line.trim()}`),
    );
    expect(updating).toEqual([]);
  });
});

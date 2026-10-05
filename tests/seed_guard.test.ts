import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The TypeScript seed is archived (R2). Nothing in CI, scripts or tests may depend on it, apart from the allowlist below.
// The allowlist is empty: the seed was removed in R2b.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'tests/seed_guard.test.ts';
const SEED_ALLOWLIST: string[] = [
];
const FORBIDDEN = ['packages/asterc/src', 'packages/asterc/dist', 'build:seed', 'aster:seed', 'bootstrap:seed', 'bootstrap-seed'];

/** A line that would refresh goldens: the `golden` script, or `-u`/`--update` on a vitest or `pnpm test` invocation. */
export function updatesGoldens(line: string): boolean {
  if (/\bpnpm\s+(-s\s+)?(run\s+)?golden\b/.test(line)) return true;
  const runsTests = /\bvitest\b/.test(line) || /\bpnpm\s+(-s\s+)?(run\s+)?test\b/.test(line);
  return runsTests && /(^|\s)(-u|--update(=\S*)?)(\s|$)/.test(line);
}

const read = (f: string): string => readFileSync(join(REPO_ROOT, f), 'utf8');
const scanned = ['.github/workflows', 'scripts', 'tests'].flatMap((dir) =>
  readdirSync(join(REPO_ROOT, dir), { recursive: true, encoding: 'utf8' })
    .map((f) => `${dir}/${f.split('\\').join('/')}`)
    .filter((f) => !f.split('/').includes('node_modules') && !f.startsWith('tests/golden/') && f !== SELF)
    .filter((f) => /\.[a-z]+$/.test(f) || f === 'scripts/aster'),
);
const text = new Map(scanned.map((f) => [f, read(f)]));
const mentionsSeed = (f: string): boolean => FORBIDDEN.some((w) => text.get(f)!.includes(w));

describe('seed guard', () => {
  it('scans the expected files', () => {
    for (const f of ['.github/workflows/ci.yml', 'scripts/selfhost.ts', 'scripts/aster', 'tests/stage.ts']) expect(scanned).toContain(f);
    expect(scanned).not.toContain(SELF);
  });

  it('keeps every file free of the TypeScript seed, except the allowlist', () => {
    expect(scanned.filter((f) => !SEED_ALLOWLIST.includes(f) && mentionsSeed(f))).toEqual([]);
  });

  it('allowlists only files that still mention the seed', () => {
    expect(SEED_ALLOWLIST.filter((f) => !scanned.includes(f) || !mentionsSeed(f))).toEqual([]);
  });

  it('never lets a workflow update goldens', () => {
    const workflows = scanned.filter((f) => f.startsWith('.github/workflows/'));
    expect(workflows.length).toBeGreaterThan(0);
    const bad = workflows.flatMap((f) =>
      text
        .get(f)!
        .split('\n')
        .filter(updatesGoldens)
        .map((line) => `${f}: ${line.trim()}`),
    );
    expect(bad).toEqual([]);
  });

  it('keeps -u and --update in package.json to the golden script', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    expect(scripts.golden).toBeDefined();
    const bad = Object.entries(scripts).filter(([name, cmd]) => name !== 'golden' && /(^|\s)(-u|--update(=\S*)?)(\s|$)/.test(cmd) && /vitest/.test(cmd));
    expect(bad).toEqual([]);
  });
});

describe('updatesGoldens', () => {
  it.each(['run: pnpm golden', 'run: pnpm -s run golden', 'run: pnpm test -u', 'run: pnpm test -- --update', 'run: pnpm exec vitest run --update=true'])(
    'flags %s',
    (line) => {
      expect(updatesGoldens(line)).toBe(true);
    },
  );
  it.each(['run: pnpm test', 'run: pnpm -s test', 'run: pnpm exec vitest run tests/x.test.ts', 'run: pnpm install --frozen-lockfile', 'run: rm -u foo'])(
    'passes %s',
    (line) => {
      expect(updatesGoldens(line)).toBe(false);
    },
  );
});

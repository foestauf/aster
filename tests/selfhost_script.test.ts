import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { firstDifference, recordAllowed, REPO_ROOT, STAGE_SUITES } from '../scripts/selfhost.js';

// scripts/selfhost.ts (pnpm selfhost) is orchestration only (contract §6.4). These cover its pure parts and the rule
// that it never imports the TypeScript compiler.

describe('firstDifference', () => {
  it('is null for identical text', () => {
    expect(firstDifference('a\nb\n', 'a\nb\n')).toBeNull();
  });
  it('reports the first differing line, 1-based', () => {
    expect(firstDifference('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ line: 2, a: 'b', b: 'B' });
  });
  it('treats a missing trailing newline as a difference', () => {
    expect(firstDifference('a\n', 'a')).toEqual({ line: 2, a: '', b: '<end of file>' });
  });
  it('reports a length difference on the first extra line', () => {
    expect(firstDifference('a\n', 'a\nb\n')).toEqual({ line: 2, a: '<end of file>', b: 'b' });
  });
});

describe('recordAllowed', () => {
  it('refuses to record from a dirty tree', () => {
    expect(recordAllowed(true, true)).toBe(false);
    expect(recordAllowed(false, true)).toBe(true);
    expect(recordAllowed(true, false)).toBe(true);
  });
});

describe('the script', () => {
  const text = readFileSync(join(REPO_ROOT, 'scripts', 'selfhost.ts'), 'utf8');
  it('imports nothing from packages/', () => {
    expect(text).not.toMatch(/from\s+['"][^'"]*packages\//);
    expect(text).not.toMatch(/import\(\s*['"][^'"]*packages\//);
  });
  it('derives the repo root from its own location, not the cwd', () => {
    expect(REPO_ROOT.endsWith('/')).toBe(true);
    expect(text).not.toMatch(/process\.cwd\(\)/);
  });
  it('runs only suites that exist', () => {
    for (const s of STAGE_SUITES) expect(() => readFileSync(join(REPO_ROOT, s))).not.toThrow();
  });
});

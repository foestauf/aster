import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './golden.js';

// Every diagnostic code the compiler can emit is catalogued in docs/inspect/README.md, and every catalogued code is
// emitted somewhere: the set of code literals in packages/asterc-self/ equals the catalogue. Codes are literals at their
// producers (spec §4), so a scan finds them all.

const PHASES = ['io', 'source', 'lex', 'syntax', 'import', 'decl', 'generic', 'typeref', 'main', 'flow', 'name', 'type', 'try', 'match', 'pattern', 'assign', 'call'];
const CODE = new RegExp(`"((?:${PHASES.join('|')})\\.[a-z0-9-]+)"`, 'g');
const PENDING_ROOT_CODES = ['io.root-unreadable', 'source.invalid-utf8']; // produced from Task 3 (inspect.aster); delete this allowance then

function sourceCodes(): Set<string> {
  const dir = join(REPO_ROOT, 'packages', 'asterc-self');
  const found = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.aster'))) {
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(CODE)) {
      if (!m[1]!.endsWith('.aster')) found.add(m[1]!);
    }
  }
  return found;
}

function catalogue(): string[] {
  const text = readFileSync(join(REPO_ROOT, 'docs', 'inspect', 'README.md'), 'utf8');
  return [...text.matchAll(/^\| `([a-z]+\.[a-z0-9-]+)` \|/gm)].map((m) => m[1]!);
}

describe('diagnostic codes', () => {
  it('are catalogued once each', () => {
    const codes = catalogue();
    expect(codes.length).toBeGreaterThan(80);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('match the catalogue exactly', () => {
    const expected = [...new Set([...sourceCodes(), ...PENDING_ROOT_CODES])].toSorted();
    expect(expected).toEqual(catalogue().toSorted());
  });

  it('are dotted kebab-case names in a known phase', () => {
    for (const c of catalogue()) expect(c).toMatch(new RegExp(`^(${PHASES.join('|')})\\.[a-z][a-z0-9-]*$`));
  });
});

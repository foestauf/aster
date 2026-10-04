import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExecutable, compileToC, formatDiagnostic, makeSource, runFrontend, type TypedProgram } from '../packages/asterc/src/index.js';
import { dumpTyped } from './typed_dump.js';

// Checks tests/programs/programs/typed.aster, which prints the typed program built by packages/asterc-self/checker.aster
// in the canonical dump format (packages/asterc-self/typed_dump.aster), against the compiler's own typed program
// printed by tests/typed_dump.ts. The corpus is check_aster.test.ts's plus the `fixtures/typed_*.txt` files, limited
// to the programs the TypeScript front end accepts: a rejected program has no typed tree to compare.
const PROGRAMS_DIR = fileURLToPath(new URL('./programs/', import.meta.url));
const SELF_DIR = fileURLToPath(new URL('../packages/asterc-self/', import.meta.url));

/** The TypeScript front end's typed program for the file at `path`, or null if it reports any diagnostic. */
function typedOf(path: string): TypedProgram | null {
  const result = runFrontend(makeSource(path, readFileSync(path, 'utf8')));
  return result.diagnostics.length === 0 ? result.typed : null;
}

const candidates = readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.aster') || /fixtures[\\/](check|typed)_\w+\.txt$/.test(f))
  .concat(readdirSync(SELF_DIR).filter((f) => f.endsWith('.aster')).map((f) => join('..', '..', 'packages', 'asterc-self', f)))
  .toSorted();

/** The accepted corpus, each file with its typed program. */
const accepted = candidates.flatMap((file) => {
  const typed = typedOf(join(PROGRAMS_DIR, file));
  return typed === null ? [] : [{ file, typed }];
});
const corpus = accepted.map((c) => c.file);

// Files whose typed bodies checker.aster does not build yet: they run as skipped until a later task removes them.
const PENDING = new Set<string>([]);

const workDir = mkdtempSync(join(tmpdir(), 'aster-typed-'));
const exe = join(workDir, 'typed');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

beforeAll(() => {
  const path = join(PROGRAMS_DIR, 'programs', 'typed.aster');
  const compiled = compileToC(makeSource(path, readFileSync(path, 'utf8')));
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
  const built = buildExecutable(compiled.c, exe, ['-Werror']);
  if (!built.ok) throw new Error(built.message);
});

describe('typed.aster matches the TypeScript typed program', () => {
  it('has a corpus that includes the drivers and the typed fixtures', () => {
    expect(corpus).toContain(join('programs', 'check.aster'));
    expect(corpus).toContain(join('programs', 'typed.aster'));
    for (const name of readdirSync(join(PROGRAMS_DIR, 'programs', 'fixtures')).filter((n) => /^typed_\w+\.txt$/.test(n))) {
      expect(corpus).toContain(join('programs', 'fixtures', name));
    }
  });

  it('has no stale PENDING entries', () => {
    for (const file of PENDING) expect(corpus).toContain(file);
  });

  it.for(accepted)('$file', ({ file, typed }, { skip }) => {
    if (PENDING.has(file)) skip();
    const run = spawnSync(exe, [join(PROGRAMS_DIR, file)], { encoding: 'utf8', timeout: 20_000, maxBuffer: 256 * 1024 * 1024 });
    expect({ stdout: run.stdout, stderr: run.stderr, status: run.status }).toEqual({ stdout: dumpTyped(typed), stderr: '', status: 0 });
  });
});

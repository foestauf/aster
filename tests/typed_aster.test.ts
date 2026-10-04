import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExecutable, compileToC, formatDiagnostic, makeSource } from '../packages/asterc/src/index.js';
import { acceptedCorpus, PROGRAMS_DIR } from './corpus.js';
import { dumpTyped } from './typed_dump.js';

// Checks tests/programs/programs/typed.aster, which prints the typed program built by packages/asterc-self/checker.aster
// in the canonical dump format (packages/asterc-self/typed_dump.aster), against the compiler's own typed program
// printed by tests/typed_dump.ts. The corpus is check_aster.test.ts's plus the `fixtures/typed_*.txt` and
// `fixtures/ir_*.txt` files, limited to the programs the TypeScript front end accepts: a rejected program has no typed tree to compare.

/** The accepted corpus, each file with its typed program. */
const accepted = acceptedCorpus();
const corpus = accepted.map((c) => c.file);

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
    // Guards against a TS change silently shrinking the accepted corpus (134 files today).
    expect(corpus.length).toBeGreaterThanOrEqual(130);
    for (const name of readdirSync(join(PROGRAMS_DIR, 'programs', 'fixtures')).filter((n) => /^typed_\w+\.txt$/.test(n))) {
      expect(corpus).toContain(join('programs', 'fixtures', name));
    }
  });

  it.for(accepted)('$file', ({ file, typed }) => {
    const run = spawnSync(exe, [join(PROGRAMS_DIR, file)], { encoding: 'utf8', timeout: 20_000, maxBuffer: 256 * 1024 * 1024 });
    expect({ stdout: run.stdout, stderr: run.stderr, status: run.status }).toEqual({ stdout: dumpTyped(typed), stderr: '', status: 0 });
  });
});

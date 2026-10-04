import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptedCorpus, PROGRAMS_DIR } from './corpus.js';
import { buildDriver } from './stage.js';
import { dumpTyped } from './typed_dump.js';
import { spawnStrict } from './spawn.js';

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

// A driver build is cc -O2 on the compiler's C, or a stage build of the driver: both can outlast vitest's 10 s default.
const CC_HOOK_TIMEOUT = 60_000;

beforeAll(() => {
  const path = join(PROGRAMS_DIR, 'programs', 'typed.aster');
  buildDriver(path, exe);
}, CC_HOOK_TIMEOUT);

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
    const run = spawnStrict(exe, [join(PROGRAMS_DIR, file)], { timeout: 20_000, maxBuffer: 256 * 1024 * 1024 });
    expect({ stdout: run.stdout, stderr: run.stderr, status: run.status }).toEqual({ stdout: dumpTyped(typed), stderr: '', status: 0 });
  });
});

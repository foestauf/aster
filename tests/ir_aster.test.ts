import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lower, printIr } from '../packages/asterc/src/index.js';
import { acceptedCorpus, PROGRAMS_DIR } from './corpus_ts.js';
import { buildDriver } from './stage.js';
import { spawnStrict } from './spawn.js';

// Checks tests/programs/programs/ir.aster, which lowers a program with packages/asterc-self/lower.aster and prints it
// with packages/asterc-self/ir_print.aster, against the compiler's own printIr(lower(typed)), byte for byte, on the
// accepted corpus (tests/corpus.ts). Nothing is normalised: temp, label and string numbering must match exactly.

const accepted = acceptedCorpus();
const corpus = accepted.map((c) => c.file);

const workDir = mkdtempSync(join(tmpdir(), 'aster-ir-'));
const exe = join(workDir, 'ir');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

// A driver build is cc -O2 on the compiler's C, or a stage build of the driver: both can outlast vitest's 10 s default.
const CC_HOOK_TIMEOUT = 60_000;

beforeAll(() => {
  const path = join(PROGRAMS_DIR, 'programs', 'ir.aster');
  buildDriver(path, exe);
}, CC_HOOK_TIMEOUT);

describe('ir.aster matches the TypeScript IR', () => {
  it('has a corpus that includes the drivers and the IR fixtures', () => {
    // Guards against a TS change silently shrinking the accepted corpus.
    expect(corpus.length).toBeGreaterThanOrEqual(140);
    expect(corpus).toContain(join('programs', 'ir.aster'));
    for (const name of readdirSync(join(PROGRAMS_DIR, 'programs', 'fixtures')).filter((n) => /^ir_\w+\.txt$/.test(n))) {
      expect(corpus).toContain(join('programs', 'fixtures', name));
    }
  });

  it.for(accepted)('$file', ({ file, typed }) => {
    const run = spawnStrict(exe, [join(PROGRAMS_DIR, file)], { timeout: 20_000, maxBuffer: 256 * 1024 * 1024 });
    const actual = { stdout: run.stdout, stderr: run.stderr, status: run.status };
    const expected = { stdout: printIr(lower(typed)), stderr: '', status: 0 };
    expect(actual).toEqual(expected);
  });
});

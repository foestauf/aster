import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExecutable, compileToC, formatDiagnostic, lower, makeSource, printIr } from '../packages/asterc/src/index.js';
import { acceptedCorpus, PROGRAMS_DIR } from './corpus.js';

// Checks tests/programs/programs/ir.aster, which lowers a program with packages/asterc-self/lower.aster and prints it
// with packages/asterc-self/ir_print.aster, against the compiler's own printIr(lower(typed)), byte for byte, on the
// accepted corpus (tests/corpus.ts). Nothing is normalised: temp, label and string numbering must match exactly.

/** Files the port can't lower yet: each must still differ from TypeScript. It shrinks every task and is empty at merge. */
const PENDING = new Set<string>();

const accepted = acceptedCorpus();
const corpus = accepted.map((c) => c.file);

const workDir = mkdtempSync(join(tmpdir(), 'aster-ir-'));
const exe = join(workDir, 'ir');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

beforeAll(() => {
  const path = join(PROGRAMS_DIR, 'programs', 'ir.aster');
  const compiled = compileToC(makeSource(path, readFileSync(path, 'utf8')));
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
  const built = buildExecutable(compiled.c, exe, ['-Werror']);
  if (!built.ok) throw new Error(built.message);
});

describe('ir.aster matches the TypeScript IR', () => {
  it('has a corpus that includes the drivers and the IR fixtures', () => {
    expect(corpus).toContain(join('programs', 'ir.aster'));
    for (const name of readdirSync(join(PROGRAMS_DIR, 'programs', 'fixtures')).filter((n) => /^ir_\w+\.txt$/.test(n))) {
      expect(corpus).toContain(join('programs', 'fixtures', name));
    }
  });

  it('lists only corpus files as pending', () => {
    for (const file of PENDING) expect(corpus).toContain(file);
  });

  it.for(accepted)('$file', ({ file, typed }) => {
    const run = spawnSync(exe, [join(PROGRAMS_DIR, file)], { encoding: 'utf8', timeout: 20_000, maxBuffer: 256 * 1024 * 1024 });
    const actual = { stdout: run.stdout, stderr: run.stderr, status: run.status };
    const expected = { stdout: printIr(lower(typed)), stderr: '', status: 0 };
    // A pending file must still differ from TypeScript; any other must match (toEqual then shows the diff).
    const pending = PENDING.has(file);
    expect(pending ? { matches: isDeepStrictEqual(actual, expected) } : actual).toEqual(pending ? { matches: false } : expected);
  });
});

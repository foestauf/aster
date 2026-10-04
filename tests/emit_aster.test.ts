import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExecutable, emitC, lower } from '../packages/asterc/src/index.js';
import { acceptedCorpus, PROGRAMS_DIR } from './corpus.js';
import { buildDriver } from './stage.js';

// Checks tests/programs/programs/emit.aster, which lowers a program with packages/asterc-self/lower.aster and emits C
// with packages/asterc-self/emit.aster, against the compiler's own emitC(lower(typed)), byte for byte, on the accepted
// corpus (tests/corpus.ts). Nothing is normalised (self-hosting contract §6.2).

const accepted = acceptedCorpus().map(({ file, typed }) => ({ file, c: emitC(lower(typed)) }));
const corpus = accepted.map((c) => c.file);
const DRIVER = join('programs', 'emit.aster');

const workDir = mkdtempSync(join(tmpdir(), 'aster-emit-'));
/** The driver built by stage 0. */
const e0 = join(workDir, 'e0');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** Runs an emitter binary on a corpus file. */
function emitWith(exe: string, file: string) {
  const run = spawnSync(exe, [join(PROGRAMS_DIR, file)], { encoding: 'utf8', timeout: 20_000, maxBuffer: 256 * 1024 * 1024 });
  return { stdout: run.stdout, stderr: run.stderr, status: run.status };
}

// cc -O2 on the compiler's ~960 KB of C can exceed vitest's default 10 s hook timeout on a slow machine.
const CC_HOOK_TIMEOUT = 60_000;

beforeAll(() => {
  const path = join(PROGRAMS_DIR, DRIVER);
  buildDriver(path, e0);
}, CC_HOOK_TIMEOUT);

describe('emit.aster (built by the stage under test) matches the TypeScript C emitter', () => {
  it('has a corpus that includes the driver and the emit fixtures', () => {
    expect(corpus).toContain(DRIVER);
    for (const name of readdirSync(join(PROGRAMS_DIR, 'programs', 'fixtures')).filter((n) => /^emit_\w+\.txt$/.test(n))) {
      expect(corpus).toContain(join('programs', 'fixtures', name));
    }
  });

  it.for(accepted)('$file', ({ file, c }) => {
    expect(emitWith(e0, file)).toEqual({ stdout: c, stderr: '', status: 0 });
  });
});

/** The driver compiled from the C that E0 emits for its own closure: an emitter built by Aster. */
const e1 = join(workDir, 'e1');

describe('emit.aster built from its own C (E1) matches the TypeScript C emitter', () => {
  beforeAll(() => {
    const own = emitWith(e0, DRIVER);
    if (own.status !== 0) throw new Error(`E0 failed on its own closure:\n${own.stderr}`);
    const expected = accepted.find((a) => a.file === DRIVER);
    // E0 is checked against TS on DRIVER above; this guards against building E1 from anything else.
    if (expected === undefined || own.stdout !== expected.c) throw new Error('E0 C for its own closure differs from stage 0');
    const built = buildExecutable(own.stdout, e1, ['-Werror']);
    if (!built.ok) throw new Error(built.message);
  }, CC_HOOK_TIMEOUT);

  it.for(accepted)('$file', ({ file, c }) => {
    expect(emitWith(e1, file)).toEqual({ stdout: c, stderr: '', status: 0 });
  });
});

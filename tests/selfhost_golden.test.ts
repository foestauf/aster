import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { parseExpectations } from './harness.js';
import { stage } from './stage.js';

// Contract §6.3: every runnable golden program, run through the stage under test with `run <file> -- <args>` and its
// expect-stdin, must meet its expect-stdout, expect-stderr and expect-exit unchanged. Runs from the program's own
// directory, as tests/golden.test.ts does, under a private TMPDIR that must be empty after every program.

const PROGRAMS_DIR = fileURLToPath(new URL('./programs/', import.meta.url));
const runnable = readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.aster') && !f.split(/[\\/]/).includes('fixtures'))
  .toSorted()
  .map((file) => ({ file, expected: parseExpectations(readFileSync(join(PROGRAMS_DIR, file), 'utf8')) }))
  .filter(({ expected }) => !expected.library && expected.errors.length === 0);

const workDir = mkdtempSync(join(tmpdir(), 'aster-sn-golden-'));
const tmpDir = join(workDir, 'tmp');
mkdirSync(tmpDir);
afterAll(() => rmSync(workDir, { recursive: true, force: true }));
afterEach(() => {
  const left = readdirSync(tmpDir);
  if (left.length > 0) throw new Error(`TMPDIR is not empty: ${left.join(', ')}`);
});

describe(`golden programs run through ${stage().name}`, () => {
  it('covers more than the compiler driver', () => {
    expect(runnable.length).toBeGreaterThan(120);
  });

  it.for(runnable)('$file', ({ file, expected }) => {
    const r = spawnSync(stage().bin, ['run', basename(file), '--', ...expected.args], {
      cwd: dirname(join(PROGRAMS_DIR, file)),
      env: { ...process.env, TMPDIR: tmpDir, LC_ALL: 'C' },
      input: expected.stdin,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) throw r.error;
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.status }).toEqual({
      stdout: expected.stdout,
      stderr: expected.stderr,
      exitCode: expected.exitCode,
    });
  });
});

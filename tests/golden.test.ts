import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildExecutable, compileToC, formatDiagnostic, formatShort, makeSource } from '../packages/asterc/src/index.js';
import { parseExpectations } from './harness.js';
import { spawnStrict } from './spawn.js';

const PROGRAMS_DIR = fileURLToPath(new URL('./programs/', import.meta.url));
const programs = readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.aster') && !f.split(/[\\/]/).includes('fixtures'))
  .toSorted()
  .map((file) => {
    const text = readFileSync(join(PROGRAMS_DIR, file), 'utf8');
    return { file, text, expected: parseExpectations(text) };
  });

const workDir = mkdtempSync(join(tmpdir(), 'aster-golden-'));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

// Library files are only compiled as part of the program that imports them.
const roots = programs.filter((p) => !p.expected.library);

describe('golden programs: compile errors', () => {
  it.each(roots.filter((p) => p.expected.errors.length > 0))('$file', ({ file, text, expected }) => {
    const source = makeSource(join(PROGRAMS_DIR, file), text);
    const compiled = compileToC(source);
    const actual = compiled.ok ? [] : compiled.diagnostics.map((d) => formatShort(compiled.map, d));
    expect(actual).toEqual(expected.errors);
  });
});

describe('golden programs: run', () => {
  it.each(roots.filter((p) => p.expected.errors.length === 0))('$file', ({ file, text, expected }) => {
    const source = makeSource(join(PROGRAMS_DIR, file), text);
    const compiled = compileToC(source);
    if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
    const exe = join(workDir, file.replace(/[\\/]/g, '__').replace(/\.aster$/, ''));
    const built = buildExecutable(compiled.c, exe, ['-Werror']);
    if (!built.ok) throw new Error(built.message);
    const run = spawnStrict(exe, expected.args, {
      cwd: dirname(join(PROGRAMS_DIR, file)),
      input: expected.stdin,
      timeout: 10_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    expect({ stdout: run.stdout, stderr: run.stderr, exitCode: run.status }).toEqual({
      stdout: expected.stdout,
      stderr: expected.stderr,
      exitCode: expected.exitCode,
    });
  });
});

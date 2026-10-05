import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { parseExpectations } from './harness.js';
import { stage } from './stage.js';
import { spawnStrict } from './spawn.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROGRAMS = join(ROOT, 'tests/programs');
const work = mkdtempSync(join(tmpdir(), 'aster-llvm-tests-'));
const scratch = join(work, 'tmp');
mkdirSync(scratch);
afterAll(() => rmSync(work, { recursive: true, force: true }));
afterEach(() => {
  const left = readdirSync(scratch);
  if (left.length) throw new Error(`TMPDIR not empty: ${left.join(', ')}`);
});

function run(cmd: string, args: string[], cwd = ROOT, input = '') {
  const r = spawnStrict(cmd, args, { cwd, input, env: { ...process.env, TMPDIR: scratch, LC_ALL: 'C' }, timeout: 120_000, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}
const corpus = readdirSync(PROGRAMS, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.aster') && !f.split(/[\\/]/).includes('fixtures')).toSorted()
  .map((file) => ({ file, expected: parseExpectations(readFileSync(join(PROGRAMS, file), 'utf8')) }))
  .filter(({ expected }) => !expected.library && expected.errors.length === 0);

describe('LLVM golden parity and clang verification', () => {
  it('covers the complete runnable corpus', () => expect(corpus.length).toBeGreaterThan(120));
  it.for(corpus)('$file', ({ file, expected }) => {
    const cwd = dirname(join(PROGRAMS, file));
    const c = run(stage().bin, ['run', basename(file), '--backend=c', '--', ...expected.args], cwd, expected.stdin);
    const llvm = run(stage().bin, ['run', basename(file), '--backend=llvm', '--', ...expected.args], cwd, expected.stdin);
    expect(c).toEqual({ stdout: expected.stdout, stderr: expected.stderr, status: expected.exitCode });
    expect(llvm).toEqual(c);
  });
});

/** Compare only ABI-bearing return/parameter types and bool zeroext; ignore optimizer parameter attributes/names. */
export function runtimeSignatures(module: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of module.split('\n')) {
    const m = /^declare\s+(.*?)\s+@(aster_rt_\w+)\((.*?)\)/.exec(line);
    if (!m) continue;
    const ret = /(?:\{\s*ptr,\s*i64\s*\}|void|ptr|i\d+)\s*$/.exec(m[1])?.[0]?.replace(/\s+/g, '');
    if (!ret) throw new Error(`unrecognized return ABI: ${line}`);
    const returnAbi = `${m[1].includes('zeroext') ? 'zeroext ' : ''}${ret}`;
    const parameters = m[3].trim() === '' ? [] : m[3].split(',').map((p) => {
      const type = /\b(ptr|i\d+)\b/.exec(p)?.[1];
      if (!type) throw new Error(`unrecognized parameter ABI: ${line}`);
      return `${type}${p.includes('zeroext') ? ' zeroext' : ''}`;
    });
    result.set(m[2], `${returnAbi}(${parameters.join(',')})`);
  }
  return result;
}

describe('LLVM deterministic output and runtime ABI', () => {
  it('emits byte-stable LLVM for the compiler without invoking clang', () => {
    const args = ['build', 'packages/asterc-self/asterc.aster', '--emit=llvm'];
    const first = run(stage().bin, args);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    expect(first.stdout).toContain('define');
    expect(run(stage().bin, args)).toEqual(first);
    expect(first.stdout).not.toMatch(/\b(?:nsw|nuw)\b/);
  });
  it('matches every public C runtime prototype as lowered by clang 18', () => {
    expect(run('clang', ['--version']).stdout).toMatch(/clang version 18\./);
    const header = readFileSync(join(ROOT, 'runtime/aster_rt.h'), 'utf8');
    const names = [...header.matchAll(/^(?:_Noreturn\s+)?(?:void|bool|int64_t|aster_string|aster_array)\s+\*?(aster_rt_\w+)\([^;{}]*\);/gm)].map((m) => m[1]);
    expect(names.length).toBe(28);
    const probe = join(work, 'abi.c');
    const output = join(work, 'abi.ll');
    writeFileSync(probe, '#include "aster_rt.h"\nvoid *abi_symbols[] = {\n' + names.map((n) => `(void *)&${n}`).join(',\n') + '\n};\n');
    const clang = run('clang', ['-S', '-emit-llvm', '-O0', '-I', join(ROOT, 'runtime'), probe, '-o', output]);
    expect(clang).toEqual({ stdout: '', stderr: '', status: 0 });
    const emitted = run(stage().bin, ['build', 'tests/programs/basics/hello.aster', '--emit=llvm']);
    expect(emitted.status).toBe(0);
    const expected = runtimeSignatures(readFileSync(output, 'utf8'));
    const actual = runtimeSignatures(emitted.stdout);
    expect([...expected.keys()].toSorted()).toEqual(names.toSorted());
    for (const name of names) expect({ name, signature: actual.get(name) }).toEqual({ name, signature: expected.get(name) });
  });
});

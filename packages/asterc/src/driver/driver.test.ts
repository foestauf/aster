import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeSource } from '../diagnostics/source.js';
import { buildExecutable } from './cc.js';
import { compileToC } from './pipeline.js';

const dir = mkdtempSync(join(tmpdir(), 'aster-driver-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;

function buildAndRun(text: string) {
  const compiled = compileToC(makeSource('t.aster', text));
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => d.message).join('\n'));
  const exe = join(dir, `p${counter++}`);
  const built = buildExecutable(compiled.c, exe, ['-Werror']);
  if (!built.ok) throw new Error(built.message);
  const run = spawnSync(exe, { encoding: 'utf8' });
  return { stdout: run.stdout, stderr: run.stderr, status: run.status };
}

describe('compileToC + buildExecutable', () => {
  it('runs the example program', () => {
    const text = 'fn main(): int {\n    let x: int = 10;\n    let y: int = 20;\n    print(x + y);\n    return 0;\n}\n';
    expect(buildAndRun(text)).toEqual({ stdout: '30\n', stderr: '', status: 0 });
  });

  it('panics on division by zero after flushing stdout', () => {
    expect(buildAndRun('fn main(): int { print(1); let z: int = 0; print(10 / z); return 0; }')).toEqual({
      stdout: '1\n',
      stderr: 'panic: division by zero\n',
      status: 101,
    });
  });

  it('wraps integer overflow', () => {
    const text = 'fn main(): int { let max: int = 9223372036854775807; print(max + 1); print(max * 2); return 0; }';
    expect(buildAndRun(text).stdout).toBe('-9223372036854775808\n-2\n');
  });

  it('runs the string runtime', () => {
    const text = `fn main(): int {
      let s: string = "héllo" + ", " + int_to_string(-42);
      print(s);
      print(len(s));
      print(byte_at(s, 1));
      print(substring(s, 0, 1) == "h");
      return 0;
    }`;
    expect(buildAndRun(text).stdout).toBe('héllo, -42\n11\n195\ntrue\n');
  });

  it('survives C name collisions', () => {
    const text = `fn printf(x: int): int { return x + 1; }
fn exit(code: int): int { return code * 2; }
fn aster_rt_add(a: int, b: int): int { return a - b; }
fn main(): int {
    let int: int = 1;
    let char: int = printf(int);
    let goto: int = exit(char);
    let NULL: int = aster_rt_add(goto, 1);
    print(NULL);
    return 0;
}`;
    expect(buildAndRun(text)).toEqual({ stdout: '3\n', stderr: '', status: 0 });
  });

  it('stops before checking when there are syntax errors', () => {
    const result = compileToC(makeSource('t.aster', 'fn main(): int { let x: int = ; return y; }'));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ message: "expected expression, found ';'" }] });
  });

  it('reports C compiler failures', () => {
    expect(buildExecutable('this is not C', join(dir, 'bad'))).toEqual({
      ok: false,
      message: expect.stringContaining("C compiler 'cc' failed"),
    });
  });

  it('reports a missing C compiler', () => {
    const previous = process.env.ASTER_CC;
    process.env.ASTER_CC = 'definitely-not-a-c-compiler';
    try {
      expect(buildExecutable('int main(void) { return 0; }', join(dir, 'never'))).toEqual({
        ok: false,
        message: expect.stringContaining("failed to run C compiler 'definitely-not-a-c-compiler'"),
      });
    } finally {
      if (previous === undefined) delete process.env.ASTER_CC;
      else process.env.ASTER_CC = previous;
    }
  });
});

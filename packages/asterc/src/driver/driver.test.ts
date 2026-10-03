import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatShort } from '../diagnostics/diagnostic.js';
import { makeSource } from '../diagnostics/source.js';
import { buildExecutable } from './cc.js';
import type { LoadHost } from './load.js';
import { compileToC, runFrontend } from './pipeline.js';

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
fn abort(code: int): int { return code * 2; }
fn aster_rt_add(a: int, b: int): int { return a - b; }
fn main(): int {
    let int: int = 1;
    let char: int = printf(int);
    let goto: int = abort(char);
    let NULL: int = aster_rt_add(goto, 1);
    print(NULL);
    return 0;
}`;
    expect(buildAndRun(text)).toEqual({ stdout: '3\n', stderr: '', status: 0 });
  });

  it('accepts a UTF-8 byte order mark and keeps columns unshifted', () => {
    const ok = compileToC(makeSource('t.aster', '\uFEFFfn main(): int { return 0; }'));
    expect(ok.ok).toBe(true);
    const source = makeSource('t.aster', '\uFEFFfn main(): int { return x; }');
    const bad = compileToC(source);
    expect(bad.ok ? [] : bad.diagnostics.map((d) => formatShort(source, d))).toEqual(["1:25 undefined name 'x'"]);
  });

  it('stops before checking when there are syntax errors', () => {
    const result = compileToC(makeSource('t.aster', 'fn main(): int { let x: int = ; return y; }'));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ message: "expected expression, found ';'" }] });
  });

  it('compiles and runs a program spread over several files', () => {
    const host: LoadHost = {
      readFile: (path) =>
        path === '/m/lib.aster'
          ? { ok: true, text: 'struct P { x: int }\nfn twice(p: P): int { return p.x * 2; }\n' }
          : { ok: false, reason: 'No such file or directory' },
      realPath: (path) => resolve(path),
    };
    const root = makeSource('/m/main.aster', 'import "lib.aster";\nfn main(): int { print(twice(P { x: 21 })); return 0; }\n');
    const compiled = compileToC(root, host);
    if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => d.message).join('\n'));
    expect(compiled.map.files.map((f) => f.path)).toEqual(['/m/main.aster', '/m/lib.aster']);
    const exe = join(dir, `p${counter++}`);
    const built = buildExecutable(compiled.c, exe, ['-Werror']);
    if (!built.ok) throw new Error(built.message);
    expect(spawnSync(exe, { encoding: 'utf8' }).stdout).toBe('42\n');
  });

  it('sorts diagnostics from several files by load order and stops before checking on load errors', () => {
    const files: Record<string, string> = {
      '/m/main.aster': 'import "a.aster";\nimport "gone.aster";\nfn main(): int { return x; }\n',
      '/m/a.aster': 'fn a( {}\n',
    };
    const host: LoadHost = {
      readFile: (path) => (path in files ? { ok: true, text: files[path] } : { ok: false, reason: 'No such file or directory' }),
      realPath: (path) => resolve(path),
    };
    const result = runFrontend(makeSource('/m/main.aster', files['/m/main.aster']), host);
    expect(result.typed).toBeNull();
    expect(result.tokens[0]).toMatchObject({ kind: 'import' });
    expect(result.diagnostics.map((d) => formatShort(result.map, d))).toEqual([
      "2:8 cannot import 'gone.aster': No such file or directory",
      "a.aster:1:7 expected identifier, found '{'",
    ]);
  });

  it('checks a loaded program with duplicates reported at the later file and main kept to the root', () => {
    const files: Record<string, string> = {
      '/m/main.aster': 'import "a.aster";\nfn f() { }\nfn main(): int { return 0; }\n',
      '/m/a.aster': 'fn f() { }\nfn main(): int { return 0; }\n',
    };
    const host: LoadHost = {
      readFile: (path) => (path in files ? { ok: true, text: files[path] } : { ok: false, reason: 'No such file or directory' }),
      realPath: (path) => resolve(path),
    };
    const result = compileToC(makeSource('/m/main.aster', files['/m/main.aster']), host);
    expect(result.ok ? [] : result.diagnostics.map((d) => formatShort(result.map, d))).toEqual([
      "a.aster:1:4 duplicate function 'f'",
      "a.aster:2:4 'main' must be declared in the root file",
    ]);
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

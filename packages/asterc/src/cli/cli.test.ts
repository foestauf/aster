import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultOutput, runCli } from './cli.js';

const dir = mkdtempSync(join(tmpdir(), 'aster-cli-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = runCli(argv, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
  });
  return { code, stdout, stderr };
}

const HELLO = 'fn main(): int {\n    let x: int = 10;\n    let y: int = 20;\n    print(x + y);\n    return 0;\n}\n';

describe('usage errors', () => {
  it.each<{ argv: string[]; reason: string }>([
    { argv: [], reason: 'missing command' },
    { argv: ['frob', 'x.aster'], reason: "unknown command 'frob'" },
    { argv: ['check'], reason: 'missing input file' },
    { argv: ['check', 'a.aster', 'b.aster'], reason: "unexpected argument 'b.aster'" },
    { argv: ['check', '--wat', 'a.aster'], reason: "unknown option '--wat'" },
    { argv: ['run', 'a.aster', '-o', 'x'], reason: "'-o' is only valid with 'build'" },
    { argv: ['check', 'a.aster', '--emit=c'], reason: "'--emit' is only valid with 'build'" },
    { argv: ['build', 'a.aster', '--emit=llvm'], reason: "unknown emit stage 'llvm'" },
    { argv: ['build', 'a.aster', '-o'], reason: "'-o' requires a path" },
  ])('$argv -> $reason', ({ argv, reason }) => {
    const r = cli(...argv);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`error: ${reason}\n`);
    expect(r.stderr).toContain('usage:');
  });

  it('reports unreadable files', () => {
    const missing = join(dir, 'missing.aster');
    expect(cli('check', missing)).toEqual({ code: 2, stdout: '', stderr: `error: cannot read '${missing}'\n` });
  });
});

describe('check', () => {
  it('is silent on success', () => {
    expect(cli('check', file('ok.aster', HELLO))).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('prints formatted diagnostics and exits 1', () => {
    const bad = file('bad.aster', 'fn main(): int {\n    return "s";\n}\n');
    expect(cli('check', bad)).toEqual({
      code: 1,
      stdout: '',
      stderr: `${bad}:2:12: error: type mismatch: expected int, found string\n      return "s";\n             ^^^\n`,
    });
  });
});

describe('build --emit', () => {
  const hello = file('emit.aster', HELLO);

  it('emits tokens as JSON', () => {
    const r = cli('build', hello, '--emit=tokens');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)[0]).toMatchObject({ kind: 'fn', text: 'fn' });
  });

  it('emits the AST as JSON with bigints as strings', () => {
    const r = cli('build', hello, '--emit=ast');
    const ast = JSON.parse(r.stdout);
    expect(ast.functions[0].name).toBe('main');
    expect(ast.functions[0].body.statements[0].init.value).toBe('10');
  });

  it('stops at syntax errors when emitting the AST', () => {
    expect(cli('build', file('syntax.aster', 'fn main(): int { return 0 }'), '--emit=ast').code).toBe(1);
  });

  it('emits IR and C', () => {
    expect(cli('build', hello, '--emit=ir').stdout).toMatch(/^fn main\(\): int\n/);
    expect(cli('build', hello, '--emit=c').stdout).toContain('int main(void) {');
  });
});

describe('build and run', () => {
  it('builds an executable at -o', () => {
    const out = join(dir, 'hello-bin');
    expect(cli('build', file('b.aster', HELLO), '-o', out)).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(existsSync(out)).toBe(true);
    expect(spawnSync(out, { encoding: 'utf8' }).stdout).toBe('30\n');
  });

  it('runs a program and forwards its output', () => {
    expect(cli('run', file('r.aster', HELLO))).toEqual({ code: 0, stdout: '30\n', stderr: '' });
  });

  it("returns the program's exit code", () => {
    const r = cli('run', file('seven.aster', 'fn main(): int { print("hi"); return 7; }'));
    expect(r).toEqual({ code: 7, stdout: 'hi\n', stderr: '' });
  });

  it('forwards panics', () => {
    const r = cli('run', file('panic.aster', 'fn main(): int { let z: int = 0; print(1 / z); return 0; }'));
    expect(r).toEqual({ code: 101, stdout: '', stderr: 'panic: division by zero\n' });
  });
});

describe('defaultOutput', () => {
  it('strips .aster and never returns the input path', () => {
    expect(defaultOutput('dir/hello.aster')).toBe('hello');
    expect(defaultOutput('hello')).toBe('hello.out');
  });
});

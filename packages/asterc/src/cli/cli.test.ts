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
    childStdio: 'pipe',
    stdout: (d) => {
      stdout += Buffer.from(d).toString('utf8');
    },
    stderr: (d) => {
      stderr += Buffer.from(d).toString('utf8');
    },
  });
  return { code, stdout, stderr };
}

/** Like cli(), but in 'inherit' mode or returning raw stdout bytes. */
function cliRaw(childStdio: 'inherit' | 'pipe', ...argv: string[]) {
  const out: Buffer[] = [];
  let calls = 0;
  const code = runCli(argv, {
    childStdio,
    stdout: (d) => {
      calls++;
      out.push(Buffer.from(d));
    },
    stderr: () => {
      calls++;
    },
  });
  return { code, stdout: Buffer.concat(out), calls };
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

  it('reports an error in an imported file with that file\'s path', () => {
    const lib = file('lib.aster', 'fn bad(): int {\n    return "s";\n}\n');
    const root = file('uses_lib.aster', 'import "lib.aster";\nfn main(): int { return bad(); }\n');
    expect(cli('check', root)).toEqual({
      code: 1,
      stdout: '',
      stderr: `${lib}:2:12: error: type mismatch: expected int, found string\n      return "s";\n             ^^^\n`,
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
  it('passes everything after -- to the program', () => {
    const f = file('args.aster', 'fn main(args: [string]): int { for a in args { print(a); } return len(args); }');
    expect(cli('run', f, '--', 'a', '-b', '--')).toEqual({ code: 3, stdout: 'a\n-b\n--\n', stderr: '' });
    expect(cli('run', f, '--')).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('accepts -- only with run', () => {
    const f = file('args2.aster', 'fn main(): int { return 0; }');
    const r = cli('build', f, '--', 'x');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("error: '--' is only valid with 'run'");
  });

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

describe('run output fidelity', () => {
  it('passes non-UTF-8 bytes through unchanged', () => {
    const r = cliRaw('pipe', 'run', file('bytes.aster', 'fn main(): int { print(substring("é", 0, 1)); return 0; }'));
    expect(r.code).toBe(0);
    expect([...r.stdout]).toEqual([0xc3, 0x0a]);
  });

  it('streams through inherited stdio without capturing when asked', () => {
    const r = cliRaw('inherit', 'run', file('quiet.aster', 'fn main(): int { return 7; }'));
    expect(r).toEqual({ code: 7, stdout: Buffer.alloc(0), calls: 0 });
  });
});

describe('defaultOutput', () => {
  it('strips .aster and never returns the input path', () => {
    expect(defaultOutput('dir/hello.aster')).toBe('hello');
    expect(defaultOutput('hello')).toBe('hello.out');
  });
});

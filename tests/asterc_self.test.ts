import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { emitC, lower } from '../packages/asterc/src/index.js';
import { acceptedCorpus, PROGRAMS_DIR } from './corpus.js';
import { parseExpectations } from './harness.js';
import { stage } from './stage.js';
import { spawnStrict } from './spawn.js';

// Checks the self-hosted compiler under test (S1 by default; see tests/stage.ts), built from
// packages/asterc-self/asterc.aster, against the stage-0 CLI
// (S0, packages/asterc/dist/cli/bin.js) on stdout, stderr and exit status, byte for byte. The only allowed difference
// is the usage text's `--emit=c` (self-hosting contract §4.1, §4.5). Both run with LC_ALL=C and a private TMPDIR that
// must be empty after every test.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const S0_BIN = join(REPO_ROOT, 'packages', 'asterc', 'dist', 'cli', 'bin.js');
const SELF_SOURCE = join(REPO_ROOT, 'packages', 'asterc-self', 'asterc.aster');

const workDir = mkdtempSync(join(tmpdir(), 'aster-self-'));
const tmpDir = join(workDir, 'tmp');
mkdirSync(tmpDir);
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

afterEach(() => {
  const left = readdirSync(tmpDir);
  if (left.length > 0) throw new Error(`TMPDIR is not empty: ${left.join(', ')}`);
});

interface RunOptions {
  cwd?: string;
  input?: string;
  env?: Record<string, string>;
}

interface Outcome {
  stdout: string;
  stderr: string;
  status: number | null;
}

function spawn(command: string, argv: readonly string[], opts: RunOptions = {}): Outcome {
  const r = spawnStrict(command, argv, {
    cwd: opts.cwd ?? REPO_ROOT,
    env: { ...process.env, TMPDIR: tmpDir, LC_ALL: 'C', ...opts.env },
    input: opts.input,
    maxBuffer: 256 * 1024 * 1024,
    timeout: 60_000,
  });
  if (r.error) throw r.error;
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

const runSn = (argv: readonly string[], opts?: RunOptions): Outcome => spawn(stage().bin, argv, opts);
const runS0 = (argv: readonly string[], opts?: RunOptions): Outcome => spawn(process.execPath, [S0_BIN, ...argv], opts);

/** S0's outcome with its usage text narrowed to the emit stages S1 supports: the one allowed text difference. */
function s0UsageToSn(o: Outcome): Outcome {
  return { ...o, stderr: o.stderr.replace('[-o <out>] [--emit=tokens|ast|ir|c]', '[-o <out>] [--backend=c|llvm] [--emit=c|llvm]').replace('aster run <file.aster> [-- <args>...]', 'aster run <file.aster> [--backend=c|llvm] [-- <args>...]') };
}

describe('usage errors', () => {
  // packages/asterc/src/cli/cli.test.ts's list, plus `--emit` with run and `--` with build.
  it.for<string[]>([
    [],
    ['frob', 'x.aster'],
    ['check'],
    ['check', 'a.aster', 'b.aster'],
    ['check', '--wat', 'a.aster'],
    ['run', 'a.aster', '-o', 'x'],
    ['check', 'a.aster', '--emit=c'],
    ['build', 'a.aster', '-o'],
    ['run', 'a.aster', '--emit=c'],
    ['build', 'a', '--', 'x'],
  ])('%j', (argv) => {
    const s0 = runS0(argv);
    expect(s0.status).toBe(2);
    expect(runSn(argv)).toEqual(s0UsageToSn(s0));
  });
});

describe('an unreadable file', () => {
  it('check missing.aster', () => {
    const s0 = runS0(['check', 'missing.aster']);
    expect(s0).toEqual({ stdout: '', stderr: "error: cannot read 'missing.aster'\n", status: 2 });
    expect(runSn(['check', 'missing.aster'])).toEqual(s0);
  });
});

describe('check, accepted programs', () => {
  const accepted = acceptedCorpus().map(({ file }) => file);

  it('covers the compiler itself', () => {
    expect(accepted).toContain(join('..', '..', 'packages', 'asterc-self', 'asterc.aster'));
  });

  it.for(accepted)('%s', (file) => {
    expect(runSn(['check', join(PROGRAMS_DIR, file)])).toEqual({ stdout: '', stderr: '', status: 0 });
  });
});

/** Every golden under tests/programs/ that expects compile errors, as `tests/programs/...`. */
const errorGoldens = readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.aster'))
  .filter((f) => parseExpectations(readFileSync(join(PROGRAMS_DIR, f), 'utf8')).errors.length > 0)
  .toSorted()
  .map((f) => join('tests', 'programs', f));

describe('check, programs with errors', () => {
  it('includes the non-ASCII column golden', () => {
    expect(errorGoldens).toContain(join('tests', 'programs', 'errors', 'non_ascii_column.aster'));
  });

  it.for(errorGoldens)('%s', (file) => {
    const s0 = runS0(['check', file]);
    expect(s0.status).toBe(1);
    expect(runSn(['check', file])).toEqual(s0);
  });

  // Diagnostics exit 1 before any cc call, so `build` is cheap. -o goes into the work dir: a wrongly successful build
  // cannot litter the repo.
  it.for(errorGoldens)('build %s', (file) => {
    const out = join(workDir, 'error-golden-out');
    const s0 = runS0(['build', file, '-o', out]);
    expect(s0.status).toBe(1);
    expect(runSn(['build', file, '-o', out])).toEqual(s0);
    expect(existsSync(out)).toBe(false);
  });
});

/** A root file spelled relative, absolute, with `./` and with `..`, from the repo root, and bare from its directory. */
function spellings(dir: string, file: string): { name: string; path: string; cwd?: string }[] {
  return [
    { name: 'relative', path: join('tests', 'programs', dir, file) },
    { name: 'absolute', path: join(REPO_ROOT, 'tests', 'programs', dir, file) },
    { name: './', path: `./tests/programs/${dir}/${file}` },
    { name: '..', path: `tests/programs/${dir}/../${dir}/${file}` },
    { name: 'bare, from its directory', path: file, cwd: join(REPO_ROOT, 'tests', 'programs', dir) },
  ];
}

describe('path spellings', () => {
  // Module goldens: an import, a cycle (cycle.aster <-> cycle_lib.aster), a diamond, a self-import and an import from a
  // subdirectory. Error goldens: a missing import, `main` declared in an imported file (reported there, with its path),
  // collisions between root and library, and a root without `main`.
  const cases: { dir: string; file: string }[] = [
    { dir: 'modules', file: 'basic.aster' },
    { dir: 'modules', file: 'cycle.aster' },
    { dir: 'modules', file: 'diamond.aster' },
    { dir: 'modules', file: 'self_import.aster' },
    { dir: 'modules', file: 'subdir.aster' },
    { dir: 'errors', file: 'import_missing.aster' },
    { dir: 'errors', file: 'import_main.aster' },
    { dir: 'errors', file: 'import_collisions.aster' },
    { dir: 'errors', file: 'missing_main.aster' },
  ];

  it.for(cases.flatMap(({ dir, file }) => spellings(dir, file).map((s) => ({ ...s, label: `${dir}/${file} ${s.name}` }))))(
    '$label',
    ({ path, cwd }) => {
      expect(runSn(['check', path], { cwd })).toEqual(runS0(['check', path], { cwd }));
    },
  );
});

describe('diagnostic layout edge cases', () => {
  // Not goldens: a BOM, CRLF line ends and spans at EOF, across lines or over astral characters, compared with S0.
  const edgeDir = join(workDir, 'edge');
  mkdirSync(edgeDir);
  const cases: { name: string; bytes: Buffer }[] = [
    { name: 'crlf.aster', bytes: Buffer.from('fn main(): int {\r\n    let x: int = "a";\r\n    return x\r\n}\r\n') },
    { name: 'crlf_eof.aster', bytes: Buffer.from('fn main(): int {\r\n    return 0\r\n') },
    { name: 'bom.aster', bytes: Buffer.from('\uFEFFfn main(): int {\n    let x: int = "\u00e9";\n    return 0;\n}\n') },
    {
      name: 'bom_tab_lib.aster',
      bytes: Buffer.from('\uFEFFfn f(): int {\n\tlet s: string = "\u00e9"; let x: int = "a";\n    return 0;\n}\n'),
    },
    { name: 'imports_bom_tab.aster', bytes: Buffer.from('import "bom_tab_lib.aster";\nfn main(): int { return 0; }\n') },
    { name: 'eof.aster', bytes: Buffer.from('fn main(): int {\n    return 0;\n') },
    { name: 'multi_line.aster', bytes: Buffer.from('fn main(): int {\n    let x: int = "a\n b";\n    return 0;\n}\n') },
    { name: 'astral_span.aster', bytes: Buffer.from('fn f(): int { return "\u{1F600}\u{1F600}"; }\nfn main(): int { return 0; }\n') },
    { name: 'imports_astral.aster', bytes: Buffer.from('import "astral_span.aster";\nfn main(): int { return 0; }\n') },
  ];
  for (const c of cases) writeFileSync(join(edgeDir, c.name), c.bytes);

  it.for(cases.map((c) => c.name))('%s', (name) => {
    const s0 = runS0(['check', name], { cwd: edgeDir });
    expect(s0.status).toBe(1);
    expect(runSn(['check', name], { cwd: edgeDir })).toEqual(s0);
  });
});

describe('build --emit=c, accepted programs', () => {
  const corpus = acceptedCorpus().map(({ file, typed }) => ({ file, c: emitC(lower(typed)) }));

  it.for(corpus)('$file', ({ file, c }) => {
    expect(runSn(['build', join('tests', 'programs', file), '--emit=c'])).toEqual({ stdout: c, stderr: '', status: 0 });
  });

  it('prints about a megabyte for the compiler itself', () => {
    const r = runSn(['build', SELF_SOURCE, '--emit=c']);
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(500_000);
  });
});

// cli.test.ts's HELLO: prints 30.
const HELLO = 'fn main(): int {\n    let x: int = 10;\n    let y: int = 20;\n    print(x + y);\n    return 0;\n}\n';

/** A fresh directory under the work dir holding `files`, for a test that builds or runs from there. */
function freshDir(name: string, files: Record<string, string>): string {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

describe('build', () => {
  it('with -o, to an executable that runs', () => {
    const dir = freshDir('build-o', { 'hello.aster': HELLO });
    const s0 = runS0(['build', 'hello.aster', '-o', join(dir, 'h0')], { cwd: dir });
    expect(s0).toEqual({ stdout: '', stderr: '', status: 0 });
    expect(runSn(['build', 'hello.aster', '-o', join(dir, 'h1')], { cwd: dir })).toEqual(s0);
    for (const exe of ['h0', 'h1']) expect(spawn(join(dir, exe), [])).toEqual({ stdout: '30\n', stderr: '', status: 0 });
  });

  // Without -o, the output goes in the cwd, named by default_output: the root may be in another directory.
  it.for([
    { name: 'x.aster', file: 'x.aster', out: 'x' },
    { name: 'noext.txt', file: 'noext.txt', out: 'noext.txt.out' },
    { name: 'a root in a subdirectory', file: 'sub/x.aster', out: 'x' },
  ])('without -o: $name', ({ name, file, out }) => {
    const outcomes = (['s0', 's1'] as const).map((who) => {
      const dir = freshDir(`build-default-${name.replaceAll(/\W/g, '_')}-${who}`, { [file]: HELLO });
      const r = (who === 's0' ? runS0 : runSn)(['build', file], { cwd: dir });
      expect(readdirSync(dir).toSorted()).toEqual([file.split('/')[0], out].toSorted());
      expect(spawn(join(dir, out), [])).toEqual({ stdout: '30\n', stderr: '', status: 0 });
      return r;
    });
    expect(outcomes[0]).toEqual({ stdout: '', stderr: '', status: 0 });
    expect(outcomes[1]).toEqual(outcomes[0]);
  });
});

describe('a directory as input', () => {
  it('check <a directory>', () => {
    const s0 = runS0(['check', 'tests']);
    expect(s0).toEqual({ stdout: '', stderr: "error: cannot read 'tests'\n", status: 2 });
    expect(runSn(['check', 'tests'])).toEqual(s0);
  });
});

describe('run', () => {
  const io = join('tests', 'programs', 'io');

  it('passes the arguments after --', () => {
    const file = join(io, 'args.aster');
    const args = parseExpectations(readFileSync(join(REPO_ROOT, file), 'utf8')).args;
    expect(args).toEqual(['one', 'two', '-3', 'é']);
    const s0 = runS0(['run', file, '--', ...args]);
    expect(s0.status).toBe(0);
    expect(runSn(['run', file, '--', ...args])).toEqual(s0);
  });

  it('passes stdin through', () => {
    const file = join(io, 'stdin.aster');
    const input = parseExpectations(readFileSync(join(REPO_ROOT, file), 'utf8')).stdin;
    const s0 = runS0(['run', file], { input });
    expect(s0).toEqual({ stdout: '13\nhello\n0\n', stderr: '', status: 0 });
    expect(runSn(['run', file], { input })).toEqual(s0);
  });

  const dir = freshDir('run', {
    'seven.aster': 'fn main(): int {\n    print("before");\n    return 7;\n}\n',
    'panics.aster': 'fn main(): int {\n    print("before");\n    panic("boom");\n}\n',
    // Recursion that overflows the stack. The array kept across the call stops cc -O2 from turning it into a loop, and
    // the base case it never reaches keeps cc from warning about infinite recursion: S1 lets cc's stderr through.
    'recurses.aster':
      'fn f(n: int): int {\n    if n == -1 {\n        return 0;\n    }\n    let xs: [int] = [n];\n    let r: int = f(n + 1);\n    push(xs, r);\n    return xs[0] + xs[1];\n}\nfn main(): int {\n    return f(0);\n}\n',
  });

  it.for([
    { file: 'seven.aster', expected: { stdout: 'before\n', stderr: '', status: 7 } },
    { file: 'panics.aster', expected: { stdout: 'before\n', stderr: 'panic: boom\n', status: 101 } },
    { file: 'recurses.aster', expected: { stdout: '', stderr: '', status: 139 } },
  ])('$file exits $expected.status', ({ file, expected }) => {
    const s0 = runS0(['run', file], { cwd: dir });
    expect(s0).toEqual(expected);
    expect(runSn(['run', file], { cwd: dir })).toEqual(s0);
  });
});

describe('divergences from stage 0', () => {
  const dir = freshDir('divergences', { 'hello.aster': HELLO, 'fakecc/cc': "#!/bin/sh\necho 'cc: boom' >&2\nexit 1\n" });
  chmodSync(join(dir, 'fakecc', 'cc'), 0o755);

  it('--emit=ir is an unknown emit stage', () => {
    // S0's rejection of a stage neither supports, with the stage name swapped.
    const llvm = s0UsageToSn(runS0(['build', 'hello.aster', '--emit=llvm'], { cwd: dir }));
    expect(llvm.status).toBe(2);
    expect(runSn(['build', 'hello.aster', '--emit=ir'], { cwd: dir })).toEqual({
      ...llvm,
      stderr: llvm.stderr.replace("'llvm'", "'ir'"),
    });
  });

  it('ASTER_CC is ignored', () => {
    const out = join(dir, 'x');
    expect(runSn(['build', 'hello.aster', '-o', out], { cwd: dir, env: { ASTER_CC: 'false' } })).toEqual({
      stdout: '',
      stderr: '',
      status: 0,
    });
    expect(spawn(out, []).stdout).toBe('30\n');
  });

  it("cc's stderr streams first, then the internal error", () => {
    const env = { PATH: `${join(dir, 'fakecc')}:${process.env.PATH ?? ''}` };
    expect(runSn(['build', 'hello.aster', '-o', join(dir, 'y')], { cwd: dir, env })).toEqual({
      stdout: '',
      stderr: "cc: boom\ninternal compiler error: C compiler 'cc' failed\n",
      status: 3,
    });
    expect(runSn(['run', 'hello.aster'], { cwd: dir, env })).toEqual({
      stdout: '',
      stderr: "cc: boom\ninternal compiler error: C compiler 'cc' failed\n",
      status: 3,
    });
  });

  // Untested: the driver's cleanup when write_file fails (driver.aster pushes the path before writing, so the partial
  // file is removed). A write failure cannot be triggered reliably here: `ulimit -f` raises SIGXFSZ instead of failing.
  it('a real cc failure (an unwritable -o) also cleans up', () => {
    const r = runSn(['build', 'hello.aster', '-o', join(dir, 'missing', 'z')], { cwd: dir });
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/\ninternal compiler error: C compiler 'cc' failed\n$/);
  });

  it('an unusable TMPDIR is an internal error', () => {
    // Not compared with S0: both exit 3, but after `internal compiler error:` the text differs (stage 0 prints Node's
    // ENOENT message and a stack). The test's own TMPDIR keeps
    // the harness's empty-TMPDIR check on the shared one meaningful.
    const missing = join(dir, 'no-such-tmp');
    expect(runSn(['build', 'hello.aster', '-o', join(dir, 'w')], { cwd: dir, env: { TMPDIR: missing } })).toEqual({
      stdout: '',
      stderr: `internal compiler error: ${missing}/aster-cc-XXXXXX: No such file or directory\n`,
      status: 3,
    });
  });

  it('a compiler panic is panic: …, exit 101', () => {
    // 64 MiB of address space must stay below the compiler's peak for its own source, so an allocation fails.
    for (let i = 0; i < 3; i++) {
      const r = spawnStrict('sh', ['-c', 'ulimit -v 65536; exec "$0" build "$1" --emit=c', stage().bin, SELF_SOURCE], {
        cwd: REPO_ROOT,
        env: { ...process.env, TMPDIR: tmpDir, LC_ALL: 'C' },
        maxBuffer: 256 * 1024 * 1024,
        timeout: 60_000,
      });
      expect(r.error).toBeUndefined();
      expect(r.status).toBe(101);
      expect(r.stderr).toMatch(/^panic: out of memory/);
    }
  });
});

describe('the next stage', () => {
  const next = join(workDir, 'next');
  const runNext = (argv: readonly string[]): Outcome => spawn(next, argv);
  const corpus = acceptedCorpus();
  const emitOf = (file: string): string => {
    const entry = corpus.find((e) => e.file === file);
    if (!entry) throw new Error(`${file} is not in the corpus`);
    return emitC(lower(entry.typed));
  };

  beforeAll(() => {
    const r = runSn(['build', join('packages', 'asterc-self', 'asterc.aster'), '-o', next]);
    if (r.status !== 0 || r.stderr !== '') throw new Error(`${stage().name} failed to build the next stage (status ${r.status}): ${r.stderr}`);
  }, 120_000);

  it.for([
    join('..', '..', 'packages', 'asterc-self', 'asterc.aster'),
    join('programs', 'fib.aster'),
    join('io', 'files.aster'),
    join('programs', 'emit.aster'),
  ])(`${stage().name} builds the next stage, whose C matches stage 0: --emit=c of %s`, (file) => {
    expect(runNext(['build', join('tests', 'programs', file), '--emit=c'])).toEqual({ stdout: emitOf(file), stderr: '', status: 0 });
  });
});


describe('LLVM backend surface', () => {
  it.for([
    ['build', '--backend=llvm', 'missing.aster'],
    ['run', '--backend=llvm', 'missing.aster'],
    ['build', '--emit=llvm', 'missing.aster'],
  ])('recognizes the not-yet-implemented LLVM selection: %j', (args) => {
    expect(runSn(args)).toEqual({ stdout: '', stderr: 'error: llvm backend not implemented yet\n', status: 2 });
    expect(runS0(args).status).toBe(2);
  });
  it.for([
    ['check', '--backend=c', 'missing.aster'],
    ['build', '--backend=wat', 'missing.aster'],
    ['run', '--backend=', 'missing.aster'],
    ['run', '--emit=llvm', 'missing.aster'],
  ])('rejects an invalid backend/stage option: %j', (args) => {
    expect(runSn(args).status).toBe(2);
    expect(runSn(args).stderr).toContain('usage:');
  });
  it('explicit C keeps the normal code generation', () => {
    const source = 'tests/programs/basics/hello.aster';
    expect(runSn(['build', source, '--backend=c', '--emit=c'])).toEqual(runSn(['build', source, '--emit=c']));
    expect(runS0(['build', source, '--backend=c']).status).toBe(2);
  });
});

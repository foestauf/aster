import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildExecutable, compileToC, emitC, formatDiagnostic, lower, makeSource } from '../packages/asterc/src/index.js';
import { acceptedCorpus, PROGRAMS_DIR } from './corpus.js';
import { parseExpectations } from './harness.js';

// Checks packages/asterc-self/asterc.aster, the self-hosted compiler (S1, built by stage 0), against the stage-0 CLI
// (S0, packages/asterc/dist/cli/bin.js) on stdout, stderr and exit status, byte for byte. The only allowed difference
// is the usage text's `--emit=c` (self-hosting contract §4.1, §4.5). Both run with LC_ALL=C and a private TMPDIR that
// must be empty after every test.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const S0_BIN = join(REPO_ROOT, 'packages', 'asterc', 'dist', 'cli', 'bin.js');
const S1_SOURCE = join(REPO_ROOT, 'packages', 'asterc-self', 'asterc.aster');

const workDir = mkdtempSync(join(tmpdir(), 'aster-self-'));
const tmpDir = join(workDir, 'tmp');
mkdirSync(tmpDir);
const s1 = join(workDir, 's1');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

// cc -O2 on the compiler's ~1 MB of C can exceed vitest's default 10 s hook timeout on a slow machine.
const CC_HOOK_TIMEOUT = 60_000;

beforeAll(() => {
  if (!existsSync(S0_BIN)) throw new Error(`${S0_BIN} is missing: run 'pnpm build' first`);
  const compiled = compileToC(makeSource(S1_SOURCE, readFileSync(S1_SOURCE, 'utf8')));
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
  const built = buildExecutable(compiled.c, s1, ['-Werror']);
  if (!built.ok) throw new Error(built.message);
}, CC_HOOK_TIMEOUT);

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
  const r = spawnSync(command, argv, {
    cwd: opts.cwd ?? REPO_ROOT,
    env: { ...process.env, TMPDIR: tmpDir, LC_ALL: 'C', ...opts.env },
    input: opts.input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 60_000,
  });
  if (r.error) throw r.error;
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

const runS1 = (argv: readonly string[], opts?: RunOptions): Outcome => spawn(s1, argv, opts);
const runS0 = (argv: readonly string[], opts?: RunOptions): Outcome => spawn(process.execPath, [S0_BIN, ...argv], opts);

/** S0's outcome with its usage text narrowed to the emit stages S1 supports: the one allowed text difference. */
function s0UsageToS1(o: Outcome): Outcome {
  return { ...o, stderr: o.stderr.replace('--emit=tokens|ast|ir|c', '--emit=c') };
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
    ['build', 'a.aster', '--emit=llvm'],
    ['build', 'a.aster', '-o'],
    ['run', 'a.aster', '--emit=c'],
    ['build', 'a', '--', 'x'],
  ])('%j', (argv) => {
    const s0 = runS0(argv);
    expect(s0.status).toBe(2);
    expect(runS1(argv)).toEqual(s0UsageToS1(s0));
  });
});

describe('an unreadable file', () => {
  it('check missing.aster', () => {
    const s0 = runS0(['check', 'missing.aster']);
    expect(s0).toEqual({ stdout: '', stderr: "error: cannot read 'missing.aster'\n", status: 2 });
    expect(runS1(['check', 'missing.aster'])).toEqual(s0);
  });
});

describe('check, accepted programs', () => {
  const accepted = acceptedCorpus().map(({ file }) => file);

  it('covers the compiler itself', () => {
    expect(accepted).toContain(join('..', '..', 'packages', 'asterc-self', 'asterc.aster'));
  });

  it.for(accepted)('%s', (file) => {
    expect(runS1(['check', join(PROGRAMS_DIR, file)])).toEqual({ stdout: '', stderr: '', status: 0 });
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
    expect(runS1(['check', file])).toEqual(s0);
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
      expect(runS1(['check', path], { cwd })).toEqual(runS0(['check', path], { cwd }));
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
    { name: 'eof.aster', bytes: Buffer.from('fn main(): int {\n    return 0;\n') },
    { name: 'multi_line.aster', bytes: Buffer.from('fn main(): int {\n    let x: int = "a\n b";\n    return 0;\n}\n') },
    { name: 'astral_span.aster', bytes: Buffer.from('fn f(): int { return "\u{1F600}\u{1F600}"; }\nfn main(): int { return 0; }\n') },
    { name: 'imports_astral.aster', bytes: Buffer.from('import "astral_span.aster";\nfn main(): int { return 0; }\n') },
  ];
  for (const c of cases) writeFileSync(join(edgeDir, c.name), c.bytes);

  it.for(cases.map((c) => c.name))('%s', (name) => {
    const s0 = runS0(['check', name], { cwd: edgeDir });
    expect(s0.status).toBe(1);
    expect(runS1(['check', name], { cwd: edgeDir })).toEqual(s0);
  });
});

describe('build --emit=c, accepted programs', () => {
  const corpus = acceptedCorpus().map(({ file, typed }) => ({ file, c: emitC(lower(typed)) }));

  it.for(corpus)('$file', ({ file, c }) => {
    expect(runS1(['build', join('tests', 'programs', file), '--emit=c'])).toEqual({ stdout: c, stderr: '', status: 0 });
  });

  it('prints about a megabyte for the compiler itself', () => {
    const r = runS1(['build', S1_SOURCE, '--emit=c']);
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
    expect(runS1(['build', 'hello.aster', '-o', join(dir, 'h1')], { cwd: dir })).toEqual(s0);
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
      const r = (who === 's0' ? runS0 : runS1)(['build', file], { cwd: dir });
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
    expect(runS1(['check', 'tests'])).toEqual(s0);
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
    expect(runS1(['run', file, '--', ...args])).toEqual(s0);
  });

  it('passes stdin through', () => {
    const file = join(io, 'stdin.aster');
    const input = parseExpectations(readFileSync(join(REPO_ROOT, file), 'utf8')).stdin;
    const s0 = runS0(['run', file], { input });
    expect(s0).toEqual({ stdout: '13\nhello\n0\n', stderr: '', status: 0 });
    expect(runS1(['run', file], { input })).toEqual(s0);
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
    expect(runS1(['run', file], { cwd: dir })).toEqual(s0);
  });
});

describe('divergences from stage 0', () => {
  const dir = freshDir('divergences', { 'hello.aster': HELLO, 'fakecc/cc': "#!/bin/sh\necho 'cc: boom' >&2\nexit 1\n" });
  chmodSync(join(dir, 'fakecc', 'cc'), 0o755);

  it('--emit=ir is an unknown emit stage', () => {
    // S0's rejection of a stage neither supports, with the stage name swapped.
    const llvm = s0UsageToS1(runS0(['build', 'hello.aster', '--emit=llvm'], { cwd: dir }));
    expect(llvm.status).toBe(2);
    expect(runS1(['build', 'hello.aster', '--emit=ir'], { cwd: dir })).toEqual({
      ...llvm,
      stderr: llvm.stderr.replace("'llvm'", "'ir'"),
    });
  });

  it('ASTER_CC is ignored', () => {
    const out = join(dir, 'x');
    expect(runS1(['build', 'hello.aster', '-o', out], { cwd: dir, env: { ASTER_CC: 'false' } })).toEqual({
      stdout: '',
      stderr: '',
      status: 0,
    });
    expect(spawn(out, []).stdout).toBe('30\n');
  });

  it("cc's stderr streams first, then the internal error", () => {
    const env = { PATH: `${join(dir, 'fakecc')}:${process.env.PATH ?? ''}` };
    expect(runS1(['build', 'hello.aster', '-o', join(dir, 'y')], { cwd: dir, env })).toEqual({
      stdout: '',
      stderr: "cc: boom\ninternal compiler error: C compiler 'cc' failed\n",
      status: 3,
    });
    expect(runS1(['run', 'hello.aster'], { cwd: dir, env })).toEqual({
      stdout: '',
      stderr: "cc: boom\ninternal compiler error: C compiler 'cc' failed\n",
      status: 3,
    });
  });

  it('a real cc failure (an unwritable -o) also cleans up', () => {
    const r = runS1(['build', 'hello.aster', '-o', join(dir, 'missing', 'z')], { cwd: dir });
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/\ninternal compiler error: C compiler 'cc' failed\n$/);
  });

  it('an unusable TMPDIR is an internal error', () => {
    // Not compared with S0: stage 0 fails differently (an uncaught exception, not exit 3). The test's own TMPDIR keeps
    // the harness's empty-TMPDIR check on the shared one meaningful.
    const missing = join(dir, 'no-such-tmp');
    expect(runS1(['build', 'hello.aster', '-o', join(dir, 'w')], { cwd: dir, env: { TMPDIR: missing } })).toEqual({
      stdout: '',
      stderr: `internal compiler error: ${missing}/aster-cc-XXXXXX: No such file or directory\n`,
      status: 3,
    });
  });

  it('a compiler panic is panic: …, exit 101', () => {
    // 64 MiB of address space must stay below the compiler's peak for its own source, so an allocation fails.
    for (let i = 0; i < 3; i++) {
      const r = spawnSync('sh', ['-c', 'ulimit -v 65536; exec "$0" build "$1" --emit=c', s1, S1_SOURCE], {
        cwd: REPO_ROOT,
        env: { ...process.env, TMPDIR: tmpDir, LC_ALL: 'C' },
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        timeout: 60_000,
      });
      expect(r.error).toBeUndefined();
      expect(r.status).toBe(101);
      expect(r.stderr).toMatch(/^panic: out of memory/);
    }
  });
});

describe('S2: the compiler built by itself', () => {
  const s2 = join(workDir, 's2');
  const runS2 = (argv: readonly string[]): Outcome => spawn(s2, argv);
  const corpus = acceptedCorpus();
  const emitOf = (file: string): string => {
    const entry = corpus.find((e) => e.file === file);
    if (!entry) throw new Error(`${file} is not in the corpus`);
    return emitC(lower(entry.typed));
  };

  beforeAll(() => {
    const r = runS1(['build', join('packages', 'asterc-self', 'asterc.aster'), '-o', s2]);
    if (r.status !== 0 || r.stderr !== '') throw new Error(`S1 failed to build S2 (status ${r.status}): ${r.stderr}`);
  }, 120_000);

  it.for([
    join('..', '..', 'packages', 'asterc-self', 'asterc.aster'),
    join('programs', 'fib.aster'),
    join('io', 'files.aster'),
    join('programs', 'emit.aster'),
  ])('--emit=c of %s', (file) => {
    expect(runS2(['build', join('tests', 'programs', file), '--emit=c'])).toEqual({ stdout: emitOf(file), stderr: '', status: 0 });
  });
});

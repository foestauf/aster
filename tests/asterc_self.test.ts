import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { acceptedFiles, PROGRAMS_DIR } from './corpus.js';
import { goldenPath, normalise, renderOutcome } from './golden.js';
import { parseExpectations } from './harness.js';
import { stage } from './stage.js';
import { spawnStrict } from './spawn.js';

// Checks the self-hosted compiler under test (see tests/stage.ts), built from packages/asterc-self/asterc.aster, on
// stdout, stderr and exit status, byte for byte. The CLI is pinned by the golden files under tests/golden/cli/ (one per
// case, in tests/golden.ts's format, identical for every stage) and by the literal outcomes below. `pnpm golden`
// rewrites the goldens. Every run uses LC_ALL=C and a private TMPDIR that must be empty after every test.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
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

/** Every golden slug in use: each is claimed once, at collection time. */
const slugs = new Set<string>();

/** The golden file for case `label` of describe `group`: lower-case, each run of non-alphanumerics a single `-`. */
function cliGolden(group: string, label: string): string {
  const slug = `${group}-${label}`.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
  if (slugs.has(slug)) throw new Error(`duplicate golden slug ${slug}`);
  slugs.add(slug);
  return goldenPath('cli', slug);
}

/**
 * `o` in the golden format, with the repo root and this suite's private directories made machine-independent. Since
 * that hides whether a path was printed relative or absolute, the raw output must not mention the repo root at all,
 * unless the case passes `raw: 'absolute-ok'` because its input is deliberately absolute.
 */
function golden(o: Outcome, opts: { raw?: 'absolute-ok' } = {}): string {
  const raw = opts.raw === 'absolute-ok' ? '' : o.stdout + o.stderr;
  expect(raw, 'raw output names the repo root').not.toContain(REPO_ROOT.replace(/\/$/, ''));
  return normalise(renderOutcome(o), { tmp: [tmpDir, workDir] });
}

describe('usage errors', () => {
  // The stage-0 CLI's usage-error list, plus `--emit` with run and `--` with build.
  it.for(([
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
  ] as string[][])
    .map((argv) => ({ argv, label: argv.join(' ') || '(no arguments)' }))
    .map((c) => ({ ...c, file: cliGolden('usage errors', c.label) })))('$label', async ({ argv, file }) => {
    const sn = runSn(argv);
    expect(sn.status).toBe(2);
    await expect(golden(sn)).toMatchFileSnapshot(file);
  });
});

describe('an unreadable file', () => {
  it('check missing.aster', () => {
    expect(runSn(['check', 'missing.aster'])).toEqual({ stdout: '', stderr: "error: cannot read 'missing.aster'\n", status: 2 });
  });
});

describe('check, accepted programs', () => {
  const accepted = acceptedFiles();

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

  it.for(errorGoldens.map((file) => ({ file, golden: cliGolden('check, programs with errors', file) })))('$file', async ({ file, golden: g }) => {
    const sn = runSn(['check', file]);
    expect(sn.status).toBe(1);
    await expect(golden(sn)).toMatchFileSnapshot(g);
  });

  // Diagnostics exit 1 before any cc call, so `build` is cheap. -o goes into the work dir: a wrongly successful build
  // cannot litter the repo.
  it.for(errorGoldens.map((file) => ({ file, golden: cliGolden('check, programs with errors', `build ${file}`) })))('build $file', async ({ file, golden: g }) => {
    const out = join(workDir, 'error-golden-out');
    const sn = runSn(['build', file, '-o', out]);
    expect(sn.status).toBe(1);
    expect(existsSync(out)).toBe(false);
    await expect(golden(sn)).toMatchFileSnapshot(g);
  });
});

/** A root file spelled relative, absolute, with `./` and with `..`, from the repo root, and bare from its directory. */
function spellings(dir: string, file: string): { name: string; path: string; cwd?: string }[] {
  return [
    { name: 'relative', path: join('tests', 'programs', dir, file) },
    { name: 'absolute', path: join(REPO_ROOT, 'tests', 'programs', dir, file) },
    { name: 'dot-slash prefix', path: `./tests/programs/${dir}/${file}` },
    { name: 'dot-dot segment', path: `tests/programs/${dir}/../${dir}/${file}` },
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

  it.for(
    cases.flatMap(({ dir, file }) =>
      spellings(dir, file).map((s) => ({ ...s, label: `${dir}/${file} ${s.name}`, golden: cliGolden('path spellings', `${dir}/${file} ${s.name}`) })),
    ),
  )('$label', async ({ name, path, cwd, golden: g }) => {
    const sn = runSn(['check', path], { cwd });
    // The goldens strip the repo root, so check here that an absolute root gives absolute paths in every diagnostic.
    const headers = name === 'absolute' ? sn.stderr.split('\n').filter((line) => /^[^\s:][^:]*:\d+:\d+: /.test(line)) : [];
    expect(name !== 'absolute' || sn.stderr === '' || headers.length > 0, 'absolute spelling: no diagnostic headers found').toBe(true);
    for (const line of headers) expect(line.startsWith(join(REPO_ROOT, 'tests', 'programs')), `not absolute: ${line}`).toBe(true);
    await expect(golden(sn, name === 'absolute' ? { raw: 'absolute-ok' } : {})).toMatchFileSnapshot(g);
  });
});

describe('diagnostic layout edge cases', () => {
  // Files written here, not goldens under tests/programs/: a BOM, CRLF line ends and spans at EOF, across lines or over
  // astral characters.
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

  it.for(cases.map((c) => ({ name: c.name, golden: cliGolden('diagnostic layout edge cases', c.name) })))('$name', async ({ name, golden: g }) => {
    const sn = runSn(['check', name], { cwd: edgeDir });
    expect(sn.status).toBe(1);
    await expect(golden(sn)).toMatchFileSnapshot(g);
  });
});

describe('build --emit=c', () => {
  const fibGolden = cliGolden('emit c', 'fib');
  it('prints the C for a small program', async () => {
    const sn = runSn(['build', join('tests', 'programs', 'programs', 'fib.aster'), '--emit=c']);
    expect(sn.status).toBe(0);
    await expect(golden(sn)).toMatchFileSnapshot(fibGolden);
  });

  it('prints about a megabyte for the compiler itself', () => {
    const r = runSn(['build', SELF_SOURCE, '--emit=c']);
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(500_000);
  });
});

// A minimal program that prints 30 and exits 0.
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
    expect(runSn(['build', 'hello.aster', '-o', join(dir, 'h')], { cwd: dir })).toEqual({ stdout: '', stderr: '', status: 0 });
    expect(spawn(join(dir, 'h'), [])).toEqual({ stdout: '30\n', stderr: '', status: 0 });
  });

  // Without -o, the output goes in the cwd, named by default_output: the root may be in another directory.
  it.for([
    { name: 'x.aster', file: 'x.aster', out: 'x' },
    { name: 'noext.txt', file: 'noext.txt', out: 'noext.txt.out' },
    { name: 'a root in a subdirectory', file: 'sub/x.aster', out: 'x' },
  ])('without -o: $name', ({ name, file, out }) => {
    const dir = freshDir(`build-default-${name.replaceAll(/\W/g, '_')}`, { [file]: HELLO });
    expect(runSn(['build', file], { cwd: dir })).toEqual({ stdout: '', stderr: '', status: 0 });
    expect(readdirSync(dir).toSorted()).toEqual([file.split('/')[0], out].toSorted());
    expect(spawn(join(dir, out), [])).toEqual({ stdout: '30\n', stderr: '', status: 0 });
  });
});

describe('a directory as input', () => {
  it('check <a directory>', () => {
    expect(runSn(['check', 'tests'])).toEqual({ stdout: '', stderr: "error: cannot read 'tests'\n", status: 2 });
  });
});

describe('run', () => {
  const io = join('tests', 'programs', 'io');

  const argsGolden = cliGolden('run', 'passes the arguments after --');
  it('passes the arguments after --', async () => {
    const file = join(io, 'args.aster');
    const args = parseExpectations(readFileSync(join(REPO_ROOT, file), 'utf8')).args;
    expect(args).toEqual(['one', 'two', '-3', 'é']);
    const sn = runSn(['run', file, '--', ...args]);
    expect(sn.status).toBe(0);
    await expect(golden(sn)).toMatchFileSnapshot(argsGolden);
  });

  it('passes stdin through', () => {
    const file = join(io, 'stdin.aster');
    const input = parseExpectations(readFileSync(join(REPO_ROOT, file), 'utf8')).stdin;
    expect(runSn(['run', file], { input })).toEqual({ stdout: '13\nhello\n0\n', stderr: '', status: 0 });
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
    expect(runSn(['run', file], { cwd: dir })).toEqual(expected);
  });
});

describe('self-hosted CLI behaviour (formerly divergences from stage 0)', () => {
  const dir = freshDir('divergences', { 'hello.aster': HELLO, 'fakecc/cc': "#!/bin/sh\necho 'cc: boom' >&2\nexit 1\n" });
  chmodSync(join(dir, 'fakecc', 'cc'), 0o755);

  const emitIrGolden = cliGolden('self-hosted CLI behaviour (formerly divergences from stage 0)', '--emit=ir is an unknown emit stage');
  it('--emit=ir is an unknown emit stage', async () => {
    const sn = runSn(['build', 'hello.aster', '--emit=ir'], { cwd: dir });
    expect(sn.status).toBe(2);
    await expect(golden(sn)).toMatchFileSnapshot(emitIrGolden);
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
    // The test's own TMPDIR keeps the harness's empty-TMPDIR check on the shared one meaningful.
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

  beforeAll(() => {
    const r = runSn(['build', join('packages', 'asterc-self', 'asterc.aster'), '-o', next]);
    if (r.status !== 0 || r.stderr !== '') throw new Error(`${stage().name} failed to build the next stage (status ${r.status}): ${r.stderr}`);
  }, 120_000);

  it.for([
    join('..', '..', 'packages', 'asterc-self', 'asterc.aster'),
    join('programs', 'fib.aster'),
    join('io', 'files.aster'),
    join('programs', 'emit.aster'),
  ])(`${stage().name} builds the next stage, whose C matches its own: --emit=c of %s`, (file) => {
    const argv = ['build', join('tests', 'programs', file), '--emit=c'];
    const r = runNext(argv);
    expect(r).toEqual(runSn(argv));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
});


describe('LLVM backend surface', () => {
  it.for([
    ['build', '--backend=llvm', 'missing.aster'],
    ['run', '--backend=llvm', 'missing.aster'],
    ['build', '--emit=llvm', 'missing.aster'],
  ])('recognizes LLVM options before normal input handling: %j', (args) => {
    expect(runSn(args)).toEqual({ stdout: '', stderr: "error: cannot read 'missing.aster'\n", status: 2 });
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
  });
});

describe('LLVM driver failure and emission isolation', () => {
  const dir = freshDir('llvm-driver', {
    'hello.aster': HELLO,
    'fakeclang/clang': "#!/bin/sh\necho 'clang: boom' >&2\nexit 1\n",
  });
  chmodSync(join(dir, 'fakeclang', 'clang'), 0o755);
  const env = { PATH: `${join(dir, 'fakeclang')}:${process.env.PATH ?? ''}` };
  it.for(['build', 'run'])('streams clang failure and cleans temporary files for %s', (command) => {
    const argv = [command, 'hello.aster', '--backend=llvm'];
    if (command === 'build') argv.push('-o', join(dir, 'out'));
    expect(runSn(argv, { cwd: dir, env })).toEqual({
      stdout: '', stderr: "clang: boom\ninternal compiler error: C compiler 'clang' failed\n", status: 3,
    });
  });
  it('LLVM textual emission does not invoke clang', () => {
    const result = runSn(['build', 'hello.aster', '--emit=llvm'], { cwd: dir, env });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('define');
  });
  it('an explicit C emission overrides the executable backend selection', () => {
    expect(runSn(['build', 'hello.aster', '--backend=llvm', '--emit=c'], { cwd: dir, env })).toEqual(
      runSn(['build', 'hello.aster', '--emit=c'], { cwd: dir, env }),
    );
  });
  it('C builds work with an unusable clang', () => {
    expect(runSn(['run', 'hello.aster', '--backend=c'], { cwd: dir, env })).toEqual({ stdout: '30\n', stderr: '', status: 0 });
  });
});

describe('the CLI goldens', () => {
  // This fails on a first `-u` into an empty tests/golden/cli/: vitest writes file snapshots only after the run.
  it('carry no machine-specific paths or stage names, and none is stale', () => {
    const dir = dirname(goldenPath('cli', 'x'));
    const files = readdirSync(dir);
    expect(files.toSorted()).toEqual([...slugs].map((slug) => `${slug}.txt`).toSorted());
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const bad of ['/home/', '/tmp/', 'S1']) expect(text, `${f} contains ${bad}`).not.toContain(bad);
    }
  });
});

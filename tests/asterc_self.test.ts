import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { goldenPath, renderOutcome, REPO_ROOT } from './golden.js';
import { stage } from './stage.js';

// `aster query` (docs/inspect/README.md, "Position queries"; the contract and its tables are in
// docs/superpowers/specs/2026-10-07-aster-source-query-contract-design.md).
const root = mkdtempSync(join(tmpdir(), 'aster-json-query-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const MAIN = `import "lib.aster";

fn main(): int {
    let p: Point = Point { x: 1, y: 2 };
    let n: int = twice(p.x);
    let s: string = "héllo 😀"; // note
    let o: Option[int] = Option::Some(n);
    if n > 0 {
        let n: int = n + 1;
        print(n);
    }
    let m: Map[string, int] = {};
    return (n + len(s)) * 2;
}
`;
const LIB = 'struct Point { x: int, y: int }\n\nfn twice(n: int): int {\n    return n * 2;\n}\n';
const CRLF = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('fn main(): int {\r\n    return 0;\r\n}\r\n')]);

const strict = new TextDecoder('utf-8', { fatal: true });

function fixture(name: string, files: Record<string, string | Buffer>): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

function run(dir: string, argv: string[]) {
  const r = spawnSync(stage().bin, argv, { cwd: dir, env: { ...process.env, LC_ALL: 'C' }, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Runs a query twice; checks determinism, one line, empty stderr, digests and that semantics equal inspect's. */
function query(dir: string, entry: string, file: string, mode: 'offset' | 'caret', at: number) {
  const argv = ['query', entry, `--file=${file}`, `--${mode}=${at}`];
  const first = run(dir, argv);
  const second = run(dir, argv);
  expect(Buffer.compare(first.stdout, second.stdout), 'deterministic').toBe(0);
  expect(first.stderr.toString('latin1')).toBe('');
  const text = strict.decode(first.stdout);
  expect(text.endsWith('\n') && !text.slice(0, -1).includes('\n'), 'one line').toBe(true);
  const doc = JSON.parse(text);
  expect([doc.schema, doc.command]).toEqual(['aster/1', 'query']);
  for (const f of doc.files) {
    expect(f.sha256, `${f.path}`).toBe(createHash('sha256').update(readFileSync(join(dir, f.path))).digest('hex'));
  }
  const inspected = JSON.parse(strict.decode(run(dir, ['inspect', entry]).stdout));
  expect(doc.semantics).toEqual(inspected.semantics);
  expect(doc.query.request).toEqual({ path: file, mode: mode === 'offset' ? 'pointer' : 'caret', offset: at, file: doc.query.request.file });
  return { status: first.status, text, doc, q: doc.query };
}

interface Row { file?: string; at: number; status: string; site?: string; extent?: [number, number]; target?: number; type?: unknown; reason?: string; sigNull?: boolean }

const POINTER: Row[] = [
  { at: 0, status: 'none' },
  { at: 7, status: 'unsupported', site: 'import-path', extent: [7, 18] },
  { at: 24, status: 'found', site: 'declaration', extent: [24, 28], target: 0 },
  { at: 30, status: 'none' },
  { at: 46, status: 'found', site: 'declaration', extent: [46, 47], target: 1 },
  { at: 49, status: 'unsupported', site: 'type-annotation', extent: [49, 54] },
  { at: 57, status: 'unsupported', site: 'struct-literal-name', extent: [57, 62] },
  { at: 65, status: 'unsupported', site: 'field-init-name', extent: [65, 66] },
  { at: 96, status: 'found', site: 'callee', extent: [96, 101], target: 10 },
  { at: 101, status: 'found', site: 'expression', extent: [96, 106], type: { kind: 'int' } },
  { at: 102, status: 'found', site: 'local', extent: [102, 103], target: 1 },
  { at: 103, status: 'found', site: 'expression', extent: [102, 105], type: { kind: 'int' } },
  { at: 104, status: 'found', site: 'field', extent: [104, 105], target: 8, type: { kind: 'int' } },
  { at: 128, status: 'found', site: 'expression', extent: [128, 141], type: { kind: 'string' } },
  { at: 130, status: 'found', site: 'expression', extent: [128, 141], type: { kind: 'string' } },
  { at: 131, status: 'invalid', reason: 'offset-not-boundary' },
  { at: 136, status: 'found', site: 'expression', extent: [128, 141], type: { kind: 'string' } },
  { at: 137, status: 'invalid', reason: 'offset-not-boundary' },
  { at: 141, status: 'none' },
  { at: 143, status: 'none' },
  { at: 176, status: 'unsupported', site: 'variant-name', extent: [176, 182] },
  { at: 182, status: 'found', site: 'expression', extent: [176, 191], type: { kind: 'enum', name: 'Option[int]', decl: 21, args: [{ kind: 'int' }] } },
  { at: 184, status: 'unsupported', site: 'variant-name', extent: [184, 188] },
  { at: 189, status: 'found', site: 'local', extent: [189, 190], target: 2 },
  { at: 197, status: 'none' },
  { at: 202, status: 'found', site: 'expression', extent: [200, 205], type: { kind: 'bool' } },
  { at: 220, status: 'found', site: 'declaration', extent: [220, 221], target: 5 },
  { at: 229, status: 'found', site: 'local', extent: [229, 230], target: 2 },
  { at: 231, status: 'found', site: 'expression', extent: [229, 234], type: { kind: 'int' } },
  { at: 244, status: 'found', site: 'callee', extent: [244, 249], target: 42, sigNull: true },
  { at: 249, status: 'found', site: 'expression', extent: [244, 252], type: { kind: 'void' } },
  { at: 250, status: 'found', site: 'local', extent: [250, 251], target: 5 },
  { at: 271, status: 'unsupported', site: 'type-annotation', extent: [271, 287] },
  { at: 290, status: 'found', site: 'expression', extent: [290, 292], type: { kind: 'map', key: { kind: 'string' }, value: { kind: 'int' } } },
  { at: 298, status: 'none' },
  { at: 305, status: 'found', site: 'expression', extent: [305, 317], type: { kind: 'int' } },
  { at: 306, status: 'found', site: 'local', extent: [306, 307], target: 2 },
  { at: 310, status: 'found', site: 'callee', extent: [310, 313], target: 32, sigNull: true },
  { at: 314, status: 'found', site: 'local', extent: [314, 315], target: 3 },
  { at: 316, status: 'found', site: 'expression', extent: [305, 317], type: { kind: 'int' } },
  { at: 318, status: 'found', site: 'expression', extent: [305, 321], type: { kind: 'int' } },
  { at: 324, status: 'none' },
  { at: 325, status: 'none' },
  { at: 326, status: 'invalid', reason: 'offset-out-of-range' },
  { file: 'lib.aster', at: 42, status: 'found', site: 'declaration', extent: [42, 43], target: 11 },
  { file: 'lib.aster', at: 68, status: 'found', site: 'local', extent: [68, 69], target: 11 },
];

const CARET: Row[] = [
  { at: 0, status: 'none' },
  { at: 47, status: 'found', site: 'declaration', extent: [46, 47], target: 1 },
  { at: 96, status: 'found', site: 'callee', extent: [96, 101], target: 10 },
  { at: 101, status: 'found', site: 'callee', extent: [96, 101], target: 10 },
  { at: 103, status: 'found', site: 'local', extent: [102, 103], target: 1 },
  { at: 105, status: 'found', site: 'field', extent: [104, 105], target: 8 },
  { at: 131, status: 'invalid', reason: 'offset-not-boundary' },
  { at: 140, status: 'found', site: 'expression', extent: [128, 141], type: { kind: 'string' } },
  { at: 141, status: 'none' },
  { at: 182, status: 'unsupported', site: 'variant-name', extent: [176, 182] },
  { at: 190, status: 'found', site: 'local', extent: [189, 190], target: 2 },
  { at: 230, status: 'found', site: 'local', extent: [229, 230], target: 2 },
  { at: 231, status: 'found', site: 'expression', extent: [229, 234], type: { kind: 'int' } },
  { at: 251, status: 'found', site: 'local', extent: [250, 251], target: 5 },
  { at: 325, status: 'none' },
  { at: 326, status: 'invalid', reason: 'offset-out-of-range' },
  { file: 'lib.aster', at: 69, status: 'found', site: 'local', extent: [68, 69], target: 11 },
];

const CRLF_ROWS: Row[] = [
  { at: 0, status: 'none' },
  { at: 1, status: 'invalid', reason: 'offset-not-boundary' },
  { at: 2, status: 'invalid', reason: 'offset-not-boundary' },
  { at: 3, status: 'none' },
  { at: 6, status: 'found', site: 'declaration', extent: [6, 10], target: 0 },
  { at: 19, status: 'none' },
  { at: 32, status: 'found', site: 'expression', extent: [32, 33], type: { kind: 'int' } },
  { at: 39, status: 'none' },
];

/**
 * What a result says about the keys `row` pins, beside what the row expects, plus the invariants every result keeps:
 * a location names its `files` entry's path, an unsupported site has no answer, a callee has no type, and a target is
 * a declaration id.
 */
function outcome(r: ReturnType<typeof query>, row: Row): { got: Record<string, unknown>; want: Record<string, unknown> } {
  const { status, q, doc } = r;
  const range = q.location?.range;
  const got: Record<string, unknown> = { status: q.status, exit: status };
  const want: Record<string, unknown> = { status: row.status, exit: row.status === 'invalid' ? 2 : 0 };
  const pins: [string, unknown, unknown][] = [
    ['reason', row.reason, q.reason],
    ['site', row.site, q.site],
    ['extent', row.extent, range && [range.start, range.end]],
    ['target', row.target, q.target],
    ['type', row.type, q.type],
    ['signature', row.sigNull ? null : undefined, q.signature],
  ];
  for (const [key, expected, actual] of pins) {
    if (expected !== undefined) {
      want[key] = expected;
      got[key] = actual;
    }
  }
  got.invariants = {
    path: q.location === undefined || doc.files[q.location.file].path === q.location.path,
    unsupportedBare: q.status !== 'unsupported' || !['type', 'signature', 'target'].some((k) => k in q),
    calleeUntyped: q.site !== 'callee' || !('type' in q),
    targetIndexed: q.target === undefined || (Number.isInteger(q.target) && q.target < doc.semantics.declarations.length),
  };
  want.invariants = { path: true, unsupportedBare: true, calleeUntyped: true, targetIndexed: true };
  return { got, want };
}

let dir = '';
beforeAll(() => {
  dir = fixture('main', { 'main.aster': MAIN, 'lib.aster': LIB, 'crlf.aster': CRLF });
});

describe('query selection', () => {
  it.for(POINTER.map((row) => ({ ...row, name: `${row.file ?? 'main.aster'} ${row.at}` })))('pointer $name', (row) => {
    const { got, want } = outcome(query(dir, 'main.aster', row.file ?? 'main.aster', 'offset', row.at), row);
    expect(got).toEqual(want);
  });
  it.for(CARET.map((row) => ({ ...row, name: `${row.file ?? 'main.aster'} ${row.at}` })))('caret $name', (row) => {
    const { got, want } = outcome(query(dir, 'main.aster', row.file ?? 'main.aster', 'caret', row.at), row);
    expect(got).toEqual(want);
  });
  it.for(CRLF_ROWS)('bom+crlf $at', (row) => {
    const { got, want } = outcome(query(dir, 'crlf.aster', 'crlf.aster', 'offset', row.at), row);
    expect(got).toEqual(want);
  });
  it('caret on the BOM and CRLF file', () => {
    // The BOM is not source, so a caret behind it has no name to its left; one just after `main` finds the declaration.
    expect(query(dir, 'crlf.aster', 'crlf.aster', 'caret', 3).q.status).toBe('none');
    expect(query(dir, 'crlf.aster', 'crlf.aster', 'caret', 10).q).toMatchObject({
      status: 'found',
      site: 'declaration',
      target: 0,
      location: { range: { start: 6, end: 10 } },
    });
  });
  it('every byte of ((n)) selects the use of n, with the parentheses in its extent', () => {
    const d = fixture('parens', { 'main.aster': 'fn main(): int {\n    let n: int = 3;\n    return ((n)) * 2;\n}\n' });
    const at = Buffer.from(readFileSync(join(d, 'main.aster'))).indexOf('((n))');
    for (let k = 0; k < 5; k++) {
      const q = query(d, 'main.aster', 'main.aster', 'offset', at + k).q;
      expect(q, `byte ${k}`).toMatchObject({
        status: 'found',
        site: 'local',
        type: { kind: 'int' },
        location: { range: { start: at, end: at + 5 } },
      });
    }
  });
  it('caret between touching sites', () => {
    const d = fixture('touch', { 'main.aster': 'fn main(): int {\n    let a: int = 1;\n    let b: int = 2;\n    return a+b;\n}\n' });
    const src = Buffer.from(readFileSync(join(d, 'main.aster')));
    const a = src.indexOf('a+b');
    expect(query(d, 'main.aster', 'main.aster', 'caret', a + 1).q).toMatchObject({ site: 'local', location: { range: { start: a, end: a + 1 } } });
    expect(query(d, 'main.aster', 'main.aster', 'caret', a + 2).q).toMatchObject({ site: 'local', location: { range: { start: a + 2, end: a + 3 } } });
  });
});

describe('query requests', () => {
  it('path spellings of the same loaded file', () => {
    for (const spelling of ['lib.aster', './lib.aster', 'sub/../lib.aster']) {
      expect(query(dir, 'main.aster', spelling, 'offset', 42).q.status, `${spelling}`).toBe('found');
    }
  });
  it('a file outside the closure', () => {
    writeFileSync(join(dir, 'other.aster'), 'fn other(): int {\n    return 0;\n}\n');
    const r = query(dir, 'main.aster', 'other.aster', 'offset', 0);
    expect(r.status).toBe(2);
    expect(r.q).toEqual({ request: { path: 'other.aster', mode: 'pointer', offset: 0, file: null }, status: 'invalid', reason: 'file-not-in-closure' });
  });
  it('the largest offset is out of range, not a usage error', () => {
    // 2^63 - 1 is not exact as a JS number, so the argv is written out and the offset compared as text.
    const r = run(dir, ['query', 'main.aster', '--file=main.aster', '--offset=9223372036854775807']);
    expect(r.status).toBe(2);
    const text = strict.decode(r.stdout);
    expect(text).toContain('"offset":9223372036854775807,');
    expect(JSON.parse(text).query).toMatchObject({ status: 'invalid', reason: 'offset-out-of-range' });
  });
  it('an empty imported file', () => {
    const d = fixture('empty', { 'main.aster': 'import "lib.aster";\nfn main(): int {\n    return 0;\n}\n', 'lib.aster': '' });
    expect(query(d, 'main.aster', 'lib.aster', 'offset', 0).q.status).toBe('none');
    expect(query(d, 'main.aster', 'lib.aster', 'caret', 0).q.status).toBe('none');
    expect(query(d, 'main.aster', 'lib.aster', 'offset', 1).q.reason).toBe('offset-out-of-range');
  });
  it('an unavailable program answers no position', () => {
    const d = fixture('broken', { 'main.aster': MAIN, 'lib.aster': LIB.replace('n * 2', 'true') });
    const r = query(d, 'main.aster', 'main.aster', 'offset', 999_999);
    expect(r.status).toBe(1);
    expect(r.doc.semantics).toEqual({ available: false, reason: 'diagnostics' });
    expect(r.q).toEqual({ request: { path: 'main.aster', mode: 'pointer', offset: 999_999, file: null }, status: 'unavailable', reason: 'diagnostics' });
    const missing = run(d, ['query', 'gone.aster', '--file=gone.aster', '--offset=0']);
    expect(missing.status).toBe(2);
    expect(JSON.parse(strict.decode(missing.stdout)).query).toMatchObject({ status: 'unavailable', reason: 'io' });
  });
  it.for([
    ['query', 'main.aster', '--offset=1'],
    ['query', 'main.aster', '--file=main.aster'],
    ['query', 'main.aster', '--file=main.aster', '--offset=1', '--caret=1'],
    ['query', 'main.aster', '--file=main.aster', '--offset=1', '--offset=2'],
    ['query', 'main.aster', '--file=main.aster', '--file=lib.aster', '--offset=1'],
    ['query', 'main.aster', '--file=', '--offset=1'],
    ['query', 'main.aster', '--file=main.aster', '--offset=-1'],
    ['query', 'main.aster', '--file=main.aster', '--offset=+1'],
    ['query', 'main.aster', '--file=main.aster', '--offset=01'],
    ['query', 'main.aster', '--file=main.aster', '--offset=1x'],
    ['query', 'main.aster', '--file=main.aster', '--offset='],
    ['query', 'main.aster', '--file=main.aster', '--offset=9223372036854775808'],
    ['query', 'main.aster', '--file=main.aster', '--offset=1', '--format=json'],
    ['query', 'main.aster', '--file=main.aster', '--offset=1', '--backend=c'],
    ['check', 'main.aster', '--file=main.aster'],
    ['inspect', 'main.aster', '--offset=1'],
  ])('usage error: %s', (argv) => {
    const r = run(dir, argv as string[]);
    expect(r.status).toBe(2);
    expect(r.stdout.length).toBe(0);
    expect(r.stderr.toString()).toMatch(/^error: /);
  });
});

describe('query goldens', () => {
  const cases: [string, string[], number][] = [
    ['query-callee-import', ['--file=main.aster', '--offset=96'], 0],
    ['query-caret-callee', ['--file=main.aster', '--caret=101'], 0],
    ['query-shadow-outer', ['--file=main.aster', '--offset=229'], 0],
    ['query-shadow-inner', ['--file=main.aster', '--offset=250'], 0],
    ['query-builtin', ['--file=main.aster', '--offset=244'], 0],
    ['query-outside', ['--file=other.aster', '--offset=0'], 2],
  ];
  it.for(cases)('%s', async ([name, flags, status]) => {
    writeFileSync(join(dir, 'other.aster'), 'fn other(): int {\n    return 0;\n}\n');
    const r = run(dir, ['query', 'main.aster', ...flags]);
    expect(r.status).toBe(status);
    await expect(renderOutcome({ status: r.status, stdout: strict.decode(r.stdout), stderr: r.stderr.toString() })).toMatchFileSnapshot(goldenPath('json', name));
  });
  it('query-unavailable', async () => {
    const d = fixture('broken-golden', { 'main.aster': MAIN, 'lib.aster': LIB.replace('n * 2', 'true') });
    const r = run(d, ['query', 'main.aster', '--file=main.aster', '--offset=96']);
    expect(r.status).toBe(1);
    await expect(renderOutcome({ status: r.status, stdout: strict.decode(r.stdout), stderr: r.stderr.toString() })).toMatchFileSnapshot(goldenPath('json', 'query-unavailable'));
  });
});

describe('query at scale', () => {
  it('answers on the compiler itself, linking a use into another file', () => {
    const checker = readFileSync(join(REPO_ROOT, 'packages/asterc-self/checker.aster'));
    const use = checker.indexOf('lookup(ctx, name)');
    const r = query(REPO_ROOT, 'packages/asterc-self/asterc.aster', 'packages/asterc-self/checker.aster', 'caret', use + 6);
    expect(r.q).toMatchObject({ status: 'found', site: 'callee' });
    const target = r.doc.semantics.declarations[r.q.target];
    expect([target.kind, target.name]).toEqual(['fn', 'lookup']);
  }, 120_000);
  it('answers a 500 KB file within the time ceiling', () => {
    const parts: string[] = [];
    let size = 0;
    for (let i = 0; size < 500_000; i++) {
      const part = `fn f${i}(a: int, b: string): int {\n    let c: int = a + len(b);\n    var d: int = c * 2;\n    return d;\n}\n\n`;
      parts.push(part);
      size += part.length;
    }
    parts.push('fn main(): int {\n    return 0;\n}\n');
    const d = fixture('large', { 'main.aster': parts.join('') });
    const started = performance.now();
    const r = run(d, ['query', 'main.aster', '--file=main.aster', `--offset=${size - 20}`]);
    expect(r.status).toBe(0);
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 60_000);
});

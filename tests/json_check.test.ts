import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { goldenPath, renderOutcome } from './golden.js';
import { stage } from './stage.js';

// `aster check --format=json` (docs/inspect/README.md, spec §5): one golden per fixture under tests/golden/json/, the
// same for every stage. Each fixture runs twice and must give the same bytes, with an empty stderr.

const root = mkdtempSync(join(tmpdir(), 'aster-json-check-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const b = (s: string) => Buffer.from(s, 'utf8');
const MAIN_OK = 'fn main(): int {\n    return 0;\n}\n';

interface Fixture {
  name: string;
  files: Record<string, Buffer>;
  entry?: string;
  status: number;
  setup?: (dir: string) => void;
  skip?: boolean;
}

const fixtures: Fixture[] = [
  { name: 'ok', files: { 'main.aster': b(MAIN_OK) }, status: 0 },
  { name: 'astral', files: { 'main.aster': b('fn main(): int {\n    let s: string = "😀é"; let n: int = s;\n    return 0;\n}\n') }, status: 1 },
  { name: 'bom', files: { 'main.aster': Buffer.concat([BOM, b('fn main(): int {\n    return "x";\n}\n')]) }, status: 1 },
  { name: 'crlf', files: { 'main.aster': b('fn main(): int {\r\n\tlet n: int = true;\r\n    return 0;\r\n}\r\n') }, status: 1 },
  { name: 'eof-no-newline', files: { 'main.aster': b('fn main(): int {\n    return 0;') }, status: 1 },
  { name: 'missing-main', files: { 'main.aster': b('fn f(): int {\n    return 1;\n}\n') }, status: 1 },
  { name: 'several-errors', files: { 'main.aster': b('fn main(): int {\n    let a: int = "x";\n    let b: bool = 1;\n    return q;\n}\n') }, status: 1 },
  { name: 'root-malformed', files: { 'main.aster': Buffer.concat([b('fn main(): int {\n    // '), Buffer.from([0xff]), b('\n    return 0;\n}\n')]) }, status: 1 },
  { name: 'root-missing', files: {}, entry: 'nope.aster', status: 2 },
  { name: 'import-missing', files: { 'main.aster': b('import "lib/gone.aster";\n' + MAIN_OK) }, status: 1 },
  { name: 'import-malformed', files: { 'main.aster': b('import "bad.aster";\n' + MAIN_OK), 'bad.aster': Buffer.concat([b('fn f(): int {\n    return 1; // '), Buffer.from([0xc3]), b('\n}\n')]) }, status: 1 },
  {
    name: 'import-unreadable',
    files: { 'main.aster': b('import "locked.aster";\n' + MAIN_OK), 'locked.aster': b('fn f(): int {\n    return 1;\n}\n') },
    setup: (dir) => chmodSync(join(dir, 'locked.aster'), 0o000),
    skip: process.getuid?.() === 0,
    status: 1,
  },
  { name: 'imported-error', files: { 'main.aster': b('import "lib.aster";\n' + MAIN_OK), 'lib.aster': b('fn f(): int {\n    return true;\n}\n') }, status: 1 },
  { name: 'imported-syntax-error', files: { 'main.aster': b('import "lib.aster";\n' + MAIN_OK), 'lib.aster': b('fn f(): int {\n    return 1 +;\n}\n') }, status: 1 },
  { name: 'cycle', files: { 'main.aster': b('import "a.aster";\n' + MAIN_OK), 'a.aster': b('import "main.aster";\nfn a(): int {\n    return 1;\n}\n') }, status: 0 },
  {
    name: 'diamond',
    files: {
      'main.aster': b('import "l.aster";\nimport "r.aster";\n' + MAIN_OK),
      'l.aster': b('import "base.aster";\nfn l(): int {\n    return base();\n}\n'),
      'r.aster': b('import "base.aster";\nfn r(): int {\n    return base();\n}\n'),
      'base.aster': b('fn base(): int {\n    return "no";\n}\n'),
    },
    status: 1,
  },
];

function run(dir: string, argv: string[]) {
  const r = spawnSync(stage().bin, argv, { cwd: dir, env: { ...process.env, LC_ALL: 'C' }, timeout: 60_000 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('check --format=json', () => {
  it.for(fixtures)('$name', async (f, { skip }) => {
    if (f.skip) skip();
    const dir = join(root, f.name);
    mkdirSync(dir);
    for (const [name, bytes] of Object.entries(f.files)) writeFileSync(join(dir, name), bytes);
    f.setup?.(dir);
    const argv = ['check', f.entry ?? 'main.aster', '--format=json'];
    const first = run(dir, argv);
    const second = run(dir, argv);
    expect(Buffer.compare(first.stdout, second.stdout), 'deterministic').toBe(0);
    expect(first.stderr.toString('latin1')).toBe('');
    expect(first.status).toBe(f.status);
    const text = first.stdout.toString('utf8');
    expect(text.endsWith('\n') && !text.slice(0, -1).includes('\n'), 'one line').toBe(true);
    const doc = JSON.parse(text);
    expect(doc.schema).toBe('aster/1');
    expect(doc.command).toBe('check');
    expect(doc.ok).toBe(doc.diagnostics.length === 0);
    expect(doc.ok).toBe(f.status === 0);
    // The range slices the file's bytes on disk.
    const located = doc.diagnostics.filter((d: any) => d.primary.range !== null && d.primary.file !== null);
    for (const d of located) {
      const r = d.primary.range;
      const path = doc.files[d.primary.file].path;
      expect(r.start).toBeLessThanOrEqual(r.end);
      expect(r.end).toBeLessThanOrEqual(f.files[path.replace(/^\.\//, '')]!.length);
    }
    await expect(renderOutcome({ status: first.status, stdout: text, stderr: '' })).toMatchFileSnapshot(goldenPath('json', f.name));
  });

  it('leaves human check output unchanged', () => {
    const dir = join(root, 'human');
    mkdirSync(dir);
    writeFileSync(join(dir, 'main.aster'), 'fn main(): int {\n    return "x";\n}\n');
    const r = run(dir, ['check', 'main.aster']);
    expect(r.status).toBe(1);
    expect(r.stdout.toString()).toBe('');
    expect(r.stderr.toString()).toBe("main.aster:2:12: error: type mismatch: expected int, found string\n      return \"x\";\n             ^^^\n");
  });

  it('accepts --format=human as the default', () => {
    const dir = join(root, 'human-explicit');
    mkdirSync(dir);
    writeFileSync(join(dir, 'main.aster'), MAIN_OK);
    const r = run(dir, ['check', 'main.aster', '--format=human']);
    expect([r.status, r.stdout.toString(), r.stderr.toString()]).toEqual([0, '', '']);
  });
});

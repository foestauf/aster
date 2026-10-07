import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { goldenPath, renderOutcome, REPO_ROOT } from './golden.js';
import { stage } from './stage.js';

// `aster inspect` (docs/inspect/README.md, spec §6): the response with `semantics`, one golden per fixture under
// tests/golden/json/inspect-*.txt, the same for every stage. Each fixture runs twice and must give the same bytes, with
// an empty stderr. Every successful fixture, and the compiler's own source, also passes the structural checks of
// `checkDecls`.

const root = mkdtempSync(join(tmpdir(), 'aster-json-inspect-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const b = (s: string) => Buffer.from(s, 'utf8');

interface Fixture {
  name: string;
  files: Record<string, Buffer>;
  entry?: string;
  status: number;
}

const fixtures: Fixture[] = [
  { name: 'shadowing', status: 0, files: { 'main.aster': b(
`fn f(x: int): int {
    let y: int = x;
    if y > 0 {
        let x: string = "inner";
        let x2: int = len(x);
        return x2;
    }
    let x: bool = true;
    match Option::Some(y) {
        Option::Some(x) => {
            return x;
        }
        Option::None => {}
    }
    return 0;
}

fn main(): int {
    return f(1);
}
`) } },
  { name: 'generics', status: 0, files: { 'main.aster': b(
`enum Pair[A, B] { Both(A, B), Neither }

struct Box {
    items: [int],
    names: Map[string, int],
}

fn main(): int {
    let p: Pair[int, string] = Pair::Both(1, "a");
    let o: Option[int] = Option::Some(2);
    let b: Box = Box { items: [], names: {} };
    return 0;
}
`) } },
  { name: 'imports', status: 0, files: {
    'main.aster': b('import "lib.aster";\nfn main(): int {\n    return twice(2);\n}\n'),
    'lib.aster': b('fn twice(n: int): int {\n    return n * 2;\n}\n'),
  } },
  { name: 'errors', status: 1, files: { 'main.aster': b('fn main(): int {\n    return "x";\n}\n') } },
  { name: 'missing', status: 2, files: {}, entry: 'nope.aster' },
];

const strict = new TextDecoder('utf-8', { fatal: true });

function run(dir: string, argv: string[]) {
  const r = spawnSync(stage().bin, argv, { cwd: dir, env: { ...process.env, LC_ALL: 'C' }, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Runs `argv` twice in `dir` and checks the response is deterministic, one line of UTF-8, with an empty stderr. */
function inspect(dir: string, argv: string[], status: number) {
  const first = run(dir, argv);
  const second = run(dir, argv);
  expect(Buffer.compare(first.stdout, second.stdout), 'deterministic').toBe(0);
  expect(first.stderr.toString('latin1')).toBe('');
  expect(first.status).toBe(status);
  const text = strict.decode(first.stdout);
  expect(text.endsWith('\n') && !text.slice(0, -1).includes('\n'), 'one line').toBe(true);
  const doc = JSON.parse(text);
  expect(doc.schema).toBe('aster/1');
  expect(doc.command).toBe('inspect');
  expect(doc.ok).toBe(status === 0);
  return { text, doc };
}

/** The ids a declaration refers to through `scope`, `shadows`, `parent` and `of`. */
const refs = (d: any): number[] => [d.scope, d.shadows, d.parent, d.of].filter((x) => x !== undefined && x !== null);

/** The structural rules every declaration list obeys. `sources` maps a `files` path, without `./`, to its bytes. */
function checkDecls(doc: any, sources: Record<string, Buffer>) {
  const decls = doc.semantics.declarations;
  expect(doc.semantics.available).toBe(true);
  decls.forEach((d: any, i: number) => expect(d.id).toBe(i));
  for (const ref of decls.flatMap(refs)) {
    expect(ref).toBeGreaterThanOrEqual(0);
    expect(ref).toBeLessThan(decls.length);
  }
  // A source declaration's location slices its name out of the file, inside its decl_range.
  for (const d of decls.filter((x: any) => x.origin === 'source')) {
    const path = doc.files[d.location.file].path.replace(/^\.\//, '');
    const r = d.location.range;
    expect(sources[path]!.subarray(r.start, r.end).toString('utf8')).toBe(d.name);
    expect(d.decl_range.start).toBeLessThanOrEqual(r.start);
    expect(d.decl_range.end).toBeGreaterThanOrEqual(r.end);
  }
  for (const d of decls.filter((x: any) => x.origin !== 'source')) expect([d.location, d.decl_range]).toEqual([null, null]);
  // Source first (by start within load order), then prelude, instantiations, builtins.
  const rank = { source: 0, prelude: 1, instantiation: 2, builtin: 3 } as Record<string, number>;
  for (let i = 1; i < decls.length; i++) expect(rank[decls[i].origin]).toBeGreaterThanOrEqual(rank[decls[i - 1].origin]);
  const builtins = decls.filter((d: any) => d.origin === 'builtin').map((d: any) => d.name);
  expect(builtins).toEqual(builtins.toSorted());
}

/** The declarations of `doc` named `name`, optionally of one kind. */
function named(doc: any, name: string, kind?: string): any[] {
  return doc.semantics.declarations.filter((d: any) => d.name === name && (kind === undefined || d.kind === kind));
}

function one(doc: any, name: string, kind?: string): any {
  const found = named(doc, name, kind);
  expect(found, `${kind ?? 'declaration'} '${name}'`).toHaveLength(1);
  return found[0];
}

// Per fixture: the facts the fixture exists for, and `checkDecls` for every successful one.
const targeted: Record<string, (doc: any, files: Record<string, Buffer>) => void> = {
  shadowing: (doc, files) => {
    checkDecls(doc, files);
    const f = one(doc, 'f', 'fn');
    const param = one(doc, 'x', 'param');
    const xs = named(doc, 'x', 'local');
    const [inner, outer, binder] = xs;
    expect(xs.map((d: any) => d.type.kind)).toEqual(['string', 'bool', 'int']);
    expect(inner.shadows).toBe(param.id);
    expect(outer.shadows).toBe(param.id);
    expect(binder.shadows).toBe(outer.id);
    for (const d of [param, ...xs]) expect(d.scope).toBe(f.id);
    expect(f.signature).toEqual({ params: [{ name: 'x', type: { kind: 'int' }, decl: param.id }], ret: { kind: 'int' } });
  },
  generics: (doc, files) => {
    checkDecls(doc, files);
    const decls = doc.semantics.declarations;
    const pair = one(doc, 'Pair', 'enum');
    expect(pair.origin).toBe('source');
    const params = decls.filter((d: any) => d.kind === 'type-param' && d.parent === pair.id);
    expect(params.map((d: any) => d.name)).toEqual(['A', 'B']);
    expect(pair.type_params).toEqual(params.map((d: any) => d.id));
    const both = decls.find((d: any) => d.kind === 'variant' && d.name === 'Both' && d.parent === pair.id);
    expect(both.payload).toEqual([{ kind: 'param', name: 'A' }, { kind: 'param', name: 'B' }]);
    const inst = one(doc, 'Pair[int, string]', 'enum');
    expect(inst.origin).toBe('instantiation');
    expect(inst.of).toBe(pair.id);
    expect(inst.args).toEqual([{ kind: 'int' }, { kind: 'string' }]);
    const instBoth = decls.find((d: any) => d.kind === 'variant' && d.name === 'Both' && d.parent === inst.id);
    expect(instBoth.payload).toEqual([{ kind: 'int' }, { kind: 'string' }]);
    const option = one(doc, 'Option', 'enum');
    expect(option.origin).toBe('prelude');
    expect(one(doc, 'Option[int]', 'enum').of).toBe(option.id);
    expect(one(doc, 'p', 'local').type).toEqual({ kind: 'enum', name: 'Pair[int, string]', decl: inst.id, args: [{ kind: 'int' }, { kind: 'string' }] });
    expect(one(doc, 'names', 'field').type).toEqual({ kind: 'map', key: { kind: 'string' }, value: { kind: 'int' } });
    const substring = one(doc, 'substring', 'builtin-fn').signature;
    expect(substring.params).toHaveLength(3);
    for (const p of substring.params) expect([p.name, p.decl]).toEqual([null, null]);
    expect(one(doc, 'print', 'builtin-fn').signature).toBeNull();
    one(doc, 'int', 'builtin-type');
    one(doc, 'Map', 'builtin-type');
  },
  imports: (doc, files) => {
    checkDecls(doc, files);
    expect(one(doc, 'twice', 'fn').location.file).toBe(1);
  },
  errors: (doc) => {
    expect(doc.semantics).toEqual({ available: false, reason: 'diagnostics' });
    expect('declarations' in doc.semantics).toBe(false);
  },
  missing: (doc) => {
    expect(doc.semantics).toEqual({ available: false, reason: 'io' });
  },
};

describe('inspect', () => {
  it.for(fixtures)('$name', async (f) => {
    const dir = join(root, f.name);
    mkdirSync(dir);
    for (const [name, bytes] of Object.entries(f.files)) writeFileSync(join(dir, name), bytes);
    const { text, doc } = inspect(dir, ['inspect', f.entry ?? 'main.aster'], f.status);
    targeted[f.name]!(doc, f.files);
    await expect(renderOutcome({ status: f.status, stdout: text, stderr: '' })).toMatchFileSnapshot(goldenPath('json', 'inspect-' + f.name));
  });

  it('inspects the compiler itself', () => {
    const { doc } = inspect(REPO_ROOT, ['inspect', 'packages/asterc-self/asterc.aster'], 0);
    expect(doc.semantics.declarations.length).toBeGreaterThan(1000);
    const sources: Record<string, Buffer> = {};
    for (const file of doc.files) sources[file.path.replace(/^\.\//, '')] = readFileSync(join(REPO_ROOT, file.path));
    checkDecls(doc, sources);
  }, 120_000);
});

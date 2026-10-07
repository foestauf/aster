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
  { name: 'binders', status: 0, files: { 'main.aster': b(
`fn pick(o: Option[int]): int {
    let Option::Some(v) = o else {
        return 0;
    };
    var total: int = v;
    if let Option::Some(w) = o {
        total = total + w;
    }
    for i in 0..3 {
        total = total + i;
    }
    let a: int = match Option::Some(1) {
        Option::Some(b) => b,
        Option::None => 0,
    };
    return total + a;
}

fn main(): int {
    return pick(Option::Some(1));
}
`) } },
  { name: 'unicode', status: 0, files: { 'main.aster': Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    b('// astral 😀 comment\r\nfn helper(): int {\r\n\tlet s: string = "😀"; var u: int = len(s);\r\n\treturn u;\r\n}\r\n\r\nfn main(): int {\r\n    return helper();\r\n}'),
  ]) } },
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

const REF_KEYS = new Set(['scope', 'shadows', 'parent', 'of', 'decl']);

/**
 * Every id `value` refers to: `scope`, `shadows`, `parent`, `of` and `type_params`, and each non-null `decl`, at any
 * depth (types, signature params, payloads, args, element, key, value).
 */
function refs(value: any): number[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]): number[] => {
    if (REF_KEYS.has(k)) return v === null ? [] : [v as number];
    if (k === 'type_params') return v as number[];
    return refs(v);
  });
}

/** The structural rules every declaration list obeys. `sources` maps a `files` path, without `./`, to its bytes. */
function checkDecls(doc: any, sources: Record<string, Buffer>) {
  const decls = doc.semantics.declarations;
  expect(doc.semantics.available).toBe(true);
  decls.forEach((d: any, i: number) => expect(d.id).toBe(i));
  for (const ref of refs(decls)) {
    expect(Number.isInteger(ref)).toBe(true);
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
  // Source facts are ordered by file id, then by name start (spec §6.3).
  const keys = decls.filter((x: any) => x.origin === 'source').map((d: any) => [d.location.file, d.location.range.start]);
  for (let i = 1; i < keys.length; i++) {
    const [[f0, s0], [f1, s1]] = [keys[i - 1], keys[i]];
    expect(f1 > f0 || (f1 === f0 && s1 > s0), `source order at ${i}`).toBe(true);
  }
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
  binders: (doc, files) => {
    checkDecls(doc, files);
    const total = one(doc, 'total', 'local');
    expect(total.mutable).toBe(true);
    for (const name of ['v', 'w', 'i', 'b']) {
      const d = one(doc, name, 'local');
      expect(d.mutable, `${name} mutable`).toBe(false);
      expect(d.decl_range, `${name} decl_range`).toEqual(d.location.range);
    }
    // `b` is allocated before `a` (the initializer is checked first) but declared after it.
    expect(one(doc, 'a', 'local').id).toBeLessThan(one(doc, 'b', 'local').id);
  },
  unicode: (doc, files) => {
    checkDecls(doc, files);
    // Line 3 is `<tab>let s: string = "<U+1F600>"; var u: int = len(s);`. Before `u` there are 1 tab, 17 units up to and
    // including the opening quote, the astral character as 2 units, and `"; var ` as 7: 27 units, so column 28 (1-based).
    // The BOM is not a column, and the `\r` of the CRLF line endings only ends lines.
    const u = one(doc, 'u', 'local');
    expect(u.location.range.start_line).toBe(3);
    expect(u.location.range.start_col_utf16).toBe(28);
    const helper = one(doc, 'helper', 'fn');
    expect([helper.location.range.start_line, helper.location.range.start_col_utf16]).toEqual([2, 4]);
    expect(one(doc, 'main', 'fn').location.range.start_line).toBe(7);
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

  describe('unavailable semantics', () => {
    const bad = Buffer.from([0x66, 0x6e, 0x20, 0xff, 0x0a]);
    const ok = 'fn main(): int {\n    return 0;\n}\n';
    const cases: { name: string; files: Record<string, Buffer>; status: number; reason: string }[] = [
      { name: 'root-bad-utf8', files: { 'main.aster': bad }, status: 1, reason: 'diagnostics' },
      { name: 'lex-error', files: { 'main.aster': b('fn main(): int {\n    let s: string = "abc;\n    return 0;\n}\n') }, status: 1, reason: 'diagnostics' },
      { name: 'syntax-error', files: { 'main.aster': b('fn main(: int {\n    return 0;\n}\n') }, status: 1, reason: 'diagnostics' },
      { name: 'missing-import', files: { 'main.aster': b('import "gone.aster";\n' + ok) }, status: 1, reason: 'diagnostics' },
      { name: 'import-bad-utf8', files: { 'main.aster': b('import "lib.aster";\n' + ok), 'lib.aster': bad }, status: 1, reason: 'diagnostics' },
      { name: 'import-error', files: { 'main.aster': b('import "lib.aster";\n' + ok), 'lib.aster': b('fn f(): int {\n    return "x";\n}\n') }, status: 1, reason: 'diagnostics' },
      { name: 'missing-root', files: {}, status: 2, reason: 'io' },
    ];
    it.for(cases)('$name', (c) => {
      const dir = join(root, 'unavail-' + c.name);
      mkdirSync(dir);
      for (const [name, bytes] of Object.entries(c.files)) writeFileSync(join(dir, name), bytes);
      const { doc } = inspect(dir, ['inspect', 'main.aster'], c.status);
      expect(doc.semantics).toEqual({ available: false, reason: c.reason });
      expect('declarations' in doc.semantics).toBe(false);
    });
  });

  it('lists exactly the checker\'s builtin functions', () => {
    const checker = readFileSync(join(REPO_ROOT, 'packages/asterc-self/checker.aster'), 'utf8');
    const body = (name: string) => {
      const start = checker.indexOf(`fn ${name}(`);
      expect(start, `fn ${name}`).toBeGreaterThanOrEqual(0);
      return checker.slice(start, checker.indexOf('\n}\n', start));
    };
    const signatures = [...body('builtin_signatures').matchAll(/Signature \{ name: "([^"]+)"/g)].map((m) => m[1]!);
    const special = [...body('special_builtins').match(/for name in \[([^\]]*)\]/)![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(signatures.length).toBeGreaterThan(0);
    expect(special.length).toBeGreaterThan(0);
    const dir = join(root, 'builtins');
    mkdirSync(dir);
    writeFileSync(join(dir, 'main.aster'), 'fn main(): int {\n    return 0;\n}\n');
    const { doc } = inspect(dir, ['inspect', 'main.aster'], 0);
    const listed = doc.semantics.declarations.filter((d: any) => d.kind === 'builtin-fn').map((d: any) => d.name);
    expect(listed.toSorted()).toEqual([...new Set([...signatures, ...special])].toSorted());
    // Builtins whose checker signature returns `Type::Void` are the Result-returning ones; they have no signature to
    // report, and neither do the specially checked builtins.
    const voidRet = [...body('builtin_signatures').matchAll(/Signature \{ name: "([^"]+)"[^\n]*ret: Type::Void \}/g)].map((m) => m[1]!);
    expect(voidRet.toSorted()).toEqual(['make_temp_dir', 'read_file', 'remove_path', 'run_process', 'write_file']);
    const sigOf = (name: string) => doc.semantics.declarations.find((d: any) => d.kind === 'builtin-fn' && d.name === name).signature;
    for (const name of [...voidRet, ...special]) expect(sigOf(name), `${name} signature`).toBeNull();
  });

  it('inspects a large file in near-linear time', () => {
    const dir = join(root, 'large');
    mkdirSync(dir);
    const parts: string[] = [];
    let size = 0;
    for (let i = 0; size < 500_000; i++) {
      const part = `fn f${i}(a: int, b: string): int {\n    let c: int = a + len(b);\n    var d: int = c * 2;\n    return d;\n}\n\n`;
      parts.push(part);
      size += part.length;
    }
    parts.push('fn main(): int {\n    return 0;\n}\n');
    writeFileSync(join(dir, 'main.aster'), parts.join(''));
    const started = performance.now();
    const r = run(dir, ['inspect', 'main.aster']);
    const elapsed = performance.now() - started;
    expect(r.status).toBe(0);
    expect(JSON.parse(strict.decode(r.stdout)).semantics.available).toBe(true);
    // A rescan per position took about 39 s here; the line tables take well under a second.
    expect(elapsed).toBeLessThan(10_000);
  }, 60_000);

  it('inspects the compiler itself', () => {
    const { doc } = inspect(REPO_ROOT, ['inspect', 'packages/asterc-self/asterc.aster'], 0);
    expect(doc.semantics.declarations.length).toBeGreaterThan(1000);
    const sources: Record<string, Buffer> = {};
    for (const file of doc.files) sources[file.path.replace(/^\.\//, '')] = readFileSync(join(REPO_ROOT, file.path));
    checkDecls(doc, sources);
  }, 120_000);
});

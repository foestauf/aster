import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDriver, REPO_ROOT } from './stage.js';

// #58: the checker's source facts (Checked.facts) and the parser's paren pairs (Loaded.parens), dumped by a driver
// built from frontend.aster. Each fact line is
// `fact <kind> <file> <start> <end> <type> <func> <local> <name> <owner>`, with file-local on-disk offsets. Each local
// site is `site <func> <local> <file> <start>`, and each paren pair is `paren <file> <open> <close> <inner_start> <inner_end>`.
const dir = mkdtempSync(join(tmpdir(), 'aster-provenance-'));
const exe = join(dir, 'facts');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeAll(() => {
  const driver = join(dir, 'facts.aster');
  writeFileSync(driver, `
import ${JSON.stringify(join(REPO_ROOT, 'packages/asterc-self/frontend.aster'))};
fn file_of(files: [SourceFile], at: int): int {
    var found: int = 0;
    for i in 0..len(files) {
        if files[i].base <= at {
            found = i;
        }
    }
    return found;
}
fn local_offset(files: [SourceFile], at: int): string {
    let f: SourceFile = files[file_of(files, at)];
    return int_to_string(at - f.base + f.bom);
}
fn main(args: [string]): int {
    let FrontEnd::Passed(loaded, checked) = front_end(args[0]) else {
        print("unavailable");
        return 1;
    };
    let files: [SourceFile] = loaded.files;
    for f in checked.facts {
        print("fact " + f.kind + " " + int_to_string(file_of(files, f.start)) + " " + local_offset(files, f.start) + " " + local_offset(files, f.end) + " " + type_to_string(f.ty) + " " + int_to_string(f.func) + " " + int_to_string(f.local) + " " + f.name + " " + f.owner);
    }
    for fi in 0..len(checked.local_sites) {
        let sites: [LocalSite] = checked.local_sites[fi].sites;
        for k in 0..len(sites) {
            print("site " + int_to_string(fi) + " " + int_to_string(k) + " " + int_to_string(file_of(files, sites[k].name.start)) + " " + local_offset(files, sites[k].name.start));
        }
    }
    for q in loaded.parens {
        print("paren " + int_to_string(file_of(files, q.open)) + " " + local_offset(files, q.open) + " " + local_offset(files, q.close) + " " + local_offset(files, q.inner_start) + " " + local_offset(files, q.inner_end));
    }
    return 0;
}
`);
  buildDriver(driver, exe);
});

interface Fact { kind: string; file: number; start: number; end: number; type: string; func: number; local: number; name: string; owner: string }

function dump(files: Record<string, string | Buffer>, entry = 'main.aster') {
  const d = mkdtempSync(join(dir, 'case-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(d, name, '..'), { recursive: true });
    writeFileSync(join(d, name), text);
  }
  const r = spawnSync(exe, [join(d, entry)], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  const facts: Fact[] = lines.filter((l) => l.startsWith('fact ')).map((l) => {
    const [, kind, file, start, end, ...rest] = l.split(' ');
    const [owner = '', name = '', local, func, ...ty] = rest.reverse();
    const type = ty.reverse().join(' ');
    return { kind: kind!, file: +file!, start: +start!, end: +end!, type: type!, func: +func!, local: +local!, name, owner };
  });
  const sites = lines.filter((l) => l.startsWith('site ')).map((l) => l.split(' ').slice(1).map(Number));
  const parens = lines.filter((l) => l.startsWith('paren ')).map((l) => l.split(' ').slice(1).map(Number));
  return { status: r.status, out: r.stdout, facts, sites, parens };
}

/** Byte offsets of `word` as a whole word in `src`, in order. */
function words(src: string, word: string): number[] {
  return [...src.matchAll(new RegExp(`\\b${word}\\b`, 'g'))].map((m) => Buffer.byteLength(src.slice(0, m.index)));
}

/** The byte span of `inner` inside the `nth` occurrence of `snippet` in `src`. */
function spanAt(src: string, snippet: string, inner = snippet, nth = 1): [number, number] {
  const buf = Buffer.from(src);
  let at = -1;
  for (let i = 0; i < nth; i++) at = buf.indexOf(snippet, at + 1);
  expect(at, `${snippet} #${nth}`).toBeGreaterThanOrEqual(0);
  const start = at + Buffer.from(snippet).indexOf(inner);
  return [start, start + Buffer.byteLength(inner)];
}

/** The one fact of `kind` exactly spanning `span` in file `file`. */
function factAt(facts: Fact[], kind: string, [start, end]: [number, number], file = 0): Fact {
  const found = facts.filter((f) => f.kind === kind && f.file === file && f.start === start && f.end === end);
  expect(found, `${kind} at ${start}-${end}`).toHaveLength(1);
  return found[0]!;
}

/** The byte offset of the declaration name the local of `fact` resolves to. */
function declOf(sites: number[][], fact: Fact): number {
  const site = sites.find(([func, local]) => func === fact.func && local === fact.local);
  expect(site).toBeDefined();
  return site![3]!;
}

describe('provenance', () => {
  it('resolves shadowed, outward and binder uses to the right declarations', () => {
    const src = `fn f(i: int): int {
    var t: int = i;
    let n: int = 1;
    if t > 0 {
        let n: int = n + 1;
        t = t + n;
    }
    for i in 0..3 {
        t = t + i;
    }
    match Option::Some(t) {
        Option::Some(i) => {
            t = t + i;
        }
        Option::None => {}
    }
    return t + i + n;
}

fn main(): int {
    return f(1);
}
`;
    const { status, facts, sites } = dump({ 'main.aster': src });
    expect(status).toBe(0);
    // n: [0] outer decl, [1] inner decl, [2] use in `n + 1`, [3] use in `t + n`, [4] the final use.
    // i: [0] param, [1] `= i`, [2] for variable, [3] for-body use, [4] binder, [5] arm use, [6] final use.
    const n = words(src, 'n');
    const i = words(src, 'i');
    const use = (at: number) => declOf(sites, factAt(facts, 'local', [at, at + 1]));
    // On the inner `let n` line the inner n is not yet declared, so the use resolves outward.
    expect(use(n[2]!)).toBe(n[0]);
    expect(use(n[3]!)).toBe(n[1]);
    expect(use(n[4]!)).toBe(n[0]);
    expect(use(i[1]!)).toBe(i[0]);
    expect(use(i[3]!)).toBe(i[2]);
    expect(use(i[5]!)).toBe(i[4]);
    expect(use(i[6]!)).toBe(i[0]);
  });

  it('records imported callees and fields in the imported file', () => {
    const main = 'import "lib.aster";\nfn main(): int {\n    let p: Point = Point { x: 1 };\n    return twice(p.x);\n}\n';
    const lib = 'struct Point { x: int }\nfn twice(n: int): int {\n    return n * 2;\n}\n';
    const { status, facts } = dump({ 'main.aster': main, 'lib.aster': lib });
    expect(status).toBe(0);
    expect(factAt(facts, 'callee', spanAt(main, 'twice(', 'twice')).name).toBe('twice');
    const x = factAt(facts, 'field', spanAt(main, 'p.x', 'x'));
    expect([x.owner, x.name, x.type]).toEqual(['Point', 'x', 'int']);
    expect(factAt(facts, 'local', spanAt(lib, 'n * 2', 'n'), 1).type).toBe('int');
  });

  it('types every expression form', () => {
    const src = `struct P { x: int }
enum E { A, B }
fn pick(o: Option[int]): Option[int] {
    let v: int = o?;
    return Option::Some(v);
}
fn main(): int {
    var p: P = P { x: 1 };
    p.x = 2;
    var xs: [int] = [];
    push(xs, 'a');
    let m: Map[string, int] = {};
    let s: Set[int] = {};
    let e: E = E::A;
    let same: bool = e == E::B;
    let neg: int = -xs[0];
    let ok: bool = !same;
    let t: int = if ok { 1 } else { panic("no") };
    let u: int = match e { E::A => 1, E::B => 2 };
    let w: string = "s";
    let o: Option[int] = pick(Option::None);
    return t + u + neg + len(w);
}
`;
    const { status, facts } = dump({ 'main.aster': src });
    expect(status).toBe(0);
    const ty = (snippet: string, nth = 1) => factAt(facts, 'expr', spanAt(src, snippet, snippet, nth)).type;
    expect(ty('o?')).toBe('int');
    expect(ty('Option::Some(v)')).toBe('Option[int]');
    expect(ty('P { x: 1 }')).toBe('P');
    expect(ty('[]')).toBe('[int]');
    expect(ty("'a'")).toBe('int');
    expect(ty('{}', 1)).toBe('Map[string, int]');
    expect(ty('{}', 2)).toBe('Set[int]');
    expect(ty('E::A')).toBe('E');
    expect(ty('e == E::B')).toBe('bool');
    expect(ty('-xs[0]')).toBe('int');
    expect(ty('xs[0]')).toBe('int');
    expect(ty('!same')).toBe('bool');
    expect(ty('panic("no")')).toBe('never');
    expect(ty('if ok { 1 } else { panic("no") }')).toBe('int');
    expect(ty('match e { E::A => 1, E::B => 2 }')).toBe('int');
    expect(ty('"s"')).toBe('string');
    expect(ty('Option::None')).toBe('Option[int]');
    expect(ty('t + u + neg + len(w)')).toBe('int');
    // Assignment places: the local on the left of `p.x = 2`, and its field.
    expect(factAt(facts, 'local', spanAt(src, 'p.x = 2', 'p')).type).toBe('P');
    expect(factAt(facts, 'field', spanAt(src, 'p.x = 2', 'x')).owner).toBe('P');
    // A callee is a callee fact only: no expr or local fact shares its span.
    for (const name of ['push', 'len', 'pick']) {
      const at = words(src, name).at(-1)!;
      const end = at + name.length;
      expect(facts.filter((f) => f.kind === 'callee' && f.start === at && f.end === end), name).toHaveLength(1);
      expect(facts.filter((f) => f.kind !== 'callee' && f.start === at && f.end === end), name).toHaveLength(0);
    }
  });

  it('keeps exact spans through a BOM, CRLF, astral text and no final newline', () => {
    const body = '// 😀 here\r\nfn main(): int {\r\n    let s: string = "😀";\r\n    return len(s);\r\n}';
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body)]);
    const { status, facts } = dump({ 'main.aster': bytes });
    expect(status).toBe(0);
    const s = facts.find((f) => f.kind === 'local' && f.type === 'string')!;
    expect(bytes.subarray(s.start, s.end).toString()).toBe('s');
    const lit = facts.find((f) => f.kind === 'expr' && f.type === 'string')!;
    expect(bytes.subarray(lit.start, lit.end).toString()).toBe('"😀"');
  });

  it('records paren pairs around the inner span', () => {
    const src = 'fn main(): int {\n    let n: int = 1;\n    return ((n + 1)) * 2;\n}\n';
    const { parens } = dump({ 'main.aster': src });
    const inner = Buffer.from(src).indexOf('n + 1');
    // [open, close, inner_start, inner_end]; the inner pair closes first, so it is recorded first.
    expect(parens.map((p) => p.slice(1))).toEqual([
      [inner - 1, inner + 6, inner, inner + 5],
      [inner - 2, inner + 7, inner, inner + 5],
    ]);
  });

  it('exposes nothing for a program that fails to check', () => {
    const { status, out } = dump({ 'main.aster': 'fn main(): int {\n    return true;\n}\n' });
    expect(status).toBe(1);
    expect(out.trim()).toBe('unavailable');
  });
});

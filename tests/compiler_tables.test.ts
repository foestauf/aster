import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDriver, REPO_ROOT } from './stage.js';
import { spawnStrict } from './spawn.js';

// The compiler's lookup tables must preserve observable ordering and error recovery. Build one self-hosted driver
// for this suite; unlike the CLI it also dumps the typed tree after checker errors, exposing which declaration won.
const dir = mkdtempSync(join(tmpdir(), 'aster-compiler-tables-'));
const exe = join(dir, 'inspect');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeAll(() => {
  const driver = join(dir, 'inspect.aster');
  writeFileSync(driver, `
import ${JSON.stringify(join(REPO_ROOT, 'packages/asterc-self/typed_dump.aster'))};
import ${JSON.stringify(join(REPO_ROOT, 'packages/asterc-self/report.aster'))};
fn table_diags(diags: [Diag]) {
    for d in sort_diags(diags) {
        print(int_to_string(d.start) + "\\t" + int_to_string(d.end) + "\\t" + d.message);
    }
}
fn main(args: [string]): int {
    let Result::Ok(src) = read_file(args[1]) else { return 2; };
    let loaded: Loaded = load_program(args[1], src);
    print(int_to_string(loaded.root_end));
    for f in loaded.files {
        print(int_to_string(f.base) + "\\t" + int_to_string(f.bom) + "\\t" + f.path);
    }
    print("===diagnostics===");
    if args[0] == "load" || len(loaded.diags) > 0 {
        table_diags(loaded.diags);
        print("===typed===");
        return 0;
    }
    let checked: Checked = check_program(loaded.items, loaded.root_end);
    table_diags(checked.diags);
    print("===typed===");
    for line in dump_typed(checked) { print(line); }
    return 0;
}
`);
  buildDriver(driver, exe);
}, 120_000);

interface Diagnostic {
  start: number;
  end: number;
  message: string;
}

function inspect(file: string, mode: 'check' | 'load' = 'check') {
  const r = spawnStrict(exe, [mode, file], { cwd: dir, timeout: 10_000, env: { ...process.env, LC_ALL: 'C' } });
  if (r.error) throw r.error;
  expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
  const [loaded, rest] = r.stdout.split('===diagnostics===\n');
  const [diagnostics, typed] = rest.split('===typed===\n');
  const [rootEnd, ...files] = loaded.trimEnd().split('\n');
  return {
    rootEnd: Number(rootEnd),
    files: files.map((line) => {
      const [base, bom, path] = line.split('\t');
      return { base: Number(base), bom: Number(bom), path };
    }),
    diagnostics: diagnostics.trimEnd() === '' ? [] : diagnostics.trimEnd().split('\n').map((line): Diagnostic => {
      const [start, end, message] = line.split('\t');
      return { start: Number(start), end: Number(end), message };
    }),
    typed,
  };
}

function check(name: string, source: string) {
  const file = join(dir, `${name}.aster`);
  writeFileSync(file, source);
  return inspect(file);
}

function diagnostic(source: string, token: string, message: string, occurrence = 0): Diagnostic {
  let start = -1;
  for (let i = 0; i <= occurrence; i++) {
    start = source.indexOf(token, start + 1);
    if (start < 0) throw new Error(`missing diagnostic token ${JSON.stringify(token)} occurrence ${occurrence}`);
  }
  return { start, end: start + token.length, message };
}

function declarations(typed: string): string[] {
  return typed.split('\n').filter((line) => line.startsWith('  local ')).map((line) => line.trim());
}

function lookups(typed: string): string[] {
  return typed.split('\n').map((line) => line.trim()).filter((line) => /^(local \d+ .+ :|place-local |binders )/.test(line));
}

describe('compiler name tables', () => {
  it('retains the first accepted struct, enum, generic template and function signature', () => {
    const source = [
      'struct Keep { value: int }',
      'struct Keep { other: bool }',
      'enum Choice { First(int), Last }',
      'enum Choice { Replaced(bool) }',
      'enum Box[T] { Value(T), Empty }',
      'enum Box[T, U] { Wrong(T, U) }',
      'fn choose(n: int): int { return n; }',
      'fn choose(n: bool): string { return "wrong"; }',
      'fn main(): int {',
      '    let k: Keep = Keep { value: 3 };',
      '    let c: Choice = Choice::First(k.value);',
      '    let b: Box[int] = Box::Value(4);',
      '    return choose(k.value);',
      '}',
      '',
    ].join('\n');
    const result = check('first-declarations', source);
    expect(result.diagnostics).toEqual([
      diagnostic(source, 'Keep', "duplicate struct 'Keep'", 1),
      diagnostic(source, 'Choice', "duplicate enum 'Choice'", 1),
      diagnostic(source, 'Box', "duplicate enum 'Box'", 1),
      diagnostic(source, 'choose', "duplicate function 'choose'", 1),
    ]);
    expect(result.typed.slice(0, result.typed.indexOf('fn choose'))).toBe([
      'struct Keep', '  field value int',
      'enum Choice', '  variant First int', '  variant Last',
      'enum Box[int]', '  variant Value int', '  variant Empty', '',
    ].join('\n'));
    expect(result.typed.split('\n').filter((line) => line.startsWith('fn '))).toEqual(['fn choose int', 'fn main int']);
    expect(declarations(result.typed)).toEqual([
      'local 0 n int param', 'local 0 k Keep let', 'local 1 c Choice let', 'local 2 b Box[int] let',
    ]);
    expect(result.typed).toContain('call choose : int');
  });

  it('uses the latest repeated parameter and local while retaining every allocated local ID', () => {
    const source = [
      'fn repeated(x: int, x: string): string {',
      '    let y: int = 1;',
      '    let y: bool = true;',
      '    var y: string = "new";',
      '    y = "last";',
      '    return x + y;',
      '}',
      'fn main(): int { return 0; }',
      '',
    ].join('\n');
    const result = check('latest-locals', source);
    expect(result.diagnostics).toEqual([
      diagnostic(source, 'x', "'x' is already declared in this scope", 1),
      diagnostic(source, 'y', "'y' is already declared in this scope", 1),
      diagnostic(source, 'y', "'y' is already declared in this scope", 2),
    ]);
    expect(declarations(result.typed)).toEqual([
      'local 0 x int param', 'local 1 x string param', 'local 2 y int let', 'local 3 y bool let', 'local 4 y string var',
    ]);
    expect(lookups(result.typed)).toEqual(['place-local 4 y : string', 'local 1 x : string', 'local 4 y : string']);
  });

  it('restores outer bindings after blocks, if-let arms and loops', () => {
    const source = [
      'fn main(): int {',
      '    var x: int = 10;',
      '    { let x: string = "inner"; print(x); }',
      '    print(x);',
      '    let o: Option[bool] = Option::Some(true);',
      '    if let Option::Some(x) = o { print(x); } else { print(x); }',
      '    for x in 0..2 { print(x); }',
      '    x += 1;',
      '    return x;',
      '}',
      '',
    ].join('\n');
    const result = check('scope-restoration', source);
    expect(result.diagnostics).toEqual([]);
    expect(declarations(result.typed)).toEqual([
      'local 0 x int var', 'local 1 x string let', 'local 2 o Option[bool] let', 'local 3 x bool let', 'local 4 x int let',
    ]);
    expect(lookups(result.typed)).toEqual([
      'local 1 x : string', 'local 0 x : int', 'local 2 o : Option[bool]', 'binders 3',
      'local 3 x : bool', 'local 0 x : int', 'local 4 x : int', 'place-local 0 x : int', 'local 0 x : int',
    ]);
  });

  it('keeps let-else binder IDs, hides them from else, and restores their enclosing scope', () => {
    const source = [
      'fn unwrap(o: Option[int]): int {',
      '    let value: string = "outer";',
      '    {',
      '        let Option::Some(value) = o else {',
      '            let copy: string = value;',
      '            panic(copy);',
      '        };',
      '        print(value);',
      '    }',
      '    print(value);',
      '    return 0;',
      '}',
      'fn main(): int { return 0; }',
      '',
    ].join('\n');
    const result = check('let-else-scopes', source);
    expect(result.diagnostics).toEqual([]);
    expect(declarations(result.typed)).toEqual([
      'local 0 o Option[int] param', 'local 1 value string let', 'local 2 value int let', 'local 3 copy string let',
    ]);
    expect(lookups(result.typed)).toEqual([
      'local 0 o : Option[int]', 'binders 2', 'local 1 value : string', 'local 3 copy : string',
      'local 2 value : int', 'local 1 value : string',
    ]);
  });

  it('reuses let-else locals during duplicate-name recovery without allocating duplicate binders', () => {
    const source = [
      'enum Pair { Both(int, string), Empty }',
      'fn conflict(o: Option[string]): string {',
      '    let value: int = 7;',
      '    let Option::Some(value) = o else { return ""; };',
      '    return value;',
      '}',
      'fn duplicate(p: Pair): int {',
      '    let Pair::Both(x, x) = p else { return 0; };',
      '    return x;',
      '}',
      'fn main(): int { return 0; }',
      '',
    ].join('\n');
    const result = check('let-else-duplicates', source);
    expect(result.diagnostics).toEqual([
      diagnostic(source, 'value', "'value' is already declared in this scope", 1),
      diagnostic(source, 'x', "duplicate binding 'x'", 1),
    ]);
    expect(declarations(result.typed)).toEqual([
      'local 0 o Option[string] param', 'local 1 value int let', 'local 2 value string let',
      'local 0 p Pair param', 'local 1 x int let',
    ]);
    expect(lookups(result.typed)).toEqual([
      'local 0 o : Option[string]', 'binders 2', 'local 2 value : string', 'local 0 p : Pair', 'binders 1 _', 'local 1 x : int',
    ]);
  });
});

describe('generic expansion and pattern sets', () => {
  it('reports only the expanding strongly connected component, in declaration order', () => {
    const source = [
      'enum Right[T] { Next(Left[[T]]) }',
      'enum Feeder[T] { Next(Left[T]) }',
      'enum Left[T] { Next(Right[T]) }',
      'enum Flat[T] { Next(Flat[T]), Item(T) }',
      'fn main(): int { return 0; }',
      '',
    ].join('\n');
    expect(check('expanding-scc', source).diagnostics).toEqual([
      diagnostic(source, 'Right', "generic enum 'Right' expands infinitely"),
      diagnostic(source, 'Left', "generic enum 'Left' expands infinitely", 2),
    ]);
  });

  it('accepts acyclic expansion and reuses recursive and repeated generic instantiations', () => {
    const source = [
      'enum Leaf[T] { Value(T) }',
      'enum Forward[T] { Value(Leaf[[T]]) }',
      'enum List[T] { Cons(T, List[T]), Nil }',
      'fn use(a: Forward[int], b: Forward[int], c: List[int]): int { return 0; }',
      'fn main(): int { return 0; }',
      '',
    ].join('\n');
    const result = check('finite-generics', source);
    expect(result.diagnostics).toEqual([]);
    expect(result.typed.split('\n').filter((line) => line.startsWith('enum '))).toEqual([
      'enum Forward[int]', 'enum Leaf[[int]]', 'enum List[int]',
    ]);
    expect(result.typed).toContain('  variant Cons int List[int]\n');
  });

  it('does not mistake a shadowed template name for an expanding graph edge', () => {
    const source = [
      'enum Target[T] { Value(Shadow[T]) }',
      'enum Shadow[Target] { Value(Target[[Target]]) }',
      'fn main(): int { return 0; }',
      '',
    ].join('\n');
    expect(check('shadowed-template', source).diagnostics).toEqual([
      diagnostic(source, 'Target', "type parameter 'Target' conflicts with a type of the same name", 1),
      diagnostic(source, 'Target[[Target]]', "'Target' is not generic"),
    ]);
  });

  it('preserves duplicate-alternative spans and declaration order for missing variants', () => {
    const source = [
      'enum Compass { West, North, East, South, Center }',
      'fn main(): int {',
      '    let c: Compass = Compass::West;',
      '    match c {',
      '        Compass::East | Compass::East | Compass::North => {}',
      '        Compass::North | Compass::East | Compass::Center | Compass::Center => {}',
      '        Compass::East | Compass::North => {}',
      '    }',
      '    return 0;',
      '}',
      '',
    ].join('\n');
    expect(check('pattern-order', source).diagnostics).toEqual([
      diagnostic(source, 'match', "non-exhaustive match: missing 'Compass::West', 'Compass::South'"),
      diagnostic(source, 'Compass::East', 'duplicate pattern alternative', 1),
      diagnostic(source, 'Compass::North', 'duplicate pattern alternative', 1),
      diagnostic(source, 'Compass::East', 'duplicate pattern alternative', 2),
      diagnostic(source, 'Compass::Center', 'duplicate pattern alternative', 1),
      diagnostic(source, 'Compass::East | Compass::North', 'unreachable match arm', 1),
    ]);
  });
});

describe('loader visited identities', () => {
  it('loads a normalized diamond and back-edge once, retaining depth-first file and declaration order', () => {
    const fixture = join(dir, 'diamond');
    mkdirSync(join(fixture, 'nested'), { recursive: true });
    const root = 'import "left.aster";\nimport "right.aster";\nfn main(): int { return left() + right(); }\n';
    const left = 'import "nested/../shared.aster";\nfn left(): int { return shared(); }\n';
    const shared = 'import "./root.aster";\nfn shared(): int { return 1; }\n';
    const right = 'import "./shared.aster";\nfn right(): int { return shared(); }\n';
    for (const [name, source] of Object.entries({ root, left, shared, right })) writeFileSync(join(fixture, `${name}.aster`), source);
    const result = inspect(join(fixture, 'root.aster'));
    expect(result.diagnostics).toEqual([]);
    expect(result.rootEnd).toBe(Buffer.byteLength(root));
    expect(result.files).toEqual([
      { path: join(fixture, 'root.aster'), base: 0, bom: 0 },
      { path: join(fixture, 'left.aster'), base: root.length + 1, bom: 0 },
      { path: `${fixture}/nested/../shared.aster`, base: root.length + left.length + 2, bom: 0 },
      { path: `${fixture}/right.aster`, base: root.length + left.length + shared.length + 3, bom: 0 },
    ]);
    expect(result.typed.split('\n').filter((line) => line.startsWith('fn '))).toEqual([
      'fn main int', 'fn left int', 'fn shared int', 'fn right int',
    ]);
  });

  it('does not mark an unreadable or invalid-UTF-8 import as visited', () => {
    const fixture = join(dir, 'failed-imports');
    mkdirSync(fixture);
    writeFileSync(join(fixture, 'bad.aster'), Buffer.from([0xff]));
    const source = [
      'import "bad.aster";',
      'import "./bad.aster";',
      'import "missing.aster";',
      'import "./missing.aster";',
      'fn main(): int { return 0; }',
      '',
    ].join('\n');
    const root = join(fixture, 'root.aster');
    writeFileSync(root, source);
    const result = inspect(root, 'load');
    expect(result.files).toEqual([{ path: root, base: 0, bom: 0 }]);
    expect(result.diagnostics.slice(0, 2)).toEqual([
      diagnostic(source, '"bad.aster"', "cannot import 'bad.aster': invalid UTF-8 at line 1, byte 0"),
      diagnostic(source, '"./bad.aster"', "cannot import './bad.aster': invalid UTF-8 at line 1, byte 0"),
    ]);
    expect(result.diagnostics).toHaveLength(4);
    for (const [i, name] of ['missing.aster', './missing.aster'].entries()) {
      const actual = result.diagnostics[i + 2];
      expect(actual).toEqual(diagnostic(source, JSON.stringify(name), actual.message));
      expect(actual.message).toMatch(new RegExp(`^cannot import '${name.replaceAll('.', '\\.')}': .+`));
    }
  });
});

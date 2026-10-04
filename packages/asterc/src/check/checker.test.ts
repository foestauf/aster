import { describe, expect, it } from 'vitest';
import { formatShort, sortDiagnostics } from '../diagnostics/diagnostic.js';
import { makeSource, nextBase, sourceMapOf } from '../diagnostics/source.js';
import { lex } from '../lexer/lexer.js';
import { parse } from '../parser/parser.js';
import { INT, STRING, typeToString, type Type } from '../types/type.js';
import { check } from './checker.js';

const MAIN = 'fn main(): int { return 0; }\n';

function checkText(text: string) {
  const source = makeSource('t.aster', text);
  const lexed = lex(source);
  const parsed = parse(lexed.tokens);
  expect([...lexed.diagnostics, ...parsed.diagnostics]).toEqual([]);
  return { source, ...check(parsed.program) };
}

const msgs = (text: string) => checkText(text).diagnostics.map((d) => d.message);

/** Two files laid out as the loader would: the root at base 0, the import right after it. */
function checkFiles(rootText: string, libText: string) {
  const root = makeSource('main.aster', rootText);
  const lib = makeSource('lib.aster', libText, nextBase(root));
  const map = sourceMapOf([root, lib]);
  const programs = [root, lib].map((s) => parse(lex(s).tokens).program);
  const program = {
    functions: programs.flatMap((p) => p.functions),
    structs: programs.flatMap((p) => p.structs),
    enums: programs.flatMap((p) => p.enums),
    imports: programs.flatMap((p) => p.imports),
  };
  const { diagnostics } = check(program, { rootEnd: root.text.length });
  return sortDiagnostics(diagnostics).map((d) => formatShort(map, d));
}

/** Diagnostic messages for a whole program. */
const messages = (text: string) => checkText(text).diagnostics.map((d) => d.message);

/** Diagnostic messages for statements placed inside `main` (body starts on line 2, column 1). */
const inMain = (body: string) => messages(`fn main(): int {\n${body}\nreturn 0;\n}`);

describe('check: whole programs', () => {
  it('types character literals as int', () => {
    expect(inMain("let c: int = 'a';\nprint(c);")).toEqual([]);
    expect(inMain("let s: string = 'a';")).toEqual(['type mismatch: expected string, found int']);
  });

  it('accepts the example program', () => {
    expect(inMain('let x: int = 10;\nlet y: int = 20;\nprint(x + y);')).toEqual([]);
  });

  it('reports positions of diagnostics', () => {
    const { source, diagnostics } = checkText('fn main(): int {\nlet x: int = "s";\nreturn 0;\n}');
    expect(diagnostics.map((d) => formatShort(source, d))).toEqual(['2:14 type mismatch: expected int, found string']);
  });

  it('reports a missing main for an empty program', () => {
    const { source, diagnostics } = checkText('// nothing here\n');
    expect(diagnostics.map((d) => formatShort(source, d))).toEqual(["1:1 missing 'fn main(): int'"]);
  });

  it('requires main to be declared in the root file', () => {
    expect(checkFiles(MAIN, 'fn main(): int { return 1; }\n')).toEqual([
      "lib.aster:1:4 'main' must be declared in the root file",
    ]);
    // A misplaced main is ignored, so the root still misses one (and a bad signature is not reported for it).
    expect(checkFiles('fn f() { }\n', 'fn main() { }\n')).toEqual([
      "1:1 missing 'fn main(): int'",
      "lib.aster:1:4 'main' must be declared in the root file",
    ]);
    expect(checkFiles(MAIN, 'fn f() { }\n')).toEqual([]);
  });

  it('reports type collisions across files at the declaration later in load order', () => {
    expect(checkFiles(`enum S { A }\n${MAIN}`, 'struct S { x: int }\n')).toEqual([
      "lib.aster:1:8 'S' is already declared as an enum",
    ]);
    expect(checkFiles(`${MAIN}struct S { x: int }\n`, 'struct S { y: int }\n')).toEqual(["lib.aster:1:8 duplicate struct 'S'"]);
  });

  it('checks the signature of main', () => {
    const bad = "'main' must have signature 'fn main(): int' or 'fn main(args: [string]): int'";
    expect(messages('fn main(args: [string]): int { return 0; }')).toEqual([]);
    expect(messages('fn main(argv: [string]): int { return 0; }')).toEqual([]);
    expect(messages('fn main() { }')).toEqual([bad]);
    expect(messages('fn main(a: int): int { return 0; }')).toEqual([bad]);
    expect(messages('fn main(args: [int]): int { return 0; }')).toEqual([bad]);
    expect(messages('fn main(args: string): int { return 0; }')).toEqual([bad]);
    expect(messages('fn main(a: [string], b: int): int { return 0; }')).toEqual([bad]);
    expect(messages('fn main(args: [string]) { }')).toEqual([bad]);
  });

  it('rejects duplicate and builtin-named functions', () => {
    expect(messages(`${MAIN}fn f() { }\nfn f() { }`)).toEqual(["duplicate function 'f'"]);
    expect(messages(`${MAIN}fn print() { }`)).toEqual(["'print' is a builtin function and cannot be redefined"]);
  });

  it('allows calling functions declared later, including mutual recursion', () => {
    expect(
      messages(`${MAIN}fn even(n: int): bool { return if n == 0 { true } else { odd(n - 1) }; }\nfn odd(n: int): bool { return if n == 0 { false } else { even(n - 1) }; }`),
    ).toEqual([]);
  });

  it('rejects void parameters and unknown types', () => {
    expect(messages(`${MAIN}fn f(a: void) { }`)).toEqual(['parameter cannot have type void']);
    expect(inMain('let x: float = 1;')).toEqual(["unknown type 'float'"]);
    expect(inMain('let x: void = 1;')).toEqual(['variable cannot have type void']);
  });
});

describe('check: variables and scopes', () => {
  it('reports undefined names', () => {
    expect(inMain('print(y);')).toEqual(["undefined name 'y'"]);
    expect(inMain('y = 1;')).toEqual(["undefined name 'y'"]);
  });

  it('only allows assignment to var', () => {
    expect(inMain('let x: int = 1;\nx = 2;')).toEqual(["cannot assign to immutable variable 'x'"]);
    expect(inMain('var x: int = 1;\nx = 2;')).toEqual([]);
    expect(inMain('var x: int = 1;\nx = "s";')).toEqual(['type mismatch: expected int, found string']);
    expect(messages(`${MAIN}fn f(a: int) { a = 1; }`)).toEqual(["cannot assign to immutable variable 'a'"]);
    expect(messages(`${MAIN}fn f() { f = 1; }`)).toEqual(["cannot assign to function 'f'"]);
  });

  it('rejects redeclaration in the same scope but allows shadowing', () => {
    expect(inMain('let x: int = 1;\nlet x: int = 2;')).toEqual(["'x' is already declared in this scope"]);
    expect(inMain('let x: int = 1;\n{ let x: string = "s"; print(x); }\nprint(x);')).toEqual([]);
    expect(messages(`${MAIN}fn f(a: int): int { let a: string = "s"; return 1; }`)).toEqual([]);
  });

  it('resolves an initializer before declaring its variable', () => {
    expect(inMain('let x: int = 1;\n{ let x: string = int_to_string(x); print(x); }')).toEqual([]);
  });

  it('distinguishes functions from values', () => {
    expect(messages(`${MAIN}fn f() { }\nfn g() { print(f); }`)).toEqual(["'f' is a function, not a value"]);
  });

  it('assigns unique local ids with params first', () => {
    const { program } = checkText(`${MAIN}fn f(a: int): int { let b: int = a; { let b: int = 2; } return b; }`);
    const f = program.functions[1];
    expect(f.params.map((l) => l.id)).toEqual([0]);
    expect(f.locals.map((l) => [l.id, l.name, typeToString(l.type), l.mutable])).toEqual([
      [0, 'a', 'int', false],
      [1, 'b', 'int', false],
      [2, 'b', 'int', false],
    ]);
  });
});

describe('check: expressions', () => {
  it('type-checks operators', () => {
    expect(inMain('"a" + "b";')).toEqual([]);
    expect(inMain('1 + "a";')).toEqual(["operator '+' cannot be applied to int and string"]);
    expect(inMain('"a" < "b";')).toEqual(["operator '<' cannot be applied to string and string"]);
    expect(inMain('true == 1;')).toEqual(["operator '==' cannot be applied to bool and int"]);
    expect(inMain('"a" == "b";')).toEqual([]);
    expect(inMain('1 && true;')).toEqual(["operator '&&' cannot be applied to int and bool"]);
    expect(inMain('-true;')).toEqual(["operator '-' cannot be applied to bool"]);
    expect(inMain('!1;')).toEqual(["operator '!' cannot be applied to int"]);
  });

  it('requires bool conditions', () => {
    expect(inMain('if 1 { }')).toEqual(['condition must be bool, found int']);
    expect(inMain('while "s" { }')).toEqual(['condition must be bool, found string']);
    expect(inMain('let x: int = if 0 { 1 } else { 2 };')).toEqual(['condition must be bool, found int']);
  });

  it('type-checks if expressions', () => {
    expect(inMain('let x: int = if true { 1 } else { 2 };')).toEqual([]);
    expect(inMain('let x: int = if true { 1 } else { "s" };')).toEqual(['if branches have different types: int and string']);
    expect(messages(`${MAIN}fn v() { }\nfn g() { let x: int = if true { v() } else { v() }; }`)).toEqual([
      'if expression cannot have type void',
    ]);
  });

  it('checks calls', () => {
    const add = 'fn add(a: int, b: int): int { return a + b; }\n';
    expect(messages(`${MAIN}${add}fn g() { add(1); }`)).toEqual(["function 'add' expects 2 arguments, found 1"]);
    expect(messages(`${MAIN}${add}fn g() { add(1, "x"); }`)).toEqual(['type mismatch: expected int, found string']);
    expect(inMain('nope();')).toEqual(["undefined function 'nope'"]);
    expect(inMain('let f: int = 1;\nf();')).toEqual(["'f' is not a function"]);
    expect(inMain('(1)(2);')).toEqual(['only named functions can be called']);
  });

  it('checks builtins', () => {
    expect(inMain('print(1);\nprint(true);\nprint("s");')).toEqual([]);
    expect(inMain('let n: int = len("abc") + byte_at("a", 0);\nlet s: string = substring("abc", 0, 1) + int_to_string(5);')).toEqual([]);
    expect(inMain('len(1);')).toEqual(["function 'len' expects a string or array, found int"]);
    expect(inMain('print(1, 2);')).toEqual(["function 'print' expects 1 argument, found 2"]);
    expect(inMain('substring("a");')).toEqual(["function 'substring' expects 3 arguments, found 1"]);
    expect(messages(`${MAIN}fn v() { }\nfn g() { print(v()); }`)).toEqual(['cannot print a value of type void']);
  });

  it('does not cascade errors from an earlier mistake', () => {
    expect(inMain('let z: bool = (y + 1) * 2 < 3;')).toEqual(["undefined name 'y'"]);
    expect(inMain('let s: string = len(q);')).toEqual(["undefined name 'q'", 'type mismatch: expected string, found int']);
  });
});

describe('check: control flow', () => {
  it('rejects break and continue outside loops', () => {
    expect(inMain('break;')).toEqual(["'break' outside of loop"]);
    expect(inMain('continue;')).toEqual(["'continue' outside of loop"]);
    expect(inMain('while true { break; }')).toEqual([]);
  });

  it('checks return values', () => {
    expect(messages(`${MAIN}fn f() { return 1; }`)).toEqual(['void function cannot return a value']);
    expect(messages(`${MAIN}fn f(): int { return; }`)).toEqual(['missing return value: expected int']);
    expect(messages(`${MAIN}fn f(): int { return "s"; }`)).toEqual(['type mismatch: expected int, found string']);
    expect(messages(`${MAIN}fn f() { return; }`)).toEqual([]);
  });

  it('requires a return on every path of a non-void function', () => {
    const missing = ["function 'f' is missing a return on some paths"];
    expect(messages(`${MAIN}fn f(): int { }`)).toEqual(missing);
    expect(messages(`${MAIN}fn f(x: bool): int { if x { return 1; } }`)).toEqual(missing);
    expect(messages(`${MAIN}fn f(x: bool): int { while x { return 1; } }`)).toEqual(missing);
    expect(messages(`${MAIN}fn f(): int { while true { break; } }`)).toEqual(missing);
    expect(messages(`${MAIN}fn f(x: bool): int { if x { return 1; } else { return 2; } }`)).toEqual([]);
    expect(messages(`${MAIN}fn f(x: bool): int { if x { return 1; } else if !x { return 2; } else { return 3; } }`)).toEqual([]);
    expect(messages(`${MAIN}fn f(): int { while true { } }`)).toEqual([]);
    expect(messages(`${MAIN}fn f(): int { while true { while true { break; } } }`)).toEqual([]);
    expect(messages(`${MAIN}fn f(): int { { return 1; } }`)).toEqual([]);
    expect(messages(`${MAIN}fn f(): int { panic("no"); }`)).toEqual([]);
    expect(messages(`${MAIN}fn f(): int { exit(1); }`)).toEqual([]);
    expect(messages(`${MAIN}fn f(x: int): int { match x { 1 => exit(1), _ => exit(2), } }`)).toEqual([]);
  });

  it('treats for loops as possibly running zero times', () => {
    expect(messages(`${MAIN}fn f(): int { for i in 0..1 { return i; } }`)).toEqual([
      "function 'f' is missing a return on some paths",
    ]);
  });

  it('scopes the loop variable to the loop and allows break/continue inside it', () => {
    expect(inMain('for i in 0..2 { continue; }\nprint(i);')).toEqual(["undefined name 'i'"]);
    expect(inMain('for x in [1, 2] { if x == 2 { break; } }')).toEqual([]);
  });
});

describe('check: structs', () => {
  it('records struct field types in declaration order', () => {
    const { program } = checkText(`${MAIN}struct P { x: int, s: string, q: Q }\nstruct Q { }`);
    expect(program.structs.map((s) => [s.name, s.fields.map((f) => `${f.name}: ${typeToString(f.type)}`)])).toEqual([
      ['P', ['x: int', 's: string', 'q: Q']],
      ['Q', []],
    ]);
  });

  it('keeps struct names apart from local variable names', () => {
    expect(messages(`${MAIN}struct P { x: int }\nfn f() { let P: P = P { x: 1 }; print(P.x); }`)).toEqual([]);
  });

  it('does not cascade from an unknown struct or field', () => {
    expect(inMain('let n: int = nope.x + 1;')).toEqual(["undefined name 'nope'"]);
    expect(inMain('let n: int = Nope { a: 1 }.b;')).toEqual(["unknown struct 'Nope'"]);
  });

  it('reports only the unknown-struct diagnostic when the literal names no struct', () => {
    expect(inMain('Nope { a: 1, b: "s" };')).toEqual(["unknown struct 'Nope'"]);
  });
  it('allows writes through the fields of any binding', () => {
    expect(messages(`${MAIN}struct P { x: int }\nfn f(p: P) { p.x = 1; p.x += 2; }`)).toEqual([]);
  });

  it('type-checks compound assignment like its binary operator', () => {
    expect(inMain('var s: string = "a";\ns += "b";\nvar n: int = 1;\nn %= 2;')).toEqual([]);
    expect(inMain('var b: bool = true;\nb += true;')).toEqual(["operator '+=' cannot be applied to bool and bool"]);
    expect(inMain('let n: int = 1;\nn += 1;')).toEqual(["cannot assign to immutable variable 'n'"]);
  });
});

describe('check: arrays', () => {
  it('infers empty array literals from the expected type', () => {
    expect(inMain('let a: [[int]] = [[], [1]];\nlet b: [[int]] = [[]];\npush(b, []);')).toEqual([]);
    expect(inMain('let a: [int] = if true { [] } else { [] };')).toEqual([]);
    expect(inMain('[];')).toEqual(['cannot infer type of empty array']);
    expect(inMain('[[]];')).toEqual(['cannot infer type of empty array']);
  });

  it('allows writes through elements of any binding', () => {
    expect(inMain('let a: [int] = [1];\na[0] = 2;\na[0] += 1;\npush(a, 3);')).toEqual([]);
  });

  it('does not cascade from bad arrays or bad element types', () => {
    expect(inMain('let n: int = nope[0] + 1;')).toEqual(["undefined name 'nope'"]);
    expect(inMain('let a: [Nope] = [];\nprint(len(a));')).toEqual(["unknown type 'Nope'"]);
    expect(inMain('let x: int = pop(nope) + 1;')).toEqual(["undefined name 'nope'"]);
  });

  it('rejects array literals passed to print', () => {
    expect(inMain('print([1]);')).toEqual(['cannot print a value of type [int]']);
    expect(inMain('print([]);')).toEqual(['cannot infer type of empty array']);
    expect(inMain('print(if true { [1] } else { [2] });')).toEqual(['cannot print a value of type [int]']);
  });

  it('does not report an uninferable empty array when the expected type is already an error', () => {
    expect(inMain('push(nope, []);')).toEqual(["undefined name 'nope'"]);
    expect(inMain('Nope { a: [] };')).toEqual(["unknown struct 'Nope'"]);
  });

  it('reports one diagnostic where an empty array would otherwise cascade', () => {
    expect(inMain('let x: Foo = [[]];')).toEqual(["unknown type 'Foo'"]);
    expect(messages(`${MAIN}struct P { x: int }\nfn f() { P { x: 1, y: [] }; }`)).toEqual(["unknown field 'y' on 'P'"]);
    expect(inMain('print([], 1);')).toEqual(["function 'print' expects 1 argument, found 2"]);
    expect(messages(`${MAIN}fn f() { return []; }`)).toEqual(['void function cannot return a value']);
  });
});

describe('check: enums', () => {
  it('records variants with tags and payload types, and whether the enum is payload-free', () => {
    const { program, diagnostics } = checkText(`${MAIN}enum E { A, B(int, [E]) }\nenum K { X, Y }`);
    expect(diagnostics).toEqual([]);
    expect(
      program.enums.map((e) => [e.name, e.payloadFree, e.variants.map((v) => `${v.tag}:${v.name}(${v.payload.map(typeToString).join(', ')})`)]),
    ).toEqual([
      ['E', false, ['0:A()', '1:B(int, [E])']],
      ['K', true, ['0:X()', '1:Y()']],
    ]);
  });

  it('lets structs and enums refer to each other in any order', () => {
    expect(messages(`${MAIN}struct Node { next: Opt }\nenum Opt { None, Some(Node) }`)).toEqual([]);
  });

  it('keeps enum names apart from local variable names', () => {
    expect(messages('enum K { X }\nfn main(): int {\nlet K: int = 1;\nlet k: K = K::X;\nreturn K;\n}')).toEqual([]);
  });

  it('infers [] from a payload slot', () => {
    expect(messages(`enum E { A([int]) }\n${MAIN}fn f(): E { return E::A([]); }`)).toEqual([]);
  });

  it('compares payload-free enums only', () => {
    const text = `enum K { X, Y }\nenum E { A, B(int) }\n${MAIN}fn f(k: K): bool { return k == K::X && k != K::Y; }\nfn g(e: E): bool { return e == E::A; }`;
    expect(messages(text)).toEqual(["cannot compare 'E' values"]);
  });

  it('does not cascade from an unknown enum or variant', () => {
    expect(inMain('let x: int = Nope::A([]) + 1;')).toEqual(["unknown enum 'Nope'"]);
    expect(messages('enum E { A }\nfn main(): int { let e: E = E::Z(1); return 0; }')).toEqual(["unknown variant 'Z' on 'E'"]);
  });
});

describe('check: match', () => {
  const ENUMS = 'enum E { A, B(int), C(int, string) }\nenum F { X }\n';
  /** Diagnostics for statements inside `fn f(e: E): int`. */
  const inFn = (body: string) => messages(`${ENUMS}${MAIN}fn f(e: E): int {\n${body}\nreturn 0;\n}`);

  /** Diagnostics for `fn g(e: E): int` whose body is just a match with the given arms. */
  const fn = (arms: string) => messages(`${ENUMS}${MAIN}fn g(e: E): int {\nmatch e { ${arms} }\n}`);

  it('accepts exhaustive matches with binders and wildcards', () => {
    expect(inFn('match e { E::A => {} E::B(n) => print(n), E::C(n, s) => print(s) }')).toEqual([]);
    expect(inFn('match e { E::B(_) => {} _ => {} }')).toEqual([]);
    expect(inFn('let n: int = match e { E::B(n) => n, _ => 0 };')).toEqual([]);
  });

  it('reports missing variants in declaration order', () => {
    expect(inFn('match e { E::B(_) => {} }')).toEqual(["non-exhaustive match: missing 'E::A', 'E::C'"]);
  });

  it('reports unreachable arms', () => {
    expect(inFn('match e { _ => {} E::A => {} }')).toEqual(['unreachable match arm']);
    expect(inFn('match e { E::A => {} E::A => {} _ => {} }')).toEqual(['unreachable match arm']);
    expect(inFn('match e { E::A => {} E::B(_) => {} E::C(_, _) => {} _ => {} }')).toEqual(['unreachable match arm']);
    expect(inFn('match e { _ => {} _ => {} }')).toEqual(['unreachable match arm']);
  });

  it('checks patterns against the scrutinee enum', () => {
    expect(inFn('match e { F::X => {} _ => {} }')).toEqual(["pattern type 'F' does not match 'E'"]);
    expect(inFn('match e { E::B(x, y) => {} _ => {} }')).toEqual(["variant 'E::B' expects 1 value, got 2"]);
    expect(inFn('match e { E::C(x, x) => {} _ => {} }')).toEqual(["duplicate binding 'x'"]);
    expect(inFn('match [1] { _ => {} }')).toEqual(["cannot match on '[int]' values"]);
  });

  it('does not cascade from a bad scrutinee or pattern', () => {
    expect(inFn('match nope { E::Zzz => {} }')).toEqual(["undefined name 'nope'"]);
    expect(inFn('match e { E::Q => {} }')).toEqual(["unknown variant 'Q' on 'E'"]);
    expect(inFn('match e { F::X => {} }')).toEqual(["pattern type 'F' does not match 'E'"]);
    expect(inFn('match e { E::B(x, y) => {} E::A => {} E::C(_, _) => {} }')).toEqual(["variant 'E::B' expects 1 value, got 2"]);
    expect(inFn('match [1] { E::A(x) => print(x + "s"), }')).toEqual(["cannot match on '[int]' values"]);
  });

  it('types match expressions from their arms', () => {
    expect(inFn('let s: string = match e { E::A => 1, _ => "x" };')).toEqual(['match arms have different types: int and string']);
    expect(inFn('let v: int = match e { _ => print(1) };')).toEqual(['match expression cannot have type void']);
    expect(inFn('let a: [int] = match e { E::A => [], _ => [1] };')).toEqual([]);
  });

  it('treats a match statement as terminating when every arm does', () => {
    expect(fn('E::A => { return 1; } _ => { return 2; }')).toEqual([]);
    expect(fn('E::A => { return 1; } _ => panic("no"),')).toEqual([]);
    expect(fn('E::A => { return 1; } _ => {}')).toEqual(["function 'g' is missing a return on some paths"]);
  });

  it('scopes binders to their arm', () => {
    expect(inFn('match e { E::B(n) => {} _ => {} }\nprint(n);')).toEqual(["undefined name 'n'"]);
  });
});

/** The typed patterns of the match that is `main`'s first statement. */
function armPatterns(text: string) {
  const main = checkText(text).program.functions.find((f) => f.name === 'main');
  const stmt = main?.body.statements[0];
  if (stmt?.kind !== 'match') throw new Error('expected a match statement');
  return stmt.arms.map((a) => a.pattern);
}

describe('check: literal matches', () => {
  const ENUMS = 'enum E { A, B(int), C(int, string) }\n';
  /** Diagnostics for statements inside `main`, with the enum `E` declared and `e: E` in scope. */
  const withEnum = (body: string) => messages(`${ENUMS}fn main(): int {\nlet e: E = E::A;\n${body}\nreturn 0;\n}`);

  it('accepts int, char, string and bool matches', () => {
    expect(inMain('match 1 { 1 => {} -2 => {} _ => {} }')).toEqual([]);
    expect(inMain("let c: int = 97;\nmatch c { 'a' | 'b' => {} '\\n' => {} _ => {} }")).toEqual([]);
    expect(inMain('match "s" { "a" => {} "" => {} _ => {} }')).toEqual([]);
    expect(inMain('match true { true => {} false => {} }')).toEqual([]);
    expect(inMain('let n: int = match "s" { "a" | "b" => 1, _ => 2 };\nprint(n);')).toEqual([]);
  });

  it('accepts an enum or-pattern covering every variant', () => {
    expect(withEnum('match e { E::A | E::B(_) => {} E::C(_, _) => {} }')).toEqual([]);
  });

  it('treats a literal match statement as terminating when every arm does', () => {
    expect(messages(`${MAIN}fn f(x: int): int { match x { 1 => { return 1; } _ => panic("x"), } }`)).toEqual([]);
    expect(messages(`${MAIN}fn f(x: int): int { match x { 1 => { return 1; } _ => {} } }`)).toEqual([
      "function 'f' is missing a return on some paths",
    ]);
  });

  it('checks each alternative against the scrutinee type', () => {
    expect(inMain('let n: int = match 1 { "a" => 0, _ => 1 };')).toEqual(["pattern type 'string' does not match 'int'"]);
    expect(inMain('let n: int = match "s" { 1 => 0, _ => 1 };')).toEqual(["pattern type 'int' does not match 'string'"]);
    expect(inMain("let n: int = match \"s\" { 'a' => 0, _ => 1 };")).toEqual(["pattern type 'int' does not match 'string'"]);
    expect(inMain('let n: int = match true { 1 => 0, _ => 1 };')).toEqual(["pattern type 'int' does not match 'bool'"]);
    expect(inMain('let n: int = match 1 { true => 0, _ => 1 };')).toEqual(["pattern type 'bool' does not match 'int'"]);
    expect(withEnum('match e { 1 => {} _ => {} }')).toEqual(["pattern type 'int' does not match 'E'"]);
    expect(withEnum('match 1 { E::A => {} _ => {} }')).toEqual(["pattern type 'E' does not match 'int'"]);
    expect(withEnum('match 1 { Nope::A => {} _ => {} }')).toEqual(["unknown enum 'Nope'"]);
  });

  it('does not report non-exhaustiveness after a mismatched alternative', () => {
    expect(inMain('match true { 1 => {} }')).toEqual(["pattern type 'int' does not match 'bool'"]);
    expect(inMain('match 1 { 1 | "a" => {} }')).toEqual(["pattern type 'string' does not match 'int'"]);
  });

  it('requires `_` for int and string matches and both values for bool', () => {
    expect(inMain('let n: int = match 1 { 1 => 0 };')).toEqual(["non-exhaustive match: add a '_' arm"]);
    expect(inMain('match "s" { "a" => {} }')).toEqual(["non-exhaustive match: add a '_' arm"]);
    expect(inMain('let n: int = match true { true => 0 };')).toEqual(["non-exhaustive match: missing 'false'"]);
    expect(inMain('let n: int = match true { false => 0 };')).toEqual(["non-exhaustive match: missing 'true'"]);
  });

  it('reports unreachable arms and duplicate alternatives', () => {
    expect(inMain('let n: int = match true { true | false => 0, _ => 1 };')).toEqual(['unreachable match arm']);
    expect(inMain('let n: int = match 1 { 1 => 0, 1 => 1, _ => 2 };')).toEqual(['unreachable match arm']);
    expect(inMain('let n: int = match 1 { 1 => 0, 1 | 2 => 1, _ => 2 };')).toEqual(['duplicate pattern alternative']);
    expect(inMain('let n: int = match 1 { 1 | 1 => 0, _ => 1 };')).toEqual(['duplicate pattern alternative']);
    expect(inMain("let n: int = match 1 { 'a' => 0, 97 => 1, _ => 2 };")).toEqual(['unreachable match arm']);
    expect(inMain('let n: int = match "s" { "a" => 0, "a" => 1, _ => 2 };')).toEqual(['unreachable match arm']);
    expect(inMain('let n: int = match 1 { _ => 0, 1 => 1 };')).toEqual(['unreachable match arm']);
    expect(withEnum('match e { E::A => {} E::A | E::B(_) => {} _ => {} }')).toEqual(['duplicate pattern alternative']);
    expect(withEnum('match e { E::A | E::B(_) => {} E::C(_, _) => {} _ => {} }')).toEqual(['unreachable match arm']);
  });

  it('reports the duplicate alternative on its own span', () => {
    const { source, diagnostics } = checkText('fn main(): int {\nlet n: int = match 1 { 1 => 0, 1 | 2 => 1, _ => 2 };\nreturn 0;\n}');
    expect(diagnostics.map((d) => formatShort(source, d))).toEqual(['2:32 duplicate pattern alternative']);
  });

  it('forbids named binders in or-patterns', () => {
    expect(withEnum('match e { E::B(x) | E::A => {} _ => {} }')).toEqual(['or-pattern alternatives cannot bind names']);
    expect(withEnum('match e { E::B(_) | E::C(_, s) => {} _ => {} }')).toEqual(['or-pattern alternatives cannot bind names']);
  });

  it('still rejects other scrutinee types', () => {
    expect(inMain('let n: int = match [1] { _ => 0 };')).toEqual(["cannot match on '[int]' values"]);
  });

  it('builds typed patterns', () => {
    expect(armPatterns("fn main(): int {\nmatch 1 { 1 | 'a' => {} _ => {} }\nreturn 0;\n}")).toEqual([
      { kind: 'ints', values: [1n, 97n] },
      { kind: 'wildcard' },
    ]);
    expect(armPatterns('fn main(): int {\nmatch true { false => {} true => {} }\nreturn 0;\n}')).toEqual([
      { kind: 'ints', values: [0n] },
      { kind: 'ints', values: [1n] },
    ]);
    expect(armPatterns('fn main(): int {\nmatch "s" { "a" | "" => {} _ => {} }\nreturn 0;\n}')).toEqual([
      { kind: 'strings', values: ['a', ''] },
      { kind: 'wildcard' },
    ]);
    expect(armPatterns(`${ENUMS}fn main(): int {\nmatch E::A { E::A | E::C(_, _) => {} _ => {} }\nreturn 0;\n}`)).toEqual([
      { kind: 'variants', variants: [{ name: 'A', tag: 0 }, { name: 'C', tag: 2 }], binders: [] },
      { kind: 'wildcard' },
    ]);
  });
});

describe('check: read_file', () => {
  it('returns Result[string, string], instantiated on first use', () => {
    const { program } = checkText('fn main(): int { let r: Result[string, string] = read_file("x"); return 0; }');
    expect(program.enums.map((e) => e.name)).toEqual(['Result[string, string]']);
    expect(checkText(MAIN).program.enums).toEqual([]);
  });

  it('leaves ReadResult as an ordinary free name', () => {
    expect(messages(`${MAIN}enum ReadResult { A }`)).toEqual([]);
    expect(messages(`${MAIN}struct ReadResult { }`)).toEqual([]);
  });
});

const mainBody = (body: string): string[] => messages(`fn main(): int { ${body} return 0; }`);
const declared = (n: string): string[] => messages(`fn ${n}() { } fn main(): int { return 0; }`);

describe('eprint and exit', () => {
  const main = mainBody;
  it('accepts eprint of int, bool and string', () => {
    expect(main('eprint(1); eprint(true); eprint("s");')).toEqual([]);
  });
  it('rejects bad eprint and exit calls', () => {
    expect(main('eprint([1]);')).toEqual(['cannot print a value of type [int]']);
    expect(main('eprint();')).toEqual(["function 'eprint' expects 1 argument, found 0"]);
    expect(main('exit("x");')).toEqual(['type mismatch: expected int, found string']);
    expect(main('exit();')).toEqual(["function 'exit' expects 1 argument, found 0"]);
  });
  it('cannot be redefined', () => {
    const m = declared;
    expect(m('eprint')).toEqual(["'eprint' is a builtin function and cannot be redefined"]);
    expect(m('exit')).toEqual(["'exit' is a builtin function and cannot be redefined"]);
  });
});

const conflict = (n: string) => `type parameter '${n}' conflicts with a type of the same name`;

describe('generic enums', () => {
  const LIST = 'enum List[T] { Cons(T, List[T]), Nil }\n';

  it('instantiates a recursive generic enum once, by its type string', () => {
    const { program, diagnostics } = checkText(`${LIST}fn f(x: List[int]) {}\n${MAIN}`);
    expect(diagnostics).toEqual([]);
    const listInt: Type = { kind: 'enum', name: 'List[int]', generic: { base: 'List', args: [INT] } };
    expect(program.enums).toEqual([
      {
        name: 'List[int]',
        payloadFree: false,
        variants: [
          { name: 'Cons', tag: 0, payload: [INT, listInt] },
          { name: 'Nil', tag: 1, payload: [] },
        ],
      },
    ]);
  });

  it('produces no enum for an unused template or the instantiations inside it', () => {
    const { program, diagnostics } = checkText(`${LIST}enum W[T] { A(T, Option[int]) }\n${MAIN}`);
    expect(diagnostics).toEqual([]);
    expect(program.enums).toEqual([]);
  });

  it('lists non-generic enums first, then instantiations in first-use order', () => {
    const { program } = checkText(`enum E { A }\nfn f(x: Option[bool], y: List[int]) {}\n${LIST}enum F { B(Result[int, string]) }\n${MAIN}`);
    expect(program.enums.map((e) => e.name)).toEqual(['E', 'F', 'Result[int, string]', 'Option[bool]', 'List[int]']);
  });

  it('reports errors in a generic enum once, however often it is instantiated', () => {
    const { diagnostics } = checkText(`enum B[T] { A(T, Nope) }\nfn f(a: B[int], b: B[bool], c: B[int]) {}\n${MAIN}`);
    expect(diagnostics.map((d) => d.message)).toEqual(["unknown type 'Nope'"]);
  });

  it('types nested instantiations and type parameters bound to arrays', () => {
    const { program, diagnostics } = checkText(`fn f(x: Option[Option[[int]]]) {}\n${MAIN}`);
    expect(diagnostics).toEqual([]);
    expect(program.enums.map((e) => e.name)).toEqual(['Option[[int]]', 'Option[Option[[int]]]']);
    expect(program.functions[0].params[0].type).toEqual({
      kind: 'enum',
      name: 'Option[Option[[int]]]',
      generic: { base: 'Option', args: [{ kind: 'enum', name: 'Option[[int]]', generic: { base: 'Option', args: [{ kind: 'array', elem: INT }] } }] },
    });
  });

  it('rejects type parameters that clash with builtin functions and templates', () => {
    expect(messages(`enum E[len] { A(len) }\n${MAIN}`)).toEqual([conflict('len')]);
    expect(messages(`${LIST}enum E[List] { A(List) }\n${MAIN}`)).toEqual([conflict('List')]);
    expect(messages(`enum E[Result] { A(Result) }\n${MAIN}`)).toEqual([conflict('Result')]);
  });

  it('shares the type namespace between templates, structs, enums and functions', () => {
    expect(messages(`enum G[T] { A(T) }\nstruct G { x: int }\n${MAIN}`)).toEqual(["'G' is already declared as an enum"]);
    expect(messages(`enum G[T] { A(T) }\nfn G() {}\n${MAIN}`)).toEqual(["'G' is already declared as an enum"]);
    expect(messages(`enum G[T] { A(T) }\nenum G[U] { B(U) }\n${MAIN}`)).toEqual(["duplicate enum 'G'"]);
    expect(messages(`struct Result { x: int }\n${MAIN}`)).toEqual(["'Result' is a builtin type and cannot be redefined"]);
  });

  it('reports expansion through a type argument nested in an array', () => {
    expect(messages(`enum N[T] { A([N[Option[T]]]), B(T) }\n${MAIN}`)).toEqual(["generic enum 'N' expands infinitely"]);
    expect(messages(`enum N[T, U] { A(N[U, T]), B(T, U) }\n${MAIN}`)).toEqual([]);
  });

  const optionInt: Type = { kind: 'enum', name: 'Option[int]', generic: { base: 'Option', args: [INT] } };

  it('types a variant expression by its instantiation, inferred from its values', () => {
    const { program, diagnostics } = checkText('fn main(): int {\nmatch Option::Some(1) { _ => {} }\nreturn 0;\n}');
    expect(diagnostics).toEqual([]);
    const stmt = program.functions[0].body.statements[0];
    expect(stmt.kind === 'match' ? stmt.scrutinee : null).toMatchObject({ kind: 'variant', type: optionInt, enum: 'Option[int]', variant: 'Some', tag: 0 });
  });

  it('infers type arguments from context before checking the values', () => {
    expect(inMain('let a: Option[[int]] = Option::Some([]);\nlet b: Result[int, string] = Result::Ok(1);')).toEqual([]);
    expect(inMain('let a: Option[int] = Option::Some(true);')).toEqual(['type mismatch: expected int, found bool']);
    expect(inMain('let a: int = Option::Some(1);')).toEqual(['type mismatch: expected int, found Option[int]']);
  });

  it('fixes a parameter from an earlier value and checks later values against it', () => {
    expect(messages(`enum Pair[T] { P(T, T) }\nfn main(): int {\nlet p: [Pair[int]] = [Pair::P(1, 2)];\nmatch Pair::P(1, true) { _ => {} }\nreturn 0;\n}`)).toEqual([
      'type mismatch: expected int, found bool',
    ]);
    expect(messages(`${LIST}fn main(): int {\nmatch List::Cons([1], List::Cons([], List::Nil)) { _ => {} }\nreturn 0;\n}`)).toEqual([]);
  });

  it('reports a parameter it cannot infer, unless something was already reported', () => {
    expect(inMain('match Option::None { _ => {} }')).toEqual(["cannot infer type arguments for 'Option'"]);
    expect(inMain('match Result::Err("e") { _ => {} }')).toEqual(["cannot infer type arguments for 'Result'"]);
    expect(inMain('match Option::Some(nope) { _ => {} }')).toEqual(["undefined name 'nope'"]);
    expect(inMain('let x: Nope = Option::None;')).toEqual(["unknown type 'Nope'"]);
    expect(inMain('let x: Option[int] = Option::Some(1, 2);')).toEqual(["variant 'Option::Some' expects 1 value, got 2"]);
    expect(inMain('let x: Option[int] = Option::Nope;')).toEqual(["unknown variant 'Nope' on 'Option'"]);
  });

  it('shares one instantiation between every mention of it', () => {
    const { program, diagnostics } = checkText(
      'struct H { o: Option[int] }\nfn f(o: Option[int]): Option[int] { return o; }\nfn main(): int {\nlet h: H = H { o: [Option::Some(1)][0] };\nlet b: Option[int] = f(h.o);\nreturn 0;\n}',
    );
    expect(diagnostics).toEqual([]);
    expect(program.enums.map((e) => e.name)).toEqual(['Option[int]']);
  });

  it('types binders by the scrutinee instantiation and checks patterns by base name', () => {
    const { program, diagnostics } = checkText('fn main(): int {\nlet o: Option[string] = Option::None;\nmatch o { Option::Some(s) => print(s), Option::None => {} }\nreturn 0;\n}');
    expect(diagnostics).toEqual([]);
    expect(program.functions[0].locals.find((l) => l.name === 's')?.type).toEqual(STRING);
    expect(inMain('let o: Option[int] = Option::None;\nmatch o { Result::Ok(_) => {}, _ => {} }')).toEqual(["pattern type 'Result' does not match 'Option[int]'"]);
    expect(inMain('let o: Option[int] = Option::None;\nmatch o { Option::Some(_) => {} }')).toEqual(["non-exhaustive match: missing 'Option::None'"]);
    expect(inMain('let o: Option[int] = Option::None;\nmatch o { Option::Nope => {}, _ => {} }')).toEqual(["unknown variant 'Nope' on 'Option'"]);
    expect(inMain('match 1 { Option::None => {}, _ => {} }')).toEqual(["pattern type 'Option' does not match 'int'"]);
  });

  it('types ? on Option and Result by the ok payload and records both failure variants', () => {
    const { program, diagnostics } = checkText(
      `fn f(r: Result[string, int]): Result[bool, int] {\nlet s: string = r?;\nreturn Result::Ok(true);\n}\n${MAIN}`,
    );
    expect(diagnostics).toEqual([]);
    const stmt = program.functions[0].body.statements[0];
    expect(stmt.kind === 'let' ? stmt.init : null).toMatchObject({
      kind: 'try', type: STRING, okVariant: 'Ok', okTag: 0, failVariant: 'Err', failTag: 1,
      returnEnum: 'Result[bool, int]', returnFailVariant: 'Err', returnFailTag: 1, failPayloadType: INT,
    });
    const opt = checkText(`fn g(o: Option[int]): Option[string] {\no?;\nreturn Option::None;\n}\n${MAIN}`);
    expect(opt.diagnostics).toEqual([]);
    const s2 = opt.program.functions[0].body.statements[0];
    expect(s2.kind === 'expr' ? s2.expr : null).toMatchObject({
      kind: 'try', type: INT, okVariant: 'Some', failVariant: 'None', returnEnum: 'Option[string]', returnFailVariant: 'None', returnFailTag: 1, failPayloadType: null,
    });
  });

  it('reports ? on a non-Option/Result, in the wrong kind of function, and with a different error type', () => {
    expect(messages(`fn f(x: int): Option[int] { return Option::Some(x?); }\n${MAIN}`)).toEqual(["'?' applies to Option or Result, not 'int'"]);
    expect(messages(`fn f(o: Option[int]) { o?; }\n${MAIN}`)).toEqual(["'?' needs the function to return an Option, but it returns 'void'"]);
    expect(inMain('let o: Option[int] = Option::None;\nlet x: int = o?;')).toEqual(["'?' needs the function to return an Option, but it returns 'int'"]);
    expect(messages(`fn f(r: Result[int, int]): Option[int] { return Option::Some(r?); }\n${MAIN}`)).toEqual([
      "'?' needs the function to return a Result, but it returns 'Option[int]'",
    ]);
    expect(messages(`fn f(r: Result[int, int]): Result[int, string] { return Result::Ok(r?); }\n${MAIN}`)).toEqual([
      "'?' error type 'int' does not match the function's error type 'string'",
    ]);
    expect(messages(`fn f(): Option[int] { return Option::Some(nope?); }\n${MAIN}`)).toEqual(["undefined name 'nope'"]);
  });

  it('does not let ? end a control path', () => {
    expect(messages(`fn f(o: Option[int]): Option[int] { o?; }\n${MAIN}`)).toEqual(["function 'f' is missing a return on some paths"]);
  });
});

describe('never', () => {
  it('lets panic and exit fit any expected type', () => {
    expect(
      msgs(`${MAIN}fn f(c: bool): int { let x: int = if c { 1 } else { panic("no") }; return x; }\nfn g(): string { return exit(1); }`),
    ).toEqual([]);
  });

  it('accepts user never functions that diverge', () => {
    expect(
      msgs(
        `${MAIN}fn die(m: string): never { eprint(m); exit(1); }\nfn f(): int { die("x"); }\nfn g(o: Option[int]): int { return match o { Option::Some(v) => v, Option::None => die("none") }; }`,
      ),
    ).toEqual([]);
  });

  it('rejects never functions that can reach their end or return', () => {
    expect(msgs(`${MAIN}fn a(): never { }\nfn b(): never { return; }\nfn c(): never { return 1; }`)).toEqual([
      "function 'a' returns 'never' but can reach its end",
      "cannot return from a function that returns 'never'",
      "cannot return from a function that returns 'never'",
    ]);
  });

  it('allows never only as a return type', () => {
    expect(
      msgs(`${MAIN}struct S { f: never }\nenum E { V(never) }\nfn f(p: never) { let x: [never] = []; let o: Option[never] = Option::None; }`),
    ).toEqual([
      "'never' is only allowed as a return type",
      "'never' is only allowed as a return type",
      "'never' is only allowed as a return type",
      "'never' is only allowed as a return type",
      "'never' is only allowed as a return type",
    ]);
  });

  it('rejects redefining never and a never main', () => {
    expect(msgs(`${MAIN}struct never { }`)).toEqual(["'never' is a built-in type and cannot be redefined"]);
    expect(msgs('fn main(): never { exit(0); }')).toEqual([
      "'main' must have signature 'fn main(): int' or 'fn main(args: [string]): int'",
    ]);
  });

  it('treats never as a wrong type where nothing is expected', () => {
    const m = msgs(`${MAIN}fn f() { let x: int = panic("a") + 1; print(panic("b")); }`);
    expect(m.length).toBe(2); // the existing operator and print messages, naming 'never'
    expect(m.every((s) => s.includes('never'))).toBe(true);
  });

  it('unifies if and match arms around never', () => {
    expect(msgs(`${MAIN}fn f(c: bool): never { let x: int = if c { panic("a") } else { panic("b") }; }`)).toEqual([]);
  });
});

describe('inferred never', () => {
  it('does not infer never as a type argument or an element type', () => {
    expect(msgs(`${MAIN}fn f() { Option::Some(panic("x")); }`)).toEqual(["cannot infer type arguments for 'Option'"]);
    expect(msgs(`${MAIN}fn f() { for x in [panic("a")] { } }`)).toEqual(['cannot infer type of empty array']);
    expect(msgs(`${MAIN}fn f() { print(len([exit(1)])); }`)).toEqual(['cannot infer type of empty array']);
  });

  it('lets a later element fix the type after a never element', () => {
    expect(msgs(`${MAIN}fn f() { let xs: [int] = [1, panic("x")]; let ys: [int] = [panic("a"), 2]; }`)).toEqual([]);
  });

  it('rejects never operands of == and !=', () => {
    const m = msgs(`${MAIN}fn f() { let b: bool = panic("a") == panic("b"); let c: bool = exit(1) != exit(2); }`);
    expect(m).toEqual([
      "operator '==' cannot be applied to never and never",
      "operator '!=' cannot be applied to never and never",
    ]);
  });
});

describe('let-else and if let', () => {

  it('binds let-else names after the statement', () => {
    expect(msgs(`${MAIN}fn f(o: Option[int]): int { let Option::Some(x) = o else { return 0; }; return x; }`)).toEqual([]);
  });

  it('requires the else block to diverge', () => {
    expect(msgs(`${MAIN}fn f(o: Option[int]): int { let Option::Some(x) = o else { print(1); }; return x; }`)).toEqual([
      "'else' block of 'let' must diverge",
    ]);
  });

  it('accepts break, continue, panic and never calls as divergence', () => {
    expect(msgs(`${MAIN}fn die(): never { exit(1); }\nfn f(xs: [Option[int]]): int { var t: int = 0; for o in xs { let Option::Some(a) = o else { continue; }; let Option::Some(b) = o else { break; }; let Option::Some(c) = o else { panic("p"); }; let Option::Some(d) = o else { die(); }; t += a + b + c + d; } return t; }`)).toEqual([]);
  });

  it('hides let-else binders from their else block and checks conflicts', () => {
    expect(msgs(`${MAIN}fn f(o: Option[int]): int { let Option::Some(x) = o else { return x; }; return x; }`)).toEqual([
      "undefined name 'x'",
    ]);
    expect(msgs(`${MAIN}fn f(o: Option[int]): int { let x: int = 1; let Option::Some(x) = o else { return 0; }; return x; }`)).toEqual([
      "'x' is already declared in this scope",
    ]);
  });

  it('scopes if-let binders to the then block', () => {
    expect(msgs(`${MAIN}fn f(o: Option[int]): int { if let Option::Some(x) = o { return x; } return x; }`)).toEqual([
      "undefined name 'x'",
    ]);
  });

  it('rejects irrefutable patterns', () => {
    expect(msgs(`${MAIN}enum W { V(int) }\nfn f(w: W, b: bool): int { let W::V(x) = w else { return 0; }; if let true | false = b { } return x; }`)).toEqual([
      'pattern always matches',
      'pattern always matches',
    ]);
  });

  it('reuses match pattern errors', () => {
    expect(msgs(`${MAIN}fn f(o: Option[int]): int { let Option::Some(a, b) = o else { return 0; }; if let 1 = "s" { } return 0; }`).length).toBe(2);
  });

  it('does not call a pattern with binder errors irrefutable', () => {
    expect(msgs(`${MAIN}enum E { A(int), B(int) }\nfn f(e: E): int { let E::A(x) | E::B(y) = e else { return 0; }; return 1; }`)).toEqual([
      'or-pattern alternatives cannot bind names',
      'or-pattern alternatives cannot bind names',
    ]);
    expect(msgs(`${MAIN}enum P { T(int, int) }\nfn f(p: P): int { let P::T(x, x) = p else { return 0; }; return 1; }`)).toEqual([
      "duplicate binding 'x'",
    ]);
  });

  it('treats an if let with two diverging branches as diverging', () => {
    expect(msgs(`${MAIN}fn f(o: Option[int]): int { if let Option::Some(x) = o { return x; } else { return 0; } }`)).toEqual([]);
  });

  it('checks else-if-let chains', () => {
    expect(msgs(`${MAIN}fn f(o: Option[int], p: Option[int]): int { if let Option::Some(x) = o { return x; } else if let Option::Some(y) = p { return y; } else { return 0; } }`)).toEqual([]);
  });
});

describe('block arms in match expressions', () => {

  it('accepts a diverging block arm', () => {
    expect(msgs(`${MAIN}fn f(o: Option[int]): int { let v: int = match o { Option::Some(x) => x, Option::None => { print(0); return -1; } }; return v; }`)).toEqual([]);
  });

  it('rejects a block arm that falls through', () => {
    expect(msgs(`${MAIN}fn f(o: Option[int]): int { return match o { Option::Some(x) => x, Option::None => { print(0); } }; }`)).toEqual([
      'match arm block must diverge',
    ]);
  });

  it('sees binders in a block arm', () => {
    expect(msgs(`${MAIN}fn f(o: Option[int]): int { return match o { Option::Some(x) => { return x; }, Option::None => 0 }; }`)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { formatShort } from '../diagnostics/diagnostic.js';
import { makeSource } from '../diagnostics/source.js';
import { lex } from '../lexer/lexer.js';
import { parse } from '../parser/parser.js';
import { INT, typeToString, type Type } from '../types/type.js';
import { check } from './checker.js';

const MAIN = 'fn main(): int { return 0; }\n';

function checkText(text: string) {
  const source = makeSource('t.aster', text);
  const lexed = lex(source);
  const parsed = parse(lexed.tokens);
  expect([...lexed.diagnostics, ...parsed.diagnostics]).toEqual([]);
  return { source, ...check(parsed.program) };
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

describe('check: ReadResult', () => {
  const STR = { kind: 'string' };

  it('is a predeclared enum, included in the program only when mentioned', () => {
    expect(checkText(MAIN).program.enums).toEqual([]);
    const { program } = checkText('fn main(): int { let r: ReadResult = ReadResult::Err("e"); return 0; }');
    expect(program.enums).toEqual([
      {
        name: 'ReadResult',
        payloadFree: false,
        variants: [
          { name: 'Ok', tag: 0, payload: [STR] },
          { name: 'Err', tag: 1, payload: [STR] },
        ],
      },
    ]);
  });

  it('counts a variant expression alone as a mention, and comes before user enums', () => {
    const { program } = checkText('enum A { X }\nfn main(): int { let a: A = A::X; ReadResult::Ok("x"); return 0; }');
    expect(program.enums.map((e) => e.name)).toEqual(['ReadResult', 'A']);
  });

  it('cannot be redefined', () => {
    const bad = "'ReadResult' is a builtin type and cannot be redefined";
    expect(messages(`${MAIN}struct ReadResult { }`)).toEqual([bad]);
    expect(messages(`${MAIN}enum ReadResult { A }`)).toEqual([bad]);
    expect(messages(`${MAIN}fn ReadResult() { }`)).toEqual([bad]);
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
    expect(messages(`enum E[ReadResult] { A(ReadResult) }\n${MAIN}`)).toEqual([conflict('ReadResult')]);
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
});

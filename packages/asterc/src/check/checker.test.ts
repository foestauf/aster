import { describe, expect, it } from 'vitest';
import { formatShort } from '../diagnostics/diagnostic.js';
import { makeSource } from '../diagnostics/source.js';
import { lex } from '../lexer/lexer.js';
import { parse } from '../parser/parser.js';
import { typeToString } from '../types/type.js';
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
    expect(messages('fn main() { }')).toEqual(["'main' must have signature 'fn main(): int'"]);
    expect(messages('fn main(a: int): int { return 0; }')).toEqual(["'main' must have signature 'fn main(): int'"]);
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
    expect(inMain('len(1);')).toEqual(['type mismatch: expected string, found int']);
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
  });
});

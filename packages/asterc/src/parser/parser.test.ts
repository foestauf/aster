import { describe, expect, it } from 'vitest';
import type { TypeExpr } from '../ast/ast.js';
import { patternText, sexpr } from '../ast/sexpr.js';
import { makeSource } from '../diagnostics/source.js';
import { lex } from '../lexer/lexer.js';
import { parse } from './parser.js';

const parseText = (text: string) => parse(lex(makeSource('t.aster', text)).tokens);
const errors = (text: string) => parseText(text).diagnostics.map((d) => d.message);

/** Renders a parsed type the way it is written; null (no return type) as void. */
const typeText = (t: TypeExpr | null): string =>
  t === null ? 'void' : t.kind === 'named' ? t.name : `[${typeText(t.elem)}]`;

/** Parses `text` as an expression statement inside a function and renders it as an s-expression. */
function expr(text: string): string {
  const { program, diagnostics } = parseText(`fn f() { ${text}; }`);
  expect(diagnostics).toEqual([]);
  const stmt = program.functions[0].body.statements[0];
  if (stmt.kind !== 'expr') throw new Error(`expected an expression statement, got ${stmt.kind}`);
  return sexpr(stmt.expr);
}

/** Parses `text` as a let initialiser (so a leading `match` is an expression) and renders it as an s-expression. */
function init(text: string): string {
  const { program, diagnostics } = parseText(`fn f() { let r: int = ${text}; }`);
  expect(diagnostics).toEqual([]);
  const stmt = program.functions[0].body.statements[0];
  if (stmt.kind !== 'let') throw new Error(`expected let, got ${stmt.kind}`);
  return sexpr(stmt.init);
}

/** The first syntax error, for inputs whose recovery reports follow-on errors. */
const firstError = (text: string) => errors(text)[0];

describe('expressions', () => {
  it('respects precedence', () => {
    expect(expr('1 + 2 * 3')).toBe('(+ 1 (* 2 3))');
    expect(expr('a || b && c == d < e + f')).toBe('(|| a (&& b (== c (< d (+ e f)))))');
    expect(expr('-x * !y')).toBe('(* (- x) (! y))');
  });

  it('is left-associative', () => {
    expect(expr('10 - 4 - 3')).toBe('(- (- 10 4) 3)');
    expect(expr('a && b && c')).toBe('(&& (&& a b) c)');
  });

  it('handles parentheses and nested unary operators', () => {
    expect(expr('(1 + 2) * 3')).toBe('(* (+ 1 2) 3)');
    expect(expr('- -x')).toBe('(- (- x))');
    expect(expr('!!b')).toBe('(! (! b))');
  });

  it('folds a minus directly before an integer literal', () => {
    expect(expr('-5')).toBe('-5');
    expect(expr('-9223372036854775808')).toBe('-9223372036854775808');
    expect(expr('-2 * 3')).toBe('(* -2 3)');
  });

  it('rejects integer literals outside the int range', () => {
    expect(errors('fn f() { 9223372036854775808; }')).toEqual(['integer literal out of range']);
    expect(errors('fn f() { -9223372036854775809; }')).toEqual(['integer literal out of range']);
  });

  it('parses calls, strings and booleans', () => {
    expect(expr('f(1, g("s"), h())')).toBe('(call f 1 (call g "s") (call h))');
    expect(expr('true != false')).toBe('(!= true false)');
  });

  it('parses if expressions with else-if chains', () => {
    const { program, diagnostics } = parseText('fn f() { let r: int = if a { 1 } else if b { 2 } else { 3 }; }');
    expect(diagnostics).toEqual([]);
    const stmt = program.functions[0].body.statements[0];
    if (stmt.kind !== 'let') throw new Error('expected let');
    expect(sexpr(stmt.init)).toBe('(if a 1 (if b 2 3))');
  });

  it('requires else on if expressions', () => {
    expect(errors('fn f() { let r: int = if a { 1 }; }')).toEqual(['if expression requires an else branch']);
  });

  it('rejects chained comparisons and equalities', () => {
    expect(errors('fn f() { a < b < c; }')).toEqual(['comparison operators cannot be chained']);
    expect(errors('fn f() { a == b != c; }')).toEqual(['comparison operators cannot be chained']);
  });

  it('allows a parenthesised comparison as an operand', () => {
    expect(expr('(a < b) == c')).toBe('(== (< a b) c)');
  });
});

describe('arrays', () => {
  it('parses array literals and index chains', () => {
    expect(expr('a[i].kids[j]')).toBe('(index (. (index a i) kids) j)');
    expect(expr('[1, [2], []]')).toBe('(array 1 (array 2) (array))');
    expect(expr('[1, 2,]')).toBe('(array 1 2)');
    expect(expr('f(x)[0]')).toBe('(index (call f x) 0)');
  });

  it('parses nested array types', () => {
    const { program, diagnostics } = parseText('fn f(g: [[int]]): [P] { }');
    expect(diagnostics).toEqual([]);
    expect(typeText(program.functions[0].params[0].type)).toBe('[[int]]');
    expect(typeText(program.functions[0].returnType)).toBe('[P]');
  });
});

describe('statements and functions', () => {
  it('parses every statement kind', () => {
    const { program, diagnostics } = parseText(`
      fn f(a: int, b: string): bool {
        let x: int = 1;
        var y: int = 2;
        y = 3;
        if x < y { } else if y < x { } else { }
        while true { break; continue; }
        { }
        g();
        return;
      }
    `);
    expect(diagnostics).toEqual([]);
    const fn = program.functions[0];
    expect(fn.name).toBe('f');
    expect(fn.params.map((p) => [p.name, typeText(p.type)])).toEqual([['a', 'int'], ['b', 'string']]);
    expect(typeText(fn.returnType)).toBe('bool');
    const kinds = fn.body.statements.map((s) => s.kind);
    expect(kinds).toEqual(['let', 'let', 'assign', 'if', 'while', 'block', 'expr', 'return']);
    const [letX, varY, , ifStmt, whileStmt] = fn.body.statements;
    expect(letX.kind === 'let' && letX.mutable).toBe(false);
    expect(varY.kind === 'let' && varY.mutable).toBe(true);
    if (ifStmt.kind !== 'if' || ifStmt.else?.kind !== 'if') throw new Error('expected else-if chain');
    expect(ifStmt.else.else?.kind).toBe('block');
    if (whileStmt.kind !== 'while') throw new Error('expected while');
    expect(whileStmt.body.statements.map((s) => s.kind)).toEqual(['break', 'continue']);
  });

  it('treats a missing return type as void (null)', () => {
    expect(parseText('fn f() { }').program.functions[0].returnType).toBeNull();
  });

  it('parses an empty file to an empty program', () => {
    expect(parseText('')).toEqual({ program: { functions: [], structs: [], enums: [] }, diagnostics: [] });
  });

  it('records statement spans from first to last token', () => {
    const { program } = parseText('fn f() { let x: int = 1; }');
    expect(program.functions[0].body.statements[0].span).toEqual({ start: 9, end: 24 });
  });

  it('recovers at statement boundaries and reports every error', () => {
    const r = parseText('fn f() {\n  let x: int = ;\n  let y = 2;\n}\nfn g() { return 1 }');
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      "expected expression, found ';'",
      "expected ':', found '='",
      "expected ';', found '}'",
    ]);
    expect(r.program.functions.map((f) => f.name)).toEqual(['f', 'g']);
  });

  it('recovers from junk at the top level', () => {
    const r = parseText('let x: int = 1;\nfn main(): int { return 0; }');
    expect(r.diagnostics.map((d) => d.message)).toEqual(["expected 'fn', 'struct' or 'enum', found 'let'"]);
    expect(r.program.functions.map((f) => f.name)).toEqual(['main']);
  });

  it('reports a missing closing brace at end of file', () => {
    expect(errors('fn f() {')).toEqual(["expected '}', found end of file"]);
  });

  it('describes identifiers, integers and strings in errors', () => {
    expect(errors('fn 1() {}')).toEqual(["expected identifier, found integer '1'"]);
    expect(errors('fn f() { let "s" }')).toEqual(['expected identifier, found string literal']);
    expect(errors('fn f() { x y; }')).toEqual(["expected ';', found identifier 'y'"]);
  });
  it('parses assignment to any place, with compound operators', () => {
    const { program, diagnostics } = parseText('fn f() { p.q.x = 1; p.n += 2; s -= 1; t *= 2; u /= 3; v %= 4; 1 = 2; }');
    expect(diagnostics).toEqual([]);
    const shown = program.functions[0].body.statements.map((s) =>
      s.kind === 'assign' ? `${sexpr(s.target)} ${s.op} ${sexpr(s.value)}` : s.kind,
    );
    expect(shown).toEqual(['(. (. p q) x) = 1', '(. p n) += 2', 's -= 1', 't *= 2', 'u /= 3', 'v %= 4', '1 = 2']);
  });

  it('parses range and array for loops', () => {
    const { program, diagnostics } = parseText('fn f() { for i in 0..n + 1 { } for x in xs { } for p in P { } }');
    expect(diagnostics).toEqual([]);
    const [range, each, named] = program.functions[0].body.statements;
    if (range.kind !== 'forRange' || each.kind !== 'forEach' || named.kind !== 'forEach') throw new Error('expected for loops');
    expect([range.name, sexpr(range.start), sexpr(range.end)]).toEqual(['i', '0', '(+ n 1)']);
    expect([each.name, sexpr(each.iterable)]).toEqual(['x', 'xs']);
    // `P {` in a for header starts the body, so this iterates over a variable named P.
    expect(sexpr(named.iterable)).toBe('P');
  });
});

describe('structs', () => {
  it('parses struct declarations with optional trailing commas', () => {
    const { program, diagnostics } = parseText('struct P { x: int, y: string, }\nstruct E {}');
    expect(diagnostics).toEqual([]);
    expect(program.structs.map((s) => [s.name, s.fields.map((f) => `${f.name}: ${typeText(f.type)}`)])).toEqual([
      ['P', ['x: int', 'y: string']],
      ['E', []],
    ]);
  });

  it('parses field access and struct literals', () => {
    expect(expr('p.x.y')).toBe('(. (. p x) y)');
    expect(expr('f(a).b')).toBe('(. (call f a) b)');
    expect(expr('P { x: 1, y: Q { z: 2 }, }')).toBe('(struct P (x 1) (y (struct Q (z 2))))');
    expect(expr('E {}')).toBe('(struct E)');
  });

  it('reads `Name {` in an if/while header as the start of the body', () => {
    expect(errors('fn f() { if P { x: 1 } { } }')).toEqual(["expected ';', found ':'"]);
    expect(errors('fn f() { while ok { } }')).toEqual([]);
  });

  it('reads `Name {` in a for header as an identifier followed by the body', () => {
    expect(errors('fn f() { for x in xs { } }')).toEqual([]);
    expect(errors('fn f() { for x in P { x: 1 } { } }')).toEqual(["expected ';', found ':'"]);
    expect(errors('fn f() { for x in (P { x: 1 }) { } }')).toEqual([]);
  });

  it('allows struct literals in headers inside parentheses, arguments, fields and if-expression branches', () => {
    expect(errors('fn f() { if (P { x: 1 }).x == 1 { } }')).toEqual([]);
    expect(errors('fn f() { if g(P { x: 1 }) { } }')).toEqual([]);
    expect(errors('fn f() { while ok(Q { p: P { x: 1 } }) { } }')).toEqual([]);
    expect(errors('fn f() { let v: int = if c { P { x: 1 }.x } else { 0 }; }')).toEqual([]);
  });

  it('recovers at a struct after an unclosed function', () => {
    const r = parseText('fn f() {\n  let x: int = 1;\nstruct S { a: int }\nfn main(): int { return 0; }');
    expect(r.diagnostics.map((d) => d.message)).toEqual(["expected '}', found 'struct'"]);
    expect(r.program.structs.map((s) => s.name)).toEqual(['S']);
    expect(r.program.functions.map((f) => f.name)).toEqual(['main']);
  });
});

describe('enums', () => {
  it('parses enum declarations with payloads and an optional trailing comma', () => {
    const { program, diagnostics } = parseText('enum E { A, B(int), C([int], E), }\nenum K { X }');
    expect(diagnostics).toEqual([]);
    expect(program.enums.map((e) => [e.name, e.variants.map((v) => `${v.name}(${v.payload.map(typeText).join(', ')})`)])).toEqual([
      ['E', ['A()', 'B(int)', 'C([int], E)']],
      ['K', ['X()']],
    ]);
  });

  it('rejects empty enums, empty payload parentheses and trailing commas in payloads', () => {
    expect(errors('enum E {}')).toEqual(["expected identifier, found '}'"]);
    expect(errors('enum E { A() }')).toEqual(["expected identifier, found ')'"]);
    expect(errors('enum E { A(int,) }')).toEqual(["expected identifier, found ')'"]);
  });

  it('parses variant expressions with and without values', () => {
    expect(expr('E::A')).toBe('E::A');
    expect(expr('E::B(1, F::C)')).toBe('(E::B 1 F::C)');
    expect(expr('E::B(P { x: 1 }).y')).toBe('(. (E::B (struct P (x 1))) y)');
    expect(errors('fn f() { E::A(); }')).toEqual(["expected expression, found ')'"]);
  });

  it('reads Name:: in a header as a variant, not a struct literal', () => {
    expect(parseText('fn f() { if k == K::A { } while k != K::B { } }').diagnostics).toEqual([]);
  });

  it('recovers at an enum after an unclosed function', () => {
    const r = parseText('fn f() {\n  let x: int = 1;\nenum E { A }\nfn main(): int { return 0; }');
    expect(r.diagnostics.map((d) => d.message)).toEqual(["expected '}', found 'enum'"]);
    expect(r.program.enums.map((e) => e.name)).toEqual(['E']);
  });

  it('rejects _ as a name', () => {
    expect(errors('fn f() { let _: int = 1; }')).toEqual(["expected identifier, found '_'"]);
  });
});

describe('match', () => {
  it('parses match expressions', () => {
    expect(init('match e { E::A => 1, E::B(x, _) => x, _ => 0, }')).toBe('(match e (E::A 1) ((E::B x _) x) (_ 0))');
    expect(init('match e { _ => 0 } + 1')).toBe('(+ (match e (_ 0)) 1)');
    expect(init('f(match m { _ => match n { _ => 2 } })')).toBe('(call f (match m (_ (match n (_ 2)))))');
  });

  it('parses match statements with block and expression arms', () => {
    const { program, diagnostics } = parseText('fn f() { match e { E::A => { g(); } E::B(x) => g(x), _ => g() } }');
    expect(diagnostics).toEqual([]);
    const stmt = program.functions[0].body.statements[0];
    if (stmt.kind !== 'match') throw new Error(`expected match, got ${stmt.kind}`);
    expect(stmt.arms.map((a) => `${patternText(a.pattern)} => ${a.body.kind === 'block' ? 'block' : sexpr(a.body)}`)).toEqual([
      'E::A => block',
      '(E::B x) => (call g x)',
      '_ => (call g)',
    ]);
  });

  it('parses the scrutinee without struct literals and allows them inside arms', () => {
    expect(init('match p { _ => P { x: 1 } }')).toBe('(match p (_ (struct P (x 1))))');
    expect(init('match (P { x: 1 }) { _ => 0 }')).toBe('(match (struct P (x 1)) (_ 0))');
    expect(firstError('fn f() { match P { x: 1 } { _ => {} } }')).toBe("expected '::', found ':'");
  });

  it('rejects malformed patterns and arms', () => {
    expect(firstError('fn f() { match e { E::A() => {} } }')).toBe("expected identifier, found ')'");
    expect(firstError('fn f() { let r: int = match e { }; }')).toBe("expected identifier, found '}'");
    expect(firstError('fn f() { match e { E::A => g() E::B => g(), } }')).toBe("expected '}', found identifier 'E'");
  });

  it('resumes at a match statement after a broken statement', () => {
    expect(errors('fn f() {\n  let x: int = 1\n  match e { _ => {} }\n}')).toEqual(["expected ';', found 'match'"]);
  });
});

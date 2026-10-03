import { describe, expect, it } from 'vitest';
import { check } from '../check/checker.js';
import { makeSource } from '../diagnostics/source.js';
import { lex } from '../lexer/lexer.js';
import { parse } from '../parser/parser.js';
import { lower } from './lower.js';
import { printIr, printIrFunction } from './print.js';

const MAIN = 'fn main(): int { return 0; }\n';

function lowerText(text: string) {
  const lexed = lex(makeSource('t.aster', text));
  const parsed = parse(lexed.tokens);
  const checked = check(parsed.program);
  expect([...lexed.diagnostics, ...parsed.diagnostics, ...checked.diagnostics]).toEqual([]);
  return lower(checked.program);
}

function irOf(text: string, fnName: string): string {
  const fn = lowerText(text).functions.find((f) => f.name === fnName);
  if (!fn) throw new Error(`no function ${fnName}`);
  return printIrFunction(fn);
}

const lines = (...ls: string[]) => ls.join('\n') + '\n';

describe('lower', () => {
  it('lowers read_file to the read instruction and a branch that builds Result', () => {
    expect(irOf(`${MAIN}fn f(p: string): Result[string, string] { return read_file(p); }`, 'f')).toBe(
      lines(
        'fn f(%0 p: string): Result[string, string]',
        '  local %1: bool',
        '  local %2: string',
        '  local %3: Result[string, string]',
        'entry:',
        '  %1, %2 = read_file %0',
        '  br %1, read_ok1, read_err2',
        'read_ok1:',
        '  %3 = enum_new Result[string, string]::Ok(%2)',
        '  jmp read_end3',
        'read_err2:',
        '  %3 = enum_new Result[string, string]::Err(%2)',
        '  jmp read_end3',
        'read_end3:',
        '  ret %3',
      ),
    );
  });

  it('lowers straight-line code', () => {
    expect(irOf('fn main(): int { let x: int = 10; let y: int = 20; print(x + y); return 0; }', 'main')).toBe(
      lines(
        'fn main(): int',
        '  local %0 x: int',
        '  local %1 y: int',
        '  local %2: int',
        'entry:',
        '  %0 = copy 10',
        '  %1 = copy 20',
        '  %2 = add %0, %1',
        '  call_builtin print_int(%2)',
        '  ret 0',
      ),
    );
  });

  it('lowers calls with and without results', () => {
    const text = 'fn add(a: int, b: int): int { return a + b; }\nfn main(): int { return add(1, 2); }';
    expect(irOf(text, 'main')).toBe(lines('fn main(): int', '  local %0: int', 'entry:', '  %0 = call add(1, 2)', '  ret %0'));
    expect(irOf(text, 'add')).toBe(
      lines('fn add(%0 a: int, %1 b: int): int', '  local %2: int', 'entry:', '  %2 = add %0, %1', '  ret %2'),
    );
  });

  it('short-circuits && into branches', () => {
    expect(irOf(`${MAIN}fn f(a: bool, b: bool): bool { return a && b; }`, 'f')).toBe(
      lines(
        'fn f(%0 a: bool, %1 b: bool): bool',
        '  local %2: bool',
        'entry:',
        '  %2 = copy %0',
        '  br %0, and_rhs1, and_end2',
        'and_rhs1:',
        '  %2 = copy %1',
        '  jmp and_end2',
        'and_end2:',
        '  ret %2',
      ),
    );
  });

  it('short-circuits || with the branches swapped', () => {
    expect(irOf(`${MAIN}fn f(a: bool, b: bool): bool { return a || b; }`, 'f')).toContain('  br %0, or_end2, or_rhs1\n');
  });

  it('lowers loops, break, continue and if expressions', () => {
    const text = `${MAIN}fn f(n: int): int {
      var i: int = 0;
      while i < n {
        i = i + 1;
        if i == 2 { continue; }
        if i == 5 { break; }
      }
      return if i > 3 { i } else { 0 - i };
    }`;
    expect(irOf(text, 'f')).toBe(
      lines(
        'fn f(%0 n: int): int',
        '  local %1 i: int',
        '  local %2: bool',
        '  local %3: int',
        '  local %4: bool',
        '  local %5: bool',
        '  local %6: bool',
        '  local %7: int',
        '  local %8: int',
        'entry:',
        '  %1 = copy 0',
        '  jmp while_head1',
        'while_head1:',
        '  %2 = lt %1, %0',
        '  br %2, while_body2, while_end3',
        'while_body2:',
        '  %3 = add %1, 1',
        '  %1 = copy %3',
        '  %4 = eq %1, 2',
        '  br %4, then4, endif5',
        'then4:',
        '  jmp while_head1',
        'endif5:',
        '  %5 = eq %1, 5',
        '  br %5, then6, endif7',
        'then6:',
        '  jmp while_end3',
        'endif7:',
        '  jmp while_head1',
        'while_end3:',
        '  %6 = gt %1, 3',
        '  br %6, then8, else9',
        'then8:',
        '  %7 = copy %1',
        '  jmp endif10',
        'else9:',
        '  %8 = sub 0, %1',
        '  %7 = copy %8',
        '  jmp endif10',
        'endif10:',
        '  ret %7',
      ),
    );
  });

  it('interns strings, uses string ops and terminates after panic', () => {
    const text = 'fn g(s: string): string {\n  if s == "" { panic("empty"); }\n  return s + "!" + "";\n}\n' + MAIN;
    const ir = lowerText(text);
    expect(ir.strings).toEqual(['', 'empty', '!']);
    expect(printIrFunction(ir.functions[0])).toBe(
      lines(
        'fn g(%0 s: string): string',
        '  local %1: bool',
        '  local %2: string',
        '  local %3: string',
        'entry:',
        '  %1 = str_eq %0, str#0',
        '  br %1, then1, endif2',
        'then1:',
        '  call_builtin panic(str#1)',
        '  unreachable',
        'endif2:',
        '  %2 = concat %0, str#2',
        '  %3 = concat %2, str#0',
        '  ret %3',
      ),
    );
  });

  it('gives shadowed variables distinct locals and ends void functions with ret', () => {
    const text = `${MAIN}fn h(x: int) {\n  let y: int = x;\n  {\n    let y: int = 2;\n    print(y);\n  }\n  print(y);\n}`;
    expect(irOf(text, 'h')).toBe(
      lines(
        'fn h(%0 x: int): void',
        '  local %1 y: int',
        '  local %2 y: int',
        'entry:',
        '  %1 = copy %0',
        '  %2 = copy 2',
        '  call_builtin print_int(%2)',
        '  call_builtin print_int(%1)',
        '  ret',
      ),
    );
  });

  it('drops unreachable code after return', () => {
    expect(irOf('fn main(): int { return 1; print(2); }', 'main')).toBe(lines('fn main(): int', 'entry:', '  ret 1'));
  });

  it('omits the endif block when both branches return', () => {
    const text = `${MAIN}fn f(b: bool): int { if b { return 1; } else { return 2; } }`;
    expect(irOf(text, 'f')).toBe(
      lines(
        'fn f(%0 b: bool): int',
        'entry:',
        '  br %0, then1, else2',
        'then1:',
        '  ret 1',
        'else2:',
        '  ret 2',
      ),
    );
  });

  it('picks print builtins by argument type and lowers unary operators', () => {
    const ir = irOf('fn main(): int { print(true); print("s"); print(-(1)); print(!false); return 0; }', 'main');
    expect(ir).toContain('call_builtin print_bool(true)');
    expect(ir).toContain('call_builtin print_string(str#0)');
    expect(ir).toContain('%0 = neg 1');
    expect(ir).toContain('%1 = not false');
  });

  it('lowers eprint by argument type and exit as a terminating builtin', () => {
    const ir = irOf('fn main(): int { eprint("x"); eprint(1); eprint(true); exit(2); }', 'main');
    expect(ir).toContain('call_builtin eprint_string(str#0)');
    expect(ir).toContain('call_builtin eprint_int(1)');
    expect(ir).toContain('call_builtin eprint_bool(true)');
    expect(ir).toContain('call_builtin exit(2)');
    expect(ir).toContain('unreachable');
  });

  it('prints the string table and blank lines between functions', () => {
    expect(printIr(lowerText('fn main(): int { print("hi"); return 0; }\nfn v() { }'))).toBe(
      lines(
        'string #0 = "hi"',
        '',
        'fn main(): int',
        'entry:',
        '  call_builtin print_string(str#0)',
        '  ret 0',
        '',
        'fn v(): void',
        'entry:',
        '  ret',
      ),
    );
  });

  it('lowers struct literals in written order and passes fields in declaration order', () => {
    const text = `${MAIN}struct P { x: int, y: int }\nfn f(a: int): int { let p: P = P { y: a + 1, x: 2 }; return p.x; }`;
    expect(irOf(text, 'f')).toBe(
      lines(
        'fn f(%0 a: int): int',
        '  local %1 p: P',
        '  local %2: int',
        '  local %3: P',
        '  local %4: int',
        'entry:',
        '  %2 = add %0, 1',
        '  %3 = struct_new P { x: 2, y: %2 }',
        '  %1 = copy %3',
        '  %4 = field_get %1.x',
        '  ret %4',
      ),
    );
  });

  it('prints the struct table first', () => {
    expect(printIr(lowerText(`struct P { x: int, q: Q }\nstruct Q {}\n${MAIN}`))).toBe(
      lines('struct P { x: int, q: Q }', 'struct Q {}', '', 'fn main(): int', 'entry:', '  ret 0'),
    );
  });
  it('evaluates the object of a compound field assignment once', () => {
    const text = `${MAIN}struct P { x: int }\nfn g(): P { return P { x: 1 }; }\nfn f() { g().x += 2; }`;
    expect(irOf(text, 'f')).toBe(
      lines(
        'fn f(): void',
        '  local %0: P',
        '  local %1: int',
        '  local %2: int',
        'entry:',
        '  %0 = call g()',
        '  %1 = field_get %0.x',
        '  %2 = add %1, 2',
        '  field_set %0.x, %2',
        '  ret',
      ),
    );
  });

  it('lowers a plain field assignment to a single field_set', () => {
    const text = `${MAIN}struct P { x: int }\nfn f(p: P) { p.x = 7; }`;
    expect(irOf(text, 'f')).toBe(
      lines('fn f(%0 p: P): void', 'entry:', '  field_set %0.x, 7', '  ret'),
    );
  });

  it('compound-assigns locals in place', () => {
    expect(irOf(`${MAIN}fn f(a: int) { var n: int = a; n *= 3; }`, 'f')).toBe(
      lines('fn f(%0 a: int): void', '  local %1 n: int', 'entry:', '  %1 = copy %0', '  %1 = mul %1, 3', '  ret'),
    );
  });

  it('lowers array literals, indexing, compound element assignment and array builtins', () => {
    const text = `${MAIN}fn f(a: [int]): int { let b: [int] = [1, a[0]]; push(b, 3); b[1] += pop(a); return len(b) + len("s"); }`;
    expect(irOf(text, 'f')).toBe(
      lines(
        'fn f(%0 a: [int]): int',
        '  local %1 b: [int]',
        '  local %2: int',
        '  local %3: [int]',
        '  local %4: int',
        '  local %5: int',
        '  local %6: int',
        '  local %7: int',
        '  local %8: int',
        '  local %9: int',
        'entry:',
        '  %2 = index_get %0[0]',
        '  %3 = array_new int [1, %2]',
        '  %1 = copy %3',
        '  array_push %1, 3',
        '  %4 = index_get %1[1]',
        '  %5 = array_pop %0',
        '  %6 = add %4, %5',
        '  index_set %1[1], %6',
        '  %7 = array_len %1',
        '  %8 = call_builtin len(str#0)',
        '  %9 = add %7, %8',
        '  ret %9',
      ),
    );
  });

  it('lowers range loops with a step block that continue jumps to', () => {
    const text = `${MAIN}fn f(n: int) { for i in 0..n { if i == 2 { continue; } print(i); } }`;
    expect(irOf(text, 'f')).toBe(
      lines(
        'fn f(%0 n: int): void',
        '  local %1 i: int',
        '  local %2: int',
        '  local %3: int',
        '  local %4: bool',
        '  local %5: bool',
        'entry:',
        '  %2 = copy 0',
        '  %3 = copy %0',
        '  jmp for_head1',
        'for_head1:',
        '  %4 = lt %2, %3',
        '  br %4, for_body2, for_end4',
        'for_body2:',
        '  %1 = copy %2',
        '  %5 = eq %1, 2',
        '  br %5, then5, endif6',
        'then5:',
        '  jmp for_step3',
        'endif6:',
        '  call_builtin print_int(%1)',
        '  jmp for_step3',
        'for_step3:',
        '  %2 = add %2, 1',
        '  jmp for_head1',
        'for_end4:',
        '  ret',
      ),
    );
  });

  it('lowers for-in over arrays by index, re-reading the length each iteration', () => {
    expect(irOf(`${MAIN}fn f(xs: [int]) { for x in xs { print(x); } }`, 'f')).toBe(
      lines(
        'fn f(%0 xs: [int]): void',
        '  local %1 x: int',
        '  local %2: [int]',
        '  local %3: int',
        '  local %4: int',
        '  local %5: bool',
        'entry:',
        '  %2 = copy %0',
        '  %3 = copy 0',
        '  jmp for_head1',
        'for_head1:',
        '  %4 = array_len %2',
        '  %5 = lt %3, %4',
        '  br %5, for_body2, for_end4',
        'for_body2:',
        '  %1 = index_get %2[%3]',
        '  call_builtin print_int(%1)',
        '  jmp for_step3',
        'for_step3:',
        '  %3 = add %3, 1',
        '  jmp for_head1',
        'for_end4:',
        '  ret',
      ),
    );
  });

  it('keeps the step block when the body only reaches it through continue', () => {
    const ir = irOf(`${MAIN}fn f(n: int): int { for i in 0..n { if i == 3 { continue; } return i; } return -1; }`, 'f');
    expect(ir).toContain('for_step');
    expect(ir).toContain('jmp for_step');
  });

  it('omits the step block when the body can neither fall through nor continue', () => {
    expect(irOf(`${MAIN}fn f(n: int): int { for i in 0..n { return i; } return 0; }`, 'f')).not.toContain('for_step');
  });

  it('lowers variant construction and payload-free enum equality through tags', () => {
    const text = `${MAIN}enum P { A(int), B }\nenum K { X, Y }\nfn f(n: int, k: K): bool { let p: P = P::A(n + 1); let q: P = P::B; return k == K::Y; }`;
    expect(irOf(text, 'f')).toBe(
      lines(
        'fn f(%0 n: int, %1 k: K): bool',
        '  local %2 p: P',
        '  local %3 q: P',
        '  local %4: int',
        '  local %5: P',
        '  local %6: P',
        '  local %7: int',
        '  local %8: K',
        '  local %9: int',
        '  local %10: bool',
        'entry:',
        '  %4 = add %0, 1',
        '  %5 = enum_new P::A(%4)',
        '  %2 = copy %5',
        '  %6 = enum_new P::B',
        '  %3 = copy %6',
        '  %7 = enum_tag %1',
        '  %8 = enum_new K::Y',
        '  %9 = enum_tag %8',
        '  %10 = eq %7, %9',
        '  ret %10',
      ),
    );
  });

  it('prints enum declarations', () => {
    expect(printIr(lowerText(`enum E { A, B(int, [E]) }\n${MAIN}`))).toContain('enum E { A, B(int, [E]) }\n');
  });

  it('lowers match to a switch on the tag, with binders read from the payload', () => {
    const text = `${MAIN}enum E { A, B(int), C(int, string) }\nfn f(e: E): int { return match e { E::B(n) => n, E::C(_, s) => len(s), _ => 0 }; }`;
    expect(irOf(text, 'f')).toBe(
      lines(
        'fn f(%0 e: E): int',
        '  local %1 n: int',
        '  local %2 s: string',
        '  local %3: int',
        '  local %4: int',
        '  local %5: int',
        'entry:',
        '  %4 = enum_tag %0',
        '  switch %4 [1: arm1, 2: arm2], default arm3',
        'arm1:',
        '  %1 = enum_field %0, E::B.0',
        '  %3 = copy %1',
        '  jmp endmatch4',
        'arm2:',
        '  %2 = enum_field %0, E::C.1',
        '  %5 = call_builtin len(%2)',
        '  %3 = copy %5',
        '  jmp endmatch4',
        'arm3:',
        '  %3 = copy 0',
        '  jmp endmatch4',
        'endmatch4:',
        '  ret %3',
      ),
    );
  });

  it('omits the end block when every arm of a match statement returns', () => {
    const text = `${MAIN}enum K { X, Y }\nfn f(k: K): int { match k { K::X => { return 1; } K::Y => { return 2; } } }`;
    expect(irOf(text, 'f')).toBe(
      lines(
        'fn f(%0 k: K): int',
        '  local %1: int',
        'entry:',
        '  %1 = enum_tag %0',
        '  switch %1 [0: arm1, 1: arm2], default unreachable',
        'arm1:',
        '  ret 1',
        'arm2:',
        '  ret 2',
      ),
    );
  });

  it('lowers an int match to a switch on the value itself', () => {
    const text = `${MAIN}fn f(x: int): int { return match x { 1 | 2 => 10, -3 => 20, _ => 30 }; }`;
    expect(irOf(text, 'f')).toContain('entry:\n  switch %0 [1: arm1, 2: arm1, -3: arm2], default arm3\n');
  });

  it('makes the default unreachable for an exhaustive bool match', () => {
    const text = `${MAIN}fn f(b: bool): int { return match b { true => 1, false => 0 }; }`;
    expect(irOf(text, 'f')).toContain('entry:\n  switch %0 [1: arm1, 0: arm2], default unreachable\n');
  });

  it('lowers a string match to a chain of str_eq tests', () => {
    const text = `${MAIN}fn f(s: string): int { return match s { "a" | "b" => 1, _ => 2 }; }`;
    expect(irOf(text, 'f')).toBe(
      lines(
        'fn f(%0 s: string): int',
        '  local %1: int',
        '  local %2: bool',
        '  local %3: bool',
        'entry:',
        '  %2 = str_eq %0, str#0',
        '  br %2, arm1, test4',
        'test4:',
        '  %3 = str_eq %0, str#1',
        '  br %3, arm1, test5',
        'test5:',
        '  jmp arm2',
        'arm1:',
        '  %1 = copy 1',
        '  jmp endmatch3',
        'arm2:',
        '  %1 = copy 2',
        '  jmp endmatch3',
        'endmatch3:',
        '  ret %1',
      ),
    );
  });
});

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
});

import { describe, expect, it } from 'vitest';
import { check } from '../../check/checker.js';
import { makeSource } from '../../diagnostics/source.js';
import { lower } from '../../ir/lower.js';
import { lex } from '../../lexer/lexer.js';
import { parse } from '../../parser/parser.js';
import { emitC, mangleFn, mangleLocal, stringLiteral } from './emit.js';

function cOf(text: string): string {
  const lexed = lex(makeSource('t.aster', text));
  const parsed = parse(lexed.tokens);
  const checked = check(parsed.program);
  expect([...lexed.diagnostics, ...parsed.diagnostics, ...checked.diagnostics]).toEqual([]);
  return emitC(lower(checked.program));
}

describe('stringLiteral', () => {
  it('keeps printable ASCII and escapes quote, backslash and ?', () => {
    expect(stringLiteral('hi')).toBe('{ "hi", 2 }');
    expect(stringLiteral('a"b\\c?')).toBe('{ "a\\"b\\\\c\\?", 6 }');
    expect(stringLiteral('')).toBe('{ "", 0 }');
  });

  it('encodes non-ASCII as UTF-8 octal escapes', () => {
    expect(stringLiteral('é\n\0')).toBe('{ "\\303\\251\\012\\000", 4 }');
  });
});

describe('mangling', () => {
  it('prefixes functions and numbers locals', () => {
    expect(mangleFn('printf')).toBe('aster_fn_printf');
    expect(mangleLocal({ id: 3, name: 'int', type: { kind: 'int' } })).toBe('l3_int');
    expect(mangleLocal({ id: 4, name: null, type: { kind: 'bool' } })).toBe('l4');
  });
});

describe('emitC', () => {
  it('emits a complete translation unit', () => {
    expect(cOf('fn main(): int { let x: int = 10; print(x + 1); return 0; }')).toBe(
      [
        '#include "aster_rt.h"',
        '',
        'int64_t aster_fn_main(void);',
        '',
        'int64_t aster_fn_main(void) {',
        '    int64_t l0_x = 0;',
        '    int64_t l1 = 0;',
        '    (void)l0_x;',
        '    (void)l1;',
        '    l0_x = INT64_C(10);',
        '    l1 = aster_rt_add(l0_x, INT64_C(1));',
        '    aster_rt_print_int(l1);',
        '    return INT64_C(0);',
        '}',
        '',
        'int main(void) {',
        '    return (int)aster_fn_main();',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('emits string constants, labels and gotos', () => {
    const c = cOf('fn main(): int { let s: string = "hi"; if s == "hi" { print(s); } return 0; }\nfn v(b: bool) { }');
    expect(c).toContain('const aster_string aster_str_0 = { "hi", 2 };');
    expect(c).toContain('void aster_fn_v(bool l0_b);');
    expect(c).toContain('    aster_string l0_s = {0};');
    expect(c).toContain('    l1 = aster_rt_str_eq(l0_s, aster_str_0);');
    expect(c).toContain('    if (l1) goto then1; else goto endif2;');
    expect(c).toContain('then1:;');
    expect(c).toContain('    goto endif2;');
    expect(c).toContain('    return;');
  });

  it('writes INT64_MIN symbolically and other operators as C', () => {
    const c = cOf('fn main(): int { let m: int = -9223372036854775808; print(!(m < 0) == true); print("a" != "b"); return -m / 2 % 3; }');
    expect(c).toContain('l0_m = INT64_MIN;');
    expect(c).toContain('= aster_rt_lt(l0_m, INT64_C(0));');
    expect(c).toContain('= !l1;');
    expect(c).toContain('= aster_rt_eq(l2, true);');
    expect(c).toContain('= !aster_rt_str_eq(aster_str_0, aster_str_1);');
    expect(c).toContain('= aster_rt_neg(l0_m);');
    expect(c).toContain('aster_rt_div(');
    expect(c).toContain('aster_rt_mod(');
  });

  it('emits unreachable as a runtime call', () => {
    expect(cOf('fn main(): int { panic("x"); }')).toContain('    aster_rt_panic(aster_str_0);\n    aster_rt_unreachable();');
  });
});

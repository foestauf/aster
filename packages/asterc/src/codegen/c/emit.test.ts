import { describe, expect, it } from 'vitest';
import { check } from '../../check/checker.js';
import { makeSource } from '../../diagnostics/source.js';
import { lower } from '../../ir/lower.js';
import { lex } from '../../lexer/lexer.js';
import { parse } from '../../parser/parser.js';
import { emitC, mangleEnum, mangleFn, mangleLocal, mangleVariant, stringLiteral } from './emit.js';

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

  it('prefixes enum types and variant members', () => {
    expect(mangleEnum('FILE')).toBe('aster_E_FILE');
    expect(mangleVariant('int')).toBe('v_int');
  });
});

describe('emitC', () => {
  it('reads files through the runtime into an ok flag and a text local', () => {
    const c = cOf('fn main(): int { let r: ReadResult = read_file("x"); return 0; }');
    expect(c).toMatch(/l\d+ = aster_rt_read_file\(aster_str_0, &l\d+\);/);
    expect(c).toContain('typedef struct aster_E_ReadResult *aster_E_ReadResult;');
  });

  it('passes the arguments to a main that takes them', () => {
    const c = cOf('fn main(args: [string]): int { return len(args); }');
    expect(c).toContain('int main(int argc, char **argv) {\n    return (int)aster_fn_main(aster_rt_args(argc, argv));\n}\n');
    expect(c).not.toContain('int main(void)');
  });

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

  it('declares every struct typedef before any definition so structs can refer to each other', () => {
    const c = cOf('struct A { b: B, n: int }\nstruct B { a: A }\nstruct E {}\nfn main(): int { return 0; }');
    expect(c).toContain(
      [
        'typedef struct aster_S_A *aster_S_A;',
        'typedef struct aster_S_B *aster_S_B;',
        'typedef struct aster_S_E *aster_S_E;',
        '',
        'struct aster_S_A {',
        '    aster_S_B f_b;',
        '    int64_t f_n;',
        '};',
        '',
        'struct aster_S_B {',
        '    aster_S_A f_a;',
        '};',
        '',
        'struct aster_S_E {',
        '    char aster_empty;',
        '};',
        '',
      ].join('\n'),
    );
  });

  it('allocates structs on the heap and accesses fields through the pointer', () => {
    const c = cOf('struct P { x: int }\nfn main(): int { let p: P = P { x: 1 }; return p.x; }');
    expect(c).toContain('    aster_S_P l0_p = NULL;');
    expect(c).toContain('    l1 = aster_rt_alloc(sizeof(struct aster_S_P));\n    l1->f_x = INT64_C(1);');
    expect(c).toContain('    l2 = l0_p->f_x;');
  });

  it('emits arrays through the runtime with typed slot access', () => {
    const c = cOf('fn main(): int { let a: [string] = ["x"]; push(a, "y"); print(a[1]); return len(a); }');
    expect(c).toContain('    aster_array l0_a = NULL;');
    expect(c).toContain(
      '    l1 = aster_rt_array_new(sizeof(aster_string), 1);\n    *(aster_string *)aster_rt_array_at(l1, 0) = aster_str_0;',
    );
    expect(c).toContain('    *(aster_string *)aster_rt_array_push_slot(l0_a) = aster_str_1;');
    expect(c).toContain('    l2 = *(aster_string *)aster_rt_array_at(l0_a, INT64_C(1));');
    expect(c).toContain('    l3 = l0_a->len;');
  });

  it('emits payload-free enums as int64 tags and other enums as tagged unions', () => {
    const c = cOf('struct S { e: E }\nenum E { A, B(int, S), C(E) }\nenum K { X, Y }\nfn main(): int { return 0; }');
    expect(c).toContain(
      [
        'typedef struct aster_S_S *aster_S_S;',
        'typedef struct aster_E_E *aster_E_E;',
        'typedef int64_t aster_E_K;',
        '',
        'struct aster_S_S {',
        '    aster_E_E f_e;',
        '};',
        '',
        'struct aster_E_E {',
        '    int64_t tag;',
        '    union {',
        '        struct { int64_t p0; aster_S_S p1; } v_B;',
        '        struct { aster_E_E p0; } v_C;',
        '    } u;',
        '};',
        '',
      ].join('\n'),
    );
  });

  it('builds enum values and reads their tags', () => {
    const c = cOf('enum E { A, B(int) }\nenum K { X, Y }\nfn main(): int { let e: E = E::B(7); let k: K = K::Y; if k == K::X { return 1; } return 0; }');
    expect(c).toContain('    aster_E_E l0_e = 0;');
    expect(c).toContain('    l2 = aster_rt_alloc(sizeof(struct aster_E_E));\n    l2->tag = INT64_C(1);\n    l2->u.v_B.p0 = INT64_C(7);');
    expect(c).toContain('    l3 = INT64_C(1);');
    expect(c).toContain('    l4 = l1_k;');
  });

  it('emits match as a C switch over the tag', () => {
    const c = cOf('enum E { A, B(int) }\nfn main(): int { let e: E = E::B(4); return match e { E::B(n) => n, _ => 0 }; }');
    expect(c).toContain('    l4 = l0_e->tag;');
    expect(c).toContain('    switch (l4) { case 1: goto arm1; default: goto arm2; }');
    expect(c).toContain('arm1:;\n    l1_n = l0_e->u.v_B.p0;');
  });

  it('makes the default case unreachable when every variant has an arm', () => {
    const c = cOf('enum K { X, Y }\nfn main(): int { let k: K = K::Y; match k { K::X => { return 1; } K::Y => { return 0; } } }');
    expect(c).toContain('    switch (l2) { case 0: goto arm1; case 1: goto arm2; default: aster_rt_unreachable(); }');
  });
});

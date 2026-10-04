import { describe, expect, it } from 'vitest';
import { makeSource, runFrontend } from '../packages/asterc/src/index.js';
import { dumpTyped, escapeDump } from './typed_dump.js';

const dump = (text: string): string => {
  const { typed, diagnostics } = runFrontend(makeSource('t.aster', text), { readFile: () => ({ ok: false, reason: 'no imports' }), realPath: (p) => p });
  if (typed === null) throw new Error(diagnostics.map((d) => d.message).join('\n'));
  return dumpTyped(typed);
};

describe('dumpTyped', () => {
  it('escapes over UTF-8 bytes', () => {
    expect(escapeDump('a"b\\c\n\t\0é')).toBe('"a\\"b\\\\c\\n\\t\\x00\\xc3\\xa9"');
  });

  it('dumps structs, locals, a struct literal, a match with binders and a return', () => {
    expect(dump(`struct P { x: int }
fn main(): int {
    let p: P = P { x: 1 };
    let o: Option[int] = Option::Some(p.x);
    match o {
        Option::Some(v) => { return v; }
        Option::None => {}
    }
    return 0;
}
`)).toBe(`struct P
  field x int
enum Option[int]
  variant Some int
  variant None
fn main int
  local 0 p P let
  local 1 o Option[int] let
  local 2 v int let
  body
    let 0
      struct-lit P : P
        init x
          int 1 : int
    let 1
      variant Option[int] Some 0 : Option[int]
        field .x : int
          local 0 p : P
    match
      local 1 o : Option[int]
      arm
        variants Some/0
        binders 2
        block
          return
            local 2 v : int
      arm
        variants None/1
        block
    return
      int 0 : int
`);
  });
});

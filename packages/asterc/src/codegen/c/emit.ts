import type { Instr, IrBinOp, IrFunction, IrLocal, IrProgram, IrType, Operand, Terminator } from '../../ir/ir.js';

const INT64_MIN = -(2n ** 63n);

function cType(t: IrType): string {
  switch (t.kind) {
    case 'int':
      return 'int64_t';
    case 'bool':
      return 'bool';
    case 'string':
      return 'aster_string';
    case 'void':
      return 'void';
  }
}

function zeroValue(t: IrType): string {
  switch (t.kind) {
    case 'int':
      return '0';
    case 'bool':
      return 'false';
    case 'string':
      return '{0}';
    case 'void':
      return '';
  }
}

const BINOPS: Record<IrBinOp, (a: string, b: string) => string> = {
  add: (a, b) => `aster_rt_add(${a}, ${b})`,
  sub: (a, b) => `aster_rt_sub(${a}, ${b})`,
  mul: (a, b) => `aster_rt_mul(${a}, ${b})`,
  div: (a, b) => `aster_rt_div(${a}, ${b})`,
  mod: (a, b) => `aster_rt_mod(${a}, ${b})`,
  // bool operands of eq/ne widen losslessly to int64_t.
  lt: (a, b) => `aster_rt_lt(${a}, ${b})`,
  le: (a, b) => `aster_rt_le(${a}, ${b})`,
  gt: (a, b) => `aster_rt_gt(${a}, ${b})`,
  ge: (a, b) => `aster_rt_ge(${a}, ${b})`,
  eq: (a, b) => `aster_rt_eq(${a}, ${b})`,
  ne: (a, b) => `aster_rt_ne(${a}, ${b})`,
  concat: (a, b) => `aster_rt_concat(${a}, ${b})`,
  str_eq: (a, b) => `aster_rt_str_eq(${a}, ${b})`,
  str_ne: (a, b) => `!aster_rt_str_eq(${a}, ${b})`,
};

export const mangleFn = (name: string): string => `aster_fn_${name}`;
export const mangleLocal = (local: IrLocal): string => (local.name === null ? `l${local.id}` : `l${local.id}_${local.name}`);

export function emitC(program: IrProgram): string {
  const out: string[] = ['#include "aster_rt.h"', ''];
  if (program.strings.length > 0) {
    // Not static: an unused static const would trip -Wunused-const-variable.
    program.strings.forEach((s, i) => out.push(`const aster_string aster_str_${i} = ${stringLiteral(s)};`));
    out.push('');
  }
  for (const fn of program.functions) out.push(`${signature(fn)};`);
  out.push('');
  for (const fn of program.functions) out.push(...emitFunction(fn), '');
  out.push('int main(void) {', '    return (int)aster_fn_main();', '}', '');
  return out.join('\n');
}

/** A C initializer for an aster_string holding `value` as UTF-8. */
export function stringLiteral(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let body = '';
  for (const b of bytes) {
    if (b === 0x22) body += '\\"';
    else if (b === 0x5c) body += '\\\\';
    else if (b === 0x3f) body += '\\?'; // avoid accidental trigraphs
    else if (b >= 0x20 && b < 0x7f) body += String.fromCharCode(b);
    else body += `\\${b.toString(8).padStart(3, '0')}`; // always 3 digits, so a following digit can't extend it
  }
  return `{ "${body}", ${bytes.length} }`;
}

function signature(fn: IrFunction): string {
  const params = fn.locals.slice(0, fn.paramCount).map((l) => `${cType(l.type)} ${mangleLocal(l)}`);
  return `${cType(fn.returnType)} ${mangleFn(fn.name)}(${params.length > 0 ? params.join(', ') : 'void'})`;
}

function emitFunction(fn: IrFunction): string[] {
  const lines = [`${signature(fn)} {`];
  const locals = fn.locals.slice(fn.paramCount);
  for (const l of locals) lines.push(`    ${cType(l.type)} ${mangleLocal(l)} = ${zeroValue(l.type)};`);
  for (const l of locals) lines.push(`    (void)${mangleLocal(l)};`);
  fn.blocks.forEach((block, i) => {
    // The entry block is never a jump target, so it gets no label (avoids -Wunused-label).
    if (i > 0) lines.push(`${block.label}:;`);
    for (const instr of block.instrs) lines.push(`    ${emitInstr(fn, instr)}`);
    lines.push(`    ${emitTerminator(fn, block.term)}`);
  });
  lines.push('}');
  return lines;
}

function operand(fn: IrFunction, o: Operand): string {
  switch (o.kind) {
    case 'local':
      return mangleLocal(fn.locals[o.id]);
    case 'int':
      // INT64_MIN has no single-literal spelling in C.
      return o.value === INT64_MIN ? 'INT64_MIN' : `INT64_C(${o.value})`;
    case 'bool':
      return o.value ? 'true' : 'false';
    case 'string':
      return `aster_str_${o.index}`;
  }
}

function emitInstr(fn: IrFunction, instr: Instr): string {
  const op = (o: Operand) => operand(fn, o);
  const assign = (dst: number | null, value: string) => (dst === null ? `${value};` : `${mangleLocal(fn.locals[dst])} = ${value};`);
  switch (instr.kind) {
    case 'copy':
      return assign(instr.dst, op(instr.src));
    case 'unop':
      return assign(instr.dst, instr.op === 'neg' ? `aster_rt_neg(${op(instr.operand)})` : `!${op(instr.operand)}`);
    case 'binop':
      return assign(instr.dst, BINOPS[instr.op](op(instr.left), op(instr.right)));
    case 'call':
      return assign(instr.dst, `${mangleFn(instr.fn)}(${instr.args.map(op).join(', ')})`);
    case 'call_builtin':
      return assign(instr.dst, `aster_rt_${instr.builtin}(${instr.args.map(op).join(', ')})`);
  }
}

function emitTerminator(fn: IrFunction, term: Terminator): string {
  switch (term.kind) {
    case 'jmp':
      return `goto ${term.target};`;
    case 'br':
      return `if (${operand(fn, term.cond)}) goto ${term.then}; else goto ${term.else};`;
    case 'ret':
      return term.value === null ? 'return;' : `return ${operand(fn, term.value)};`;
    case 'unreachable':
      return 'aster_rt_unreachable();';
  }
}

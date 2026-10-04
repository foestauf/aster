import type { Type } from '../../types/type.js';
import type { Instr, IrBinOp, IrEnum, IrFunction, IrLocal, IrProgram, IrType, Operand, Terminator } from '../../ir/ir.js';

type EnumTable = ReadonlyMap<string, IrEnum>;

const INT64_MIN = -(2n ** 63n);

function cType(t: Type): string {
  switch (t.kind) {
    case 'int':
      return 'int64_t';
    case 'bool':
      return 'bool';
    case 'string':
      return 'aster_string';
    case 'struct':
      return mangleStruct(t.name);
    case 'enum':
      return mangleEnum(t.name);
    case 'array':
      return 'aster_array';
    case 'void':
      return 'void';
    case 'error':
    case 'never':
      throw new Error(`internal: ${t.kind} type reached codegen`);
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
    case 'enum':
      // A null pointer constant for heap enums and tag 0 for payload-free ones.
      return '0';
    case 'struct':
    case 'array':
      return 'NULL';
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
export const mangleStruct = (name: string): string => `aster_S_${name}`;
/**
 * Non-generic enums are `aster_E_<name>`. An instantiation (its name contains `[`) is `aster_G_` followed by its type
 * string with `_` written as `__`, `[` as `_L`, `]` as `_R` and `, ` as `_C`, so no two names collide.
 */
export const mangleEnum = (name: string): string => {
  if (!name.includes('[')) return `aster_E_${name}`;
  let out = 'aster_G_';
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (c === '_') out += '__';
    else if (c === '[') out += '_L';
    else if (c === ']') out += '_R';
    else if (c === ',') {
      out += '_C';
      i++; // always followed by one space
    } else out += c;
  }
  return out;
};
export const mangleVariant = (name: string): string => `v_${name}`;
export const mangleField = (name: string): string => `f_${name}`;
export const mangleLocal = (local: IrLocal): string => (local.name === null ? `l${local.id}` : `l${local.id}_${local.name}`);

export function emitC(program: IrProgram): string {
  const out: string[] = ['#include "aster_rt.h"', ''];
  if (program.structs.length > 0 || program.enums.length > 0) {
    // Every typedef comes first, so struct and enum bodies can refer to any type, including themselves.
    for (const s of program.structs) out.push(`typedef struct ${mangleStruct(s.name)} *${mangleStruct(s.name)};`);
    for (const e of program.enums) out.push(enumTypedef(e));
    out.push('');
    for (const s of program.structs) {
      out.push(`struct ${mangleStruct(s.name)} {`);
      if (s.fields.length === 0) out.push('    char aster_empty;'); // C11 has no empty structs
      for (const f of s.fields) out.push(`    ${cType(f.type)} ${mangleField(f.name)};`);
      out.push('};', '');
    }
    for (const e of program.enums) if (!e.payloadFree) out.push(...enumDefinition(e), '');
  }
  if (program.strings.length > 0) {
    // Not static: an unused static const would trip -Wunused-const-variable.
    program.strings.forEach((s, i) => out.push(`const aster_string aster_str_${i} = ${stringLiteral(s)};`));
    out.push('');
  }
  const enums: EnumTable = new Map(program.enums.map((e) => [e.name, e]));
  for (const fn of program.functions) out.push(`${signature(fn)};`);
  out.push('');
  for (const fn of program.functions) out.push(...emitFunction(fn, enums), '');
  const mainTakesArgs = program.functions.some((fn) => fn.name === 'main' && fn.paramCount === 1);
  if (mainTakesArgs) {
    out.push('int main(int argc, char **argv) {', '    return (int)aster_fn_main(aster_rt_args(argc, argv));', '}', '');
  } else {
    out.push('int main(void) {', '    return (int)aster_fn_main();', '}', '');
  }
  return out.join('\n');
}

/** Payload-free enums are plain int64 tags; every other enum is a pointer to a tagged union. */
const enumTypedef = (e: IrEnum): string =>
  e.payloadFree ? `typedef int64_t ${mangleEnum(e.name)};` : `typedef struct ${mangleEnum(e.name)} *${mangleEnum(e.name)};`;

/**
 * The tagged union behind a heap enum. Only payload variants get a union member, and a heap enum has at least one
 * payload variant (otherwise it would be payload-free), so the union is never empty.
 */
function enumDefinition(e: IrEnum): string[] {
  const lines = [`struct ${mangleEnum(e.name)} {`, '    int64_t tag;', '    union {'];
  for (const v of e.variants) {
    if (v.payload.length === 0) continue;
    const slots = v.payload.map((t, i) => `${cType(t)} p${i};`).join(' ');
    lines.push(`        struct { ${slots} } ${mangleVariant(v.name)};`);
  }
  lines.push('    } u;', '};');
  return lines;
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

function emitFunction(fn: IrFunction, enums: EnumTable): string[] {
  const lines = [`${signature(fn)} {`];
  const locals = fn.locals.slice(fn.paramCount);
  for (const l of locals) lines.push(`    ${cType(l.type)} ${mangleLocal(l)} = ${zeroValue(l.type)};`);
  for (const l of locals) lines.push(`    (void)${mangleLocal(l)};`);
  fn.blocks.forEach((block, i) => {
    // The entry block is never a jump target, so it gets no label (avoids -Wunused-label).
    if (i > 0) lines.push(`${block.label}:;`);
    for (const instr of block.instrs) lines.push(`    ${emitInstr(fn, enums, instr)}`);
    lines.push(`    ${emitTerminator(fn, block.term)}`);
  });
  lines.push('}');
  return lines;
}

/** INT64_MIN has no single-literal spelling in C. */
function intLiteral(v: bigint): string {
  return v === INT64_MIN ? 'INT64_MIN' : `INT64_C(${v})`;
}

function operand(fn: IrFunction, o: Operand): string {
  switch (o.kind) {
    case 'local':
      return mangleLocal(fn.locals[o.id]);
    case 'int':
      return intLiteral(o.value);
    case 'bool':
      return o.value ? 'true' : 'false';
    case 'string':
      return `aster_str_${o.index}`;
  }
}

/** An lvalue of C type `t` at the address a runtime array call returns. */
const slot = (t: string, call: string): string => `*(${t} *)${call}`;

/** C type of the elements of an array operand. Array values are never constants, so the operand is a local. */
function elemCType(fn: IrFunction, array: Operand): string {
  const t = array.kind === 'local' ? fn.locals[array.id].type : null;
  if (t === null || t.kind !== 'array') throw new Error('internal: array operand is not an array local');
  return cType(t.elem);
}

/** The declaration of an enum-typed operand. Enum values are never constants, so the operand is a local. */
function enumOf(fn: IrFunction, enums: EnumTable, o: Operand): IrEnum {
  const t = o.kind === 'local' ? fn.locals[o.id].type : null;
  const decl = t !== null && t.kind === 'enum' ? enums.get(t.name) : undefined;
  if (decl === undefined) throw new Error('internal: enum operand is not an enum local');
  return decl;
}

function emitInstr(fn: IrFunction, enums: EnumTable, instr: Instr): string {
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
    case 'struct_new': {
      const target = mangleLocal(fn.locals[instr.dst]);
      return [
        `${target} = aster_rt_alloc(sizeof(struct ${mangleStruct(instr.struct)}));`,
        ...instr.fields.map((f) => `${target}->${mangleField(f.name)} = ${op(f.value)};`),
      ].join('\n    ');
    }
    case 'field_get':
      return assign(instr.dst, `${op(instr.object)}->${mangleField(instr.field)}`);
    case 'field_set':
      return `${op(instr.object)}->${mangleField(instr.field)} = ${op(instr.value)};`;
    case 'array_new': {
      const target = mangleLocal(fn.locals[instr.dst]);
      const t = cType(instr.elem);
      return [
        `${target} = aster_rt_array_new(sizeof(${t}), ${instr.elements.length});`,
        ...instr.elements.map((e, i) => `${slot(t, `aster_rt_array_at(${target}, ${i})`)} = ${op(e)};`),
      ].join('\n    ');
    }
    case 'index_get':
      return assign(instr.dst, slot(elemCType(fn, instr.array), `aster_rt_array_at(${op(instr.array)}, ${op(instr.index)})`));
    case 'index_set':
      return `${slot(elemCType(fn, instr.array), `aster_rt_array_at(${op(instr.array)}, ${op(instr.index)})`)} = ${op(instr.value)};`;
    case 'array_len':
      return assign(instr.dst, `${op(instr.array)}->len`);
    case 'array_push':
      return `${slot(elemCType(fn, instr.array), `aster_rt_array_push_slot(${op(instr.array)})`)} = ${op(instr.value)};`;
    case 'enum_new': {
      const decl = enums.get(instr.enum);
      if (decl === undefined) throw new Error(`internal: unknown enum ${instr.enum}`);
      const target = mangleLocal(fn.locals[instr.dst]);
      if (decl.payloadFree) return `${target} = INT64_C(${instr.tag});`;
      const member = `${target}->u.${mangleVariant(instr.variant)}`;
      return [
        `${target} = aster_rt_alloc(sizeof(struct ${mangleEnum(instr.enum)}));`,
        `${target}->tag = INT64_C(${instr.tag});`,
        ...instr.args.map((a, i) => `${member}.p${i} = ${op(a)};`),
      ].join('\n    ');
    }
    case 'enum_field':
      return assign(instr.dst, `${op(instr.value)}->u.${mangleVariant(instr.variant)}.p${instr.index}`);
    case 'enum_tag':
      return assign(instr.dst, enumOf(fn, enums, instr.value).payloadFree ? op(instr.value) : `${op(instr.value)}->tag`);
    case 'array_pop':
      return assign(instr.dst, slot(elemCType(fn, instr.array), `aster_rt_array_pop_slot(${op(instr.array)})`));
    case 'sys':
      throw new Error(`internal: ${instr.builtin} is not emitted yet`);
    case 'read_file':
      return `${mangleLocal(fn.locals[instr.text])} = aster_rt_read_file(${op(instr.path)}, &${mangleLocal(fn.locals[instr.ok])});`;
  }
}

function emitTerminator(fn: IrFunction, term: Terminator): string {
  switch (term.kind) {
    case 'jmp':
      return `goto ${term.target};`;
    case 'br':
      return `if (${operand(fn, term.cond)}) goto ${term.then}; else goto ${term.else};`;
    case 'switch': {
      const cases = term.cases.map((c) => `case ${intLiteral(c.value)}: goto ${c.target};`);
      const fallback = term.default === null ? 'default: aster_rt_unreachable();' : `default: goto ${term.default};`;
      // gcc rejects a bool switch condition under -Wswitch-bool.
      const isBool = term.value.kind === 'bool' || (term.value.kind === 'local' && fn.locals[term.value.id].type.kind === 'bool');
      const on = isBool ? `(int64_t)${operand(fn, term.value)}` : operand(fn, term.value);
      return `switch (${on}) { ${[...cases, fallback].join(' ')} }`;
    }
    case 'ret':
      return term.value === null ? 'return;' : `return ${operand(fn, term.value)};`;
    case 'unreachable':
      return 'aster_rt_unreachable();';
  }
}

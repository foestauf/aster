import type { Instr, IrEnum, IrFunction, IrLocal, IrProgram, Operand, Terminator } from './ir.js';
import { typeToString } from '../types/type.js';

const braces = (items: string[]): string => (items.length === 0 ? '{}' : `{ ${items.join(', ')} }`);

export function printIr(program: IrProgram): string {
  const parts: string[] = [];
  if (program.structs.length > 0) {
    parts.push(
      program.structs.map((s) => `struct ${s.name} ${braces(s.fields.map((f) => `${f.name}: ${typeToString(f.type)}`))}\n`).join(''),
    );
  }
  if (program.enums.length > 0) {
    parts.push(program.enums.map((e) => `enum ${e.name} ${braces(e.variants.map(variantDecl))}\n`).join(''));
  }
  if (program.strings.length > 0) {
    parts.push(program.strings.map((s, i) => `string #${i} = ${JSON.stringify(s)}\n`).join(''));
  }
  for (const fn of program.functions) parts.push(printIrFunction(fn));
  return parts.join('\n');
}

export function printIrFunction(fn: IrFunction): string {
  const lines: string[] = [];
  const params = fn.locals.slice(0, fn.paramCount).map(localDecl).join(', ');
  lines.push(`fn ${fn.name}(${params}): ${typeToString(fn.returnType)}`);
  for (const local of fn.locals.slice(fn.paramCount)) lines.push(`  local ${localDecl(local)}`);
  for (const block of fn.blocks) {
    lines.push(`${block.label}:`);
    for (const instr of block.instrs) lines.push(`  ${printInstr(instr)}`);
    lines.push(`  ${printTerminator(block.term)}`);
  }
  return lines.join('\n') + '\n';
}

const variantDecl = (v: IrEnum['variants'][number]): string =>
  v.payload.length === 0 ? v.name : `${v.name}(${v.payload.map(typeToString).join(', ')})`;

const localDecl = (l: IrLocal): string => `%${l.id}${l.name === null ? '' : ` ${l.name}`}: ${typeToString(l.type)}`;

function operand(o: Operand): string {
  switch (o.kind) {
    case 'local':
      return `%${o.id}`;
    case 'int':
      return o.value.toString();
    case 'bool':
      return String(o.value);
    case 'string':
      return `str#${o.index}`;
  }
}

const dst = (d: number | null): string => (d === null ? '' : `%${d} = `);

function printInstr(i: Instr): string {
  switch (i.kind) {
    case 'copy':
      return `%${i.dst} = copy ${operand(i.src)}`;
    case 'unop':
      return `%${i.dst} = ${i.op} ${operand(i.operand)}`;
    case 'binop':
      return `%${i.dst} = ${i.op} ${operand(i.left)}, ${operand(i.right)}`;
    case 'call':
      return `${dst(i.dst)}call ${i.fn}(${i.args.map(operand).join(', ')})`;
    case 'call_builtin':
      return `${dst(i.dst)}call_builtin ${i.builtin}(${i.args.map(operand).join(', ')})`;
    case 'struct_new':
      return `%${i.dst} = struct_new ${i.struct} ${braces(i.fields.map((f) => `${f.name}: ${operand(f.value)}`))}`;
    case 'field_get':
      return `%${i.dst} = field_get ${operand(i.object)}.${i.field}`;
    case 'field_set':
      return `field_set ${operand(i.object)}.${i.field}, ${operand(i.value)}`;
    case 'array_new':
      return `%${i.dst} = array_new ${typeToString(i.elem)} [${i.elements.map(operand).join(', ')}]`;
    case 'index_get':
      return `%${i.dst} = index_get ${operand(i.array)}[${operand(i.index)}]`;
    case 'index_set':
      return `index_set ${operand(i.array)}[${operand(i.index)}], ${operand(i.value)}`;
    case 'array_len':
      return `%${i.dst} = array_len ${operand(i.array)}`;
    case 'array_push':
      return `array_push ${operand(i.array)}, ${operand(i.value)}`;
    case 'enum_new':
      return `%${i.dst} = enum_new ${i.enum}::${i.variant}${i.args.length === 0 ? '' : `(${i.args.map(operand).join(', ')})`}`;
    case 'enum_tag':
      return `%${i.dst} = enum_tag ${operand(i.value)}`;
    case 'array_pop':
      return `%${i.dst} = array_pop ${operand(i.array)}`;
  }
}

function printTerminator(t: Terminator): string {
  switch (t.kind) {
    case 'jmp':
      return `jmp ${t.target}`;
    case 'br':
      return `br ${operand(t.cond)}, ${t.then}, ${t.else}`;
    case 'ret':
      return t.value === null ? 'ret' : `ret ${operand(t.value)}`;
    case 'unreachable':
      return 'unreachable';
  }
}

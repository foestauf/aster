import type { Instr, IrFunction, IrLocal, IrProgram, Operand, Terminator } from './ir.js';

export function printIr(program: IrProgram): string {
  const parts: string[] = [];
  if (program.strings.length > 0) {
    parts.push(program.strings.map((s, i) => `string #${i} = ${JSON.stringify(s)}\n`).join(''));
  }
  for (const fn of program.functions) parts.push(printIrFunction(fn));
  return parts.join('\n');
}

export function printIrFunction(fn: IrFunction): string {
  const lines: string[] = [];
  const params = fn.locals.slice(0, fn.paramCount).map(localDecl).join(', ');
  lines.push(`fn ${fn.name}(${params}): ${fn.returnType}`);
  for (const local of fn.locals.slice(fn.paramCount)) lines.push(`  local ${localDecl(local)}`);
  for (const block of fn.blocks) {
    lines.push(`${block.label}:`);
    for (const instr of block.instrs) lines.push(`  ${printInstr(instr)}`);
    lines.push(`  ${printTerminator(block.term)}`);
  }
  return lines.join('\n') + '\n';
}

const localDecl = (l: IrLocal): string => `%${l.id}${l.name === null ? '' : ` ${l.name}`}: ${l.type}`;

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

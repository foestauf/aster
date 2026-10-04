import { typeToString, type Instr, type IrFunction, type IrProgram, type Operand, type Terminator } from '../packages/asterc/src/index.js';

const INT_OPS = new Set(['add', 'sub', 'mul', 'div', 'mod', 'lt', 'le', 'gt', 'ge']);
const COMPARISONS = new Set(['lt', 'le', 'gt', 'ge', 'eq', 'ne', 'str_eq', 'str_ne']);

/**
 * Structural problems in `program`, one message per problem, prefixed by the function's name; empty for a well-formed
 * program. It checks labels, targets, local and string ranges and the operand types the IR fixes. It is not a full type
 * checker: calls, fields, arrays and enums are only range-checked.
 */
export function validateIr(program: IrProgram): string[] {
  const problems: string[] = [];
  for (const fn of program.functions) checkFunction(program, fn, (msg) => problems.push(`${fn.name}: ${msg}`));
  return problems;
}

function checkFunction(program: IrProgram, fn: IrFunction, report: (msg: string) => void): void {
  const labels = new Set<string>();
  if (fn.blocks.length > 0 && fn.blocks[0].label !== 'entry') report(`the first block is ${fn.blocks[0].label}, not entry`);
  for (const b of fn.blocks) {
    if (labels.has(b.label)) report(`duplicate label ${b.label}`);
    labels.add(b.label);
  }
  fn.locals.forEach((l, i) => {
    if (l.id !== i) report(`local ${i} has id ${l.id}`);
    if (l.type.kind === 'void') report(`local %${i} is void`);
  });

  /** The type of a local id as a string, or null (after reporting) when it is out of range. */
  const localType = (id: number): string | null => {
    const l = fn.locals[id];
    if (l === undefined) {
      report(`operand %${id} is out of range`);
      return null;
    }
    return typeToString(l.type);
  };
  const typeOf = (o: Operand): string | null => {
    switch (o.kind) {
      case 'local':
        return localType(o.id);
      case 'int':
        return 'int';
      case 'bool':
        return 'bool';
      case 'string':
        if (o.index < 0 || o.index >= program.strings.length) report(`string #${o.index} is out of range`);
        return 'string';
    }
  };
  const want = (what: string, actual: string | null, wanted: string): void => {
    if (actual !== null && actual !== wanted) report(`${what} is ${actual}, expected ${wanted}`);
  };
  const target = (label: string): void => {
    if (!labels.has(label)) report(`jump to unknown label ${label}`);
  };

  const checkInstr = (i: Instr): void => {
    switch (i.kind) {
      case 'copy': {
        const dst = localType(i.dst);
        const src = typeOf(i.src);
        if (dst !== null && src !== null && dst !== src) report(`copy writes ${src} into %${i.dst}: ${dst}`);
        return;
      }
      case 'unop': {
        const operandType = i.op === 'neg' ? 'int' : 'bool';
        want(`${i.op} operand`, typeOf(i.operand), operandType);
        want(`${i.op} result`, localType(i.dst), operandType);
        return;
      }
      case 'binop': {
        const left = typeOf(i.left);
        const right = typeOf(i.right);
        if (INT_OPS.has(i.op)) {
          want(`${i.op} operand`, left, 'int');
          want(`${i.op} operand`, right, 'int');
        } else if (i.op === 'concat' || i.op === 'str_eq' || i.op === 'str_ne') {
          want(`${i.op} operand`, left, 'string');
          want(`${i.op} operand`, right, 'string');
        } else if (left !== null && right !== null && (left !== right || (left !== 'int' && left !== 'bool'))) {
          report(`${i.op} compares ${left} with ${right}`);
        }
        want(`${i.op} result`, localType(i.dst), COMPARISONS.has(i.op) ? 'bool' : i.op === 'concat' ? 'string' : 'int');
        return;
      }
      case 'call':
      case 'call_builtin':
        if (i.dst !== null) localType(i.dst);
        i.args.forEach(typeOf);
        return;
      case 'struct_new':
        localType(i.dst);
        i.fields.forEach((f) => typeOf(f.value));
        return;
      case 'field_get':
        localType(i.dst);
        typeOf(i.object);
        return;
      case 'field_set':
        typeOf(i.object);
        typeOf(i.value);
        return;
      case 'array_new':
        localType(i.dst);
        i.elements.forEach(typeOf);
        return;
      case 'index_get':
        localType(i.dst);
        typeOf(i.array);
        want('index', typeOf(i.index), 'int');
        return;
      case 'index_set':
        typeOf(i.array);
        want('index', typeOf(i.index), 'int');
        typeOf(i.value);
        return;
      case 'array_len':
        want('array_len result', localType(i.dst), 'int');
        typeOf(i.array);
        return;
      case 'array_push':
        typeOf(i.array);
        typeOf(i.value);
        return;
      case 'array_pop':
        localType(i.dst);
        typeOf(i.array);
        return;
      case 'enum_new':
        localType(i.dst);
        i.args.forEach(typeOf);
        return;
      case 'enum_tag':
        want('enum_tag result', localType(i.dst), 'int');
        typeOf(i.value);
        return;
      case 'enum_field':
        localType(i.dst);
        typeOf(i.value);
        return;
      case 'read_file':
        want('read_file ok', localType(i.ok), 'bool');
        want('read_file text', localType(i.text), 'string');
        want('read_file path', typeOf(i.path), 'string');
        return;
    }
  };

  const checkTerm = (t: Terminator): void => {
    switch (t.kind) {
      case 'jmp':
        return target(t.target);
      case 'br':
        want('br condition', typeOf(t.cond), 'bool');
        target(t.then);
        return target(t.else);
      case 'switch': {
        const v = typeOf(t.value);
        if (v !== null && v !== 'int' && v !== 'bool') report(`switch value is ${v}, expected int or bool`);
        t.cases.forEach((c) => target(c.target));
        if (t.default !== null) target(t.default);
        return;
      }
      case 'ret': {
        const ret = typeToString(fn.returnType);
        if (t.value === null) {
          if (ret !== 'void') report(`ret without a value in a function returning ${ret}`);
        } else if (ret === 'void') {
          report('ret with a value in a void function');
        } else {
          want('ret value', typeOf(t.value), ret);
        }
        return;
      }
      case 'unreachable':
        return;
    }
  };

  for (const b of fn.blocks) {
    b.instrs.forEach(checkInstr);
    checkTerm(b.term);
  }
}

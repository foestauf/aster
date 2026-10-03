import { binaryOpOf, type BinaryOp, type CompoundOp } from '../ast/ast.js';
import type { TBlock, TExpr, TFunction, TStmt, TStruct, TypedProgram } from '../check/types.js';
import { BOOL, type Type } from '../types/type.js';
import type {
  BasicBlock, Instr, IrBinOp, IrBuiltin, IrFunction, IrLocal, IrProgram, IrStruct, IrType, Operand, Terminator,
} from './ir.js';

interface StringTable {
  values: string[];
  index: Map<string, number>;
}

interface Loop {
  continueLabel: string;
  breakLabel: string;
}

interface FnState {
  locals: IrLocal[];
  blocks: BasicBlock[];
  /** The open block, or null when the current position is unreachable. */
  current: { label: string; instrs: Instr[] } | null;
  labelCount: number;
  loops: Loop[];
  strings: StringTable;
  structs: ReadonlyMap<string, TStruct>;
}

const INT_BINOPS: Record<Exclude<BinaryOp, '&&' | '||'>, IrBinOp> = {
  '+': 'add',
  '-': 'sub',
  '*': 'mul',
  '/': 'div',
  '%': 'mod',
  '<': 'lt',
  '<=': 'le',
  '>': 'gt',
  '>=': 'ge',
  '==': 'eq',
  '!=': 'ne',
};

export function lower(program: TypedProgram): IrProgram {
  const strings: StringTable = { values: [], index: new Map() };
  const structs = new Map(program.structs.map((s) => [s.name, s]));
  const functions = program.functions.map((fn) => lowerFunction(fn, strings, structs));
  return { structs: program.structs.map(irStruct), functions, strings: strings.values };
}

const irStruct = (s: TStruct): IrStruct => ({
  name: s.name,
  fields: s.fields.map((f) => ({ name: f.name, type: irType(f.type) })),
});

function irType(t: Type): IrType {
  if (t.kind === 'error') throw new Error('internal: error type reached lowering');
  return t;
}

function lowerFunction(fn: TFunction, strings: StringTable, structs: ReadonlyMap<string, TStruct>): IrFunction {
  const st: FnState = {
    locals: fn.locals.map((l) => ({ id: l.id, name: l.name, type: irType(l.type) })),
    blocks: [],
    current: { label: 'entry', instrs: [] },
    labelCount: 0,
    loops: [],
    strings,
    structs,
  };
  lowerBlock(st, fn.body);
  // The checker guarantees non-void functions never fall off the end.
  terminate(st, fn.returnType.kind === 'void' ? { kind: 'ret', value: null } : { kind: 'unreachable' });
  return {
    name: fn.name,
    paramCount: fn.params.length,
    locals: st.locals,
    returnType: irType(fn.returnType),
    blocks: st.blocks,
  };
}

// ---- block plumbing

const newLabel = (st: FnState, hint: string): string => `${hint}${++st.labelCount}`;

function newTemp(st: FnState, type: IrType): number {
  const id = st.locals.length;
  st.locals.push({ id, name: null, type });
  return id;
}

function emit(st: FnState, instr: Instr): void {
  if (!st.current) throw new Error('internal: emitting into unreachable code');
  st.current.instrs.push(instr);
}

/** Closes the open block with `term`. A no-op when the position is already unreachable. */
function terminate(st: FnState, term: Terminator): void {
  if (!st.current) return;
  st.blocks.push({ label: st.current.label, instrs: st.current.instrs, term });
  st.current = null;
}

/** Opens a new block, falling through into it from the open block if there is one. */
function startBlock(st: FnState, label: string): void {
  terminate(st, { kind: 'jmp', target: label });
  st.current = { label, instrs: [] };
}

function internString(table: StringTable, value: string): number {
  const existing = table.index.get(value);
  if (existing !== undefined) return existing;
  table.values.push(value);
  table.index.set(value, table.values.length - 1);
  return table.values.length - 1;
}

function currentLoop(st: FnState): Loop {
  const loop = st.loops[st.loops.length - 1];
  if (loop === undefined) throw new Error('internal: break/continue outside loop');
  return loop;
}

// ---- statements

function lowerAssign(st: FnState, stmt: Extract<TStmt, { kind: 'assign' }>): void {
  const { place, op } = stmt;
  switch (place.kind) {
    case 'local': {
      // A local can't change while the right-hand side runs, so it can be read after it.
      const value = lowerValue(st, stmt.value);
      if (op === '=') {
        emit(st, { kind: 'copy', dst: place.local.id, src: value });
      } else {
        const self: Operand = { kind: 'local', id: place.local.id };
        emit(st, { kind: 'binop', dst: place.local.id, op: binOp(binaryOpOf(op), place.type), left: self, right: value });
      }
      return;
    }
    case 'field': {
      const object = lowerValue(st, place.object);
      storeThroughPlace(
        st,
        stmt,
        (dst) => ({ kind: 'field_get', dst, object, field: place.field }),
        (value) => ({ kind: 'field_set', object, field: place.field, value }),
      );
      return;
    }
  }
}

/**
 * Finishes an assignment to a place whose sub-expressions are already lowered (so they run exactly once): computes
 * the new value, via `read` for compound operators, and emits `write`.
 */
function storeThroughPlace(
  st: FnState,
  stmt: Extract<TStmt, { kind: 'assign' }>,
  read: (dst: number) => Instr,
  write: (value: Operand) => Instr,
): void {
  const { place, op } = stmt;
  const value = op === '=' ? lowerValue(st, stmt.value) : combine(st, op, place.type, read, stmt.value);
  emit(st, write(value));
}

/** For `place op= rhs`: loads the place's current value, evaluates `rhs`, applies `op` and returns the result. */
function combine(st: FnState, op: CompoundOp, type: Type, read: (dst: number) => Instr, rhs: TExpr): Operand {
  const old = newTemp(st, irType(type));
  emit(st, read(old));
  const value = lowerValue(st, rhs);
  const dst = newTemp(st, irType(type));
  emit(st, { kind: 'binop', dst, op: binOp(binaryOpOf(op), type), left: { kind: 'local', id: old }, right: value });
  return { kind: 'local', id: dst };
}

function lowerBlock(st: FnState, block: TBlock): void {
  for (const stmt of block.statements) {
    if (!st.current) return; // the rest is unreachable
    lowerStmt(st, stmt);
  }
}

function lowerStmt(st: FnState, stmt: TStmt): void {
  switch (stmt.kind) {
    case 'let':
      emit(st, { kind: 'copy', dst: stmt.local.id, src: lowerValue(st, stmt.init) });
      return;
    case 'assign':
      lowerAssign(st, stmt);
      return;
    case 'expr':
      lowerExpr(st, stmt.expr);
      return;
    case 'block':
      lowerBlock(st, stmt);
      return;
    case 'return':
      terminate(st, { kind: 'ret', value: stmt.value ? lowerValue(st, stmt.value) : null });
      return;
    case 'break':
      terminate(st, { kind: 'jmp', target: currentLoop(st).breakLabel });
      return;
    case 'continue':
      terminate(st, { kind: 'jmp', target: currentLoop(st).continueLabel });
      return;
    case 'if': {
      const cond = lowerValue(st, stmt.cond);
      const thenLabel = newLabel(st, 'then');
      const elseLabel = stmt.else ? newLabel(st, 'else') : null;
      const endLabel = newLabel(st, 'endif');
      terminate(st, { kind: 'br', cond, then: thenLabel, else: elseLabel ?? endLabel });

      startBlock(st, thenLabel);
      lowerBlock(st, stmt.then);
      let reachesEnd = st.current !== null || elseLabel === null;
      terminate(st, { kind: 'jmp', target: endLabel });

      if (stmt.else && elseLabel) {
        startBlock(st, elseLabel);
        lowerBlock(st, stmt.else);
        if (st.current) reachesEnd = true;
        terminate(st, { kind: 'jmp', target: endLabel });
      }
      if (reachesEnd) startBlock(st, endLabel);
      return;
    }
    case 'while': {
      const head = newLabel(st, 'while_head');
      const body = newLabel(st, 'while_body');
      const end = newLabel(st, 'while_end');
      startBlock(st, head);
      const cond = lowerValue(st, stmt.cond);
      terminate(st, { kind: 'br', cond, then: body, else: end });
      startBlock(st, body);
      st.loops.push({ continueLabel: head, breakLabel: end });
      lowerBlock(st, stmt.body);
      st.loops.pop();
      terminate(st, { kind: 'jmp', target: head });
      startBlock(st, end);
      return;
    }
  }
}

// ---- expressions

function lowerValue(st: FnState, e: TExpr): Operand {
  const value = lowerExpr(st, e);
  if (value === null) throw new Error('internal: void expression used as a value');
  return value;
}

/** Lowers an expression and returns its value, or null for void expressions. */
function lowerExpr(st: FnState, e: TExpr): Operand | null {
  switch (e.kind) {
    case 'int':
      return { kind: 'int', value: e.value };
    case 'bool':
      return { kind: 'bool', value: e.value };
    case 'string':
      return { kind: 'string', index: internString(st.strings, e.value) };
    case 'local':
      return { kind: 'local', id: e.local.id };
    case 'unary': {
      const operand = lowerValue(st, e.operand);
      const dst = newTemp(st, irType(e.type));
      emit(st, { kind: 'unop', dst, op: e.op === '-' ? 'neg' : 'not', operand });
      return { kind: 'local', id: dst };
    }
    case 'binary': {
      if (e.op === '&&' || e.op === '||') return lowerShortCircuit(st, e.op, e.left, e.right);
      const left = lowerValue(st, e.left);
      const right = lowerValue(st, e.right);
      const dst = newTemp(st, irType(e.type));
      emit(st, { kind: 'binop', dst, op: binOp(e.op, e.left.type), left, right });
      return { kind: 'local', id: dst };
    }
    case 'call': {
      const args = e.args.map((a) => lowerValue(st, a));
      const dst = e.type.kind === 'void' ? null : newTemp(st, irType(e.type));
      emit(st, { kind: 'call', dst, fn: e.fn, args });
      return dst === null ? null : { kind: 'local', id: dst };
    }
    case 'builtin': {
      const args = e.args.map((a) => lowerValue(st, a));
      const dst = e.type.kind === 'void' ? null : newTemp(st, irType(e.type));
      emit(st, { kind: 'call_builtin', dst, builtin: irBuiltin(e), args });
      if (e.builtin === 'panic') terminate(st, { kind: 'unreachable' });
      return dst === null ? null : { kind: 'local', id: dst };
    }
    case 'if': {
      const cond = lowerValue(st, e.cond);
      const thenLabel = newLabel(st, 'then');
      const elseLabel = newLabel(st, 'else');
      const endLabel = newLabel(st, 'endif');
      const dst = newTemp(st, irType(e.type));
      terminate(st, { kind: 'br', cond, then: thenLabel, else: elseLabel });
      startBlock(st, thenLabel);
      emit(st, { kind: 'copy', dst, src: lowerValue(st, e.then) });
      terminate(st, { kind: 'jmp', target: endLabel });
      startBlock(st, elseLabel);
      emit(st, { kind: 'copy', dst, src: lowerValue(st, e.else) });
      terminate(st, { kind: 'jmp', target: endLabel });
      startBlock(st, endLabel);
      return { kind: 'local', id: dst };
    }
    case 'field': {
      const object = lowerValue(st, e.object);
      const dst = newTemp(st, irType(e.type));
      emit(st, { kind: 'field_get', dst, object, field: e.field });
      return { kind: 'local', id: dst };
    }
    case 'structLit': {
      // Evaluate in written order, then hand the values over in declaration order. Reordering operands is safe
      // because no Aster expression can assign to a local.
      const values = new Map<string, Operand>();
      for (const f of e.fields) values.set(f.field, lowerValue(st, f.value));
      const decl = st.structs.get(e.struct);
      if (!decl) throw new Error(`internal: unknown struct ${e.struct}`);
      const fields = decl.fields.map((f) => {
        const value = values.get(f.name);
        if (value === undefined) throw new Error(`internal: missing field ${f.name}`);
        return { name: f.name, value };
      });
      const dst = newTemp(st, irType(e.type));
      emit(st, { kind: 'struct_new', dst, struct: e.struct, fields });
      return { kind: 'local', id: dst };
    }
  }
}

function lowerShortCircuit(st: FnState, op: '&&' | '||', left: TExpr, right: TExpr): Operand {
  const l = lowerValue(st, left);
  const rhs = newLabel(st, op === '&&' ? 'and_rhs' : 'or_rhs');
  const end = newLabel(st, op === '&&' ? 'and_end' : 'or_end');
  const dst = newTemp(st, irType(BOOL));
  emit(st, { kind: 'copy', dst, src: l });
  terminate(
    st,
    op === '&&' ? { kind: 'br', cond: l, then: rhs, else: end } : { kind: 'br', cond: l, then: end, else: rhs },
  );
  startBlock(st, rhs);
  emit(st, { kind: 'copy', dst, src: lowerValue(st, right) });
  terminate(st, { kind: 'jmp', target: end });
  startBlock(st, end);
  return { kind: 'local', id: dst };
}

function binOp(op: BinaryOp, operandType: Type): IrBinOp {
  if (op === '&&' || op === '||') throw new Error('internal: short-circuit operator in binOp');
  if (operandType.kind === 'string') {
    if (op === '+') return 'concat';
    if (op === '==') return 'str_eq';
    if (op === '!=') return 'str_ne';
  }
  return INT_BINOPS[op];
}

function irBuiltin(e: Extract<TExpr, { kind: 'builtin' }>): IrBuiltin {
  if (e.builtin !== 'print') return e.builtin;
  const t = e.args[0].type.kind;
  return t === 'int' ? 'print_int' : t === 'bool' ? 'print_bool' : 'print_string';
}

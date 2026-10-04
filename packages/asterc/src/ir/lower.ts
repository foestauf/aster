import { binaryOpOf, type BinaryOp, type CompoundOp } from '../ast/ast.js';
import type { TBlock, TEnum, TExpr, TFunction, TPattern, TStmt, TStruct, TypedProgram } from '../check/types.js';
import { BOOL, INT, STRING, type Type } from '../types/type.js';
import type {
  BasicBlock, Instr, IrBinOp, IrBuiltin, IrEnum, IrFunction, IrLocal, IrProgram, IrStruct, IrType, Operand, Terminator,
} from './ir.js';

interface StringTable {
  values: string[];
  index: Map<string, number>;
}

interface Loop {
  continueLabel: string;
  breakLabel: string;
  /** Set when a `continue` targets this loop, so its continue block is reachable. */
  continued: boolean;
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
  return { structs: program.structs.map(irStruct), enums: program.enums.map(irEnum), functions, strings: strings.values };
}

const irStruct = (s: TStruct): IrStruct => ({
  name: s.name,
  fields: s.fields.map((f) => ({ name: f.name, type: irType(f.type) })),
});

const irEnum = (e: TEnum): IrEnum => ({
  name: e.name,
  payloadFree: e.payloadFree,
  variants: e.variants.map((v) => ({ name: v.name, tag: v.tag, payload: v.payload.map(irType) })),
});

function irType(t: Type): IrType {
  if (t.kind === 'error') throw new Error('internal: error type reached lowering');
  if (t.kind === 'never') throw new Error('internal: never type reached lowering');
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
  // A never function is void in the IR: the checker guarantees its body diverges, so this is a no-op for it.
  const returnType: IrType = fn.returnType.kind === 'never' ? { kind: 'void' } : irType(fn.returnType);
  terminate(st, returnType.kind === 'void' ? { kind: 'ret', value: null } : { kind: 'unreachable' });
  return {
    name: fn.name,
    paramCount: fn.params.length,
    locals: st.locals,
    returnType,
    blocks: pruneUnreachable(st.blocks),
  };
}

/** Keeps only the blocks reachable from the entry block, in their original order. */
function pruneUnreachable(blocks: BasicBlock[]): BasicBlock[] {
  if (blocks.length === 0) return blocks;
  const byLabel = new Map(blocks.map((b) => [b.label, b]));
  const reached = new Set<string>();
  const work = [blocks[0].label];
  while (work.length > 0) {
    const label = work.pop()!;
    if (reached.has(label)) continue;
    reached.add(label);
    const term = byLabel.get(label)!.term;
    if (term.kind === 'jmp') work.push(term.target);
    else if (term.kind === 'br') work.push(term.then, term.else);
    else if (term.kind === 'switch') {
      work.push(...term.cases.map((c) => c.target));
      if (term.default !== null) work.push(term.default);
    }
  }
  return blocks.filter((b) => reached.has(b.label));
}

// ---- block plumbing

const newLabel = (st: FnState, hint: string): string => `${hint}${++st.labelCount}`;

function newTemp(st: FnState, type: IrType): number {
  const id = st.locals.length;
  st.locals.push({ id, name: null, type });
  return id;
}

function emit(st: FnState, instr: Instr): void {
  // Code after a never expression is unreachable: drop it rather than emit it.
  if (!st.current) return;
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
    case 'index': {
      const array = lowerValue(st, place.array);
      const index = lowerValue(st, place.index);
      storeThroughPlace(
        st,
        stmt,
        (dst) => ({ kind: 'index_get', dst, array, index }),
        (value) => ({ kind: 'index_set', array, index, value }),
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
    case 'match':
      lowerMatch(st, stmt.scrutinee, stmt.arms.map((a) => a.pattern), (i) => lowerBlock(st, stmt.arms[i].body));
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
    case 'continue': {
      const loop = currentLoop(st);
      loop.continued = true;
      terminate(st, { kind: 'jmp', target: loop.continueLabel });
      return;
    }
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
      st.loops.push({ continueLabel: head, breakLabel: end, continued: false });
      lowerBlock(st, stmt.body);
      st.loops.pop();
      terminate(st, { kind: 'jmp', target: head });
      startBlock(st, end);
      return;
    }
    case 'forRange': {
      const start = lowerValue(st, stmt.start);
      const end = lowerValue(st, stmt.end);
      const counter = newTemp(st, irType(INT));
      const limit = newTemp(st, irType(INT));
      emit(st, { kind: 'copy', dst: counter, src: start });
      emit(st, { kind: 'copy', dst: limit, src: end });
      lowerFor(st, stmt.body, counter, {
        cond: () => {
          const c = newTemp(st, irType(BOOL));
          emit(st, { kind: 'binop', dst: c, op: 'lt', left: ref(counter), right: ref(limit) });
          return ref(c);
        },
        bind: () => emit(st, { kind: 'copy', dst: stmt.local.id, src: ref(counter) }),
      });
      return;
    }
    case 'forEach': {
      const source = lowerValue(st, stmt.array);
      const array = newTemp(st, irType(stmt.array.type));
      const index = newTemp(st, irType(INT));
      emit(st, { kind: 'copy', dst: array, src: source });
      emit(st, { kind: 'copy', dst: index, src: { kind: 'int', value: 0n } });
      lowerFor(st, stmt.body, index, {
        cond: () => {
          const n = newTemp(st, irType(INT));
          emit(st, { kind: 'array_len', dst: n, array: ref(array) });
          const c = newTemp(st, irType(BOOL));
          emit(st, { kind: 'binop', dst: c, op: 'lt', left: ref(index), right: ref(n) });
          return ref(c);
        },
        bind: () => emit(st, { kind: 'index_get', dst: stmt.local.id, array: ref(array), index: ref(index) }),
      });
      return;
    }
  }
}

const ref = (id: number): Operand => ({ kind: 'local', id });
const ONE: Operand = { kind: 'int', value: 1n };

/**
 * The shared shape of both for loops (`counter` is the hidden int local that the step block increments):
 *   head: br cond, body, end
 *   body: bind the loop variable; body; jmp step
 *   step: counter += 1; jmp head   (only when the body can fall through or continue; an unused label would warn)
 *   end:
 */
function lowerFor(st: FnState, body: TBlock, counter: number, parts: { cond: () => Operand; bind: () => void }): void {
  const head = newLabel(st, 'for_head');
  const bodyLabel = newLabel(st, 'for_body');
  const step = newLabel(st, 'for_step');
  const end = newLabel(st, 'for_end');
  startBlock(st, head);
  const cond = parts.cond();
  terminate(st, { kind: 'br', cond, then: bodyLabel, else: end });
  startBlock(st, bodyLabel);
  parts.bind();
  const loop: Loop = { continueLabel: step, breakLabel: end, continued: false };
  st.loops.push(loop);
  lowerBlock(st, body);
  st.loops.pop();
  if (st.current !== null || loop.continued) {
    startBlock(st, step);
    emit(st, { kind: 'binop', dst: counter, op: 'add', left: ref(counter), right: ONE });
    terminate(st, { kind: 'jmp', target: head });
  }
  startBlock(st, end);
}

/**
 * The shape of a match:
 *   enum:     entry: t = enum_tag s; switch t [tag: armN, ...], default <the `_` arm, or unreachable>
 *   int/bool: entry: switch s [value: armN, ...], default <the `_` arm, or unreachable>
 *   string:   entry: a chain of `str_eq s, "lit"` tests, each br armN / next test, in arm order;
 *             a `_` arm ends the chain with a jmp, otherwise the chain ends in unreachable
 *   armN:     binder = enum_field s, Enum::Variant.slot (for each binder); body; jmp endmatch
 *   endmatch: (only when some arm falls through; an unused label would warn)
 * The scrutinee is evaluated once, and binders are read before the body runs.
 */
function lowerMatch(st: FnState, scrutinee: TExpr, patterns: readonly TPattern[], lowerBody: (index: number) => void): void {
  const value = lowerValue(st, scrutinee);
  const labels = patterns.map(() => newLabel(st, 'arm'));
  const end = newLabel(st, 'endmatch');
  const enumName = scrutinee.type.kind === 'enum' ? scrutinee.type.name : '';
  if (scrutinee.type.kind === 'enum') {
    lowerSwitch(st, enumTag(st, value), patterns, labels);
  } else if (scrutinee.type.kind === 'string') {
    lowerStringTests(st, value, patterns, labels);
  } else {
    lowerSwitch(st, value, patterns, labels);
  }
  let reachesEnd = false;
  for (const [i, p] of patterns.entries()) {
    startBlock(st, labels[i]);
    if (p.kind === 'variants' && p.variants.length === 1) {
      const variant = p.variants[0];
      for (const [index, binder] of p.binders.entries()) {
        if (binder === null) continue;
        emit(st, { kind: 'enum_field', dst: binder.id, value, enum: enumName, variant: variant.name, tag: variant.tag, index });
      }
    }
    lowerBody(i);
    if (st.current !== null) reachesEnd = true;
    terminate(st, { kind: 'jmp', target: end });
  }
  if (reachesEnd) startBlock(st, end);
}

/** Terminates the current block with a switch on an enum tag, an int or a bool. */
function lowerSwitch(st: FnState, on: Operand, patterns: readonly TPattern[], labels: readonly string[]): void {
  const cases: { value: bigint; target: string }[] = [];
  let fallback: string | null = null;
  for (const [i, p] of patterns.entries()) {
    if (p.kind === 'wildcard') fallback = labels[i];
    else if (p.kind === 'variants') for (const v of p.variants) cases.push({ value: BigInt(v.tag), target: labels[i] });
    else if (p.kind === 'ints') for (const v of p.values) cases.push({ value: v, target: labels[i] });
    else throw new Error('internal: string pattern on a non-string match');
  }
  terminate(st, { kind: 'switch', value: on, cases, default: fallback });
}

/** A string match is a chain of equality tests, in arm order; a `_` arm ends it. */
function lowerStringTests(st: FnState, on: Operand, patterns: readonly TPattern[], labels: readonly string[]): void {
  for (const [i, p] of patterns.entries()) {
    if (p.kind === 'wildcard') {
      terminate(st, { kind: 'jmp', target: labels[i] });
      return;
    }
    if (p.kind !== 'strings') throw new Error('internal: non-string pattern on a string match');
    for (const v of p.values) {
      const test = newTemp(st, { kind: 'bool' });
      emit(st, { kind: 'binop', dst: test, op: 'str_eq', left: on, right: { kind: 'string', index: internString(st.strings, v) } });
      const next = newLabel(st, 'test');
      terminate(st, { kind: 'br', cond: ref(test), then: labels[i], else: next });
      startBlock(st, next);
    }
  }
  terminate(st, { kind: 'unreachable' });
}

// ---- expressions

function lowerValue(st: FnState, e: TExpr): Operand {
  const value = lowerExpr(st, e);
  if (value === null) throw new Error('internal: void expression used as a value');
  return value;
}

/** Stands in for the value of an expression in unreachable code. Only ever used there, and that code is pruned. */
const PLACEHOLDER: Operand = { kind: 'int', value: 0n };

/** Lowers an expression and returns its value, or null for void expressions. */
function lowerExpr(st: FnState, e: TExpr): Operand | null {
  if (!st.current) return PLACEHOLDER;
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
      const dst = e.type.kind === 'void' || e.type.kind === 'never' ? null : newTemp(st, irType(e.type));
      emit(st, { kind: 'call', dst, fn: e.fn, args });
      if (e.type.kind === 'never') {
        terminate(st, { kind: 'unreachable' });
        return PLACEHOLDER;
      }
      return dst === null ? null : { kind: 'local', id: dst };
    }
    case 'builtin': {
      const args = e.args.map((a) => lowerValue(st, a));
      if (e.builtin === 'read_file') return lowerReadFile(st, args[0], e.type as Extract<Type, { kind: 'enum' }>);
      if (e.builtin === 'push') {
        emit(st, { kind: 'array_push', array: args[0], value: args[1] });
        return null;
      }
      if (e.builtin === 'pop' || (e.builtin === 'len' && e.args[0].type.kind === 'array')) {
        const dst = newTemp(st, irType(e.type));
        emit(st, e.builtin === 'pop' ? { kind: 'array_pop', dst, array: args[0] } : { kind: 'array_len', dst, array: args[0] });
        return { kind: 'local', id: dst };
      }
      const dst = e.type.kind === 'void' || e.type.kind === 'never' ? null : newTemp(st, irType(e.type));
      emit(st, { kind: 'call_builtin', dst, builtin: irBuiltin(e), args });
      if (e.type.kind === 'never') {
        terminate(st, { kind: 'unreachable' });
        return PLACEHOLDER;
      }
      return dst === null ? null : { kind: 'local', id: dst };
    }
    case 'match': {
      if (e.type.kind === 'never') {
        lowerMatch(st, e.scrutinee, e.arms.map((a) => a.pattern), (i) => {
          const body = e.arms[i].body;
          if (body.kind === 'block') lowerBlock(st, body);
          else lowerValue(st, body);
        });
        return PLACEHOLDER;
      }
      const dst = newTemp(st, irType(e.type));
      lowerMatch(st, e.scrutinee, e.arms.map((a) => a.pattern), (i) => {
        const body = e.arms[i].body;
        // A block arm diverges, so it has no value to copy.
        if (body.kind === 'block') lowerBlock(st, body);
        else emit(st, { kind: 'copy', dst, src: lowerValue(st, body) });
      });
      return { kind: 'local', id: dst };
    }
    case 'if': {
      const cond = lowerValue(st, e.cond);
      const thenLabel = newLabel(st, 'then');
      const elseLabel = newLabel(st, 'else');
      const endLabel = newLabel(st, 'endif');
      const never = e.type.kind === 'never';
      const dst = never ? null : newTemp(st, irType(e.type));
      terminate(st, { kind: 'br', cond, then: thenLabel, else: elseLabel });
      startBlock(st, thenLabel);
      const thenValue = lowerValue(st, e.then);
      if (dst !== null) emit(st, { kind: 'copy', dst, src: thenValue });
      terminate(st, { kind: 'jmp', target: endLabel });
      startBlock(st, elseLabel);
      const elseValue = lowerValue(st, e.else);
      if (dst !== null) emit(st, { kind: 'copy', dst, src: elseValue });
      terminate(st, { kind: 'jmp', target: endLabel });
      // When both branches diverge nothing reaches the end, so the position stays unreachable.
      if (dst === null) return PLACEHOLDER;
      startBlock(st, endLabel);
      return { kind: 'local', id: dst };
    }
    case 'field': {
      const object = lowerValue(st, e.object);
      const dst = newTemp(st, irType(e.type));
      emit(st, { kind: 'field_get', dst, object, field: e.field });
      return { kind: 'local', id: dst };
    }
    case 'index': {
      const array = lowerValue(st, e.array);
      const index = lowerValue(st, e.index);
      const dst = newTemp(st, irType(e.type));
      emit(st, { kind: 'index_get', dst, array, index });
      return { kind: 'local', id: dst };
    }
    case 'arrayLit': {
      const elements = e.elements.map((el) => lowerValue(st, el));
      const type = irType(e.type);
      if (type.kind !== 'array') throw new Error('internal: array literal without an array type');
      const dst = newTemp(st, type);
      emit(st, { kind: 'array_new', dst, elem: irType(type.elem), elements });
      return { kind: 'local', id: dst };
    }
    case 'variant': {
      const args = e.args.map((a) => lowerValue(st, a));
      const dst = newTemp(st, irType(e.type));
      emit(st, { kind: 'enum_new', dst, enum: e.enum, variant: e.variant, tag: e.tag, args });
      return { kind: 'local', id: dst };
    }
    case 'enumCompare': {
      const left = enumTag(st, lowerValue(st, e.left));
      const right = enumTag(st, lowerValue(st, e.right));
      const dst = newTemp(st, irType(BOOL));
      emit(st, { kind: 'binop', dst, op: e.op === '==' ? 'eq' : 'ne', left, right });
      return { kind: 'local', id: dst };
    }
    case 'try': {
      // `operand?`: branch on the tag; the failure path builds the return enum's failure value and returns it.
      if (e.operand.type.kind !== 'enum') throw new Error('internal: ? on a non-enum operand');
      const operandEnum = e.operand.type.name;
      const value = lowerValue(st, e.operand);
      const tag = enumTag(st, value);
      const isOk = newTemp(st, irType(BOOL));
      emit(st, { kind: 'binop', dst: isOk, op: 'eq', left: tag, right: { kind: 'int', value: BigInt(e.okTag) } });
      const okLabel = newLabel(st, 'try_ok');
      const failLabel = newLabel(st, 'try_fail');
      terminate(st, { kind: 'br', cond: ref(isOk), then: okLabel, else: failLabel });
      startBlock(st, failLabel);
      const args: Operand[] = [];
      if (e.failPayloadType !== null) {
        const payload = newTemp(st, irType(e.failPayloadType));
        emit(st, { kind: 'enum_field', dst: payload, value, enum: operandEnum, variant: e.failVariant, tag: e.failTag, index: 0 });
        args.push(ref(payload));
      }
      const failValue = newTemp(st, irType(e.returnType));
      emit(st, { kind: 'enum_new', dst: failValue, enum: e.returnEnum, variant: e.returnFailVariant, tag: e.returnFailTag, args });
      terminate(st, { kind: 'ret', value: ref(failValue) });
      // The fail block is terminated, so opening the ok block adds no fall-through jump.
      startBlock(st, okLabel);
      const dst = newTemp(st, irType(e.type));
      emit(st, { kind: 'enum_field', dst, value, enum: operandEnum, variant: e.okVariant, tag: e.okTag, index: 0 });
      return ref(dst);
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

/** Reads the tag of an enum value into a new int temporary. */
function enumTag(st: FnState, value: Operand): Operand {
  const dst = newTemp(st, irType(INT));
  emit(st, { kind: 'enum_tag', dst, value });
  return ref(dst);
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
  switch (e.builtin) {
    case 'print': {
      const t = e.args[0].type.kind;
      return t === 'int' ? 'print_int' : t === 'bool' ? 'print_bool' : 'print_string';
    }
    case 'eprint': {
      const t = e.args[0].type.kind;
      return t === 'int' ? 'eprint_int' : t === 'bool' ? 'eprint_bool' : 'eprint_string';
    }
    case 'push':
    case 'pop':
      throw new Error(`internal: ${e.builtin} is lowered to an array instruction`);
    case 'read_file':
      throw new Error('internal: read_file is lowered to a read_file instruction');
    default:
      return e.builtin;
  }
}

/** `read_file(p)`: the runtime fills an ok flag and a string, then each outcome builds its Result variant. */
function lowerReadFile(st: FnState, path: Operand, resultType: Extract<Type, { kind: 'enum' }>): Operand {
  const ok = newTemp(st, irType(BOOL));
  const text = newTemp(st, irType(STRING));
  const dst = newTemp(st, irType(resultType));
  emit(st, { kind: 'read_file', ok, text, path });
  const okLabel = newLabel(st, 'read_ok');
  const errLabel = newLabel(st, 'read_err');
  const endLabel = newLabel(st, 'read_end');
  terminate(st, { kind: 'br', cond: { kind: 'local', id: ok }, then: okLabel, else: errLabel });
  for (const [label, variant, tag] of [[okLabel, 'Ok', 0], [errLabel, 'Err', 1]] as const) {
    startBlock(st, label);
    emit(st, { kind: 'enum_new', dst, enum: resultType.name, variant, tag, args: [{ kind: 'local', id: text }] });
    terminate(st, { kind: 'jmp', target: endLabel });
  }
  startBlock(st, endLabel);
  return { kind: 'local', id: dst };
}

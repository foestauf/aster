import {
  binaryOpOf, type AssignStmt, type BinaryExpr, type BinaryOp, type Block, type ArrayLitExpr, type CallExpr, type Expr, type FnDecl, type IfStmt, type Program, type Stmt, type StructDecl,
  type StructLitExpr, type TypeExpr,
} from '../ast/ast.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { Span } from '../diagnostics/source.js';
import { BOOL, ERROR, INT, STRING, VOID, typeEquals, typeToString, type Type } from '../types/type.js';
import { BUILTIN_SIGNATURES, isBuiltin, isSignatureBuiltin, type Signature, type SignatureBuiltin } from './builtins.js';
import type { Local, TBlock, TExpr, TField, TFunction, TPlace, TStmt, TStruct, TypedProgram } from './types.js';

export interface CheckResult {
  program: TypedProgram;
  diagnostics: Diagnostic[];
}

/** State shared by the whole program check. */
interface Env {
  diagnostics: Diagnostic[];
  /** Every accepted struct, by name. Struct names live in the type namespace. */
  structs: Map<string, TStruct>;
}

/** Per-function checking state. */
interface Ctx extends Env {
  signatures: Map<string, Signature>;
  returnType: Type;
  locals: Local[];
  scopes: Map<string, Local>[];
  loops: { hasBreak: boolean }[];
}

interface Checked<T> {
  node: T;
  /** True when control can never continue past this statement. */
  diverges: boolean;
}

const PRIMITIVES: ReadonlyMap<string, Type> = new Map<string, Type>([
  ['int', INT],
  ['bool', BOOL],
  ['string', STRING],
  ['void', VOID],
]);

const report = (env: Env, message: string, span: Span): void => {
  env.diagnostics.push({ message, span });
};

const isError = (t: Type): boolean => t.kind === 'error';

const errorExpr = (): TExpr => ({ kind: 'int', type: ERROR, value: 0n });

function resolveType(env: Env, ref: TypeExpr): Type {
  if (ref.kind === 'array') {
    const elem = resolveType(env, ref.elem);
    if (elem.kind === 'void') {
      report(env, 'array element type cannot be void', ref.elem.span);
      return ERROR;
    }
    return isError(elem) ? ERROR : { kind: 'array', elem };
  }
  const primitive = PRIMITIVES.get(ref.name);
  if (primitive) return primitive;
  if (env.structs.has(ref.name)) return { kind: 'struct', name: ref.name };
  report(env, `unknown type '${ref.name}'`, ref.span);
  return ERROR;
}

const findField = (env: Env, struct: string, name: string): TField | undefined =>
  env.structs.get(struct)?.fields.find((f) => f.name === name);

/** Struct and array values are heap references; v0.1 defines no equality for them. */
const isReference = (t: Type): boolean => t.kind === 'struct' || t.kind === 'array';

/** Registers every struct name before resolving any field type, so structs can refer to each other in any order. */
function collectStructs(env: Env, decls: readonly StructDecl[]): TStruct[] {
  const accepted: { decl: StructDecl; struct: TStruct }[] = [];
  for (const decl of decls) {
    if (PRIMITIVES.has(decl.name)) {
      report(env, `'${decl.name}' is a built-in type and cannot be redefined`, decl.nameSpan);
    } else if (isBuiltin(decl.name)) {
      report(env, `'${decl.name}' is a builtin function and cannot be redefined`, decl.nameSpan);
    } else if (env.structs.has(decl.name)) {
      report(env, `duplicate struct '${decl.name}'`, decl.nameSpan);
    } else {
      const struct: TStruct = { name: decl.name, fields: [] };
      env.structs.set(decl.name, struct);
      accepted.push({ decl, struct });
    }
  }
  for (const { decl, struct } of accepted) {
    for (const field of decl.fields) {
      if (struct.fields.some((f) => f.name === field.name)) {
        report(env, `duplicate field '${field.name}'`, field.nameSpan);
        continue;
      }
      let type = resolveType(env, field.type);
      if (type.kind === 'void') {
        report(env, 'field cannot have type void', field.type.span);
        type = ERROR;
      }
      struct.fields.push({ name: field.name, type });
    }
  }
  return accepted.map((a) => a.struct);
}

export function check(program: Program): CheckResult {
  const env: Env = { diagnostics: [], structs: new Map() };
  const structs = collectStructs(env, program.structs);

  // Pass 1: collect signatures so functions can be called before their declaration.
  const signatures = new Map<string, Signature>();
  const declared: { decl: FnDecl; sig: Signature }[] = [];
  for (const decl of program.functions) {
    if (isBuiltin(decl.name)) {
      report(env, `'${decl.name}' is a builtin function and cannot be redefined`, decl.nameSpan);
      continue;
    }
    if (env.structs.has(decl.name)) {
      report(env, `'${decl.name}' is already declared as a struct`, decl.nameSpan);
      continue;
    }
    if (signatures.has(decl.name)) {
      report(env, `duplicate function '${decl.name}'`, decl.nameSpan);
      continue;
    }
    const params = decl.params.map((p) => {
      const type = resolveType(env, p.type);
      if (type.kind !== 'void') return type;
      report(env, 'parameter cannot have type void', p.type.span);
      return ERROR;
    });
    const sig: Signature = { params, returnType: decl.returnType ? resolveType(env, decl.returnType) : VOID };
    signatures.set(decl.name, sig);
    declared.push({ decl, sig });
  }

  const main = declared.find((d) => d.decl.name === 'main');
  if (!main) {
    report(env, "missing 'fn main(): int'", { start: 0, end: 0 });
  } else if (main.sig.params.length !== 0 || main.sig.returnType.kind !== 'int') {
    report(env, "'main' must have signature 'fn main(): int'", main.decl.nameSpan);
  }

  // Pass 2: check bodies.
  const functions = declared.map(({ decl, sig }) => checkFunction(env, signatures, decl, sig));
  return { program: { structs, functions }, diagnostics: env.diagnostics };
}

function checkFunction(env: Env, signatures: Map<string, Signature>, decl: FnDecl, sig: Signature): TFunction {
  const ctx: Ctx = {
    ...env,
    signatures,
    returnType: sig.returnType,
    locals: [],
    scopes: [new Map()],
    loops: [],
  };
  const params = decl.params.map((p, i) => declare(ctx, p.name, p.nameSpan, sig.params[i], false));
  const body = checkBlock(ctx, decl.body);
  if (!body.diverges && sig.returnType.kind !== 'void' && !isError(sig.returnType)) {
    report(ctx, `function '${decl.name}' is missing a return on some paths`, decl.nameSpan);
  }
  return { name: decl.name, params, locals: ctx.locals, returnType: sig.returnType, body: body.node };
}

function declare(ctx: Ctx, name: string, nameSpan: Span, type: Type, mutable: boolean): Local {
  const scope = ctx.scopes[ctx.scopes.length - 1];
  if (scope.has(name)) report(ctx, `'${name}' is already declared in this scope`, nameSpan);
  const local: Local = { id: ctx.locals.length, name, type, mutable };
  ctx.locals.push(local);
  scope.set(name, local);
  return local;
}

function lookup(ctx: Ctx, name: string): Local | undefined {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const local = ctx.scopes[i].get(name);
    if (local) return local;
  }
  return undefined;
}

const isFunctionName = (ctx: Ctx, name: string): boolean => ctx.signatures.has(name) || isBuiltin(name);

function expectType(ctx: Ctx, expected: Type, actual: TExpr, span: Span): void {
  if (isError(expected) || isError(actual.type) || typeEquals(expected, actual.type)) return;
  report(ctx, `type mismatch: expected ${typeToString(expected)}, found ${typeToString(actual.type)}`, span);
}

function checkCondition(ctx: Ctx, expr: Expr): TExpr {
  const cond = checkExpr(ctx, expr);
  if (cond.type.kind !== 'bool' && !isError(cond.type)) {
    report(ctx, `condition must be bool, found ${typeToString(cond.type)}`, expr.span);
  }
  return cond;
}

// ---- statements

function checkBlock(ctx: Ctx, block: Block): Checked<TBlock> {
  ctx.scopes.push(new Map());
  const statements: TStmt[] = [];
  let diverges = false;
  for (const stmt of block.statements) {
    const checked = checkStmt(ctx, stmt);
    statements.push(checked.node);
    if (checked.diverges) diverges = true;
  }
  ctx.scopes.pop();
  return { node: { kind: 'block', statements }, diverges };
}

function checkStmt(ctx: Ctx, stmt: Stmt): Checked<TStmt> {
  switch (stmt.kind) {
    case 'let': {
      let type = resolveType(ctx, stmt.type);
      if (type.kind === 'void') {
        report(ctx, 'variable cannot have type void', stmt.type.span);
        type = ERROR;
      }
      const init = checkExpr(ctx, stmt.init, type);
      expectType(ctx, type, init, stmt.init.span);
      const local = declare(ctx, stmt.name, stmt.nameSpan, type, stmt.mutable);
      return { node: { kind: 'let', local, init }, diverges: false };
    }
    case 'assign': {
      const place = checkPlace(ctx, stmt.target);
      // A target that was already reported has no type to guide the value, and must not cascade into it.
      const value = checkExpr(ctx, stmt.value, place === null ? ERROR : place.type);
      if (place === null) return { node: { kind: 'expr', expr: value }, diverges: false };
      if (stmt.op === '=') expectType(ctx, place.type, value, stmt.value.span);
      else checkCompound(ctx, stmt, place.type, value);
      return { node: { kind: 'assign', place, op: stmt.op, value }, diverges: false };
    }
    case 'if':
      return checkIf(ctx, stmt);
    case 'while': {
      const cond = checkCondition(ctx, stmt.cond);
      const loop = { hasBreak: false };
      ctx.loops.push(loop);
      const body = checkBlock(ctx, stmt.body);
      ctx.loops.pop();
      const infinite = stmt.cond.kind === 'bool' && stmt.cond.value && !loop.hasBreak;
      return { node: { kind: 'while', cond, body: body.node }, diverges: infinite };
    }
    case 'forRange': {
      const start = checkRangeBound(ctx, stmt.start);
      const end = checkRangeBound(ctx, stmt.end);
      const { local, body } = checkForBody(ctx, stmt.name, stmt.nameSpan, INT, stmt.body);
      // A for loop may run zero times, so it never ends a control path on its own.
      return { node: { kind: 'forRange', local, start, end, body }, diverges: false };
    }
    case 'forEach': {
      const array = checkExpr(ctx, stmt.iterable);
      let elem: Type = ERROR;
      if (array.type.kind === 'array') elem = array.type.elem;
      else if (!isError(array.type)) {
        report(ctx, `cannot iterate over a value of type ${typeToString(array.type)}`, stmt.iterable.span);
      }
      const { local, body } = checkForBody(ctx, stmt.name, stmt.nameSpan, elem, stmt.body);
      return { node: { kind: 'forEach', local, array, body }, diverges: false };
    }
    case 'break':
    case 'continue': {
      const loop = ctx.loops[ctx.loops.length - 1];
      if (loop === undefined) report(ctx, `'${stmt.kind}' outside of loop`, stmt.span);
      else if (stmt.kind === 'break') loop.hasBreak = true;
      return { node: stmt.kind === 'break' ? { kind: 'break' } : { kind: 'continue' }, diverges: true };
    }
    case 'return': {
      if (stmt.value === null) {
        if (ctx.returnType.kind !== 'void' && !isError(ctx.returnType)) {
          report(ctx, `missing return value: expected ${typeToString(ctx.returnType)}`, stmt.span);
        }
        return { node: { kind: 'return', value: null }, diverges: true };
      }
      const value = checkExpr(ctx, stmt.value, ctx.returnType);
      if (ctx.returnType.kind === 'void') report(ctx, 'void function cannot return a value', stmt.value.span);
      else expectType(ctx, ctx.returnType, value, stmt.value.span);
      return { node: { kind: 'return', value }, diverges: true };
    }
    case 'block':
      return checkBlock(ctx, stmt);
    case 'expr': {
      const expr = checkExpr(ctx, stmt.expr);
      const diverges = expr.kind === 'builtin' && expr.builtin === 'panic';
      return { node: { kind: 'expr', expr }, diverges };
    }
  }
}

function checkIf(ctx: Ctx, stmt: IfStmt): Checked<TStmt> {
  const cond = checkCondition(ctx, stmt.cond);
  const then = checkBlock(ctx, stmt.then);
  if (stmt.else === null) {
    return { node: { kind: 'if', cond, then: then.node, else: null }, diverges: false };
  }
  let other: Checked<TBlock>;
  if (stmt.else.kind === 'if') {
    const nested = checkIf(ctx, stmt.else);
    other = { node: { kind: 'block', statements: [nested.node] }, diverges: nested.diverges };
  } else {
    other = checkBlock(ctx, stmt.else);
  }
  return {
    node: { kind: 'if', cond, then: then.node, else: other.node },
    diverges: then.diverges && other.diverges,
  };
}

function checkRangeBound(ctx: Ctx, expr: Expr): TExpr {
  const bound = checkExpr(ctx, expr);
  if (!isError(bound.type) && bound.type.kind !== 'int') {
    report(ctx, `range bound must be int, found ${typeToString(bound.type)}`, expr.span);
  }
  return bound;
}

/** Checks a for-loop body with the immutable loop variable declared in a scope of its own. */
function checkForBody(ctx: Ctx, name: string, nameSpan: Span, type: Type, block: Block): { local: Local; body: TBlock } {
  ctx.scopes.push(new Map());
  const local = declare(ctx, name, nameSpan, type, false);
  ctx.loops.push({ hasBreak: false });
  const body = checkBlock(ctx, block);
  ctx.loops.pop();
  ctx.scopes.pop();
  return { local, body: body.node };
}

// ---- expressions

/** `expected` only guides array literals (and passes into if-expression branches); callers still check the result. */
function checkExpr(ctx: Ctx, expr: Expr, expected?: Type): TExpr {
  switch (expr.kind) {
    case 'int':
      return { kind: 'int', type: INT, value: expr.value };
    case 'string':
      return { kind: 'string', type: STRING, value: expr.value };
    case 'bool':
      return { kind: 'bool', type: BOOL, value: expr.value };
    case 'name': {
      const local = lookup(ctx, expr.name);
      if (local) return { kind: 'local', type: local.type, local };
      const message = isFunctionName(ctx, expr.name)
        ? `'${expr.name}' is a function, not a value`
        : `undefined name '${expr.name}'`;
      report(ctx, message, expr.span);
      return errorExpr();
    }
    case 'unary': {
      const operand = checkExpr(ctx, expr.operand);
      if (isError(operand.type)) return errorExpr();
      const want = expr.op === '-' ? INT : BOOL;
      if (!typeEquals(operand.type, want)) {
        report(ctx, `operator '${expr.op}' cannot be applied to ${typeToString(operand.type)}`, expr.span);
        return errorExpr();
      }
      return { kind: 'unary', type: want, op: expr.op, operand };
    }
    case 'binary':
      return checkBinary(ctx, expr);
    case 'call':
      return checkCall(ctx, expr);
    case 'ifExpr': {
      const cond = checkCondition(ctx, expr.cond);
      const then = checkExpr(ctx, expr.then, expected);
      const other = checkExpr(ctx, expr.else, expected);
      if (isError(then.type) || isError(other.type)) return errorExpr();
      if (!typeEquals(then.type, other.type)) {
        report(ctx, `if branches have different types: ${typeToString(then.type)} and ${typeToString(other.type)}`, expr.span);
        return errorExpr();
      }
      if (then.type.kind === 'void') {
        report(ctx, 'if expression cannot have type void', expr.span);
        return errorExpr();
      }
      return { kind: 'if', type: then.type, cond, then, else: other };
    }
    case 'field': {
      const object = checkExpr(ctx, expr.object);
      if (isError(object.type)) return errorExpr();
      const field = object.type.kind === 'struct' ? findField(ctx, object.type.name, expr.field) : undefined;
      if (!field) {
        report(ctx, `unknown field '${expr.field}' on '${typeToString(object.type)}'`, expr.fieldSpan);
        return errorExpr();
      }
      return { kind: 'field', type: field.type, object, field: expr.field };
    }
    case 'structLit':
      return checkStructLit(ctx, expr);
    case 'index': {
      const array = checkExpr(ctx, expr.array);
      const index = checkExpr(ctx, expr.index);
      if (!isError(index.type) && index.type.kind !== 'int') {
        report(ctx, `array index must be int, found ${typeToString(index.type)}`, expr.index.span);
      }
      if (isError(array.type)) return errorExpr();
      if (array.type.kind !== 'array') {
        report(ctx, `cannot index a value of type ${typeToString(array.type)}`, expr.array.span);
        return errorExpr();
      }
      if (index.type.kind !== 'int') return errorExpr();
      return { kind: 'index', type: array.type.elem, array, index };
    }
    case 'arrayLit':
      return checkArrayLit(ctx, expr, expected);
  }
}

function checkStructLit(ctx: Ctx, expr: StructLitExpr): TExpr {
  const struct = ctx.structs.get(expr.name);
  if (!struct) {
    report(ctx, `unknown struct '${expr.name}'`, expr.nameSpan);
    // Still check the values so their own errors surface; the `error` type keeps an `[]` value from being
    // reported as uninferable.
    for (const init of expr.fields) checkExpr(ctx, init.value, ERROR);
    return errorExpr();
  }
  const fields: { field: string; value: TExpr }[] = [];
  for (const init of expr.fields) {
    const decl = findField(ctx, struct.name, init.name);
    const value = checkExpr(ctx, init.value, decl?.type);
    if (!decl) {
      report(ctx, `unknown field '${init.name}' on '${expr.name}'`, init.nameSpan);
    } else if (fields.some((f) => f.field === init.name)) {
      report(ctx, `duplicate field '${init.name}'`, init.nameSpan);
    } else {
      expectType(ctx, decl.type, value, init.value.span);
      fields.push({ field: init.name, value });
    }
  }
  for (const f of struct.fields) {
    if (!fields.some((init) => init.field === f.name)) report(ctx, `missing field '${f.name}' in '${expr.name}'`, expr.nameSpan);
  }
  return { kind: 'structLit', type: { kind: 'struct', name: struct.name }, struct: struct.name, fields };
}

function checkArrayLit(ctx: Ctx, expr: ArrayLitExpr, expected: Type | undefined): TExpr {
  if (expected !== undefined && isError(expected)) {
    // The expected type was already reported as wrong; only look for errors inside the elements.
    for (const el of expr.elements) checkExpr(ctx, el);
    return errorExpr();
  }
  let elem = expected !== undefined && expected.kind === 'array' ? expected.elem : undefined;
  if (expr.elements.length === 0) {
    if (elem === undefined) {
      report(ctx, 'cannot infer type of empty array', expr.span);
      return errorExpr();
    }
    return { kind: 'arrayLit', type: { kind: 'array', elem }, elements: [] };
  }
  const elements: TExpr[] = [];
  for (const el of expr.elements) {
    const value = checkExpr(ctx, el, elem);
    if (elem === undefined) {
      // Without an expected type, the first element decides.
      if (value.type.kind === 'void') {
        report(ctx, 'array element cannot have type void', el.span);
        return errorExpr();
      }
      elem = value.type;
    } else {
      expectType(ctx, elem, value, el.span);
    }
    elements.push(value);
  }
  if (elem === undefined || isError(elem)) return errorExpr();
  return { kind: 'arrayLit', type: { kind: 'array', elem }, elements };
}

/**
 * Resolves an assignment target. Only a bare local needs to be `var`; writing through a field (or, from Task 5, an
 * element) is always allowed, because `let` only fixes the binding, not the object it refers to.
 */
function checkPlace(ctx: Ctx, target: Expr): TPlace | null {
  switch (target.kind) {
    case 'name': {
      const local = lookup(ctx, target.name);
      if (!local) {
        const message = isFunctionName(ctx, target.name)
          ? `cannot assign to function '${target.name}'`
          : `undefined name '${target.name}'`;
        report(ctx, message, target.span);
        return null;
      }
      if (!local.mutable) report(ctx, `cannot assign to immutable variable '${target.name}'`, target.span);
      return { kind: 'local', type: local.type, local };
    }
    case 'field':
    case 'index': {
      const checked = checkExpr(ctx, target);
      if (checked.kind === 'field') return { kind: 'field', type: checked.type, object: checked.object, field: checked.field };
      if (checked.kind === 'index') return { kind: 'index', type: checked.type, array: checked.array, index: checked.index };
      return null; // already reported
    }
    default:
      report(ctx, 'invalid assignment target', target.span);
      return null;
  }
}

function checkCompound(ctx: Ctx, stmt: AssignStmt, target: Type, value: TExpr): void {
  if (stmt.op === '=' || isError(target) || isError(value.type)) return;
  const result = binaryResultType(binaryOpOf(stmt.op), target, value.type);
  if (result === null || !typeEquals(result, target)) {
    report(ctx, `operator '${stmt.op}' cannot be applied to ${typeToString(target)} and ${typeToString(value.type)}`, stmt.span);
  }
}

function binaryResultType(op: BinaryOp, left: Type, right: Type): Type | null {
  const same = typeEquals(left, right);
  switch (op) {
    case '+':
      return same && (left.kind === 'int' || left.kind === 'string') ? left : null;
    case '-':
    case '*':
    case '/':
    case '%':
      return left.kind === 'int' && right.kind === 'int' ? INT : null;
    case '<':
    case '<=':
    case '>':
    case '>=':
      return left.kind === 'int' && right.kind === 'int' ? BOOL : null;
    case '==':
    case '!=':
      return same && left.kind !== 'void' ? BOOL : null;
    case '&&':
    case '||':
      return left.kind === 'bool' && right.kind === 'bool' ? BOOL : null;
  }
}

function checkBinary(ctx: Ctx, expr: BinaryExpr): TExpr {
  const left = checkExpr(ctx, expr.left);
  const right = checkExpr(ctx, expr.right);
  if (isError(left.type) || isError(right.type)) return errorExpr();
  if ((expr.op === '==' || expr.op === '!=') && typeEquals(left.type, right.type) && isReference(left.type)) {
    report(ctx, `cannot compare '${typeToString(left.type)}' values`, expr.span);
    return errorExpr();
  }
  const type = binaryResultType(expr.op, left.type, right.type);
  if (type === null) {
    report(
      ctx,
      `operator '${expr.op}' cannot be applied to ${typeToString(left.type)} and ${typeToString(right.type)}`,
      expr.span,
    );
    return errorExpr();
  }
  return { kind: 'binary', type, op: expr.op, left, right };
}

const arityMessage = (name: string, expected: number, found: number): string =>
  `function '${name}' expects ${expected} ${expected === 1 ? 'argument' : 'arguments'}, found ${found}`;

function checkCall(ctx: Ctx, expr: CallExpr): TExpr {
  // Only used once a problem with the call itself has been reported (or the signature is known): the `error`
  // type keeps `[]` arguments from cascading. Calls nothing has complained about yet must not use it.
  const checkArgs = (params?: readonly Type[]): TExpr[] =>
    expr.args.map((a, i) => checkExpr(ctx, a, params === undefined ? ERROR : (params[i] ?? ERROR)));
  if (expr.callee.kind !== 'name') {
    checkArgs();
    report(ctx, 'only named functions can be called', expr.callee.span);
    return errorExpr();
  }
  const name = expr.callee.name;
  if (lookup(ctx, name)) {
    checkArgs();
    report(ctx, `'${name}' is not a function`, expr.callee.span);
    return errorExpr();
  }
  if (name === 'print') return checkPrint(ctx, expr, expr.args.map((a) => checkExpr(ctx, a)));
  if (name === 'len' || name === 'push' || name === 'pop') return checkCollectionBuiltin(ctx, name, expr);

  const builtin: SignatureBuiltin | null = isSignatureBuiltin(name) ? name : null;
  const sig = builtin ? BUILTIN_SIGNATURES[builtin] : ctx.signatures.get(name);
  if (!sig) {
    checkArgs();
    report(ctx, `undefined function '${name}'`, expr.callee.span);
    return errorExpr();
  }
  const args = checkArgs(sig.params);
  if (args.length !== sig.params.length) {
    report(ctx, arityMessage(name, sig.params.length, args.length), expr.span);
  } else {
    args.forEach((arg, i) => expectType(ctx, sig.params[i], arg, expr.args[i].span));
  }
  return builtin
    ? { kind: 'builtin', type: sig.returnType, builtin, args }
    : { kind: 'call', type: sig.returnType, fn: name, args };
}

function checkPrint(ctx: Ctx, expr: CallExpr, args: TExpr[]): TExpr {
  if (args.length !== 1) {
    report(ctx, arityMessage('print', 1, args.length), expr.span);
    return errorExpr();
  }
  const t = args[0].type;
  if (!isError(t) && t.kind !== 'int' && t.kind !== 'bool' && t.kind !== 'string') {
    report(ctx, `cannot print a value of type ${typeToString(t)}`, expr.args[0].span);
  }
  return { kind: 'builtin', type: VOID, builtin: 'print', args };
}

/** `len` (string or array), `push` and `pop` (any array). Typed by hand because Aster has no generics. */
function checkCollectionBuiltin(ctx: Ctx, name: 'len' | 'push' | 'pop', expr: CallExpr): TExpr {
  const first = expr.args.length > 0 ? checkExpr(ctx, expr.args[0]) : null;
  const elem = first !== null && first.type.kind === 'array' ? first.type.elem : undefined;
  // When the first argument is not an array it is reported below (or already was), so the rest must not cascade.
  const rest = expr.args.slice(1).map((a) => checkExpr(ctx, a, elem ?? ERROR));
  const arity = name === 'push' ? 2 : 1;
  if (first === null || expr.args.length !== arity) {
    report(ctx, arityMessage(name, arity, expr.args.length), expr.span);
    return errorExpr();
  }
  const args = [first, ...rest];
  const t = first.type;
  if (name === 'len') {
    if (!isError(t) && t.kind !== 'string' && t.kind !== 'array') {
      report(ctx, `function 'len' expects a string or array, found ${typeToString(t)}`, expr.args[0].span);
    }
    // len is an int whatever its argument, so a bad argument doesn't cascade.
    return { kind: 'builtin', type: INT, builtin: 'len', args };
  }
  if (elem === undefined) {
    if (!isError(t)) report(ctx, `function '${name}' expects an array, found ${typeToString(t)}`, expr.args[0].span);
    return errorExpr();
  }
  if (name === 'push') {
    expectType(ctx, elem, args[1], expr.args[1].span);
    return { kind: 'builtin', type: VOID, builtin: 'push', args };
  }
  return { kind: 'builtin', type: elem, builtin: 'pop', args };
}

import type { BinaryExpr, BinaryOp, Block, CallExpr, Expr, FnDecl, IfStmt, Program, Stmt, TypeRef } from '../ast/ast.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { Span } from '../diagnostics/source.js';
import { BUILTIN_SIGNATURES, isBuiltin, isSignatureBuiltin, type Signature, type SignatureBuiltin } from './builtins.js';
import type { Local, TBlock, TExpr, TFunction, TStmt, Type, TypedProgram } from './types.js';

export interface CheckResult {
  program: TypedProgram;
  diagnostics: Diagnostic[];
}

interface Sink {
  diagnostics: Diagnostic[];
}

/** Per-function checking state. */
interface Ctx extends Sink {
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

const TYPE_NAMES: ReadonlySet<string> = new Set(['int', 'bool', 'string', 'void']);

const report = (sink: Sink, message: string, span: Span): void => {
  sink.diagnostics.push({ message, span });
};

const errorExpr = (): TExpr => ({ kind: 'int', type: 'error', value: 0n });

function resolveType(sink: Sink, ref: TypeRef): Type {
  if (TYPE_NAMES.has(ref.name)) return ref.name as Type;
  report(sink, `unknown type '${ref.name}'`, ref.span);
  return 'error';
}

export function check(program: Program): CheckResult {
  const sink: Sink = { diagnostics: [] };

  // Pass 1: collect signatures so functions can be called before their declaration.
  const signatures = new Map<string, Signature>();
  const declared: { decl: FnDecl; sig: Signature }[] = [];
  for (const decl of program.functions) {
    if (isBuiltin(decl.name)) {
      report(sink, `'${decl.name}' is a builtin function and cannot be redefined`, decl.nameSpan);
      continue;
    }
    if (signatures.has(decl.name)) {
      report(sink, `duplicate function '${decl.name}'`, decl.nameSpan);
      continue;
    }
    const params = decl.params.map((p) => {
      const type = resolveType(sink, p.type);
      if (type !== 'void') return type;
      report(sink, 'parameter cannot have type void', p.type.span);
      return 'error';
    });
    const sig: Signature = { params, returnType: decl.returnType ? resolveType(sink, decl.returnType) : 'void' };
    signatures.set(decl.name, sig);
    declared.push({ decl, sig });
  }

  const main = declared.find((d) => d.decl.name === 'main');
  if (!main) {
    report(sink, "missing 'fn main(): int'", { start: 0, end: 0 });
  } else if (main.sig.params.length !== 0 || main.sig.returnType !== 'int') {
    report(sink, "'main' must have signature 'fn main(): int'", main.decl.nameSpan);
  }

  // Pass 2: check bodies.
  const functions = declared.map(({ decl, sig }) => checkFunction(sink, signatures, decl, sig));
  return { program: { functions }, diagnostics: sink.diagnostics };
}

function checkFunction(sink: Sink, signatures: Map<string, Signature>, decl: FnDecl, sig: Signature): TFunction {
  const ctx: Ctx = {
    diagnostics: sink.diagnostics,
    signatures,
    returnType: sig.returnType,
    locals: [],
    scopes: [new Map()],
    loops: [],
  };
  const params = decl.params.map((p, i) => declare(ctx, p.name, p.nameSpan, sig.params[i], false));
  const body = checkBlock(ctx, decl.body);
  if (!body.diverges && sig.returnType !== 'void' && sig.returnType !== 'error') {
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
  if (expected === 'error' || actual.type === 'error' || expected === actual.type) return;
  report(ctx, `type mismatch: expected ${expected}, found ${actual.type}`, span);
}

function checkCondition(ctx: Ctx, expr: Expr): TExpr {
  const cond = checkExpr(ctx, expr);
  if (cond.type !== 'bool' && cond.type !== 'error') report(ctx, `condition must be bool, found ${cond.type}`, expr.span);
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
      if (type === 'void') {
        report(ctx, 'variable cannot have type void', stmt.type.span);
        type = 'error';
      }
      const init = checkExpr(ctx, stmt.init);
      expectType(ctx, type, init, stmt.init.span);
      const local = declare(ctx, stmt.name, stmt.nameSpan, type, stmt.mutable);
      return { node: { kind: 'let', local, init }, diverges: false };
    }
    case 'assign': {
      const value = checkExpr(ctx, stmt.value);
      const local = lookup(ctx, stmt.name);
      if (!local) {
        const message = isFunctionName(ctx, stmt.name)
          ? `cannot assign to function '${stmt.name}'`
          : `undefined name '${stmt.name}'`;
        report(ctx, message, stmt.nameSpan);
        return { node: { kind: 'expr', expr: value }, diverges: false };
      }
      if (!local.mutable) report(ctx, `cannot assign to immutable variable '${stmt.name}'`, stmt.nameSpan);
      expectType(ctx, local.type, value, stmt.value.span);
      return { node: { kind: 'assign', local, value }, diverges: false };
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
    case 'break':
    case 'continue': {
      const loop = ctx.loops[ctx.loops.length - 1];
      if (loop === undefined) report(ctx, `'${stmt.kind}' outside of loop`, stmt.span);
      else if (stmt.kind === 'break') loop.hasBreak = true;
      return { node: stmt.kind === 'break' ? { kind: 'break' } : { kind: 'continue' }, diverges: true };
    }
    case 'return': {
      if (stmt.value === null) {
        if (ctx.returnType !== 'void' && ctx.returnType !== 'error') {
          report(ctx, `missing return value: expected ${ctx.returnType}`, stmt.span);
        }
        return { node: { kind: 'return', value: null }, diverges: true };
      }
      const value = checkExpr(ctx, stmt.value);
      if (ctx.returnType === 'void') report(ctx, 'void function cannot return a value', stmt.value.span);
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

// ---- expressions

function checkExpr(ctx: Ctx, expr: Expr): TExpr {
  switch (expr.kind) {
    case 'int':
      return { kind: 'int', type: 'int', value: expr.value };
    case 'string':
      return { kind: 'string', type: 'string', value: expr.value };
    case 'bool':
      return { kind: 'bool', type: 'bool', value: expr.value };
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
      if (operand.type === 'error') return errorExpr();
      const want: Type = expr.op === '-' ? 'int' : 'bool';
      if (operand.type !== want) {
        report(ctx, `operator '${expr.op}' cannot be applied to ${operand.type}`, expr.span);
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
      const then = checkExpr(ctx, expr.then);
      const other = checkExpr(ctx, expr.else);
      if (then.type === 'error' || other.type === 'error') return errorExpr();
      if (then.type !== other.type) {
        report(ctx, `if branches have different types: ${then.type} and ${other.type}`, expr.span);
        return errorExpr();
      }
      if (then.type === 'void') {
        report(ctx, 'if expression cannot have type void', expr.span);
        return errorExpr();
      }
      return { kind: 'if', type: then.type, cond, then, else: other };
    }
  }
}

function binaryResultType(op: BinaryOp, left: Type, right: Type): Type | null {
  switch (op) {
    case '+':
      return left === right && (left === 'int' || left === 'string') ? left : null;
    case '-':
    case '*':
    case '/':
    case '%':
      return left === 'int' && right === 'int' ? 'int' : null;
    case '<':
    case '<=':
    case '>':
    case '>=':
      return left === 'int' && right === 'int' ? 'bool' : null;
    case '==':
    case '!=':
      return left === right && left !== 'void' ? 'bool' : null;
    case '&&':
    case '||':
      return left === 'bool' && right === 'bool' ? 'bool' : null;
  }
}

function checkBinary(ctx: Ctx, expr: BinaryExpr): TExpr {
  const left = checkExpr(ctx, expr.left);
  const right = checkExpr(ctx, expr.right);
  if (left.type === 'error' || right.type === 'error') return errorExpr();
  const type = binaryResultType(expr.op, left.type, right.type);
  if (type === null) {
    report(ctx, `operator '${expr.op}' cannot be applied to ${left.type} and ${right.type}`, expr.span);
    return errorExpr();
  }
  return { kind: 'binary', type, op: expr.op, left, right };
}

function checkCall(ctx: Ctx, expr: CallExpr): TExpr {
  const args = expr.args.map((a) => checkExpr(ctx, a));
  if (expr.callee.kind !== 'name') {
    report(ctx, 'only named functions can be called', expr.callee.span);
    return errorExpr();
  }
  const name = expr.callee.name;
  if (lookup(ctx, name)) {
    report(ctx, `'${name}' is not a function`, expr.callee.span);
    return errorExpr();
  }

  if (name === 'print') {
    if (args.length !== 1) {
      report(ctx, `function 'print' expects 1 argument, found ${args.length}`, expr.span);
      return errorExpr();
    }
    if (args[0].type === 'void') report(ctx, 'cannot print a value of type void', expr.args[0].span);
    return { kind: 'builtin', type: 'void', builtin: 'print', args };
  }

  let sig: Signature | undefined;
  let builtin: SignatureBuiltin | null = null;
  if (isSignatureBuiltin(name)) {
    sig = BUILTIN_SIGNATURES[name];
    builtin = name;
  } else {
    sig = ctx.signatures.get(name);
  }
  if (!sig) {
    report(ctx, `undefined function '${name}'`, expr.callee.span);
    return errorExpr();
  }

  if (args.length !== sig.params.length) {
    const noun = sig.params.length === 1 ? 'argument' : 'arguments';
    report(ctx, `function '${name}' expects ${sig.params.length} ${noun}, found ${args.length}`, expr.span);
  } else {
    args.forEach((arg, i) => expectType(ctx, sig.params[i], arg, expr.args[i].span));
  }
  return builtin
    ? { kind: 'builtin', type: sig.returnType, builtin, args }
    : { kind: 'call', type: sig.returnType, fn: name, args };
}

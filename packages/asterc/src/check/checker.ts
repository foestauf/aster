import {
  binaryOpOf, type AssignStmt, type BinaryExpr, type BinaryOp, type Block, type Alternative, type ArrayLitExpr, type CallExpr, type EnumDecl, type Expr, type FnDecl, type IfLetStmt, type IfStmt, type MatchExpr, type Pattern, type Program, type Stmt, type StructDecl,
  type StructLitExpr, type TypeExpr, type VariantDecl, type VariantExpr,
} from '../ast/ast.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { makeSource, type Span } from '../diagnostics/source.js';
import { lex } from '../lexer/lexer.js';
import { parse } from '../parser/parser.js';
import { BOOL, ERROR, INT, NEVER, STRING, VOID, instanceName, typeEquals, typeToString, type Type } from '../types/type.js';
import {
  BUILTIN_SIGNATURES, OPTION, PRELUDE_SOURCE, RESULT, isBuiltin, isSignatureBuiltin, type Signature,
  type SignatureBuiltin,
} from './builtins.js';
import { findExpandingEnums, mentionsParam, type Template } from './generics.js';
import type { Local, TBlock, TEnum, TExpr, TField, TFunction, TPattern, TPlace, TStmt, TStruct, TVariant, TypedProgram } from './types.js';

export interface CheckResult {
  program: TypedProgram;
  diagnostics: Diagnostic[];
}

/** State shared by the whole program check. */
interface Env {
  diagnostics: Diagnostic[];
  /** Every accepted struct, by name. Struct and enum names share the type namespace. */
  structs: Map<string, TStruct>;
  /** Every accepted non-generic enum and every instantiation so far, by name (`Option[int]` for an instantiation). */
  enums: Map<string, TEnum>;
  /** Every accepted generic enum, by name. Templates share the type namespace with structs and enums. */
  templates: Map<string, Template>;
  /** The instantiations the program uses, in order of first use. */
  instances: TEnum[];
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
  ['never', NEVER],
]);

const report = (env: Env, message: string, span: Span): void => {
  env.diagnostics.push({ message, span });
};

const builtinTypeMessage = (name: string): string => `'${name}' is a builtin type and cannot be redefined`;

/** Names of predeclared types, which no declaration may reuse. */
const isBuiltinType = (name: string): boolean => name === OPTION || name === RESULT;

/** 'struct' / 'enum' when `name` is already taken in the type namespace. Templates count as enums. */
const typeKindOf = (env: Env, name: string): 'struct' | 'enum' | null =>
  env.structs.has(name) ? 'struct' : env.enums.has(name) || env.templates.has(name) ? 'enum' : null;

const isError = (t: Type): boolean => t.kind === 'error';

const errorExpr = (): TExpr => ({ kind: 'int', type: ERROR, value: 0n });

/**
 * Resolves a written type. `bindings` maps the type parameters in scope to their types, and `quiet` suppresses
 * diagnostics (used when instantiating, since the template's declaration was already checked). With `instantiates`
 * off, a valid instantiation resolves to the error type instead of being created, so validating a template's
 * payloads registers nothing.
 */
function resolveType(env: Env, ref: TypeExpr, bindings?: ReadonlyMap<string, Type>, quiet = false, instantiates = true, allowNever = false): Type {
  const say = (message: string, span: Span): void => {
    if (!quiet) report(env, message, span);
  };
  if (ref.kind === 'array') {
    const elem = resolveType(env, ref.elem, bindings, quiet, instantiates);
    if (elem.kind === 'void') {
      say('array element type cannot be void', ref.elem.span);
      return ERROR;
    }
    return isError(elem) ? ERROR : { kind: 'array', elem };
  }
  const bound = bindings?.get(ref.name);
  if (bound !== undefined && ref.args.length > 0) {
    say(`'${ref.name}' is not generic`, ref.span);
    return ERROR;
  }
  if (bound !== undefined) return bound;
  const template = env.templates.get(ref.name);
  if (template) {
    const expected = template.params.length;
    if (ref.args.length !== expected) {
      say(`'${ref.name}' expects ${expected} type ${expected === 1 ? 'argument' : 'arguments'}, got ${ref.args.length}`, ref.span);
      return ERROR;
    }
    const args = ref.args.map((arg) => {
      const type = resolveType(env, arg, bindings, quiet, instantiates);
      if (type.kind !== 'void') return type;
      say('type argument cannot be void', arg.span);
      return ERROR;
    });
    if (args.some(isError) || template.broken || !instantiates) return ERROR;
    return instantiate(env, template, args);
  }
  let type: Type | null = PRIMITIVES.get(ref.name) ?? null;
  if (type !== null && type.kind === 'never' && !allowNever) {
    say("'never' is only allowed as a return type", ref.span);
    return ERROR;
  }
  if (env.structs.has(ref.name)) type = { kind: 'struct', name: ref.name };
  if (env.enums.has(ref.name)) type = { kind: 'enum', name: ref.name };
  if (type === null) {
    say(`unknown type '${ref.name}'`, ref.span);
    return ERROR;
  }
  if (ref.args.length > 0) {
    say(`'${ref.name}' is not generic`, ref.span);
    return ERROR;
  }
  return type;
}

/**
 * The type of `template` instantiated with `args`. The first use creates its TEnum, registering it before resolving
 * the payloads so recursive enums terminate; the expansion check guarantees there are finitely many instantiations.
 */
function instantiate(env: Env, template: Template, args: Type[]): Type {
  const base = template.decl.name;
  const name = instanceName(base, args);
  const type: Type = { kind: 'enum', name, generic: { base, args } };
  if (env.enums.has(name)) return type;
  const enumType: TEnum = { name, payloadFree: false, variants: [] };
  env.enums.set(name, enumType);
  env.instances.push(enumType);
  const bindings = new Map(template.params.map((param, i) => [param, args[i]]));
  for (const variant of template.decl.variants) {
    // Validating the template already reported the duplicate.
    if (enumType.variants.some((v) => v.name === variant.name)) continue;
    const payload = variant.payload.map((ref) => {
      const t = resolveType(env, ref, bindings, true);
      return t.kind === 'void' ? ERROR : t;
    });
    enumType.variants.push({ name: variant.name, tag: enumType.variants.length, payload });
  }
  return type;
}

const findField = (env: Env, struct: string, name: string): TField | undefined =>
  env.structs.get(struct)?.fields.find((f) => f.name === name);

/** Struct and array values are heap references; v0.1 defines no equality for them. */
const isReference = (t: Type): boolean => t.kind === 'struct' || t.kind === 'array';

/** 'a struct' / 'an enum', for diagnostics. */
const article = (kind: 'struct' | 'enum'): string => (kind === 'struct' ? 'a struct' : 'an enum');

/**
 * Registers every struct and enum name before resolving any field or payload type, so types can refer to each other
 * in any order. Structs and enums share the type namespace; of two colliding declarations, the later one is reported.
 * A generic enum becomes a template: its parameters and the expansion check come before any payload is resolved, and
 * its payloads are then resolved once, with every parameter bound to the error type, only to report its errors.
 */
function collectTypes(env: Env, program: Program): { structs: TStruct[]; enums: TEnum[] } {
  const decls = [...program.structs, ...program.enums].toSorted((a, b) => a.span.start - b.span.start);
  const structs: { decl: StructDecl; struct: TStruct }[] = [];
  const enums: { decl: EnumDecl; enumType: TEnum }[] = [];
  const templates: Template[] = [];
  for (const decl of decls) {
    const previous = typeKindOf(env, decl.name);
    if (PRIMITIVES.has(decl.name)) {
      report(env, `'${decl.name}' is a built-in type and cannot be redefined`, decl.nameSpan);
    } else if (isBuiltinType(decl.name)) {
      report(env, builtinTypeMessage(decl.name), decl.nameSpan);
    } else if (isBuiltin(decl.name)) {
      report(env, `'${decl.name}' is a builtin function and cannot be redefined`, decl.nameSpan);
    } else if (previous === decl.kind) {
      report(env, `duplicate ${decl.kind} '${decl.name}'`, decl.nameSpan);
    } else if (previous !== null) {
      report(env, `'${decl.name}' is already declared as ${article(previous)}`, decl.nameSpan);
    } else if (decl.kind === 'struct') {
      const struct: TStruct = { name: decl.name, fields: [] };
      env.structs.set(decl.name, struct);
      structs.push({ decl, struct });
    } else if (decl.typeParams.length > 0) {
      const template: Template = { decl, params: decl.typeParams.map((p) => p.name), broken: false, hasErrors: false };
      env.templates.set(decl.name, template);
      templates.push(template);
    } else {
      const payloadFree = decl.variants.every((v) => v.payload.length === 0);
      const enumType: TEnum = { name: decl.name, payloadFree, variants: [] };
      env.enums.set(decl.name, enumType);
      enums.push({ decl, enumType });
    }
  }
  for (const template of templates) {
    const { decl } = template;
    const before = env.diagnostics.length;
    const seen = new Set<string>();
    for (const param of decl.typeParams) {
      if (seen.has(param.name)) {
        report(env, `duplicate type parameter '${param.name}'`, param.nameSpan);
        continue;
      }
      seen.add(param.name);
      // A conflicting parameter stays bound, so the payloads that use it report nothing more.
      if (PRIMITIVES.has(param.name) || typeKindOf(env, param.name) !== null || isBuiltin(param.name)) {
        report(env, `type parameter '${param.name}' conflicts with a type of the same name`, param.nameSpan);
      }
      if (!decl.variants.some((v) => v.payload.some((ref) => mentionsParam(ref, param.name)))) {
        report(env, `type parameter '${param.name}' is never used`, param.nameSpan);
      }
    }
    if (env.diagnostics.length > before) template.hasErrors = true;
  }
  const expanding = findExpandingEnums(env.templates);
  for (const template of templates) {
    if (!expanding.has(template.decl.name)) continue;
    report(env, `generic enum '${template.decl.name}' expands infinitely`, template.decl.nameSpan);
    template.broken = true;
    template.hasErrors = true;
  }
  for (const { decl, struct } of structs) {
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
  for (const { decl, enumType } of enums) {
    for (const variant of decl.variants) {
      if (enumType.variants.some((v) => v.name === variant.name)) {
        report(env, `duplicate variant '${variant.name}' in '${decl.name}'`, variant.nameSpan);
        continue;
      }
      const payload = variant.payload.map((ref) => {
        const type = resolveType(env, ref);
        if (type.kind !== 'void') return type;
        report(env, 'payload cannot have type void', ref.span);
        return ERROR;
      });
      enumType.variants.push({ name: variant.name, tag: enumType.variants.length, payload });
    }
  }
  for (const template of templates) {
    const { decl, params } = template;
    const before = env.diagnostics.length;
    const placeholders = new Map(params.map((param) => [param, ERROR]));
    const names = new Set<string>();
    for (const variant of decl.variants) {
      if (names.has(variant.name)) {
        report(env, `duplicate variant '${variant.name}' in '${decl.name}'`, variant.nameSpan);
        continue;
      }
      names.add(variant.name);
      for (const ref of variant.payload) {
        const type = resolveType(env, ref, placeholders, false, false);
        if (type.kind === 'void') report(env, 'payload cannot have type void', ref.span);
      }
    }
    if (env.diagnostics.length > before) template.hasErrors = true;
  }
  return { structs: structs.map((s) => s.struct), enums: enums.map((e) => e.enumType) };
}

/** `fn main(): int`, or `fn main(args: [string]): int` with any parameter name. */
const isMainSignature = (sig: Signature): boolean => {
  if (sig.returnType.kind !== 'int') return false;
  if (sig.params.length === 0) return true;
  const [param] = sig.params;
  return sig.params.length === 1 && param.kind === 'array' && param.elem.kind === 'string';
};

/** Option and Result, parsed from the prelude and registered as templates before any user declaration. */
function preludeTemplates(): Map<string, Template> {
  const { program } = parse(lex(makeSource('<prelude>', PRELUDE_SOURCE)).tokens);
  return new Map(program.enums.map((decl) => [decl.name, { decl, params: decl.typeParams.map((p) => p.name), broken: false, hasErrors: false }]));
}

export interface CheckOptions {
  /** End offset of the root file; declarations at or past it come from imported files. Defaults to no limit. */
  rootEnd?: number;
}

export function check(program: Program, options: CheckOptions = {}): CheckResult {
  const rootEnd = options.rootEnd ?? Infinity;
  const env: Env = {
    diagnostics: [],
    structs: new Map(),
    enums: new Map(),
    templates: preludeTemplates(),
    instances: [],
  };
  const { structs, enums } = collectTypes(env, program);

  // Pass 1: collect signatures so functions can be called before their declaration.
  const signatures = new Map<string, Signature>();
  const declared: { decl: FnDecl; sig: Signature }[] = [];
  for (const decl of program.functions) {
    if (decl.name === 'main' && decl.nameSpan.start >= rootEnd) {
      // Ignored as if not declared, so the root's own main (or its absence) is judged alone.
      report(env, "'main' must be declared in the root file", decl.nameSpan);
      continue;
    }
    if (isBuiltinType(decl.name)) {
      report(env, builtinTypeMessage(decl.name), decl.nameSpan);
      continue;
    }
    if (isBuiltin(decl.name)) {
      report(env, `'${decl.name}' is a builtin function and cannot be redefined`, decl.nameSpan);
      continue;
    }
    const typeKind = typeKindOf(env, decl.name);
    if (typeKind !== null) {
      report(env, `'${decl.name}' is already declared as ${article(typeKind)}`, decl.nameSpan);
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
    const sig: Signature = { params, returnType: decl.returnType ? resolveType(env, decl.returnType, undefined, false, true, true) : VOID };
    signatures.set(decl.name, sig);
    declared.push({ decl, sig });
  }

  const main = declared.find((d) => d.decl.name === 'main');
  if (!main) {
    report(env, "missing 'fn main(): int'", { start: 0, end: 0 });
  } else if (!isMainSignature(main.sig)) {
    report(env, "'main' must have signature 'fn main(): int' or 'fn main(args: [string]): int'", main.decl.nameSpan);
  }

  // Pass 2: check bodies.
  const functions = declared.map(({ decl, sig }) => checkFunction(env, signatures, decl, sig));
  // Instantiations follow the non-generic enums, in order of first use.
  const userEnums = [...enums, ...env.instances];
  return { program: { structs, enums: userEnums, functions }, diagnostics: env.diagnostics };
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
  if (sig.returnType.kind === 'never') {
    if (!body.diverges) report(ctx, `function '${decl.name}' returns 'never' but can reach its end`, decl.nameSpan);
  } else if (!body.diverges && sig.returnType.kind !== 'void' && !isError(sig.returnType)) {
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

/** Puts an already-allocated local into the current scope, reporting a clash like `declare` does. */
function declareExisting(ctx: Ctx, name: string, nameSpan: Span, local: Local): void {
  const scope = ctx.scopes[ctx.scopes.length - 1];
  if (scope.has(name)) report(ctx, `'${name}' is already declared in this scope`, nameSpan);
  scope.set(name, local);
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
  if (isError(expected) || isError(actual.type) || actual.type.kind === 'never' || typeEquals(expected, actual.type)) return;
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
      return { node: { kind: 'let', local, init }, diverges: init.type.kind === 'never' };
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
      if (ctx.returnType.kind === 'never') {
        report(ctx, "cannot return from a function that returns 'never'", stmt.span);
        const value = stmt.value === null ? null : checkExpr(ctx, stmt.value);
        return { node: { kind: 'return', value }, diverges: true };
      }
      if (stmt.value === null) {
        if (ctx.returnType.kind !== 'void' && !isError(ctx.returnType)) {
          report(ctx, `missing return value: expected ${typeToString(ctx.returnType)}`, stmt.span);
        }
        return { node: { kind: 'return', value: null }, diverges: true };
      }
      // In a void function the value is wrong whatever it is, so `[]` must not also be reported as uninferable.
      const value = checkExpr(ctx, stmt.value, ctx.returnType.kind === 'void' ? ERROR : ctx.returnType);
      if (ctx.returnType.kind === 'void') report(ctx, 'void function cannot return a value', stmt.value.span);
      else expectType(ctx, ctx.returnType, value, stmt.value.span);
      return { node: { kind: 'return', value }, diverges: true };
    }
    case 'match': {
      const bodies: Checked<TBlock>[] = [];
      const { scrutinee, patterns } = checkMatch(ctx, stmt.scrutinee, stmt.keywordSpan, stmt.arms.map((a) => a.pattern), (i) => {
        const body = stmt.arms[i].body;
        if (body.kind === 'block') {
          bodies.push(checkBlock(ctx, body));
        } else {
          const checked = checkStmt(ctx, { kind: 'expr', expr: body, span: body.span });
          bodies.push({ node: { kind: 'block', statements: [checked.node] }, diverges: checked.diverges });
        }
      });
      const arms = patterns.map((pattern, i) => ({ pattern, body: bodies[i].node }));
      // Every match is exhaustive, so it ends a control path exactly when every arm does.
      const diverges = bodies.length > 0 && bodies.every((b) => b.diverges);
      return { node: { kind: 'match', scrutinee, arms }, diverges };
    }
    case 'block':
      return checkBlock(ctx, stmt);
    case 'letElse': {
      let binders = new Map<string, Local>();
      let elseBlock: Checked<TBlock> = { node: { kind: 'block', statements: [] }, diverges: true };
      const { scrutinee, patterns } = checkMatch(ctx, stmt.init, stmt.pattern.span, [stmt.pattern, { kind: 'wildcard', span: stmt.pattern.span }], (i) => {
        if (i === 0) binders = new Map(ctx.scopes[ctx.scopes.length - 1]); // the arm scope holds exactly the binders
        else elseBlock = checkBlock(ctx, stmt.else);
      }, { refutable: true });
      if (!elseBlock.diverges) report(ctx, "'else' block of 'let' must diverge", stmt.elseKeywordSpan);
      const declared = new Set<string>();
      for (const b of stmt.pattern.kind === 'variant' ? stmt.pattern.binders : []) {
        const local = b === null || declared.has(b.name) ? undefined : binders.get(b.name);
        if (b !== null && local !== undefined) {
          declared.add(b.name);
          declareExisting(ctx, b.name, b.span, local);
        }
      }
      const arms = [
        { pattern: patterns[0], body: { kind: 'block', statements: [] } as TBlock },
        { pattern: patterns[1], body: elseBlock.node },
      ];
      return { node: { kind: 'match', scrutinee, arms }, diverges: false };
    }
    case 'ifLet':
      return checkIfLet(ctx, stmt);
    case 'expr': {
      const expr = checkExpr(ctx, stmt.expr);
      return { node: { kind: 'expr', expr }, diverges: expr.type.kind === 'never' };
    }
  }
}

function checkIf(ctx: Ctx, stmt: IfStmt): Checked<TStmt> {
  const cond = checkCondition(ctx, stmt.cond);
  const then = checkBlock(ctx, stmt.then);
  if (stmt.else === null) {
    return { node: { kind: 'if', cond, then: then.node, else: null }, diverges: false };
  }
  const other = checkElse(ctx, stmt.else);
  return {
    node: { kind: 'if', cond, then: then.node, else: other.node },
    diverges: then.diverges && other.diverges,
  };
}

/** Checks the else branch of an `if` or `if let`: a block, or a chained `if`/`if let` wrapped in a block. */
function checkElse(ctx: Ctx, other: Block | IfStmt | IfLetStmt): Checked<TBlock> {
  if (other.kind === 'block') return checkBlock(ctx, other);
  const nested = other.kind === 'if' ? checkIf(ctx, other) : checkIfLet(ctx, other);
  return { node: { kind: 'block', statements: [nested.node] }, diverges: nested.diverges };
}

function checkIfLet(ctx: Ctx, stmt: IfLetStmt): Checked<TStmt> {
  let then: Checked<TBlock> = { node: { kind: 'block', statements: [] }, diverges: false };
  let other: Checked<TBlock> = { node: { kind: 'block', statements: [] }, diverges: false };
  const { scrutinee, patterns } = checkMatch(ctx, stmt.scrutinee, stmt.pattern.span, [stmt.pattern, { kind: 'wildcard', span: stmt.pattern.span }], (i) => {
    if (i === 0) then = checkBlock(ctx, stmt.then);
    else if (stmt.else !== null) other = checkElse(ctx, stmt.else);
  }, { refutable: true });
  const arms = [
    { pattern: patterns[0], body: then.node },
    { pattern: patterns[1], body: other.node },
  ];
  return { node: { kind: 'match', scrutinee, arms }, diverges: stmt.else !== null && then.diverges && other.diverges };
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
    case 'char':
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
    case 'matchExpr':
      return checkMatchExpr(ctx, expr, expected);
    case 'ifExpr': {
      const cond = checkCondition(ctx, expr.cond);
      const then = checkExpr(ctx, expr.then, expected);
      const other = checkExpr(ctx, expr.else, expected);
      if (isError(then.type) || isError(other.type)) return errorExpr();
      // A branch of type never doesn't take part in the "same type" rule.
      const type = then.type.kind === 'never' ? other.type : then.type;
      if (then.type.kind !== 'never' && other.type.kind !== 'never' && !typeEquals(then.type, other.type)) {
        report(ctx, `if branches have different types: ${typeToString(then.type)} and ${typeToString(other.type)}`, expr.span);
        return errorExpr();
      }
      if (type.kind === 'void') {
        report(ctx, 'if expression cannot have type void', expr.span);
        return errorExpr();
      }
      return { kind: 'if', type, cond, then, else: other };
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
    case 'try':
      return checkTry(ctx, expr);
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
    case 'variant':
      return checkVariantExpr(ctx, expr, expected);
  }
}

/** `t`'s instance name, base and type arguments when it is an `Option` or `Result` instantiation, else null. */
const tryable = (t: Type): { name: string; base: string; args: Type[] } | null =>
  t.kind === 'enum' && t.generic !== undefined && (t.generic.base === OPTION || t.generic.base === RESULT)
    ? { name: t.name, ...t.generic }
    : null;

/** `e?` (§3.7): unwraps `Some`/`Ok`, or returns `None`/`Err(e)` from the enclosing function. */
function checkTry(ctx: Ctx, expr: Extract<Expr, { kind: 'try' }>): TExpr {
  const operand = checkExpr(ctx, expr.operand);
  if (isError(operand.type)) return errorExpr();
  const op = tryable(operand.type);
  if (op === null) {
    report(ctx, `'?' applies to Option or Result, not '${typeToString(operand.type)}'`, expr.span);
    return errorExpr();
  }
  const isResult = op.base === RESULT;
  const opEnum = ctx.enums.get(op.name);
  if (!opEnum) throw new Error(`internal: missing instantiation ${op.name}`);
  const [ok, fail] = opEnum.variants;
  const type = ok.payload[0];
  const failPayloadType = isResult ? fail.payload[0] : null;
  const ret = tryable(ctx.returnType);
  const node = (returnFailVariant: string, returnFailTag: number): TExpr => ({
    kind: 'try',
    type,
    operand,
    okVariant: ok.name,
    okTag: ok.tag,
    failVariant: fail.name,
    failTag: fail.tag,
    returnType: ctx.returnType,
    returnEnum: ctx.returnType.kind === 'enum' ? ctx.returnType.name : '',
    returnFailVariant,
    returnFailTag,
    failPayloadType,
  });
  // Reachable when the return type failed to resolve (`fn f(): Option[Nope]`); only lowering is unreachable then.
  if (isError(ctx.returnType)) return node(fail.name, fail.tag);
  if (ret === null || ret.base !== op.base) {
    const kind = isResult ? 'a Result' : 'an Option';
    report(ctx, `'?' needs the function to return ${kind}, but it returns '${typeToString(ctx.returnType)}'`, expr.span);
    return errorExpr();
  }
  if (isResult && !typeEquals(op.args[1], ret.args[1])) {
    const [mine, theirs] = [op.args[1], ret.args[1]].map(typeToString);
    report(ctx, `'?' error type '${mine}' does not match the function's error type '${theirs}'`, expr.span);
    return errorExpr();
  }
  // The signature resolved the return type, so its instantiation exists.
  const retFail = ctx.enums.get(ret.name)?.variants[1];
  if (!retFail) throw new Error(`internal: missing instantiation ${ret.name}`);
  return node(retFail.name, retFail.tag);
}

const variantArityMessage = (enumName: string, variant: string, expected: number, found: number): string =>
  `variant '${enumName}::${variant}' expects ${expected} ${expected === 1 ? 'value' : 'values'}, got ${found}`;

/** A resolved `E::V`: a variant of a non-generic enum, or a variant of a generic enum's template. */
type FoundVariant = { enumType: TEnum; variant: TVariant } | { template: Template; variantDecl: VariantDecl };

/** Resolves `E::V`, reporting an unknown enum, a non-enum type or an unknown variant. */
function resolveVariant(env: Env, enumName: string, enumSpan: Span, variantName: string, variantSpan: Span): FoundVariant | null {
  const template = env.templates.get(enumName);
  if (template) {
    const variantDecl = template.decl.variants.find((v) => v.name === variantName);
    if (!variantDecl) {
      report(env, `unknown variant '${variantName}' on '${enumName}'`, variantSpan);
      return null;
    }
    return { template, variantDecl };
  }
  const enumType = env.enums.get(enumName);
  if (!enumType) {
    const isType = env.structs.has(enumName) || PRIMITIVES.has(enumName);
    report(env, isType ? `'${enumName}' is not an enum` : `unknown enum '${enumName}'`, enumSpan);
    return null;
  }
  const variant = enumType.variants.find((v) => v.name === variantName);
  if (!variant) {
    report(env, `unknown variant '${variantName}' on '${enumName}'`, variantSpan);
    return null;
  }
  return { enumType, variant };
}

function checkVariantExpr(ctx: Ctx, expr: VariantExpr, expected: Type | undefined): TExpr {
  const found = resolveVariant(ctx, expr.enumName, expr.enumSpan, expr.variant, expr.variantSpan);
  if (found === null) {
    // Still check the values for their own errors; the `error` type keeps `[]` from being reported as uninferable.
    for (const a of expr.args) checkExpr(ctx, a, ERROR);
    return errorExpr();
  }
  if ('template' in found) return checkGenericVariantExpr(ctx, expr, found.template, found.variantDecl, expected);
  const { enumType, variant } = found;
  const args = expr.args.map((a, i) => checkExpr(ctx, a, variant.payload[i] ?? ERROR));
  if (args.length !== variant.payload.length) {
    report(ctx, variantArityMessage(enumType.name, variant.name, variant.payload.length, args.length), expr.span);
    return errorExpr();
  }
  args.forEach((arg, i) => expectType(ctx, variant.payload[i], arg, expr.args[i].span));
  return { kind: 'variant', type: { kind: 'enum', name: enumType.name }, enum: enumType.name, variant: variant.name, tag: variant.tag, args };
}

/**
 * Checks `E::V(...)` for a generic `E`, inferring its type arguments (spec §3.5): first from an expected
 * instantiation of `E`, then from the values left to right. Each value takes its slot type as context once every
 * parameter the slot mentions is known, and its type then fixes the parameters still unknown.
 */
function checkGenericVariantExpr(ctx: Ctx, expr: VariantExpr, template: Template, variantDecl: VariantDecl, expected: Type | undefined): TExpr {
  const base = template.decl.name;
  if (template.broken || template.hasErrors) {
    // The declaration was already reported.
    for (const a of expr.args) checkExpr(ctx, a, ERROR);
    return errorExpr();
  }
  const bindings = new Map<string, Type>();
  if (expected?.kind === 'enum' && expected.generic?.base === base) {
    expected.generic.args.forEach((arg, i) => bindings.set(template.params[i], arg));
  }
  const slots = variantDecl.payload;
  const args = expr.args.map((a, i) => {
    const slot = slots.at(i);
    if (slot === undefined) return checkExpr(ctx, a, ERROR);
    const known = template.params.every((p) => bindings.has(p) || !mentionsParam(slot, p));
    const value = checkExpr(ctx, a, known ? resolveType(ctx, slot, bindings, true) : undefined);
    unify(template.params, slot, value.type, bindings);
    return value;
  });
  if (args.length !== slots.length) {
    report(ctx, variantArityMessage(base, variantDecl.name, slots.length, args.length), expr.span);
    return errorExpr();
  }
  const typeArgs = template.params.map((p) => bindings.get(p));
  if (typeArgs.includes(undefined)) {
    // An unknown parameter that an error-typed value or context would have fixed was already reported.
    const reported = (expected !== undefined && isError(expected)) || args.some((a) => isError(a.type));
    if (!reported) report(ctx, `cannot infer type arguments for '${base}'`, expr.span);
    return errorExpr();
  }
  const type = instantiate(ctx, template, typeArgs.filter((t) => t !== undefined));
  const name = typeToString(type);
  const variant = ctx.enums.get(name)?.variants.find((v) => v.name === variantDecl.name);
  if (variant === undefined) throw new Error(`internal: instantiation '${name}' has no variant '${variantDecl.name}'`);
  args.forEach((arg, i) => expectType(ctx, variant.payload[i], arg, expr.args[i].span));
  return { kind: 'variant', type, enum: name, variant: variant.name, tag: variant.tag, args };
}

/**
 * Matches a value's type against a template slot, binding each of `params` the slot fixes that is still unbound: a
 * bare parameter takes the whole type, and arrays and instantiations of the same template are matched part by part.
 * Error and void types bind nothing.
 */
function unify(params: readonly string[], slot: TypeExpr, actual: Type, bindings: Map<string, Type>): void {
  if (isError(actual) || actual.kind === 'void' || actual.kind === 'never') return;
  if (slot.kind === 'array') {
    if (actual.kind === 'array') unify(params, slot.elem, actual.elem, bindings);
    return;
  }
  if (params.includes(slot.name)) {
    if (slot.args.length === 0 && !bindings.has(slot.name)) bindings.set(slot.name, actual);
    return;
  }
  if (actual.kind !== 'enum' || actual.generic?.base !== slot.name || actual.generic.args.length !== slot.args.length) return;
  const actualArgs = actual.generic.args;
  slot.args.forEach((arg, i) => unify(params, arg, actualArgs[i], bindings));
}

/** The name an enum's patterns and diagnostics write: an instantiation's generic enum, or the enum itself. */
const enumBaseName = (t: Type): string => (t.kind === 'enum' ? (t.generic?.base ?? t.name) : typeToString(t));

type MatchCategory = 'enum' | 'int' | 'bool' | 'string';

function matchCategory(t: Type): MatchCategory | null {
  if (t.kind === 'enum' || t.kind === 'int' || t.kind === 'bool' || t.kind === 'string') return t.kind;
  return null;
}

/** A pattern alternative that fits the scrutinee: its key in the match's covered set, and the value it matches. */
type ResolvedAlternative =
  | { key: string; kind: 'variant'; variant: TVariant }
  | { key: string; kind: 'int'; value: bigint }
  | { key: string; kind: 'string'; value: string };

/**
 * Checks a match's scrutinee and patterns (spec §3.3):
 * - the scrutinee must be an enum, int, bool or string
 * - each pattern alternative must fit the scrutinee's type
 * - no arm may be unreachable, and no alternative may repeat a value already covered
 * - an enum or bool match must cover every value unless there is a `_` arm; an int or string match needs `_`
 * `checkArm(i)` checks arm i's body with that arm's binders in scope. Patterns are not checked at all against an
 * error-typed or unmatchable scrutinee, and an alternative that fails to resolve switches off the exhaustiveness check.
 */
function checkMatch(
  ctx: Ctx,
  scrutineeExpr: Expr,
  keywordSpan: Span,
  patterns: readonly Pattern[],
  checkArm: (index: number) => void,
  options: { refutable?: boolean } = {},
): { scrutinee: TExpr; patterns: TPattern[] } {
  const scrutinee = checkExpr(ctx, scrutineeExpr);
  const st = scrutinee.type;
  const decl: TEnum | null = st.kind === 'enum' ? (ctx.enums.get(st.name) ?? null) : null;
  if (matchCategory(st) === null && !isError(st)) report(ctx, `cannot match on '${typeToString(st)}' values`, scrutineeExpr.span);
  const category = st.kind === 'enum' && decl === null ? null : matchCategory(st);

  const covered = new Set<string>();
  let wildcardSeen = false;
  let allResolved = true;
  const typed: TPattern[] = [];
  for (const [index, pattern] of patterns.entries()) {
    const alternatives: readonly Alternative[] =
      pattern.kind === 'wildcard' ? [] : pattern.kind === 'or' ? pattern.alternatives : [pattern];
    let resolved: (ResolvedAlternative | null)[] = [];
    let fresh: ResolvedAlternative[] = [];
    const diagnosticsBefore = ctx.diagnostics.length;
    if (category !== null) {
      resolved = alternatives.map((alt) => resolveAlternative(ctx, st, decl, alt));
      if (resolved.includes(null)) allResolved = false;
      if (pattern.kind === 'wildcard') {
        // let-else and if-let supply a synthetic wildcard, which is never unreachable: `pattern always matches` covers it.
        if (!options.refutable && (wildcardSeen || missingValues(category, st, decl, covered)?.length === 0)) {
          report(ctx, 'unreachable match arm', pattern.span);
        }
      } else {
        fresh = checkReachability(ctx, pattern, alternatives, resolved, covered, wildcardSeen);
        for (const r of fresh) covered.add(r.key);
        // A pattern with any error of its own is not also called irrefutable.
        if (options.refutable && index === 0 && ctx.diagnostics.length === diagnosticsBefore && !resolved.includes(null)
          && missingValues(category, st, decl, covered)?.length === 0) {
          report(ctx, 'pattern always matches', pattern.span);
        }
      }
    }
    if (pattern.kind === 'wildcard') wildcardSeen = true;

    ctx.scopes.push(new Map());
    const single = pattern.kind === 'variant' ? resolved[0] : null;
    const binders = declareBinders(ctx, pattern, single?.kind === 'variant' ? single.variant : null);
    checkArm(index);
    ctx.scopes.pop();
    typed.push(typedPattern(pattern, category, fresh, binders));
  }

  if (category !== null && allResolved && !wildcardSeen) {
    const missing = missingValues(category, st, decl, covered);
    if (missing === null) report(ctx, "non-exhaustive match: add a '_' arm", keywordSpan);
    else if (missing.length > 0) report(ctx, `non-exhaustive match: missing ${missing.join(', ')}`, keywordSpan);
  }
  return { scrutinee, patterns: typed };
}

/**
 * Resolves one alternative against the scrutinee type `st`, reporting a pattern that does not fit. Returns null
 * after any report. `decl` is the scrutinee's enum, or null when the scrutinee is not an enum.
 */
function resolveAlternative(ctx: Ctx, st: Type, decl: TEnum | null, alt: Alternative): ResolvedAlternative | null {
  if (alt.kind === 'variant') {
    if (decl !== null) {
      const variant = resolvePatternVariant(ctx, st, decl, alt);
      return variant === null ? null : { key: `tag:${variant.tag}`, kind: 'variant', variant };
    }
    // Only the enum name matters here: any variant of it is the wrong type.
    if (ctx.enums.has(alt.enumName) || ctx.templates.has(alt.enumName)) {
      report(ctx, `pattern type '${alt.enumName}' does not match '${typeToString(st)}'`, alt.enumSpan);
    } else {
      resolveVariant(ctx, alt.enumName, alt.enumSpan, alt.variant, alt.variantSpan);
    }
    return null;
  }
  const patternType = alt.kind === 'stringPat' ? STRING : alt.kind === 'boolPat' ? BOOL : INT;
  if (!typeEquals(patternType, st)) {
    report(ctx, `pattern type '${typeToString(patternType)}' does not match '${typeToString(st)}'`, alt.span);
    return null;
  }
  switch (alt.kind) {
    case 'intPat':
    case 'charPat':
      return { key: `int:${alt.value}`, kind: 'int', value: alt.value };
    case 'boolPat':
      return { key: `bool:${alt.value}`, kind: 'int', value: alt.value ? 1n : 0n };
    case 'stringPat':
      return { key: `str:${JSON.stringify(alt.value)}`, kind: 'string', value: alt.value };
  }
}

/**
 * Reports an arm whose every resolved alternative is already covered (or that follows `_`) as unreachable, and
 * otherwise each covered alternative as a duplicate. Returns the alternatives that cover something new.
 */
function checkReachability(
  ctx: Ctx,
  pattern: Pattern,
  alternatives: readonly Alternative[],
  resolved: readonly (ResolvedAlternative | null)[],
  covered: ReadonlySet<string>,
  wildcardSeen: boolean,
): ResolvedAlternative[] {
  const fresh: ResolvedAlternative[] = [];
  const stale: Alternative[] = [];
  const armKeys = new Set<string>();
  for (const [i, r] of resolved.entries()) {
    if (r === null) continue;
    if (covered.has(r.key) || armKeys.has(r.key)) {
      stale.push(alternatives[i]);
    } else {
      armKeys.add(r.key);
      fresh.push(r);
    }
  }
  if (fresh.length + stale.length === 0) return fresh;
  if (wildcardSeen || fresh.length === 0) report(ctx, 'unreachable match arm', pattern.span);
  else for (const alt of stale) report(ctx, 'duplicate pattern alternative', alt.span);
  return fresh;
}

/**
 * The values a match on `category` has not yet covered, in the form the non-exhaustive message lists them; null
 * for int and string, whose values can never all be covered.
 */
function missingValues(category: MatchCategory, st: Type, decl: TEnum | null, covered: ReadonlySet<string>): string[] | null {
  switch (category) {
    case 'enum':
      return (decl?.variants ?? []).filter((v) => !covered.has(`tag:${v.tag}`)).map((v) => `'${enumBaseName(st)}::${v.name}'`);
    case 'bool':
      return ['true', 'false'].filter((b) => !covered.has(`bool:${b}`)).map((b) => `'${b}'`);
    case 'int':
    case 'string':
      return null;
  }
}

/**
 * Declares a single variant pattern's binders in the current scope, typed by `variant`'s payload when the binder
 * count is right. Named binders in an or-pattern are reported and not declared.
 */
function declareBinders(ctx: Ctx, pattern: Pattern, variant: TVariant | null): (Local | null)[] {
  if (pattern.kind === 'or') {
    for (const alt of pattern.alternatives) {
      if (alt.kind !== 'variant') continue;
      for (const binder of alt.binders) {
        if (binder !== null) report(ctx, 'or-pattern alternatives cannot bind names', binder.span);
      }
    }
    return [];
  }
  if (pattern.kind !== 'variant') return [];
  const slots = variant !== null && pattern.binders.length === variant.payload.length ? variant.payload : null;
  const seen = new Set<string>();
  const binders: (Local | null)[] = [];
  for (const [slot, binder] of pattern.binders.entries()) {
    if (binder === null) {
      binders.push(null);
    } else if (seen.has(binder.name)) {
      report(ctx, `duplicate binding '${binder.name}'`, binder.span);
      binders.push(null);
    } else {
      seen.add(binder.name);
      binders.push(declare(ctx, binder.name, binder.span, slots?.[slot] ?? ERROR, false));
    }
  }
  return binders;
}

/** The typed form of an arm's pattern, from the values it newly covers. */
function typedPattern(pattern: Pattern, category: MatchCategory | null, fresh: readonly ResolvedAlternative[], binders: (Local | null)[]): TPattern {
  if (pattern.kind === 'wildcard') return { kind: 'wildcard' };
  switch (category) {
    case 'int':
    case 'bool':
      return { kind: 'ints', values: fresh.flatMap((r) => (r.kind === 'int' ? [r.value] : [])) };
    case 'string':
      return { kind: 'strings', values: fresh.flatMap((r) => (r.kind === 'string' ? [r.value] : [])) };
    case 'enum':
    case null: {
      const variants = fresh.flatMap((r) => (r.kind === 'variant' ? [{ name: r.variant.name, tag: r.variant.tag }] : []));
      return { kind: 'variants', variants, binders: variants.length === 1 ? binders : [] };
    }
  }
}

/**
 * Resolves `F::V(...)` against the scrutinee's enum. Returns null after reporting an unknown or wrong enum or an
 * unknown variant. A wrong binder count is reported, but the variant is still returned, so it still counts as covered.
 */
function resolvePatternVariant(ctx: Ctx, st: Type, decl: TEnum, pattern: Extract<Pattern, { kind: 'variant' }>): TVariant | null {
  // Patterns never carry type arguments, so a pattern names an instantiation by its generic enum's name.
  const enumName = enumBaseName(st);
  if (pattern.enumName !== enumName) {
    const found = resolveVariant(ctx, pattern.enumName, pattern.enumSpan, pattern.variant, pattern.variantSpan);
    if (found !== null) report(ctx, `pattern type '${pattern.enumName}' does not match '${typeToString(st)}'`, pattern.enumSpan);
    return null;
  }
  const variant = decl.variants.find((v) => v.name === pattern.variant);
  if (!variant) {
    report(ctx, `unknown variant '${pattern.variant}' on '${enumName}'`, pattern.variantSpan);
    return null;
  }
  if (pattern.binders.length !== variant.payload.length) {
    report(ctx, variantArityMessage(enumName, variant.name, variant.payload.length, pattern.binders.length), pattern.span);
  }
  return variant;
}

function checkMatchExpr(ctx: Ctx, expr: MatchExpr, expected: Type | undefined): TExpr {
  const bodies: (TExpr | TBlock)[] = [];
  const { scrutinee, patterns } = checkMatch(ctx, expr.scrutinee, expr.keywordSpan, expr.arms.map((a) => a.pattern), (i) => {
    const body = expr.arms[i].body;
    if (body.kind === 'block') {
      const block = checkBlock(ctx, body);
      if (!block.diverges) report(ctx, 'match arm block must diverge', expr.arms[i].pattern.span);
      bodies.push(block.node);
    } else {
      bodies.push(checkExpr(ctx, body, expected));
    }
  });
  const exprs = bodies.filter((b): b is TExpr => b.kind !== 'block');
  if (exprs.some((b) => isError(b.type))) return errorExpr();
  // The parser guarantees at least one arm.
  // Arms of type never don't take part in the "same type" rule; the expression is never only if every arm is.
  const live = exprs.filter((b) => b.type.kind !== 'never');
  const type = live.length > 0 ? live[0].type : NEVER;
  const other = live.find((b) => !typeEquals(b.type, type));
  if (other !== undefined) {
    report(ctx, `match arms have different types: ${typeToString(type)} and ${typeToString(other.type)}`, expr.span);
    return errorExpr();
  }
  if (type.kind === 'void') {
    report(ctx, 'match expression cannot have type void', expr.span);
    return errorExpr();
  }
  if (matchCategory(scrutinee.type) === null) return errorExpr();
  return { kind: 'match', type, scrutinee, arms: patterns.map((pattern, i) => ({ pattern, body: bodies[i] })) };
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
    const value = checkExpr(ctx, init.value, decl?.type ?? ERROR);
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
    for (const el of expr.elements) checkExpr(ctx, el, ERROR);
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
      // Without an expected type, the first element that isn't never decides.
      if (value.type.kind === 'never') {
        elements.push(value);
        continue;
      }
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
  if (elem === undefined) {
    report(ctx, 'cannot infer type of empty array', expr.span);
    return errorExpr();
  }
  if (isError(elem)) return errorExpr();
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
  if (left.type.kind === 'never' || right.type.kind === 'never') {
    report(
      ctx,
      `operator '${expr.op}' cannot be applied to ${typeToString(left.type)} and ${typeToString(right.type)}`,
      expr.span,
    );
    return errorExpr();
  }
  if ((expr.op === '==' || expr.op === '!=') && typeEquals(left.type, right.type)) {
    const t = left.type;
    const payloadFreeEnum = t.kind === 'enum' && ctx.enums.get(t.name)?.payloadFree === true;
    if (isReference(t) || (t.kind === 'enum' && !payloadFreeEnum)) {
      report(ctx, `cannot compare '${typeToString(t)}' values`, expr.span);
      return errorExpr();
    }
    if (payloadFreeEnum) return { kind: 'enumCompare', type: BOOL, op: expr.op, left, right };
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
  if (name === 'print' || name === 'eprint') {
    // A wrong argument count is reported by checkPrint; its arguments must not cascade then.
    const args = expr.args.map((a) => checkExpr(ctx, a, expr.args.length === 1 ? undefined : ERROR));
    return checkPrint(ctx, expr, name, args);
  }
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
  const returnType =
    builtin === 'read_file' ? instantiate(ctx, ctx.templates.get(RESULT)!, [STRING, STRING]) : sig.returnType;
  return builtin
    ? { kind: 'builtin', type: returnType, builtin, args }
    : { kind: 'call', type: returnType, fn: name, args };
}

function checkPrint(ctx: Ctx, expr: CallExpr, name: 'print' | 'eprint', args: TExpr[]): TExpr {
  if (args.length !== 1) {
    report(ctx, arityMessage(name, 1, args.length), expr.span);
    return errorExpr();
  }
  const t = args[0].type;
  if (!isError(t) && t.kind !== 'int' && t.kind !== 'bool' && t.kind !== 'string') {
    report(ctx, `cannot print a value of type ${typeToString(t)}`, expr.args[0].span);
  }
  return { kind: 'builtin', type: VOID, builtin: name, args };
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

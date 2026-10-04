import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  lex, makeSource, parse,
  type Alternative, type Block, type EnumDecl, type Expr, type FnDecl, type IfLetStmt, type IfStmt, type Pattern, type Span, type Stmt, type StructDecl, type TypeExpr,
} from '../packages/asterc/src/index.js';
import { buildDriver } from './stage.js';

// Checks tests/programs/programs/parse.aster, the Aster parser written in Aster, against the compiler's own lexer and
// parser. Both sides render the AST in the indented-tree format of docs/superpowers/specs/2026-10-03-aster-parse-aster-design.md §3.
const PROGRAMS_DIR = fileURLToPath(new URL('./programs/', import.meta.url));
const SELF_DIR = fileURLToPath(new URL('../packages/asterc-self/', import.meta.url));
const corpus = readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.aster') || /fixtures[\\/](lex|parse)_\w+\.txt$/.test(f))
  .concat(readdirSync(SELF_DIR).filter((f) => f.endsWith('.aster')).map((f) => join('..', '..', 'packages', 'asterc-self', f)))
  .toSorted();

const toOutput = (lines: string[]): string => lines.map((l) => `${l}\n`).join('');

/**
 * The TypeScript lexer and parser's output in parse.aster's format, with UTF-16 offsets converted to byte offsets in
 * the raw file: the tree for stdout and errors (lexer first, then parser) for stderr. `makeSource` strips a leading
 * BOM before lexing, so spans are shifted past its 3 bytes.
 */
function expected(text: string): { stdout: string; stderr: string; status: number } {
  const bom = text.startsWith('﻿') ? 3 : 0;
  const body = bom > 0 ? text.slice(1) : text;
  // byteAt[i] is the byte offset of UTF-16 index i of body.
  const byteAt: number[] = [bom];
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    const width = code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code <= 0xdbff ? 4 : code >= 0xdc00 && code <= 0xdfff ? 0 : 3;
    byteAt.push(byteAt[i] + width);
  }
  const byte = (offset: number): number => {
    const b = byteAt[offset];
    if (b === undefined) throw new Error(`span offset ${offset} is outside the ${body.length}-unit source`);
    return b;
  };
  const sp = (s: Span): string => `${byte(s.start)} ${byte(s.end)}`;

  const lines: string[] = [];
  const emit = (depth: number, line: string): void => {
    lines.push(`${'  '.repeat(depth)}${line}`);
  };

  const type = (d: number, t: TypeExpr): void => {
    if (t.kind === 'named') {
      emit(d, `type ${sp(t.span)} ${t.name}`);
      for (const a of t.args) type(d + 1, a);
      return;
    }
    emit(d, `array-type ${sp(t.span)}`);
    type(d + 1, t.elem);
  };

  const alternative = (d: number, a: Alternative): void => {
    switch (a.kind) {
      case 'variant':
        emit(d, `pattern ${sp(a.span)} ${a.enumName} ${sp(a.enumSpan)} ${a.variant} ${sp(a.variantSpan)}`);
        for (const b of a.binders) emit(d + 1, b === null ? '_' : `bind ${sp(b.span)} ${b.name}`);
        return;
      case 'intPat':
        return emit(d, `int-pattern ${sp(a.span)} ${a.raw}`);
      case 'charPat':
        return emit(d, `char-pattern ${sp(a.span)} ${a.raw}`);
      case 'stringPat':
        return emit(d, `string-pattern ${sp(a.span)} ${a.raw}`);
      case 'boolPat':
        return emit(d, `bool-pattern ${sp(a.span)} ${a.value}`);
    }
  };
  const pattern = (d: number, p: Pattern): void => {
    if (p.kind === 'wildcard') return emit(d, `wildcard ${sp(p.span)}`);
    if (p.kind !== 'or') return alternative(d, p);
    emit(d, `or-pattern ${sp(p.span)}`);
    for (const a of p.alternatives) alternative(d + 1, a);
  };

  const expr = (d: number, e: Expr): void => {
    const head = `${sp(e.span)}`;
    switch (e.kind) {
      case 'int':
        return emit(d, `int ${head} ${e.value}`);
      case 'char':
        return emit(d, `char ${head} ${e.raw}`);
      case 'string':
        return emit(d, `string ${head} ${body.slice(e.span.start, e.span.end)}`);
      case 'bool':
        return emit(d, `bool ${head} ${e.value}`);
      case 'name':
        return emit(d, `name ${head} ${e.name}`);
      case 'unary':
        emit(d, `unary ${head} ${e.op}`);
        return expr(d + 1, e.operand);
      case 'binary':
        emit(d, `binary ${head} ${e.op}`);
        expr(d + 1, e.left);
        return expr(d + 1, e.right);
      case 'call':
        emit(d, `call ${head}`);
        expr(d + 1, e.callee);
        for (const a of e.args) expr(d + 1, a);
        return;
      case 'ifExpr':
        emit(d, `if-expr ${head}`);
        expr(d + 1, e.cond);
        expr(d + 1, e.then);
        return expr(d + 1, e.else);
      case 'field':
        emit(d, `get ${head} ${e.field} ${sp(e.fieldSpan)}`);
        return expr(d + 1, e.object);
      case 'structLit':
        emit(d, `struct-lit ${head} ${e.name} ${sp(e.nameSpan)}`);
        for (const f of e.fields) {
          emit(d + 1, `init ${sp(f.nameSpan)} ${f.name}`);
          expr(d + 2, f.value);
        }
        return;
      case 'try':
        emit(d, `try ${head}`);
        return expr(d + 1, e.operand);
      case 'index':
        emit(d, `index ${head}`);
        expr(d + 1, e.array);
        return expr(d + 1, e.index);
      case 'arrayLit':
        emit(d, `array-lit ${head}`);
        for (const x of e.elements) expr(d + 1, x);
        return;
      case 'variant':
        emit(d, `variant-lit ${head} ${e.enumName} ${sp(e.enumSpan)} ${e.variant} ${sp(e.variantSpan)}`);
        for (const a of e.args) expr(d + 1, a);
        return;
      case 'matchExpr':
        emit(d, `match-expr ${head} ${sp(e.keywordSpan)}`);
        expr(d + 1, e.scrutinee);
        for (const arm of e.arms) {
          emit(d + 1, 'arm');
          pattern(d + 2, arm.pattern);
          if (arm.body.kind === 'block') block(d + 2, arm.body);
          else expr(d + 2, arm.body);
        }
        return;
    }
  };

  const block = (d: number, b: Block): void => {
    emit(d, `block ${sp(b.span)}`);
    for (const s of b.statements) stmt(d + 1, s);
  };

  const elseBranch = (d: number, e: IfStmt['else']): void => {
    if (e === null) emit(d, '-');
    else if (e.kind === 'if') ifStmt(d, e);
    else if (e.kind === 'ifLet') ifLetStmt(d, e);
    else block(d, e);
  };

  const ifStmt = (d: number, s: IfStmt): void => {
    emit(d, `if ${sp(s.span)}`);
    expr(d + 1, s.cond);
    block(d + 1, s.then);
    elseBranch(d + 1, s.else);
  };

  const ifLetStmt = (d: number, s: IfLetStmt): void => {
    emit(d, `if-let ${sp(s.span)}`);
    pattern(d + 1, s.pattern);
    expr(d + 1, s.scrutinee);
    block(d + 1, s.then);
    elseBranch(d + 1, s.else);
  };

  const stmt = (d: number, s: Stmt): void => {
    const head = sp(s.span);
    switch (s.kind) {
      case 'let':
        emit(d, `${s.mutable ? 'var' : 'let'} ${head} ${s.name} ${sp(s.nameSpan)}`);
        type(d + 1, s.type);
        return expr(d + 1, s.init);
      case 'letElse':
        emit(d, `let-else ${head}`);
        pattern(d + 1, s.pattern);
        expr(d + 1, s.init);
        return block(d + 1, s.else);
      case 'assign':
        emit(d, `assign ${head} ${s.op}`);
        expr(d + 1, s.target);
        return expr(d + 1, s.value);
      case 'if':
        return ifStmt(d, s);
      case 'ifLet':
        return ifLetStmt(d, s);
      case 'while':
        emit(d, `while ${head}`);
        expr(d + 1, s.cond);
        return block(d + 1, s.body);
      case 'forRange':
        emit(d, `for-range ${head} ${s.name} ${sp(s.nameSpan)}`);
        expr(d + 1, s.start);
        expr(d + 1, s.end);
        return block(d + 1, s.body);
      case 'forEach':
        emit(d, `for-each ${head} ${s.name} ${sp(s.nameSpan)}`);
        expr(d + 1, s.iterable);
        return block(d + 1, s.body);
      case 'break':
      case 'continue':
        return emit(d, `${s.kind} ${head}`);
      case 'return':
        emit(d, `return ${head}`);
        if (s.value === null) return emit(d + 1, '-');
        return expr(d + 1, s.value);
      case 'expr':
        emit(d, `expr ${head}`);
        return expr(d + 1, s.expr);
      case 'block':
        return block(d, s);
      case 'match':
        emit(d, `match ${head} ${sp(s.keywordSpan)}`);
        expr(d + 1, s.scrutinee);
        for (const arm of s.arms) {
          emit(d + 1, 'arm');
          pattern(d + 2, arm.pattern);
          if (arm.body.kind === 'block') block(d + 2, arm.body);
          else expr(d + 2, arm.body);
        }
        return;
    }
  };

  const fn = (f: FnDecl): void => {
    emit(0, `fn ${sp(f.span)} ${f.name} ${sp(f.nameSpan)}`);
    for (const p of f.params) {
      emit(1, `param ${sp(p.nameSpan)} ${p.name}`);
      type(2, p.type);
    }
    if (f.returnType === null) emit(1, '-');
    else type(1, f.returnType);
    block(1, f.body);
  };

  const struct = (s: StructDecl): void => {
    emit(0, `struct ${sp(s.span)} ${s.name} ${sp(s.nameSpan)}`);
    for (const f of s.fields) {
      emit(1, `field ${sp(f.nameSpan)} ${f.name}`);
      type(2, f.type);
    }
  };

  const enumDecl = (e: EnumDecl): void => {
    emit(0, `enum ${sp(e.span)} ${e.name} ${sp(e.nameSpan)}`);
    for (const p of e.typeParams) emit(1, `type-param ${sp(p.nameSpan)} ${p.name}`);
    for (const v of e.variants) {
      emit(1, `variant ${sp(v.nameSpan)} ${v.name}`);
      for (const t of v.payload) type(2, t);
    }
  };

  const lexed = lex(makeSource('corpus', text));
  const parsed = parse(lexed.tokens);
  const items = [...parsed.program.functions, ...parsed.program.structs, ...parsed.program.enums, ...parsed.program.imports]
    .toSorted((a, b) => a.span.start - b.span.start);
  for (const item of items) {
    if (item.kind === 'fn') fn(item);
    else if (item.kind === 'struct') struct(item);
    else if (item.kind === 'enum') enumDecl(item);
    else emit(0, `import ${sp(item.span)} ${body.slice(item.pathSpan.start, item.pathSpan.end)}`);
  }
  const diagnostics = [...lexed.diagnostics, ...parsed.diagnostics];
  const errors = diagnostics.map((d) => `error ${sp(d.span)} ${d.message}`);
  return { stdout: toOutput(lines), stderr: toOutput(errors), status: diagnostics.length > 0 ? 1 : 0 };
}

const workDir = mkdtempSync(join(tmpdir(), 'aster-parse-'));
const exe = join(workDir, 'parse');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

// A driver build is cc -O2 on the compiler's C, or a stage build of the driver: both can outlast vitest's 10 s default.
const CC_HOOK_TIMEOUT = 60_000;

beforeAll(() => {
  buildDriver(join(PROGRAMS_DIR, 'programs', 'parse.aster'), exe);
}, CC_HOOK_TIMEOUT);

describe('parse.aster matches the TypeScript parser', () => {
  it('has a corpus that includes itself and the parser fixtures', () => {
    expect(corpus).toContain(join('programs', 'parse.aster'));
    expect(corpus).toContain(join('..', '..', 'packages', 'asterc-self', 'lexer.aster'));
    for (const f of ['parse_sample', 'parse_errors', 'parse_ints', 'parse_empty', 'parse_patterns', 'parse_generics', 'parse_imports', 'parse_unwrap', 'parse_unwrap_errors', 'lex_question', 'lex_bom', 'lex_chars']) {
      expect(corpus).toContain(join('programs', 'fixtures', `${f}.txt`));
    }
  });

  it.each(corpus)('%s', (file) => {
    const path = join(PROGRAMS_DIR, file);
    // Fatal decoding rejects invalid UTF-8; ignoreBOM keeps a BOM in the text so expected() can account for it.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
    const run = spawnSync(exe, [path], { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
    expect({ stdout: run.stdout, stderr: run.stderr, status: run.status }).toEqual(expected(text));
  });
});

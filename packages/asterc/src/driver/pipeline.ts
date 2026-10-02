import type { Program } from '../ast/ast.js';
import { check } from '../check/checker.js';
import type { TypedProgram } from '../check/types.js';
import { emitC } from '../codegen/c/emit.js';
import { sortDiagnostics, type Diagnostic } from '../diagnostics/diagnostic.js';
import type { SourceFile } from '../diagnostics/source.js';
import type { IrProgram } from '../ir/ir.js';
import { lower } from '../ir/lower.js';
import { lex } from '../lexer/lexer.js';
import type { Token } from '../lexer/token.js';
import { parse } from '../parser/parser.js';

export interface FrontendResult {
  tokens: Token[];
  ast: Program;
  /** null whenever there are diagnostics. */
  typed: TypedProgram | null;
  /** Sorted by position and deduplicated. */
  diagnostics: Diagnostic[];
}

export function runFrontend(source: SourceFile): FrontendResult {
  const lexed = lex(source);
  const parsed = parse(lexed.tokens);
  const syntax = [...lexed.diagnostics, ...parsed.diagnostics];
  if (syntax.length > 0) {
    // Checking a broken tree mostly produces noise, so stop at syntax errors.
    return { tokens: lexed.tokens, ast: parsed.program, typed: null, diagnostics: sortDiagnostics(syntax) };
  }
  const checked = check(parsed.program);
  const diagnostics = sortDiagnostics(checked.diagnostics);
  return {
    tokens: lexed.tokens,
    ast: parsed.program,
    typed: diagnostics.length > 0 ? null : checked.program,
    diagnostics,
  };
}

export type CompileResult = { ok: true; ir: IrProgram; c: string } | { ok: false; diagnostics: Diagnostic[] };

export function compileToC(source: SourceFile): CompileResult {
  const frontend = runFrontend(source);
  if (frontend.typed === null) return { ok: false, diagnostics: frontend.diagnostics };
  const ir = lower(frontend.typed);
  return { ok: true, ir, c: emitC(ir) };
}

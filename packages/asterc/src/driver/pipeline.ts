import type { Program } from '../ast/ast.js';
import { check } from '../check/checker.js';
import type { TypedProgram } from '../check/types.js';
import { emitC } from '../codegen/c/emit.js';
import { sortDiagnostics, type Diagnostic } from '../diagnostics/diagnostic.js';
import type { SourceFile, SourceMap } from '../diagnostics/source.js';
import type { IrProgram } from '../ir/ir.js';
import { lower } from '../ir/lower.js';
import { lex } from '../lexer/lexer.js';
import type { Token } from '../lexer/token.js';
import { loadProgram, nodeHost, type LoadHost } from './load.js';

export interface FrontendResult {
  /** The root file's tokens only. */
  tokens: Token[];
  /** The whole program: every loaded file's items, in load order. */
  ast: Program;
  /** null whenever there are diagnostics. */
  typed: TypedProgram | null;
  /** Sorted by position (so by load order, then position within a file) and deduplicated. */
  diagnostics: Diagnostic[];
  /** Every loaded file, root first; format diagnostics against it. */
  map: SourceMap;
}

/** Loads the root and its imports through `host`, then checks the whole program. */
export function runFrontend(root: SourceFile, host: LoadHost = nodeHost): FrontendResult {
  const tokens = lex(root).tokens;
  const loaded = loadProgram(root, host);
  const { map, program } = loaded;
  if (loaded.diagnostics.length > 0) {
    // Checking a broken tree mostly produces noise, so stop at syntax and import errors.
    return { tokens, ast: program, typed: null, diagnostics: sortDiagnostics(loaded.diagnostics), map };
  }
  const checked = check(program, { rootEnd: loaded.rootEnd });
  const diagnostics = sortDiagnostics(checked.diagnostics);
  return { tokens, ast: program, typed: diagnostics.length > 0 ? null : checked.program, diagnostics, map };
}

export type CompileResult =
  | { ok: true; ir: IrProgram; c: string; map: SourceMap }
  | { ok: false; diagnostics: Diagnostic[]; map: SourceMap };

export function compileToC(root: SourceFile, host: LoadHost = nodeHost): CompileResult {
  const { typed, diagnostics, map } = runFrontend(root, host);
  if (typed === null) return { ok: false, diagnostics, map };
  const ir = lower(typed);
  return { ok: true, ir, c: emitC(ir), map };
}

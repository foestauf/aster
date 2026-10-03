import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Program } from '../ast/ast.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { makeSource, nextBase, sourceMapOf, type SourceFile, type SourceMap } from '../diagnostics/source.js';
import { lex } from '../lexer/lexer.js';
import { parse } from '../parser/parser.js';

export type ReadResult = { ok: true; text: string } | { ok: false; reason: string };

/** How the loader reaches files; Node's `fs` by default, an in-memory map in tests. */
export interface LoadHost {
  readFile(path: string): ReadResult;
  /** Identity of a file, with symlinks resolved; files with the same real path load once. */
  realPath(path: string): string;
}

/** The `strerror` texts the runtime's `read_file` reports, for the errors a program is likely to hit. */
const REASONS: Record<string, string> = {
  ENOENT: 'No such file or directory',
  EISDIR: 'Is a directory',
  EACCES: 'Permission denied',
};

function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== undefined && code in REASONS) return REASONS[code];
  // Node prefixes system errors with their code: "ENOTDIR: not a directory, open '…'".
  return code !== undefined && error.message.startsWith(`${code}: `) ? error.message.slice(code.length + 2) : error.message;
}

export const nodeHost: LoadHost = {
  readFile(path) {
    if (path.includes('\0')) return { ok: false, reason: 'invalid path' };
    try {
      return { ok: true, text: readFileSync(path, 'utf8') };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  },
  realPath(path) {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  },
};

export interface LoadResult {
  /** Every loaded file, root first, in load order. */
  map: SourceMap;
  /** The items of every loaded file, in load order. */
  program: Program;
  /** End offset of the root file: declarations starting at or past it come from imports. */
  rootEnd: number;
  /** Lexical and syntax errors of every file, and imports that could not be read. Unsorted. */
  diagnostics: Diagnostic[];
}

/**
 * Loads the root and, depth first in the order the imports appear, every file it reaches, each once (by real path).
 * Each new file's base follows the previous file in load order, so spans are global and sort by load order.
 */
export function loadProgram(root: SourceFile, host: LoadHost): LoadResult {
  const files: SourceFile[] = [];
  const program: Program = { functions: [], structs: [], enums: [], imports: [] };
  const diagnostics: Diagnostic[] = [];
  const loaded = new Set<string>([host.realPath(resolve(root.path))]);

  const visit = (source: SourceFile): void => {
    files.push(source);
    const lexed = lex(source);
    const parsed = parse(lexed.tokens);
    diagnostics.push(...lexed.diagnostics, ...parsed.diagnostics);
    program.functions.push(...parsed.program.functions);
    program.structs.push(...parsed.program.structs);
    program.enums.push(...parsed.program.enums);
    program.imports.push(...parsed.program.imports);
    for (const imp of parsed.program.imports) {
      const real = host.realPath(resolve(dirname(source.path), imp.path));
      if (loaded.has(real)) continue;
      const read = host.readFile(real);
      if (!read.ok) {
        diagnostics.push({ message: `cannot import '${imp.path}': ${read.reason}`, span: imp.pathSpan });
        continue;
      }
      loaded.add(real);
      const display = isAbsolute(imp.path) ? imp.path : join(dirname(source.path), imp.path);
      visit(makeSource(display, read.text, nextBase(files[files.length - 1])));
    }
  };

  visit(root);
  return { map: sourceMapOf(files), program, rootEnd: root.text.length, diagnostics };
}

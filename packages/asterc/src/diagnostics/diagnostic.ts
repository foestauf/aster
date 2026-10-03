import { dirname, relative, sep } from 'node:path';
import { lineCol, lineText, sourceAt, type SourceFile, type SourceMap, type Span } from './source.js';

export interface Diagnostic {
  message: string;
  span: Span;
}

/** Sorts by position (stable) and drops exact duplicates (same start and message). */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics
    .toSorted((a, b) => a.span.start - b.span.start)
    .filter((d) => {
      const key = `${d.span.start}:${d.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function formatDiagnostic(where: SourceFile | SourceMap, d: Diagnostic): string {
  const source = sourceAt(where, d.span.start);
  const { line, col } = lineCol(where, d.span.start);
  const text = lineText(source, line);
  const padding = text.slice(0, col - 1).replace(/[^\t]/g, ' ');
  const width = Math.max(1, Math.min(d.span.end - d.span.start, text.length - (col - 1)));
  return `${source.path}:${line}:${col}: error: ${d.message}\n  ${text}\n  ${padding}${'^'.repeat(width)}`;
}

/**
 * Compact form used by golden tests: `line:col message` for the root file (the map's first file),
 * `relPath:line:col message` for others, with relPath relative to the root's directory.
 */
export function formatShort(where: SourceFile | SourceMap, d: Diagnostic): string {
  const source = sourceAt(where, d.span.start);
  const { line, col } = lineCol(where, d.span.start);
  const root = 'files' in where ? where.files[0] : where;
  if (source === root) return `${line}:${col} ${d.message}`;
  const rel = relative(dirname(root.path), source.path).split(sep).join('/');
  return `${rel}:${line}:${col} ${d.message}`;
}

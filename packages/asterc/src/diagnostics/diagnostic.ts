import { lineCol, lineText, type SourceFile, type Span } from './source.js';

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

export function formatDiagnostic(source: SourceFile, d: Diagnostic): string {
  const { line, col } = lineCol(source, d.span.start);
  const text = lineText(source, line);
  const padding = text.slice(0, col - 1).replace(/[^\t]/g, ' ');
  const width = Math.max(1, Math.min(d.span.end - d.span.start, text.length - (col - 1)));
  return `${source.path}:${line}:${col}: error: ${d.message}\n  ${text}\n  ${padding}${'^'.repeat(width)}`;
}

/** Compact `line:col message` form used by golden tests. */
export function formatShort(source: SourceFile, d: Diagnostic): string {
  const { line, col } = lineCol(source, d.span.start);
  return `${line}:${col} ${d.message}`;
}

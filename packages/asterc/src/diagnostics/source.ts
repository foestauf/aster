export interface SourceFile {
  path: string;
  text: string;
  /** Offset of the first character of each line. */
  lineStarts: number[];
}

/** A half-open range [start, end) of character offsets into a SourceFile's text. */
export interface Span {
  start: number;
  end: number;
}

export function makeSource(path: string, rawText: string): SourceFile {
  // Some Windows editors start UTF-8 files with a byte order mark; it is not part of the program.
  const text = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  return { path, text, lineStarts };
}

/** 1-based line and column of a character offset. */
export function lineCol(source: SourceFile, offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = source.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (source.lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - source.lineStarts[lo] + 1 };
}

/** Text of a 1-based line, without its line terminator. */
export function lineText(source: SourceFile, line: number): string {
  const start = source.lineStarts[line - 1];
  const next = source.lineStarts[line];
  const end = next === undefined ? source.text.length : next - 1;
  return source.text.slice(start, end).replace(/\r$/, '');
}

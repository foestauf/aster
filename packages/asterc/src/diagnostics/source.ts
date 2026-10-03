export interface SourceFile {
  path: string;
  text: string;
  /** Global offset of this file's first character; spans are global (base + local offset). */
  base: number;
  /** Offset of the first character of each line. */
  lineStarts: number[];
}

/** A half-open range [start, end) of character offsets into a SourceFile's text. */
export interface Span {
  start: number;
  end: number;
}

/** Files in load order; the first is the root. Bases are strictly increasing and never overlap. */
export interface SourceMap {
  files: SourceFile[];
}

export function makeSource(path: string, rawText: string, base = 0): SourceFile {
  // Some Windows editors start UTF-8 files with a byte order mark; it is not part of the program.
  const text = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  return { path, text, base, lineStarts };
}

/** Base for the file loaded after `file`: one past its end, so an EOF offset stays inside its own file. */
export function nextBase(file: SourceFile): number {
  return file.base + file.text.length + 1;
}

export function sourceMapOf(files: SourceFile[]): SourceMap {
  if (files.length === 0) throw new Error('a source map needs at least one file');
  for (let k = 1; k < files.length; k++) {
    if (files[k].base < nextBase(files[k - 1])) {
      throw new Error(`source file '${files[k].path}' overlaps '${files[k - 1].path}'`);
    }
  }
  return { files };
}

/** The last file whose base is at or before the offset. A lone SourceFile is its own map. */
export function sourceAt(where: SourceFile | SourceMap, offset: number): SourceFile {
  if (!('files' in where)) return where;
  let found = where.files[0];
  for (const f of where.files) {
    if (f.base <= offset) found = f;
    else break;
  }
  return found;
}

/** 1-based line and column of a character offset. */
export function lineCol(where: SourceFile | SourceMap, offset: number): { line: number; col: number } {
  const source = sourceAt(where, offset);
  offset -= source.base;
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

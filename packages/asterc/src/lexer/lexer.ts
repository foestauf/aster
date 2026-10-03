import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { SourceFile } from '../diagnostics/source.js';
import { KEYWORDS, PUNCTUATION, type Keyword, type Token, type TokenKind } from './token.js';

const KEYWORD_SET: ReadonlySet<string> = new Set(KEYWORDS);
const PUNCTUATION_SET: ReadonlySet<string> = new Set(PUNCTUATION);
const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['n', '\n'],
  ['t', '\t'],
  ['\\', '\\'],
  ['"', '"'],
  ['0', '\0'],
]);

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isIdentStart = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

export function lex(source: SourceFile): LexResult {
  const text = source.text;
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = 0;

  const push = (kind: TokenKind, start: number, extra: { intValue?: bigint; stringValue?: string } = {}): void => {
    tokens.push({ kind, text: text.slice(start, i), span: { start, end: i }, ...extra });
  };

  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }

    const start = i;
    if (isDigit(c)) {
      while (i < text.length && isDigit(text[i])) i++;
      push('int', start, { intValue: BigInt(text.slice(start, i)) });
      continue;
    }
    if (isIdentStart(c)) {
      while (i < text.length && isIdentPart(text[i])) i++;
      const word = text.slice(start, i);
      push(word === '_' ? '_' : KEYWORD_SET.has(word) ? (word as Keyword) : 'ident', start);
      continue;
    }
    if (c === '"') {
      i++;
      let value = '';
      let terminated = false;
      while (i < text.length && text[i] !== '\n') {
        const ch = text[i];
        if (ch === '"') {
          i++;
          terminated = true;
          break;
        }
        if (ch === '\\') {
          const next = text[i + 1];
          const mapped = next === undefined ? undefined : ESCAPES.get(next);
          if (mapped === undefined) {
            const width = next === undefined || next === '\n' ? 1 : 2;
            diagnostics.push({
              message: `invalid escape sequence '${text.slice(i, i + width)}'`,
              span: { start: i, end: i + width },
            });
            i += width;
            continue;
          }
          value += mapped;
          i += 2;
          continue;
        }
        value += ch;
        i++;
      }
      if (!terminated) diagnostics.push({ message: 'unterminated string literal', span: { start, end: i } });
      push('string', start, { stringValue: value });
      continue;
    }

    const two = text.slice(i, i + 2);
    if (PUNCTUATION_SET.has(two)) {
      i += 2;
      push(two as TokenKind, start);
      continue;
    }
    if (PUNCTUATION_SET.has(c)) {
      i++;
      push(c as TokenKind, start);
      continue;
    }

    const char = String.fromCodePoint(text.codePointAt(i) as number);
    i += char.length;
    diagnostics.push({ message: `unexpected character '${char}'`, span: { start, end: i } });
  }

  tokens.push({ kind: 'eof', text: '', span: { start: text.length, end: text.length } });
  return { tokens, diagnostics };
}

import type { Span } from '../diagnostics/source.js';

export const KEYWORDS = [
  'fn', 'let', 'var', 'if', 'else', 'while', 'break', 'continue', 'return', 'true', 'false',
  'struct', 'for', 'in',
] as const;
export type Keyword = (typeof KEYWORDS)[number];

export const PUNCTUATION = [
  '(', ')', '{', '}', '[', ']', ',', ':', ';', '.', '..', '=', '+', '-', '*', '/', '%', '!',
  '<', '<=', '>', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=',
] as const;
export type Punctuation = (typeof PUNCTUATION)[number];

export type TokenKind = 'int' | 'string' | 'ident' | 'eof' | Keyword | Punctuation;

export interface Token {
  kind: TokenKind;
  text: string;
  span: Span;
  /** Set on `int` tokens. Not range-checked here; the parser does that. */
  intValue?: bigint;
  /** Set on `string` tokens: the literal's decoded value. */
  stringValue?: string;
}

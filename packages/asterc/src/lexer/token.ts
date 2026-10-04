import type { Span } from '../diagnostics/source.js';

export const KEYWORDS = [
  'fn', 'let', 'var', 'if', 'else', 'while', 'break', 'continue', 'return', 'true', 'false',
  'struct', 'for', 'in', 'enum', 'match', 'import',
] as const;
export type Keyword = (typeof KEYWORDS)[number];

export const PUNCTUATION = [
  '(', ')', '{', '}', '[', ']', ',', ':', ';', '.', '..', '=', '+', '-', '*', '/', '%', '!',
  '<', '<=', '>', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '::', '=>', '|', '?',
] as const;
export type Punctuation = (typeof PUNCTUATION)[number];

/** `_` on its own is the wildcard token; any longer word starting with `_` is an identifier. */
export type TokenKind = 'int' | 'char' | 'string' | 'ident' | 'eof' | '_' | Keyword | Punctuation;

export interface Token {
  kind: TokenKind;
  text: string;
  span: Span;
  /** Set on `int` and `char` tokens. Not range-checked here; the parser does that. */
  intValue?: bigint;
  /** Set on `string` tokens: the literal's decoded value. */
  stringValue?: string;
}

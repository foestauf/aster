import { describe, expect, it } from 'vitest';
import { makeSource } from '../diagnostics/source.js';
import { lex } from './lexer.js';

const run = (text: string) => lex(makeSource('t.aster', text));
const kinds = (text: string) => run(text).tokens.map((t) => t.kind);
const messages = (text: string) => run(text).diagnostics.map((d) => d.message);

describe('lex', () => {
  it('lexes a function header', () => {
    expect(kinds('fn main(): int {')).toEqual(['fn', 'ident', '(', ')', ':', 'ident', '{', 'eof']);
  });

  it('treats type names as identifiers, not keywords', () => {
    expect(kinds('int bool string void')).toEqual(['ident', 'ident', 'ident', 'ident', 'eof']);
  });

  it('lexes every keyword', () => {
    const words = 'fn let var if else while break continue return true false';
    expect(kinds(words)).toEqual([...words.split(' '), 'eof']);
  });

  it('prefers two-character operators', () => {
    expect(kinds('a <= b == c != d && e || !f >= g = h < i > j')).toEqual([
      'ident', '<=', 'ident', '==', 'ident', '!=', 'ident', '&&', 'ident', '||',
      '!', 'ident', '>=', 'ident', '=', 'ident', '<', 'ident', '>', 'ident', 'eof',
    ]);
  });

  it('skips whitespace, CRLF and line comments', () => {
    expect(kinds('let x // comment ( ;\r\n\t= 1;')).toEqual(['let', 'ident', '=', 'int', ';', 'eof']);
  });

  it('records spans and token text', () => {
    const { tokens } = run('let  x1');
    expect(tokens.map((t) => [t.text, t.span.start, t.span.end])).toEqual([
      ['let', 0, 3],
      ['x1', 5, 7],
      ['', 7, 7],
    ]);
  });

  it('stores int values as bigint without range checking', () => {
    expect(run('9223372036854775808').tokens[0].intValue).toBe(9223372036854775808n);
  });

  it('decodes string escapes', () => {
    const [tok] = run(String.raw`"a\n\t\\\"\0b"`).tokens;
    expect(tok.kind).toBe('string');
    expect(tok.stringValue).toBe('a\n\t\\"\0b');
  });

  it('keeps non-ASCII characters in strings', () => {
    expect(run('"héllo"').tokens[0].stringValue).toBe('héllo');
  });

  it('reports invalid escapes and keeps lexing', () => {
    const r = run(String.raw`"a\qb" x`);
    expect(r.diagnostics).toEqual([{ message: String.raw`invalid escape sequence '\q'`, span: { start: 2, end: 4 } }]);
    expect(r.tokens.map((t) => t.kind)).toEqual(['string', 'ident', 'eof']);
    expect(r.tokens[0].stringValue).toBe('ab');
  });

  it('reports strings left open at a newline or end of file', () => {
    expect(messages('"abc\nx')).toEqual(['unterminated string literal']);
    expect(messages('"abc')).toEqual(['unterminated string literal']);
  });

  it('reports and skips unexpected characters', () => {
    const r = run('a & b');
    expect(r.tokens.map((t) => t.kind)).toEqual(['ident', 'ident', 'eof']);
    expect(r.diagnostics).toEqual([{ message: "unexpected character '&'", span: { start: 2, end: 3 } }]);
  });

  it('reports astral characters as one character', () => {
    expect(messages('😀')).toEqual(["unexpected character '😀'"]);
  });

  it('lexes an empty file to a single eof token', () => {
    expect(kinds('')).toEqual(['eof']);
  });
});

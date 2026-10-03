import { describe, expect, it } from 'vitest';
import { makeSource } from '../diagnostics/source.js';
import { lex } from './lexer.js';

const run = (text: string) => lex(makeSource('t.aster', text));
const kinds = (text: string) => run(text).tokens.map((t) => t.kind);
const messages = (text: string) => run(text).diagnostics.map((d) => d.message);
const span = (text: string) => run(text).diagnostics.map((d) => [d.span.start, d.span.end]);

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

  it('ends a one-character punctuator at the end of the file inside the file', () => {
    const { tokens } = run('{}');
    expect(tokens.map((t) => [t.text, t.span.start, t.span.end])).toEqual([
      ['{', 0, 1],
      ['}', 1, 2],
      ['', 2, 2],
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

  it('lexes the v0.1 keywords and punctuation', () => {
    expect(kinds('struct for in')).toEqual(['struct', 'for', 'in', 'eof']);
    expect(kinds('a.b[c] .. += -= *= /= %=')).toEqual([
      'ident', '.', 'ident', '[', 'ident', ']', '..', '+=', '-=', '*=', '/=', '%=', 'eof',
    ]);
  });

  it('lexes a range without spaces as three tokens', () => {
    expect(kinds('1..5')).toEqual(['int', '..', 'int', 'eof']);
  });

  it('still lexes a line comment rather than /=', () => {
    expect(kinds('x //= y')).toEqual(['ident', 'eof']);
  });

  it('lexes the v0.2 keywords and punctuation', () => {
    expect(kinds('enum match')).toEqual(['enum', 'match', 'eof']);
    expect(kinds('E::V => x')).toEqual(['ident', '::', 'ident', '=>', 'ident', 'eof']);
    expect(kinds('a: b = c')).toEqual(['ident', ':', 'ident', '=', 'ident', 'eof']);
  });

  it('lexes a lone underscore as its own token but keeps underscore-prefixed identifiers', () => {
    expect(kinds('_ _x __ x_')).toEqual(['_', 'ident', 'ident', 'ident', 'eof']);
  });

  it('lexes character literals as char tokens with their byte value', () => {
    const { tokens, diagnostics } = run(`'a' ' ' '~' '\\n' '\\t' '\\r' '\\\\' '\\'' '\\"' '\\0' '"'`);
    expect(diagnostics).toEqual([]);
    expect(tokens.slice(0, -1).map((t) => [t.kind, t.intValue])).toEqual([
      ['char', 97n], ['char', 32n], ['char', 126n], ['char', 10n], ['char', 9n], ['char', 13n],
      ['char', 92n], ['char', 39n], ['char', 34n], ['char', 0n], ['char', 34n],
    ]);
    expect(tokens[0].text).toBe(`'a'`);
  });

  it('reports bad character literals once each and still produces a char token', () => {
    expect(messages(`''`)).toEqual(['empty character literal']);
    expect(messages(`'ab'`)).toEqual(['character literal must be a single ASCII character']);
    expect(messages(`'é'`)).toEqual(['character literal must be a single ASCII character']);
    expect(messages(`'\t'`)).toEqual(['character literal must be a single ASCII character']); // a raw tab
    expect(messages(`'\\q'`)).toEqual(["invalid escape sequence '\\q'"]);
    expect(messages(`'a\nx`)).toEqual(['unterminated character literal']);
    expect(messages(`'`)).toEqual(['unterminated character literal']);
    expect(kinds(`'ab' x`)).toEqual(['char', 'ident', 'eof']);
    expect(run(`'ab'`).tokens[0].intValue).toBe(0n);
  });

  it('spans character-literal errors', () => {
    expect(span(`''`)).toEqual([[0, 2]]);
    expect(span(`x 'ab' y`)).toEqual([[2, 6]]);
    expect(span(`'\\q'`)).toEqual([[1, 3]]);
    expect(span(`'abc\nx`)).toEqual([[0, 4]]);
  });

  it('does not start a char literal inside a comment or a string', () => {
    expect(kinds(`// don't\n"it's"`)).toEqual(['string', 'eof']);
  });

  it('accepts \\r and \\\' in strings', () => {
    const { tokens, diagnostics } = run(`"a\\rb\\'c"`);
    expect(diagnostics).toEqual([]);
    expect(tokens[0].stringValue).toBe("a\rb'c");
  });

  it('lexes | and keeps || as one token', () => {
    expect(kinds('a | b || c')).toEqual(['ident', '|', 'ident', '||', 'ident', 'eof']);
  });
});

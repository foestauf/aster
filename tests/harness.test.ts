import { describe, expect, it } from 'vitest';
import { parseExpectations } from './harness.js';

describe('parseExpectations', () => {
  it('reads stdout blocks, stderr and exit code', () => {
    const text = [
      '// expect-stdout:',
      '// 1',
      '//',
      '// two words',
      '// expect-exit: 3',
      '// expect-stderr: panic: x',
      'fn main(): int { return 3; }',
    ].join('\n');
    expect(parseExpectations(text)).toEqual({ stdout: '1\n\ntwo words\n', stderr: 'panic: x\n', exitCode: 3, errors: [], args: [], stdin: '', library: false });
  });

  it('collects repeated expect-error lines', () => {
    const text = "// expect-error: 1:1 a\n// expect-error: 2:5 b 'c'\nfn f() {}";
    expect(parseExpectations(text).errors).toEqual(['1:1 a', "2:5 b 'c'"]);
  });

  it('defaults to empty output and exit 0', () => {
    expect(parseExpectations('fn main(): int { return 0; }')).toEqual({ stdout: '', stderr: '', exitCode: 0, errors: [], args: [], stdin: '', library: false });
  });

  it('ignores plain comments and stops at the first code line', () => {
    expect(parseExpectations('// a note\nfn main(): int { return 0; }\n// expect-exit: 4').exitCode).toBe(0);
  });

  it('rejects malformed or unknown expect directives', () => {
    expect(() => parseExpectations('// expect-exit 3\nfn')).toThrow("unrecognised directive '// expect-exit 3'");
    expect(() => parseExpectations('// expect-stdot:\n// 1\nfn')).toThrow("unrecognised directive '// expect-stdot:'");
  });

  it('handles CRLF files', () => {
    expect(parseExpectations('// expect-stdout:\r\n// hi\r\n// expect-exit: 2\r\nfn')).toEqual({
      stdout: 'hi\n',
      stderr: '',
      exitCode: 2,
      errors: [],
      args: [],
      stdin: '',
      library: false,
    });
  });

  it('reads program arguments and a stdin block', () => {
    const text = [
      '// expect-args: one  -two é',
      '// expect-stdin:',
      '// line 1',
      '//',
      '// expect-stdout:',
      '// out',
      'fn main(): int { return 0; }',
    ].join('\n');
    const e = parseExpectations(text);
    expect(e.args).toEqual(['one', '-two', 'é']);
    expect(e.stdin).toBe('line 1\n\n');
    expect(e.stdout).toBe('out\n');
  });

  it('collects repeated expect-args lines', () => {
    expect(parseExpectations('// expect-args: a b\n// expect-args: c\nfn').args).toEqual(['a', 'b', 'c']);
  });

  it('treats an empty expect-args as no arguments', () => {
    expect(parseExpectations('// expect-args:\nfn').args).toEqual([]);
  });

  it('marks a library file and rejects other directives alongside it', () => {
    expect(parseExpectations('// expect-library\nfn f() {}').library).toBe(true);
    expect(parseExpectations('fn f() {}').library).toBe(false);
    expect(() => parseExpectations('// expect-library\n// expect-stdout:\n// x\nfn f() {}')).toThrow('expect-library');
    expect(() => parseExpectations('// expect-exit: 1\n// expect-library\nfn f() {}')).toThrow('expect-library');
  });
});

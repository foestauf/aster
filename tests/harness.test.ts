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
    expect(parseExpectations(text)).toEqual({ stdout: '1\n\ntwo words\n', stderr: 'panic: x\n', exitCode: 3, errors: [] });
  });

  it('collects repeated expect-error lines', () => {
    const text = "// expect-error: 1:1 a\n// expect-error: 2:5 b 'c'\nfn f() {}";
    expect(parseExpectations(text).errors).toEqual(['1:1 a', "2:5 b 'c'"]);
  });

  it('defaults to empty output and exit 0', () => {
    expect(parseExpectations('fn main(): int { return 0; }')).toEqual({ stdout: '', stderr: '', exitCode: 0, errors: [] });
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
    });
  });
});

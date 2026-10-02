export interface Expectations {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** `line:col message` entries; non-empty means compile-only. */
  errors: string[];
}

const isComment = (line: string): boolean => line.startsWith('//');
const isDirective = (line: string): boolean => /^\/\/ ?expect-/.test(line);
const commentBody = (line: string): string => line.replace(/^\/\/ ?/, '');

/** Reads `// expect-*` directives from the leading comment block of a golden program. */
export function parseExpectations(text: string): Expectations {
  const lines = text.split(/\r?\n/);
  const result: Expectations = { stdout: '', stderr: '', exitCode: 0, errors: [] };
  let i = 0;
  while (i < lines.length && isComment(lines[i])) {
    const body = commentBody(lines[i]);
    i++;
    if (body === 'expect-stdout:') {
      while (i < lines.length && isComment(lines[i]) && !isDirective(lines[i])) {
        result.stdout += `${commentBody(lines[i])}\n`;
        i++;
      }
      continue;
    }
    const exit = /^expect-exit: (-?\d+)$/.exec(body);
    const stderr = /^expect-stderr: (.*)$/.exec(body);
    const error = /^expect-error: (.*)$/.exec(body);
    if (exit) result.exitCode = Number(exit[1]);
    else if (stderr) result.stderr += `${stderr[1]}\n`;
    else if (error) result.errors.push(error[1]);
    // A typo'd directive would otherwise silently fall back to a default and weaken the test.
    else if (body.startsWith('expect-')) throw new Error(`unrecognised directive '${lines[i - 1]}'`);
  }
  return result;
}

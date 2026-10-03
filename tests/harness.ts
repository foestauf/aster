export interface Expectations {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** `line:col message` entries; non-empty means compile-only. */
  errors: string[];
  /** Program arguments, split on whitespace; repeated `expect-args` lines add to them. */
  args: string[];
  /** Text fed to the program's stdin; empty when there is no `expect-stdin` block. */
  stdin: string;
  /** True for a file that is only imported by other programs, never compiled or run on its own. */
  library: boolean;
}

const isComment = (line: string): boolean => line.startsWith('//');
const isDirective = (line: string): boolean => /^\/\/ ?expect-/.test(line);
const commentBody = (line: string): string => line.replace(/^\/\/ ?/, '');

/** Reads `// expect-*` directives from the leading comment block of a golden program. */
export function parseExpectations(text: string): Expectations {
  const lines = text.split(/\r?\n/);
  const result: Expectations = { stdout: '', stderr: '', exitCode: 0, errors: [], args: [], stdin: '', library: false };
  let i = 0;
  /** Reads the comment lines after a block directive, each terminated by a newline. */
  const readBlock = (): string => {
    let block = '';
    while (i < lines.length && isComment(lines[i]) && !isDirective(lines[i])) {
      block += `${commentBody(lines[i])}\n`;
      i++;
    }
    return block;
  };
  while (i < lines.length && isComment(lines[i])) {
    const body = commentBody(lines[i]);
    i++;
    if (body === 'expect-stdout:') {
      result.stdout += readBlock();
      continue;
    }
    if (body === 'expect-stdin:') {
      result.stdin += readBlock();
      continue;
    }
    if (body === 'expect-library') {
      result.library = true;
      continue;
    }
    const exit = /^expect-exit: (-?\d+)$/.exec(body);
    const stderr = /^expect-stderr: (.*)$/.exec(body);
    const error = /^expect-error: (.*)$/.exec(body);
    const args = /^expect-args:(.*)$/.exec(body);
    if (exit) result.exitCode = Number(exit[1]);
    else if (stderr) result.stderr += `${stderr[1]}\n`;
    else if (error) result.errors.push(error[1]);
    else if (args) result.args.push(...args[1].split(/\s+/).filter((a) => a.length > 0));
    // A typo'd directive would otherwise silently fall back to a default and weaken the test.
    else if (body.startsWith('expect-')) throw new Error(`unrecognised directive '${lines[i - 1]}'`);
  }
  // A library is never run or compared, so any other directive would be silently ignored.
  if (result.library && lines.slice(0, i).some((l) => isDirective(l) && commentBody(l) !== 'expect-library'))
    throw new Error("a '// expect-library' file cannot have other expect directives");
  return result;
}

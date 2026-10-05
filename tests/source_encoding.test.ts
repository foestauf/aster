import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { spawnStrict } from './spawn.js';
import { stage } from './stage.js';

// Source must be well-formed UTF-8 (issue #25, docs/superpowers/specs/2026-10-04-aster-source-encoding-design.md).
// Byte-generated files go to a temp dir, never tests/programs/, whose readers decode as UTF-8. Every comparison is on
// raw bytes: decoding first would map a raw 0xFF and U+FFFD's EF BF BD to the same string and hide the difference.

const dir = mkdtempSync(join(tmpdir(), 'aster-encoding-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Outcome {
  stdout: Buffer;
  stderr: Buffer;
  status: number | null;
}

function spawn(command: string, argv: readonly string[]): Outcome {
  const r = spawnSync(command, argv, { cwd: dir, env: { ...process.env, LC_ALL: 'C' }, timeout: 60_000 });
  if (r.error) throw r.error;
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

const run = (argv: readonly string[]) => spawn(stage().bin, argv);
const latin1 = (o: Outcome) => ({ ...o, stdout: o.stdout.toString('latin1'), stderr: o.stderr.toString('latin1') });

/** Writes `prefix`, then the raw `bad` bytes, then `suffix` to `name` in the temp dir. */
function write(name: string, prefix: string | Buffer, bad: number[], suffix: string): void {
  writeFileSync(join(dir, name), Buffer.concat([Buffer.from(prefix), Buffer.from(bad), Buffer.from(suffix)]));
}

const IN_STRING = ['fn main(): int {\n    print("', '");\n    return 0;\n}\n'] as const;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const malformed: { name: string; prefix: string | Buffer; bad: number[]; suffix: string; reason: string }[] = [
  { name: 'lone_ff', prefix: IN_STRING[0], bad: [0x61, 0xff, 0x62], suffix: IN_STRING[1], reason: 'line 2, byte 29' },
  { name: 'stray_continuation', prefix: IN_STRING[0], bad: [0x80], suffix: IN_STRING[1], reason: 'line 2, byte 28' },
  { name: 'overlong', prefix: IN_STRING[0], bad: [0xc0, 0x80], suffix: IN_STRING[1], reason: 'line 2, byte 28' },
  { name: 'surrogate', prefix: IN_STRING[0], bad: [0xed, 0xa0, 0x80], suffix: IN_STRING[1], reason: 'line 2, byte 28' },
  { name: 'past_10ffff', prefix: IN_STRING[0], bad: [0xf4, 0x90, 0x80, 0x80], suffix: IN_STRING[1], reason: 'line 2, byte 28' },
  { name: 'truncated_at_eof', prefix: 'fn main(): int { return 0; }\n// ', bad: [0xc3], suffix: '', reason: 'line 2, byte 32' },
  { name: 'in_comment', prefix: 'fn main(): int {\n    // a', bad: [0xff], suffix: '\n    return 0;\n}\n', reason: 'line 2, byte 25' },
  { name: 'bare', prefix: 'fn main(): int {\n    ', bad: [0xff], suffix: '\n    return 0;\n}\n', reason: 'line 2, byte 21' },
  { name: 'after_bom', prefix: Buffer.concat([BOM, Buffer.from(IN_STRING[0])]), bad: [0xff], suffix: IN_STRING[1], reason: 'line 2, byte 31' },
];

const valid: { name: string; prefix: string | Buffer; bad: number[]; suffix: string; stdout: number[]; literal: string }[] = [
  { name: 'e_acute', prefix: IN_STRING[0], bad: [0xc3, 0xa9], suffix: IN_STRING[1], stdout: [0xc3, 0xa9, 0x0a], literal: '{ "\\303\\251", 2 }' },
  { name: 'emoji', prefix: IN_STRING[0], bad: [0xf0, 0x9f, 0x98, 0x80], suffix: IN_STRING[1], stdout: [0xf0, 0x9f, 0x98, 0x80, 0x0a], literal: '{ "\\360\\237\\230\\200", 4 }' },
  { name: 'bom', prefix: Buffer.concat([BOM, Buffer.from(IN_STRING[0])]), bad: [0x61], suffix: IN_STRING[1], stdout: [0x61, 0x0a], literal: '{ "a", 1 }' },
];

describe('malformed UTF-8 in the root file', () => {
  it.for(malformed)('$name', ({ name, prefix, bad, suffix, reason }) => {
    const file = `${name}.aster`;
    write(file, prefix, bad, suffix);
    const expected = { stdout: '', stderr: `${file}: error: invalid UTF-8 at ${reason}\n`, status: 1 };
    for (const argv of [['check', file], ['build', file, '--emit=c'], ['run', file]]) {
      expect(latin1(run(argv)), `${stage().name} ${argv.join(' ')}`).toEqual(expected);
    }
  });
});

describe('malformed UTF-8 in an imported file', () => {
  it.for(malformed)('$name', ({ name, prefix, bad, suffix, reason }) => {
    // The library's main is never reached: the bad bytes stop it at the import.
    write(`lib_${name}.aster`, prefix, bad, suffix);
    const root = `imports_${name}.aster`;
    const literal = `lib_${name}.aster`;
    writeFileSync(join(dir, root), `import "${literal}";\nfn helper(): int { return 0; }\n`);
    const caret = ' '.repeat(9) + '^'.repeat(literal.length + 2);
    const expected = {
      stdout: '',
      stderr: `${root}:1:8: error: cannot import '${literal}': invalid UTF-8 at ${reason}\n  import "${literal}";\n${caret}\n`,
      status: 1,
    };
    for (const argv of [['check', root], ['build', root, '--emit=c']]) {
      expect(latin1(run(argv)), `${stage().name} ${argv.join(' ')}`).toEqual(expected);
    }
  });
});

describe('well-formed UTF-8 controls', () => {
  it.for(valid)('$name', ({ name, prefix, bad, suffix, stdout, literal }) => {
    const file = `${name}.aster`;
    write(file, prefix, bad, suffix);
    const lib = `lib_ok_${name}.aster`;
    write(lib, prefix.toString().replace('fn main(): int', 'fn unused(): int'), bad, suffix);
    const root = `imports_ok_${name}.aster`;
    writeFileSync(join(dir, root), `import "${lib}";\nfn main(): int { return 0; }\n`);
    // check prints nothing; run prints the literal's bytes plus the newline; build --emit=c spells the literal as
    // octal escapes with its byte length, so it is pinned by that fragment (the rest of the C is not this test's concern).
    const checked = run(['check', file]);
    expect(latin1(checked), `${stage().name} check ${file}`).toEqual({ stdout: '', stderr: '', status: 0 });
    const ran = run(['run', file]);
    expect(ran.status, `${stage().name} run ${file}: ${ran.stderr.toString('latin1')}`).toBe(0);
    expect(ran.stderr.length, `${stage().name} run ${file} wrote to stderr`).toBe(0);
    expect([...ran.stdout], `${stage().name} run ${file}`).toEqual(stdout);
    for (const target of [file, root]) {
      const argv = ['build', target, '--emit=c'];
      const built = run(argv);
      expect(built.status, `${stage().name} ${argv.join(' ')}: ${built.stderr.toString('latin1')}`).toBe(0);
      expect(built.stderr.length).toBe(0);
      expect(built.stdout.toString('latin1')).toContain(literal);
    }
  });
});

describe('the parity suites decode output strictly', () => {
  it('throws on a raw 0xFF instead of comparing it equal to U+FFFD', () => {
    expect(() => spawnStrict('printf', ['a\\377b'])).toThrow('stdout of printf is not well-formed UTF-8');
    expect(spawnStrict('printf', ['a\\357\\277\\275b']).stdout).toBe('a�b');
  });
});

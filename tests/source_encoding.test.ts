import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { spawnStrict } from './spawn.js';
import { stage } from './stage.js';

// Source must be well-formed UTF-8 (issue #25, docs/superpowers/specs/2026-10-04-aster-source-encoding-design.md).
// Byte-generated files go to a temp dir, never tests/programs/, whose readers decode as UTF-8. Every comparison is on
// raw bytes: decoding first would map a raw 0xFF and U+FFFD's EF BF BD to the same string and hide the difference.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const S0_BIN = join(REPO_ROOT, 'packages', 'asterc', 'dist', 'cli', 'bin.js');

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

const runS0 = (argv: readonly string[]) => spawn(process.execPath, [S0_BIN, ...argv]);
const runSn = (argv: readonly string[]) => spawn(stage().bin, argv);

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

const valid: { name: string; prefix: string | Buffer; bad: number[]; suffix: string; stdout: number[] }[] = [
  { name: 'e_acute', prefix: IN_STRING[0], bad: [0xc3, 0xa9], suffix: IN_STRING[1], stdout: [0xc3, 0xa9, 0x0a] },
  { name: 'emoji', prefix: IN_STRING[0], bad: [0xf0, 0x9f, 0x98, 0x80], suffix: IN_STRING[1], stdout: [0xf0, 0x9f, 0x98, 0x80, 0x0a] },
  { name: 'bom', prefix: Buffer.concat([BOM, Buffer.from(IN_STRING[0])]), bad: [0x61], suffix: IN_STRING[1], stdout: [0x61, 0x0a] },
];

describe('malformed UTF-8 in the root file', () => {
  it.for(malformed)('$name', ({ name, prefix, bad, suffix, reason }) => {
    const file = `${name}.aster`;
    write(file, prefix, bad, suffix);
    const expected = { stdout: '', stderr: `${file}: error: invalid UTF-8 at ${reason}\n`, status: 1 };
    for (const argv of [['check', file], ['build', file, '--emit=c'], ['run', file]]) {
      const s0 = runS0(argv);
      expect({ ...s0, stdout: s0.stdout.toString('latin1'), stderr: s0.stderr.toString('latin1') }, `S0 ${argv.join(' ')}`).toEqual(expected);
      expect(runSn(argv), `${stage().name} ${argv.join(' ')}`).toEqual(s0);
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
    const s0 = runS0(['check', root]);
    const caret = ' '.repeat(9) + '^'.repeat(literal.length + 2);
    expect(s0.stderr.toString('latin1')).toBe(
      `${root}:1:8: error: cannot import '${literal}': invalid UTF-8 at ${reason}\n  import "${literal}";\n${caret}\n`,
    );
    expect(s0.status).toBe(1);
    expect(runSn(['check', root])).toEqual(s0);
    expect(runSn(['build', root, '--emit=c'])).toEqual(runS0(['build', root, '--emit=c']));
  });
});

describe('well-formed UTF-8 controls', () => {
  it.for(valid)('$name', ({ name, prefix, bad, suffix, stdout }) => {
    const file = `${name}.aster`;
    write(file, prefix, bad, suffix);
    const lib = `lib_ok_${name}.aster`;
    write(lib, prefix.toString().replace('fn main(): int', 'fn unused(): int'), bad, suffix);
    const root = `imports_ok_${name}.aster`;
    writeFileSync(join(dir, root), `import "${lib}";\nfn main(): int { return 0; }\n`);
    for (const argv of [['check', file], ['build', file, '--emit=c'], ['run', file], ['build', root, '--emit=c']]) {
      const s0 = runS0(argv);
      expect(s0.status, `S0 ${argv.join(' ')}: ${s0.stderr.toString('latin1')}`).toBe(0);
      expect(runSn(argv), `${stage().name} ${argv.join(' ')}`).toEqual(s0);
    }
    expect([...runSn(['run', file]).stdout]).toEqual(stdout);
  });
});

describe('the parity suites decode output strictly', () => {
  it('throws on a raw 0xFF instead of comparing it equal to U+FFFD', () => {
    expect(() => spawnStrict('printf', ['a\\377b'])).toThrow('stdout of printf is not well-formed UTF-8');
    expect(spawnStrict('printf', ['a\\357\\277\\275b']).stdout).toBe('a�b');
  });
});

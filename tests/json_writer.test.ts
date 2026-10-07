import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { buildDriver, REPO_ROOT } from './stage.js';

// json.aster and the range helpers, through a driver built by the stage under test. The driver reads raw bytes from a
// file named by argv and prints the result, so inputs can hold any byte.
const dir = mkdtempSync(join(tmpdir(), 'aster-json-'));
const exe = join(dir, 'json');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeAll(() => {
  const driver = join(dir, 'json.aster');
  writeFileSync(driver, `
import ${JSON.stringify(join(REPO_ROOT, 'packages/asterc-self/json.aster'))};
fn show(r: Range): string {
    return int_to_string(r.start) + " " + int_to_string(r.end) + " " + int_to_string(r.start_line) + ":" + int_to_string(r.start_col) + " " + int_to_string(r.end_line) + ":" + int_to_string(r.end_col);
}
fn main(args: [string]): int {
    let Result::Ok(text) = read_file(args[1]) else { return 2; };
    if args[0] == "str" { print(json_str(text)); }
    if args[0] == "lossy" { print(json_str(utf8_lossy(text))); }
    if args[0] == "join" { print(json_array(["1", "2", "3"]) + json_object([json_kv("a", json_bool(true)), json_kv("b", json_int(7))]) + json_array([])); }
    if args[0] == "range" {
        let bom: int = bom_len(text);
        let src: string = substring(text, bom, len(text));
        print(show(file_range(src, bom, 0, len(src))));
        print(show(file_range(src, bom, len(src) - 1, len(src) + 50)));
    }
    if args[0] == "invalid" { print(show(invalid_range(text, utf8_invalid_at(text)))); }
    return 0;
}
`);
  buildDriver(driver, exe);
});

function run(mode: string, bytes: Buffer): Buffer {
  const input = join(dir, 'input');
  writeFileSync(input, bytes);
  const r = spawnSync(exe, [mode, input], { env: { ...process.env, LC_ALL: 'C' } });
  if (r.error) throw r.error;
  expect(r.status).toBe(0);
  return r.stdout;
}

describe('json_str', () => {
  it('escapes quotes, backslashes, control bytes and DEL; keeps UTF-8 raw', () => {
    const input = Buffer.from('a"b\\c\nd\re\tf\u0001g\u007fh é 😀', 'utf8');
    expect(run('str', input).toString('utf8')).toBe('"a\\"b\\\\c\\nd\\re\\tf\\u0001g\\u007fh é 😀"\n');
  });
  it('round-trips through JSON.parse', () => {
    const s = 'x\u0000\u001f"\\   \u{1F600}';
    expect(JSON.parse(run('str', Buffer.from(s, 'utf8')).toString('utf8'))).toBe(s);
  });
});

describe('utf8_lossy', () => {
  it('replaces each maximal ill-formed subpart with U+FFFD', () => {
    // E1 80 is a truncated 3-byte sequence (one subpart); FF and the lone 80 are one each; F0 9F 98 80 is valid.
    const input = Buffer.from([0x61, 0xe1, 0x80, 0x62, 0xff, 0x80, 0x63, 0xf0, 0x9f, 0x98, 0x80]);
    expect(JSON.parse(run('lossy', input).toString('utf8'))).toBe('a�b��c\u{1F600}');
  });
  it('leaves well-formed text alone', () => {
    expect(JSON.parse(run('lossy', Buffer.from('dir/ü.aster')).toString('utf8'))).toBe('dir/ü.aster');
  });
});

describe('joins', () => {
  it('writes compact arrays and objects', () => {
    expect(run('join', Buffer.from('')).toString()).toBe('[1,2,3]{"a":true,"b":7}[]\n');
  });
});

describe('file_range', () => {
  it('counts the BOM in offsets but not in columns, CR as a column, astral as two units', () => {
    const text = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\n😀x', 'utf8')]);
    // src = "a\r\n😀x" (8 bytes). Whole file: 3..11, 1:1 to 2:4. Last byte: 10..11, 2:3 to 2:4; the end clamps.
    expect(run('range', text).toString()).toBe('3 11 1:1 2:4\n10 11 2:3 2:4\n');
  });
  it('places a malformed byte on its line, one column wide', () => {
    const text = Buffer.concat([Buffer.from('ab\ncé'), Buffer.from([0xff])]);
    expect(run('invalid', text).toString()).toBe('6 7 2:3 2:4\n');
  });
});

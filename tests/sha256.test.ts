import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDriver } from './stage.js';

// The sha256_hex builtin through a driver built by the stage under test: it prints the digest of a file's bytes as
// read_file returns them, BOM included, the way `aster query` digests a file.
const dir = mkdtempSync(join(tmpdir(), 'aster-sha256-'));
const exe = join(dir, 'sha');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeAll(() => {
  const driver = join(dir, 'sha.aster');
  writeFileSync(driver, `
fn main(args: [string]): int {
    let Result::Ok(text) = read_file(args[0]) else { return 2; };
    print(sha256_hex(text));
    return 0;
}
`);
  buildDriver(driver, exe);
});

function digest(bytes: Buffer): string {
  const input = join(dir, 'input');
  writeFileSync(input, bytes);
  const r = spawnSync(exe, [input], { encoding: 'utf8' });
  expect(r.status).toBe(0);
  return r.stdout.trim();
}

const node = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('sha256_hex', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(digest(Buffer.alloc(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(digest(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(digest(Buffer.from('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('matches Node across every padding boundary', () => {
    for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 300_000]) {
      const b = randomBytes(n);
      expect(digest(b), `length ${n}`).toBe(node(b));
    }
  });
  it('hashes a BOM as part of the bytes', () => {
    const b = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('fn main(): int {\r\n    return 0;\r\n}\r\n')]);
    expect(digest(b)).toBe(node(b));
  });
});

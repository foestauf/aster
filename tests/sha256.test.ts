import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDriver, REPO_ROOT } from './stage.js';

// sha256.aster through a driver built by the stage under test. `plain` hashes a file's bytes; `bom` hashes EF BB BF
// followed by them, the way `aster query` hashes a file whose BOM the loader stripped.
const dir = mkdtempSync(join(tmpdir(), 'aster-sha256-'));
const exe = join(dir, 'sha');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeAll(() => {
  const driver = join(dir, 'sha.aster');
  writeFileSync(driver, `
import ${JSON.stringify(join(REPO_ROOT, 'packages/asterc-self/sha256.aster'))};
fn main(args: [string]): int {
    let Result::Ok(text) = read_file(args[1]) else { return 2; };
    let s: Sha256 = sha256_new();
    let prefix: [int] = [];
    if args[0] == "bom" {
        push(prefix, 239);
        push(prefix, 187);
        push(prefix, 191);
    }
    print(sha256_hex(s, prefix, text));
    return 0;
}
`);
  buildDriver(driver, exe);
});

function digest(mode: 'plain' | 'bom', bytes: Buffer): string {
  const input = join(dir, 'input');
  writeFileSync(input, bytes);
  const r = spawnSync(exe, [mode, input], { encoding: 'utf8' });
  expect(r.status).toBe(0);
  return r.stdout.trim();
}

const node = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('sha256', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(digest('plain', Buffer.alloc(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(digest('plain', Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(digest('plain', Buffer.from('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('matches Node across every padding boundary', () => {
    for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129]) {
      const b = randomBytes(n);
      expect(digest('plain', b), `length ${n}`).toBe(node(b));
    }
  });
  it('hashes a BOM prefix as the on-disk bytes', () => {
    const body = Buffer.from('fn main(): int {\r\n    return 0;\r\n}\r\n');
    expect(digest('bom', body)).toBe(node(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])));
  });
  it('hashes 300 KB of arbitrary bytes', () => {
    const b = randomBytes(300_000);
    expect(digest('plain', b)).toBe(node(b));
  }, 60_000);
});

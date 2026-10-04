import { describe, expect, it } from 'vitest';
import { invalidUtf8At, invalidUtf8Reason } from './utf8.js';

const bytes = (...b: number[]) => Uint8Array.from(b);

describe('invalidUtf8At', () => {
  it.each<{ name: string; input: number[]; at: number }>([
    { name: 'empty', input: [], at: -1 },
    { name: 'ASCII', input: [0x61, 0x0a, 0x7f], at: -1 },
    { name: 'é, € and 😀', input: [0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80], at: -1 },
    { name: 'the edges: U+0080, U+07FF, U+0800, U+D7FF, U+E000, U+FFFF, U+10000, U+10FFFF', input: [0xc2, 0x80, 0xdf, 0xbf, 0xe0, 0xa0, 0x80, 0xed, 0x9f, 0xbf, 0xee, 0x80, 0x80, 0xef, 0xbf, 0xbf, 0xf0, 0x90, 0x80, 0x80, 0xf4, 0x8f, 0xbf, 0xbf], at: -1 },
    { name: 'a BOM', input: [0xef, 0xbb, 0xbf, 0x61], at: -1 },
    { name: 'a lone FF', input: [0x61, 0xff, 0x62], at: 1 },
    { name: 'FE', input: [0xfe], at: 0 },
    { name: 'a stray continuation byte', input: [0x61, 0x80], at: 1 },
    { name: 'a truncated 2-byte sequence at the end', input: [0x61, 0xc3], at: 1 },
    { name: 'a truncated 3-byte sequence before ASCII', input: [0xe2, 0x82, 0x61], at: 0 },
    { name: 'a truncated 4-byte sequence', input: [0xf0, 0x9f, 0x98], at: 0 },
    { name: 'overlong C0 80', input: [0x61, 0xc0, 0x80], at: 1 },
    { name: 'overlong C1 BF', input: [0xc1, 0xbf], at: 0 },
    { name: 'overlong E0 9F BF', input: [0xe0, 0x9f, 0xbf], at: 0 },
    { name: 'overlong F0 8F BF BF', input: [0xf0, 0x8f, 0xbf, 0xbf], at: 0 },
    { name: 'a surrogate ED A0 80', input: [0x61, 0x62, 0xed, 0xa0, 0x80], at: 2 },
    { name: 'past U+10FFFF: F4 90 80 80', input: [0xf4, 0x90, 0x80, 0x80], at: 0 },
    { name: 'F5', input: [0xf5, 0x80, 0x80, 0x80], at: 0 },
    { name: 'the first of two errors', input: [0xc3, 0xa9, 0x80, 0xff], at: 2 },
  ])('$name', ({ input, at }) => {
    expect(invalidUtf8At(bytes(...input))).toBe(at);
  });

  it('agrees with a fatal TextDecoder on random bytes', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const accepts = (b: Uint8Array) => {
      try {
        decoder.decode(b);
        return true;
      } catch {
        return false;
      }
    };
    // A fixed-seed LCG, skewed towards bytes that start or continue multi-byte sequences.
    let seed = 25;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    const pool = [0x00, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe1, 0xec, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf3, 0xf4, 0xf5, 0xff];
    for (let n = 0; n < 20_000; n++) {
      const b = Uint8Array.from({ length: next() % 8 }, () => (next() % 4 === 0 ? next() % 256 : pool[next() % pool.length]));
      expect(invalidUtf8At(b) === -1, `bytes ${[...b].map((x) => x.toString(16)).join(' ')}`).toBe(accepts(b));
    }
  });
});

describe('invalidUtf8Reason', () => {
  it('names the line and the byte offset', () => {
    const b = bytes(0x61, 0x0a, 0x0a, 0x62, 0xff);
    expect(invalidUtf8Reason(b, 4)).toBe('invalid UTF-8 at line 3, byte 4');
    expect(invalidUtf8Reason(b, 0)).toBe('invalid UTF-8 at line 1, byte 0');
  });
});

// Source files must be well-formed UTF-8 (Unicode Table 3-7). packages/asterc-self/loader.aster's utf8_invalid_at and
// utf8_reason are the same algorithm, byte for byte.

/** Offset of the first byte of the first ill-formed sequence in `bytes`, or -1 if it is well-formed UTF-8. */
export function invalidUtf8At(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      i += 1;
      continue;
    }
    // The sequence length and the range of its second byte; later bytes are always 80..BF.
    let n: number;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) n = 2;
    else if (b >= 0xe0 && b <= 0xef) {
      n = 3;
      if (b === 0xe0) lo = 0xa0;
      if (b === 0xed) hi = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      n = 4;
      if (b === 0xf0) lo = 0x90;
      if (b === 0xf4) hi = 0x8f;
    } else return i;
    if (i + n > bytes.length) return i;
    if (bytes[i + 1] < lo || bytes[i + 1] > hi) return i;
    for (let k = 2; k < n; k++) {
      if (bytes[i + k] < 0x80 || bytes[i + k] > 0xbf) return i;
    }
    i += n;
  }
  return -1;
}

/** `invalid UTF-8 at line <L>, byte <B>`: L is 1-based, B is the 0-based offset `at` into the file as stored. */
export function invalidUtf8Reason(bytes: Uint8Array, at: number): string {
  let line = 1;
  for (let i = 0; i < at; i++) {
    if (bytes[i] === 0x0a) line += 1;
  }
  return `invalid UTF-8 at line ${line}, byte ${at}`;
}

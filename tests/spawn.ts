import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';

// spawnSync with `encoding: 'utf8'` decodes leniently: a raw 0xFF and U+FFFD's EF BF BD both become '\uFFFD', so two
// outputs that differ in bytes compare equal (issue #25). spawnStrict decodes with a fatal decoder instead, and throws
// on output that is not well-formed UTF-8.

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** `bytes` as text, or an error naming `what` if they are not well-formed UTF-8. */
export function strictUtf8(bytes: Uint8Array, what: string): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error(`${what} is not well-formed UTF-8; compare it as bytes`);
  }
}

/** spawnSync, with stdout and stderr decoded strictly as UTF-8. */
export function spawnStrict(
  command: string,
  args: readonly string[],
  options: Omit<SpawnSyncOptions, 'encoding'> = {},
): SpawnSyncReturns<string> {
  // A string `input` is encoded with `encoding`, which 'buffer' is not, so it goes in as UTF-8 bytes.
  const input = typeof options.input === 'string' ? Buffer.from(options.input, 'utf8') : options.input;
  const r = spawnSync(command, args, { ...options, input, encoding: 'buffer' });
  const stdout = strictUtf8(r.stdout ?? Buffer.alloc(0), `stdout of ${command}`);
  const stderr = strictUtf8(r.stderr ?? Buffer.alloc(0), `stderr of ${command}`);
  return { ...r, stdout, stderr, output: [null, stdout, stderr] };
}

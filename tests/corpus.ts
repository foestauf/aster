import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROGRAMS_DIR = fileURLToPath(new URL('./programs/', import.meta.url));
const ACCEPTED = fileURLToPath(new URL('./golden/accepted.txt', import.meta.url));

/**
 * Every program the compiler accepts, as listed in tests/golden/accepted.txt: paths relative to PROGRAMS_DIR, sorted,
 * covering `.aster` files under tests/programs/, `fixtures/{check,typed,ir,emit}_*.txt` and packages/asterc-self/.
 */
export function acceptedFiles(): string[] {
  return readFileSync(ACCEPTED, 'utf8').split('\n').filter((line) => line !== '');
}

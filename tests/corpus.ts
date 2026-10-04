import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSource, runFrontend, type TypedProgram } from '../packages/asterc/src/index.js';

export const PROGRAMS_DIR = fileURLToPath(new URL('./programs/', import.meta.url));
const SELF_DIR = fileURLToPath(new URL('../packages/asterc-self/', import.meta.url));

/** The TypeScript front end's typed program for the file at `path`, or null if it reports any diagnostic. */
function typedOf(path: string): TypedProgram | null {
  const result = runFrontend(makeSource(path, readFileSync(path, 'utf8')));
  return result.diagnostics.length === 0 ? result.typed : null;
}

/**
 * Every program the TypeScript front end accepts, with its typed program: each `.aster` under tests/programs/, each
 * `fixtures/{check,typed,ir,emit}_*.txt`, and the libraries in packages/asterc-self/ (which have no main, so none is
 * accepted: the drivers cover them through their closures). Paths are relative to PROGRAMS_DIR, sorted.
 */
export function acceptedCorpus(): { file: string; typed: TypedProgram }[] {
  return readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.aster') || /fixtures[\\/](check|typed|ir|emit)_\w+\.txt$/.test(f))
    .concat(readdirSync(SELF_DIR).filter((f) => f.endsWith('.aster')).map((f) => join('..', '..', 'packages', 'asterc-self', f)))
    .toSorted()
    .flatMap((file) => {
      const typed = typedOf(join(PROGRAMS_DIR, file));
      return typed === null ? [] : [{ file, typed }];
    });
}

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, without a trailing slash. */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Absolute path of the golden file for case `name` of `kind`: path separators in `name` become '__'. */
export function goldenPath(kind: 'check' | 'cli', name: string): string {
  return join(REPO_ROOT, 'tests', 'golden', kind, `${name.replace(/[\\/]/g, '__')}.txt`);
}

/** A process outcome in the golden file format: exit status, then stdout and stderr, each as is. */
export function renderOutcome(o: { status: number | null; stdout: string; stderr: string }): string {
  return `== exit ${o.status}\n== stdout\n${o.stdout}== stderr\n${o.stderr}`;
}

/**
 * `text` with machine-specific paths removed: `REPO_ROOT` (and the slash after it) disappears, leaving repo-relative
 * paths, and each directory in `opts.tmp` becomes `<tmp>`. Longer paths are replaced first.
 */
export function normalise(text: string, opts: { tmp?: string[] } = {}): string {
  const rules: [string, string][] = [
    [`${REPO_ROOT}/`, ''],
    [REPO_ROOT, ''],
  ];
  for (const dir of opts.tmp ?? []) {
    const bare = dir.replace(/\/+$/, '');
    rules.push([`${bare}/`, '<tmp>/'], [bare, '<tmp>']);
  }
  return rules
    .toSorted((a, b) => b[0].length - a[0].length)
    .reduce((s, [from, to]) => s.split(from).join(to), text);
}

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The two-step rule: v0.8a adds maps and sets, but the installed compiler (build/asterc) predates them, so the
// compiler's own sources in packages/asterc-self/ must not use the map surface until v0.8b rewrites them onto it.
// `{}` is only counted where an expression is expected: after `=`, `(`, `,`, `[`, `:` or `return`. Elsewhere it is an empty
// block (`_ => {}`, `else {}`) or an empty struct body. This guard is deleted in v0.8b.

const SRC_DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'packages', 'asterc-self');

/** `src` with string literals blanked, then `//` comments removed (a `//` inside a string is not a comment). */
export function stripCommentsAndStrings(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      let out = '';
      for (let i = 0; i < line.length; i++) {
        const c = line[i]!;
        if (c === '"') {
          i++;
          while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1;
          out += '""';
        } else if (c === '/' && line[i + 1] === '/') break;
        else out += c;
      }
      return out;
    })
    .join('\n');
}

const BUILTIN_CALL = /\b(map_(set|get|has|remove|keys)|set_(add|has|remove|items))\s*\(/;

/** Each use of the map surface in `src`, as a short description. */
export function mapSurfaceUses(src: string): string[] {
  const code = stripCommentsAndStrings(src);
  const uses: string[] = [];
  for (const [re, what] of [
    [/\b(Map|Set)\s*\[/, 'Map[ or Set[ type'],
    [/(?:[=(,[:]|\breturn)\s*\{\s*\}/, '{} expression'],
    [BUILTIN_CALL, 'map or set builtin call'],
  ] as const) {
    const m = re.exec(code);
    if (m) uses.push(`${what}: ${m[0]}`);
  }
  return uses;
}

describe('two-step guard', () => {
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.aster'));

  it('scans the compiler sources', () => {
    expect(files).toContain('checker.aster');
    expect(files).toContain('asterc.aster');
  });

  it('detects a violation', () => {
    expect(mapSurfaceUses('let s: Set[int] = {};')).toHaveLength(2);
    expect(mapSurfaceUses('map_has(x, 1);')).toHaveLength(1);
    expect(mapSurfaceUses('return {};')).toHaveLength(1);
    expect(mapSurfaceUses('f(a, {});')).toHaveLength(1);
    // Empty blocks and empty structs are not the empty literal.
    expect(mapSurfaceUses('match x { _ => {} } else {} struct Unit {}')).toEqual([]);
    expect(mapSurfaceUses('print("map_has(x)"); // Map[int, int] {}')).toEqual([]);
  });

  it.for(files)('%s uses no maps or sets', (file) => {
    expect(mapSurfaceUses(readFileSync(join(SRC_DIR, file), 'utf8'))).toEqual([]);
  });
});

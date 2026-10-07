import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stage } from './stage.js';

// The acceptance test of issue #53: a consumer that knows only the public JSON contract (docs/inspect/README.md). It
// never reads stderr or human text, and takes positions only from `range` byte offsets.

const dir = mkdtempSync(join(tmpdir(), 'aster-consumer-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const strict = new TextDecoder('utf-8', { fatal: true });

function aster(argv: string[]) {
  const r = spawnSync(stage().bin, argv, { cwd: dir, env: { ...process.env, LC_ALL: 'C' }, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, doc: JSON.parse(strict.decode(r.stdout)) };
}

function slice(path: string, range: { start: number; end: number }): string {
  return readFileSync(join(dir, path)).subarray(range.start, range.end).toString('utf8');
}

const MAIN = 'import "geometry.aster";\n\nfn main(): int {\n    let p: Point = origin();\n    return area(p, 3);\n}\n';
const BROKEN = '// Shapes 📐\nstruct Point {\n    x: int,\n    y: int,\n}\n\nfn origin(): Point {\n    return Point { x: 0, y: 0 };\n}\n\nfn area(p: Point, side: int): int {\n    return p.z * side;\n}\n';
const FIXED = BROKEN.replace('p.z', 'p.x');

describe('an external consumer', () => {
  beforeAll(() => {
    writeFileSync(join(dir, 'main.aster'), MAIN);
    writeFileSync(join(dir, 'geometry.aster'), BROKEN);
  });

  it('finds a broken field access by code and exact range, without human text', () => {
    writeFileSync(join(dir, 'geometry.aster'), BROKEN);
    const { status, doc } = aster(['check', 'main.aster', '--format=json']);
    expect(status).toBe(1);
    expect(doc.schema).toBe('aster/1');
    const d = doc.diagnostics.find((x: any) => x.code === 'name.unknown-field');
    expect(d).toBeDefined();
    const file = doc.files[d.primary.file];
    expect(file.path.endsWith('geometry.aster')).toBe(true);
    expect(slice(file.path, d.primary.range)).toBe('z');
    expect(d.primary.range.start_line).toBe(12);
    const inspected = aster(['inspect', 'main.aster']);
    expect(inspected.status).toBe(1);
    expect(inspected.doc.semantics.available).toBe(false);
    expect(inspected.doc.semantics.reason).toBe('diagnostics');
  });

  it('reads the fixed program\'s declaration, signature and location', () => {
    writeFileSync(join(dir, 'main.aster'), MAIN);
    writeFileSync(join(dir, 'geometry.aster'), FIXED);
    const { status, doc } = aster(['inspect', 'main.aster']);
    expect(status).toBe(0);
    expect(doc.semantics.available).toBe(true);
    const decls = doc.semantics.declarations;
    const area = decls.find((x: any) => x.kind === 'fn' && x.name === 'area');
    const point = decls.find((x: any) => x.kind === 'struct' && x.name === 'Point');
    expect(area.signature.ret).toEqual({ kind: 'int' });
    expect(area.signature.params.map((p: any) => [p.name, p.type])).toEqual([
      ['p', { kind: 'struct', name: 'Point', decl: point.id }],
      ['side', { kind: 'int' }],
    ]);
    const path = doc.files[area.location.file].path;
    expect(slice(path, area.location.range)).toBe('area');
    expect(slice(path, area.decl_range).startsWith('fn area(')).toBe(true);
    const p = decls.find((x: any) => x.kind === 'local' && x.name === 'p');
    expect(p.type).toEqual({ kind: 'struct', name: 'Point', decl: point.id });
    expect(decls[p.scope].name).toBe('main');
  });
});

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stage } from './stage.js';

// The acceptance test of issue #59: a consumer that knows only the public JSON contract of `aster query`. It finds
// positions by byte offset, never reads stderr or diagnostic text, and refuses an answer whose digests no longer match.

const dir = mkdtempSync(join(tmpdir(), 'aster-query-consumer-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const strict = new TextDecoder('utf-8', { fatal: true });

const MAIN = 'import "shapes.aster";\n\n// 📐 entry\nfn main(): int {\n    let side: int = 3;\n    return area(side);\n}\n';
const SHAPES = 'fn area(side: int): int {\n    return side * side;\n}\n';
// Every test starts from these two files, so each one runs alone (`-t`); the tests that edit a file put it back.
const reset = () => {
  writeFileSync(join(dir, 'main.aster'), MAIN);
  writeFileSync(join(dir, 'shapes.aster'), SHAPES);
};
beforeAll(reset);

function aster(argv: string[]) {
  const r = spawnSync(stage().bin, argv, { cwd: dir, env: { ...process.env, LC_ALL: 'C' }, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, doc: JSON.parse(strict.decode(r.stdout)) };
}

const sha = (path: string) => createHash('sha256').update(readFileSync(join(dir, path))).digest('hex');
/** Whether every file the answer depends on still has the bytes it was computed from. */
const fresh = (doc: any) => doc.files.every((f: any) => sha(f.path) === f.sha256);

describe('a query consumer', () => {
  it('goes from a caret after a callee to the imported declaration', () => {
    const caret = Buffer.from(MAIN).indexOf('area(') + 'area'.length;
    const { status, doc } = aster(['query', 'main.aster', '--file=main.aster', `--caret=${caret}`]);
    expect(status).toBe(0);
    expect(fresh(doc)).toBe(true);
    expect(doc.query.site).toBe('callee');
    expect(doc.query.signature.ret).toEqual({ kind: 'int' });
    const target = doc.semantics.declarations[doc.query.target];
    const path = doc.files[target.location.file].path;
    expect(readFileSync(join(dir, path)).subarray(target.location.range.start, target.location.range.end).toString()).toBe('area');
  });

  it('reads the type of a use and its declaration', () => {
    const at = Buffer.from(MAIN).indexOf('side);');
    const { doc } = aster(['query', 'main.aster', '--file=main.aster', `--offset=${at}`]);
    expect(doc.query).toMatchObject({ status: 'found', site: 'local', type: { kind: 'int' } });
    expect(doc.semantics.declarations[doc.query.target]).toMatchObject({ kind: 'local', name: 'side' });
  });

  it('treats a comment as no result, not an error', () => {
    const at = Buffer.from(MAIN).indexOf('entry');
    const { status, doc } = aster(['query', 'main.aster', '--file=main.aster', `--offset=${at}`]);
    expect([status, doc.query.status]).toEqual([0, 'none']);
  });

  it('detects a stale response', () => {
    const at = Buffer.from(MAIN).indexOf('side);');
    const { doc } = aster(['query', 'main.aster', '--file=main.aster', `--offset=${at}`]);
    try {
      writeFileSync(join(dir, 'shapes.aster'), SHAPES + '// edited after the query\n');
      expect(fresh(doc)).toBe(false);
    } finally {
      reset();
    }
    expect(fresh(doc)).toBe(true);
  });

  it('gets no semantics from a broken import, by status alone', () => {
    try {
      writeFileSync(join(dir, 'shapes.aster'), SHAPES.replace('side * side', 'true'));
      const { status, doc } = aster(['query', 'main.aster', '--file=main.aster', '--offset=0']);
      expect(status).toBe(1);
      expect(doc.query).toMatchObject({ status: 'unavailable', reason: 'diagnostics' });
      expect(doc.diagnostics[0].code).toBe('type.mismatch');
    } finally {
      reset();
    }
  });
});

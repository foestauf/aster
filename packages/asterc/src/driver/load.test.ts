import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatShort } from '../diagnostics/diagnostic.js';
import { makeSource, nextBase } from '../diagnostics/source.js';
import { loadProgram, nodeHost, type LoadHost } from './load.js';

/** An in-memory file system keyed by absolute path; real paths are just resolved paths. */
function memoryHost(files: Record<string, string>): LoadHost {
  const fs = new Map(Object.entries(files));
  return {
    readFile: (path) => {
      const text = fs.get(path);
      return text === undefined ? { ok: false, reason: 'No such file or directory' } : { ok: true, text };
    },
    realPath: (path) => resolve(path),
  };
}

const MAIN = 'fn main(): int { return 0; }\n';

function load(files: Record<string, string>, rootPath = '/r/main.aster') {
  const root = makeSource(rootPath, files[rootPath]);
  return loadProgram(root, memoryHost(files));
}

describe('loadProgram', () => {
  it('loads a lone root file at base 0', () => {
    const result = load({ '/r/main.aster': MAIN });
    expect(result.diagnostics).toEqual([]);
    expect(result.map.files.map((f) => [f.path, f.base])).toEqual([['/r/main.aster', 0]]);
    expect(result.rootEnd).toBe(MAIN.length);
    expect(result.program.functions.map((f) => f.name)).toEqual(['main']);
  });

  it('loads depth first, pre-order, laying files out with nextBase', () => {
    const result = load({
      '/r/main.aster': `import "a.aster";\nimport "b.aster";\n${MAIN}`,
      '/r/a.aster': 'import "c.aster";\nfn a(): int { return 1; }\n',
      '/r/b.aster': 'fn b(): int { return 2; }\n',
      '/r/c.aster': 'struct C { x: int }\n',
    });
    expect(result.diagnostics).toEqual([]);
    const { files } = result.map;
    expect(files.map((f) => f.path)).toEqual(['/r/main.aster', '/r/a.aster', '/r/c.aster', '/r/b.aster']);
    expect(files[0].base).toBe(0);
    for (let k = 1; k < files.length; k++) expect(files[k].base).toBe(nextBase(files[k - 1]));
    expect(result.rootEnd).toBe(files[0].text.length);
    expect(result.program.functions.map((f) => f.name)).toEqual(['main', 'a', 'b']);
    expect(result.program.structs.map((s) => s.name)).toEqual(['C']);
    expect(result.program.imports.map((i) => i.path)).toEqual(['a.aster', 'b.aster', 'c.aster']);
    // Spans are global: `fn b` starts inside b's range.
    const b = result.program.functions[2];
    expect(b.span.start).toBe(files[3].base);
  });

  it('loads a file reached by several spellings once', () => {
    const result = load({
      '/r/main.aster': `import "./lib.aster";\nimport "lib.aster";\nimport "sub/../lib.aster";\n${MAIN}`,
      '/r/lib.aster': 'fn lib(): int { return 1; }\n',
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.map.files.map((f) => f.path)).toEqual(['/r/main.aster', '/r/lib.aster']);
    expect(result.program.functions.map((f) => f.name)).toEqual(['main', 'lib']);
  });

  it('terminates on cycles and self-imports', () => {
    const cycle = load({
      '/r/main.aster': `import "a.aster";\n${MAIN}`,
      '/r/a.aster': 'import "main.aster";\nfn a(): int { return 1; }\n',
    });
    expect(cycle.diagnostics).toEqual([]);
    expect(cycle.map.files.map((f) => f.path)).toEqual(['/r/main.aster', '/r/a.aster']);

    const self = load({ '/r/main.aster': `import "main.aster";\nimport "./main.aster";\n${MAIN}` });
    expect(self.diagnostics).toEqual([]);
    expect(self.map.files.map((f) => f.path)).toEqual(['/r/main.aster']);
  });

  it('resolves imports against the importing file, and joins display paths to it', () => {
    const result = load({
      '/r/main.aster': `import "sub/a.aster";\n${MAIN}`,
      '/r/sub/a.aster': 'import "b.aster";\n',
      '/r/sub/b.aster': 'fn b(): int { return 1; }\n',
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.map.files.map((f) => f.path)).toEqual(['/r/main.aster', '/r/sub/a.aster', '/r/sub/b.aster']);
  });

  it('keeps relative display paths relative', () => {
    const files = { [resolve('rel/main.aster')]: `import "sub/a.aster";\n${MAIN}`, [resolve('rel/sub/a.aster')]: '' };
    const root = makeSource('rel/main.aster', files[resolve('rel/main.aster')]);
    const result = loadProgram(root, memoryHost(files));
    expect(result.diagnostics).toEqual([]);
    expect(result.map.files.map((f) => f.path)).toEqual(['rel/main.aster', join('rel', 'sub', 'a.aster')]);
  });

  it('uses an absolute import path as is', () => {
    const result = load({ '/r/main.aster': `import "/lib/x.aster";\n${MAIN}`, '/lib/x.aster': '' });
    expect(result.diagnostics).toEqual([]);
    expect(result.map.files.map((f) => f.path)).toEqual(['/r/main.aster', '/lib/x.aster']);
  });

  it('reports a file that cannot be read at the import literal', () => {
    const text = `fn helper(): int { return 1; }\nimport "nope.aster";\n${MAIN}`;
    const result = load({ '/r/main.aster': text });
    expect(result.diagnostics.map((d) => formatShort(result.map, d))).toEqual([
      "2:8 cannot import 'nope.aster': No such file or directory",
    ]);
    const [d] = result.diagnostics;
    expect(text.slice(d.span.start, d.span.end)).toBe('"nope.aster"');
  });

  it('reports syntax errors in imported files inside their range', () => {
    const result = load({
      '/r/main.aster': `import "bad.aster";\n${MAIN}`,
      '/r/bad.aster': 'fn broken( { }\n',
    });
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const bad = result.map.files[1];
    for (const d of result.diagnostics) {
      expect(d.span.start).toBeGreaterThanOrEqual(bad.base);
      expect(d.span.start).toBeLessThanOrEqual(bad.base + bad.text.length);
    }
    expect(formatShort(result.map, result.diagnostics[0])).toMatch(/^bad\.aster:1:\d+ /);
  });

  it('still follows imports of a file with syntax errors', () => {
    const result = load({
      '/r/main.aster': `import "a.aster";\nfn oops( {}\n${MAIN}`,
      '/r/a.aster': 'fn a(: int {}\n',
    });
    const files = result.diagnostics.map((d) => formatShort(result.map, d).split(':')[0]);
    expect(files).toContain('a.aster');
  });
});

describe('nodeHost', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aster-load-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads files and maps OS errors to their reasons', () => {
    writeFileSync(join(dir, 'x.aster'), 'hello');
    mkdirSync(join(dir, 'd'));
    expect(nodeHost.readFile(join(dir, 'x.aster'))).toEqual({ ok: true, text: 'hello' });
    expect(nodeHost.readFile(join(dir, 'missing'))).toEqual({ ok: false, reason: 'No such file or directory' });
    expect(nodeHost.readFile(join(dir, 'd'))).toEqual({ ok: false, reason: 'Is a directory' });
    expect(nodeHost.readFile(join(dir, 'x\0y'))).toEqual({ ok: false, reason: 'invalid path' });
  });

  it('resolves real paths, falling back to path.resolve', () => {
    expect(nodeHost.realPath(join(dir, 'd', '..', 'x.aster'))).toBe(nodeHost.realPath(join(dir, 'x.aster')));
    expect(nodeHost.realPath(join(dir, 'missing'))).toBe(resolve(dir, 'missing'));
    expect(nodeHost.realPath('a\0b')).toBe(resolve('a\0b'));
  });

  it('loads imports from disk through the default host', () => {
    writeFileSync(join(dir, 'lib.aster'), 'fn lib(): int { return 1; }\n');
    const result = loadProgram(makeSource(join(dir, 'main.aster'), `import "lib.aster";\n${MAIN}`), nodeHost);
    expect(result.diagnostics).toEqual([]);
    expect(result.program.functions.map((f) => f.name)).toEqual(['main', 'lib']);
  });
});

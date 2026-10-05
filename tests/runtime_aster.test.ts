import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { renderRuntimeAster } from '../scripts/gen-runtime.js';
import { buildExecutable, compileToC, formatDiagnostic, makeSource } from '../packages/asterc/src/index.js';
import { spawnStrict } from './spawn.js';

const RUNTIME_DIR = resolve('runtime');
const RUNTIME_AST = resolve('packages/asterc-self/runtime.aster');
const h = readFileSync(join(RUNTIME_DIR, 'aster_rt.h'), 'utf8');
const c = readFileSync(join(RUNTIME_DIR, 'aster_rt.c'), 'utf8');

const workDir = mkdtempSync(join(tmpdir(), 'aster-runtime-'));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe('runtime.aster', () => {
  it('is up to date with runtime/ (run `pnpm gen:runtime`)', () => {
    expect(readFileSync(RUNTIME_AST, 'utf8'), 'runtime.aster is stale: run `pnpm gen:runtime`').toBe(renderRuntimeAster(h, c));
  });

  it('rejects a non-ASCII runtime', () => {
    expect(() => renderRuntimeAster('café', '')).toThrow('ASCII');
  });

  it('round-trips both files byte for byte when built by stage 0', () => {
    const path = join(workDir, 'main.aster');
    const src = `import ${JSON.stringify(RUNTIME_AST)};\nfn main(): int {\n    print(runtime_h());\n    print(runtime_c());\n    return 0;\n}\n`;
    writeFileSync(path, src);
    const compiled = compileToC(makeSource(path, src));
    if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
    const exe = join(workDir, 'main');
    const built = buildExecutable(compiled.c, exe, ['-Werror']);
    if (!built.ok) throw new Error(built.message);
    const run = spawnStrict(exe, [], { maxBuffer: 16 * 1024 * 1024 });
    expect(run.status).toBe(0);
    // print appends a newline after each string.
    expect(run.stdout).toBe(`${h}\n${c}\n`);
  });
});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const RUNTIME = resolve('runtime');
const work = mkdtempSync(join(tmpdir(), 'aster-runtime-map-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('runtime hash table', () => {
  it('passes the C harness (insertion order, tombstones, compaction, sets)', () => {
    const out = join(work, 'harness');
    const build = spawnSync(
      'cc',
      ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', RUNTIME, resolve('tests/runtime_map_harness.c'), join(RUNTIME, 'aster_rt.c'), '-o', out],
      { encoding: 'utf8' },
    );
    expect(build.error).toBeUndefined();
    expect(build.stderr).toBe('');
    expect(build.status).toBe(0);
    const run = spawnSync(out, [], { encoding: 'utf8' });
    expect(run.error).toBeUndefined();
    expect(run.stdout).toBe('ok\n');
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });
});

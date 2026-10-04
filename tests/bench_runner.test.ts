import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../scripts/bench.js';

// Linux is the compiler's supported platform. Exercise the actual measurement
// boundary as well as the pure statistics: child failure must never be hidden.
describe('native benchmark measurement runner', () => {
  let work: string;
  let runner: string;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'aster-bench-runner-test-'));
    runner = join(work, 'runner');
    const build = spawnSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', join(REPO_ROOT, 'scripts/bench-runner.c'), '-o', runner], { encoding: 'utf8' });
    if (build.error || build.status !== 0 || build.stderr !== '') {
      throw new Error(`measurement runner build failed: ${build.error?.message ?? build.stderr}`);
    }
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  function measure(command: string[]) {
    const metrics = join(work, 'metrics.json');
    rmSync(metrics, { force: true });
    const process = spawnSync(runner, [metrics, ...command], { encoding: 'utf8' });
    expect(process.error).toBeUndefined();
    expect(process.status).toBe(0);
    const timing = JSON.parse(readFileSync(metrics, 'utf8')) as { elapsedMs: number; peakRssKiB: number; exitCode: number; signal: number };
    expect(timing.elapsedMs).toBeGreaterThan(0);
    expect(timing.peakRssKiB).toBeGreaterThanOrEqual(0);
    return { process, timing };
  }

  it('preserves exact stdout, stderr and nonzero child exit', () => {
    const { process, timing } = measure(['sh', '-c', "printf 'answer\\n'; printf 'notice\\n' >&2; exit 7"]);
    expect(process.stdout).toBe('answer\n');
    expect(process.stderr).toBe('notice\n');
    expect(timing.exitCode).toBe(7);
    expect(timing.signal).toBe(0);
  });
  it('records signal termination distinctly', () => {
    const { timing } = measure(['sh', '-c', 'kill -TERM $$']);
    expect(timing.exitCode).toBe(143);
    expect(timing.signal).toBe(15);
  });
  it('records an exec failure rather than a successful timing', () => {
    const { process, timing } = measure([join(work, 'nonexistent-program')]);
    expect(process.stderr).toContain('nonexistent-program');
    expect(timing.exitCode).toBe(127);
    expect(timing.signal).toBe(0);
  });
  it('reports its own usage errors with status 125', () => {
    const process = spawnSync(runner, [], { encoding: 'utf8' });
    expect(process.status).toBe(125);
    expect(process.stderr).toContain('usage: bench-runner');
  });
});

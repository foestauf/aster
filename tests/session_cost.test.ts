import { describe, expect, it } from 'vitest';
import { generateLargeProgram, parseOptions, positionOf, parseTimeOutput, readRssKiB, renderProcessTable, summarize } from '../scripts/session-cost.js';

// Issue #62: the pure helpers of the session-cost evidence script. The measurements themselves never run in CI.

describe('summarize', () => {
  it('reports median and spread without mutating', () => {
    const v = [5, 1, 3];
    expect(summarize(v)).toEqual({ n: 3, median: 3, min: 1, max: 5 });
    expect(v).toEqual([5, 1, 3]);
    expect(summarize([4, 1, 3, 2]).median).toBe(2.5);
    expect(summarize([7])).toEqual({ n: 1, median: 7, min: 7, max: 7 });
  });
  it('rejects empty or nonfinite input', () => {
    for (const v of [[], [NaN]]) expect(() => summarize(v)).toThrow(Error);
  });
});

describe('options', () => {
  it('defaults and overrides', () => {
    expect(parseOptions([])).toEqual({ runs: 10, compiler: 'build/asterc', record: false });
    expect(parseOptions(['--runs=3', '--compiler=x/asterc', '--record'])).toEqual({ runs: 3, compiler: 'x/asterc', record: true });
  });
  it('rejects bad input', () => {
    for (const a of [['--runs=0'], ['--runs=1.5'], ['--wat'], ['--compiler=']]) expect(() => parseOptions(a)).toThrow(Error);
  });
});

describe('generateLargeProgram', () => {
  it('is deterministic, has main, and scales', () => {
    const a = generateLargeProgram(5000);
    expect(a).toBe(generateLargeProgram(5000));
    expect(a).toContain('fn main(): int');
    const kb = Buffer.byteLength(a) / 1024;
    expect(kb).toBeGreaterThan(400);
    expect(kb).toBeLessThan(700);
  });
});

describe('parseTimeOutput', () => {
  it('reads the last "%e %M" line', () => {
    expect(parseTimeOutput('noise\n0.35 334848\n')).toEqual({ elapsedS: 0.35, maxRssKiB: 334848 });
    expect(parseTimeOutput('Command exited with non-zero status 1\n0.01 2000\n')).toEqual({ elapsedS: 0.01, maxRssKiB: 2000 });
    expect(parseTimeOutput('garbage')).toBeNull();
  });
});

describe('readRssKiB', () => {
  it('is positive for this process and 0 for a missing pid', () => {
    expect(readRssKiB(process.pid)).toBeGreaterThan(0);
    expect(readRssKiB(2 ** 22 + 12345)).toBe(0);
  });
});

describe('renderProcessTable', () => {
  it('renders medians with spread and marks failures', () => {
    const t = renderProcessTable([
      { program: 'demo', command: 'query', wallMs: [1, 2, 3], rssKiB: [3500, 3600, 3700], outBytes: 900, failures: 0 },
      { program: 'big', command: 'check', wallMs: [10], rssKiB: [100], outBytes: 10, failures: 2 },
    ]);
    expect(t).toContain('| demo | query | 2.0 (1.0–3.0) | 3600 (3500–3700) | 900 | 0 |');
    expect(t).toContain('| big | check | 10.0 (10.0–10.0) | 100 (100–100) | 10 | 2 |');
  });
});

describe('positionOf', () => {
  it('turns a byte offset into a 0-based line and UTF-16 character, inverting byteOffset', async () => {
    const { createRequire } = await import('node:module');
    const convert = createRequire(import.meta.url)('../editors/vscode/src/convert.cjs');
    const bytes = Buffer.from('ab\n📐 x\ny');
    expect(positionOf(bytes, 0)).toEqual({ line: 0, character: 0 });
    expect(positionOf(bytes, 3)).toEqual({ line: 1, character: 0 });
    expect(positionOf(bytes, 8)).toEqual({ line: 1, character: 3 });
    for (const off of [0, 1, 3, 7, 8, 10]) {
      const p = positionOf(bytes, off);
      expect(convert.byteOffset(bytes, p.line, p.character).offset).toBe(off);
    }
  });
});

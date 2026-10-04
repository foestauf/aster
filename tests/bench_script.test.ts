import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertExpected, compareConfigurations, geometricMean, median, parseExpected, parseOptions, REPO_ROOT, renderReport, renderReproduction, roundOrder, type Report, type Result } from '../scripts/bench.js';

describe('benchmark statistics', () => {
  it('computes odd and even medians without mutating samples', () => {
    const values = [7, 1, 3];
    expect(median(values)).toBe(3);
    expect(values).toEqual([7, 1, 3]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([9])).toBe(9);
  });
  it('rejects empty or nonfinite medians', () => {
    for (const values of [[], [NaN], [Infinity]]) expect(() => median(values)).toThrow(Error);
  });
  it('uses a logarithmic geometric mean', () => {
    expect(geometricMean([0.5, 2])).toBeCloseTo(1);
    expect(geometricMean([1, 4, 16])).toBeCloseTo(4);
    expect(geometricMean([1e300, 1e300])).toBeCloseTo(1e300, -288);
  });
  it('rejects zero, negative, empty or nonfinite geometric means', () => {
    for (const values of [[], [0], [-1], [NaN], [Infinity]]) expect(() => geometricMean(values)).toThrow(Error);
  });
});

describe('benchmark CLI', () => {
  it('defaults to five measured runs and all C variants', () => {
    expect(parseOptions([])).toEqual({ runs: 5, configs: ['c-O2', 'c-O3', 'c-lto'], compiler: 'build/asterc', record: null, sourceRevision: null, environmentNote: null });
  });
  it('supports record names, explicit source provenance and optional LLVM', () => {
    expect(parseOptions(['--record', '--runs=7']).record).toBe('baseline');
    expect(parseOptions(['--record=llvm-decision', '--configs=c-O2,c-O3,c-lto,llvm', '--source-revision=' + 'a'.repeat(40), '--compiler=build/other', '--environment-note=Debian cloud']).record).toBe('llvm-decision');
  });
  it('rejects malformed, unknown and duplicate arguments', () => {
    for (const args of [
      ['--runs=0'], ['--runs=-1'], ['--runs=1.5'], ['--runs=1001'], ['--runs'], ['--wat'],
      ['--record=../escape'], ['--record='], ['--compiler='], ['--source-revision=short'],
      ['--configs=llvm'], ['--configs=c-O2,c-O2'], ['--configs=c-O2,unknown'], ['--runs=2', '--runs=3'],
    ]) expect(() => parseOptions(args)).toThrow(Error);
  });
});

describe('expected output and scheduling', () => {
  it('parses multiline stdout, stderr and exit status exactly', () => {
    expect(parseExpected('// expect-stdout: hello\n// expect-stdout:\n// expect-stdout: 42\n// expect-stderr: notice\n// expect-exit: 1')).toEqual({ stdout: 'hello\n\n42\n', stderr: 'notice\n', exitCode: 1 });
  });
  it('requires declared stdout and valid unambiguous status', () => {
    expect(() => parseExpected('fn main(): int { return 0; }')).toThrow(Error);
    for (const extra of ['// expect-exit: nope', '// expect-exit: 256', '// expect-exit: 0\n// expect-exit: 0']) {
      expect(() => parseExpected('// expect-stdout: 0\n' + extra)).toThrow(Error);
    }
  });
  it('checks exit, stdout, stderr and trailing newlines without normalization', () => {
    const expected = { stdout: '42\n', stderr: '', exitCode: 0 };
    expect(() => assertExpected(expected, expected, 'sample')).not.toThrow(Error);
    for (const actual of [{ ...expected, stdout: '42' }, { ...expected, stderr: 'warning' }, { ...expected, exitCode: 2 }]) {
      expect(() => assertExpected(actual, expected, 'sample')).toThrow(/sample:/);
    }
  });
  it('rotates all configurations, preserving input', () => {
    const configs = ['c-O2', 'c-O3', 'c-lto'];
    expect(roundOrder(configs, 0)).toEqual(configs);
    expect(roundOrder(configs, 1)).toEqual(['c-O3', 'c-lto', 'c-O2']);
    expect(roundOrder(configs, 2)).toEqual(['c-lto', 'c-O2', 'c-O3']);
    expect(roundOrder(configs, 3)).toEqual(configs);
    expect(configs).toEqual(['c-O2', 'c-O3', 'c-lto']);
    expect(roundOrder([], 5)).toEqual([]);
    expect(() => roundOrder(configs, -1)).toThrow(Error);
  });
});

function result(benchmark: string, configuration: Result['configuration'], ms: number, kind: Result['kind'] = 'runtime'): Result {
  return { benchmark, kind, configuration, medianWallMs: ms, medianPeakRssKiB: 1024, command: ['program'], samples: [] };
}

describe('whole-suite C selection', () => {
  it('selects one best whole-suite C configuration, excluding compiler rows and LLVM', () => {
    const results = [
      result('a', 'c-O2', 100), result('b', 'c-O2', 100),
      result('a', 'c-O3', 25), result('b', 'c-O3', 200),
      result('a', 'c-lto', 50), result('b', 'c-lto', 50),
      result('a', 'llvm', 10), result('b', 'llvm', 10),
      result('self-build', 'c-O2', 1, 'self-build'), result('self-build', 'c-lto', 10000, 'self-build'),
    ];
    const comparison = compareConfigurations(results, ['c-O2', 'c-O3', 'c-lto', 'llvm']);
    expect(comparison.bestC).toBe('c-lto');
    expect(comparison.geometricMeanSpeedups['c-O3']).toBeCloseTo(Math.sqrt(2));
    expect(comparison.geometricMeanSpeedups['c-lto']).toBeCloseTo(2);
    expect(comparison.geometricMeanSpeedups.llvm).toBeCloseTo(10);
  });
  it('keeps c-O2 on ties and refuses incomplete suites', () => {
    expect(compareConfigurations([result('a', 'c-O2', 1), result('a', 'c-O3', 1)], ['c-O2', 'c-O3']).bestC).toBe('c-O2');
    expect(() => compareConfigurations([], ['c-O2'])).toThrow(Error);
    expect(() => compareConfigurations([result('a', 'c-O2', 1)], ['c-O2', 'c-O3'])).toThrow(Error);
    expect(() => compareConfigurations([result('a', 'c-O2', 0)], ['c-O2'])).toThrow(Error);
  });
});

function fixture(): Report {
  return {
    schemaVersion: 1,
    environment: { recordedAt: '2026-10-04T00:00:00.000Z', gitCommit: 'local-sha', gitDirty: true, sourceRevision: 'upstream-sha', inputSha256: 'input-sha', compilerSha256: 'compiler-sha', uname: 'Linux x86_64', osRelease: 'Debian 13', cpu: 'test CPU', cpuCount: 4, governor: 'unavailable', cc: 'gcc 13.3', clang: 'clang 18.1', lld: 'lld 18.1', node: 'v24.0.0', note: 'cloud materialization', deviations: ['reference OS differs'] },
    options: parseOptions([]), workloadSources: [], buildCommands: [], results: [result('integers', 'c-O2', 12.34567)],
    bestC: 'c-O2', geometricMeanSpeedups: { 'c-O2': 1 }, ok: true, failure: null,
  };
}

describe('report rendering', () => {
  it('includes provenance, precision, method, limits and explicit best C', () => {
    const text = renderReport(fixture());
    for (const expected of ['upstream-sha', 'dirty: yes', 'input-sha', 'cloud materialization', 'DEVIATION', '12.346', '1024', 'wait4', 'Medians exclude warmups', 'rotating configuration order', 'Best measured whole-suite C configuration: c-O2', 'self-emit-c', 'unchanged driver (cc -O2)', 'No L5/default-backend decision', 'PASS']) {
      expect(text).toContain(expected);
    }
  });
  it('renders incomplete and failed runs without an apparent pass', () => {
    const report = fixture();
    report.ok = false;
    report.failure = 'incorrect checksum';
    report.bestC = null;
    report.results[0]!.medianWallMs = null;
    const text = renderReport(report);
    expect(text).toContain('incomplete');
    expect(text).toContain('not established');
    expect(text).toContain('FAIL: incorrect checksum');
    expect(text).not.toContain('\nPASS');
  });
});

describe('benchmark orchestration boundary', () => {
  const text = readFileSync(join(REPO_ROOT, 'scripts/bench.ts'), 'utf8');
  it('imports no compiler implementation', () => {
    expect(text).not.toMatch(/from\s+['"][^'"]*packages\//);
    expect(text).not.toMatch(/import\(\s*['"][^'"]*packages\//);
  });
  it('derives paths from the script, not the caller working directory', () => {
    expect(REPO_ROOT.endsWith('/')).toBe(true);
    expect(text).not.toMatch(/process\.cwd\(\)/);
  });
  it('keeps optional LLVM opt-in and the package entry point dependency-free', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.bench).toBe('node scripts/bench.ts');
    expect(readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')).toContain('.bench/');
    expect(parseOptions([]).configs).not.toContain('llvm');
  });
});

describe('record reproduction recipe', () => {
  it('preserves a named bootstrap binary and describes the matching toolchain', () => {
    const args = ['--record', '--compiler=build/asterc-baseline'];
    const text = renderReproduction(parseOptions(args), args);
    expect(text).toContain('export PATH=');
    expect(text).toContain('gcc 13');
    expect(text).toContain('clang/lld 18');
    expect(text).toContain('pnpm bootstrap');
    expect(text).toContain("cp -- build/asterc 'build/asterc-baseline'");
    expect(text).toContain('Never splice LLVM samples');
    expect(renderReproduction(parseOptions(args), args, '2')).toContain("taskset -c '2' pnpm bench");
  });
  it('does not copy the default compiler onto itself and quotes custom paths', () => {
    expect(renderReproduction(parseOptions([]), [])).not.toContain('cp --');
    const args = ["--compiler=build/compiler's copy"];
    expect(renderReproduction(parseOptions(args), args)).toContain("'build/compiler'\\''s copy'");
  });
});

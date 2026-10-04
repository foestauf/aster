import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertExpected, assessVariability, compareConfigurations, evaluateL5, geometricMean, median, parseExpected, parseOptions, REPO_ROOT, renderReport, renderReproduction, renderL5, roundOrder, type Report, type Result } from '../scripts/bench.js';

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
    environment: { recordedAt: '2026-10-04T00:00:00.000Z', gitCommit: 'local-sha', gitDirty: true, sourceRevision: 'upstream-sha', inputSha256: 'input-sha', compilerSha256: 'compiler-sha', uname: 'Linux x86_64', osRelease: 'Debian 13', cpu: 'test CPU', cpuCount: 4, cpuAffinity: '0-3', governor: 'unavailable', cc: 'gcc 13.3', clang: 'clang 18.1', lld: 'lld 18.1', node: 'v24.0.0', note: 'cloud materialization', deviations: ['reference OS differs'] },
    options: parseOptions([]), workloadSources: [], buildCommands: [], results: [result('integers', 'c-O2', 12.34567)],
    bestC: 'c-O2', geometricMeanSpeedups: { 'c-O2': 1 }, decision: evaluateL5([], ['c-O2'], true), ok: true, failure: null,
  };
}

describe('report rendering', () => {
  it('includes provenance, precision, method, limits and explicit best C', () => {
    const text = renderReport(fixture());
    for (const expected of ['upstream-sha', 'dirty: yes', 'input-sha', 'cloud materialization', 'DEVIATION', '12.346', '1024', 'wait4', 'Medians exclude warmups', 'rotating configuration order', 'Best measured whole-suite C configuration: c-O2', 'self-emit-c', 'unchanged driver (cc -O2)', 'L5 performance decision: NOT-EVALUATED', 'No compiler defaults are changed', 'Benchmark output checks: PASS']) {
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
    expect(text).not.toContain('Benchmark output checks: PASS');
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


const allConfigs = ['c-O2', 'c-O3', 'c-lto', 'llvm'] as const;
function sampled(benchmark: string, configuration: Result['configuration'], ms: number, kind: Result['kind'] = 'runtime', times: number[] = [ms, ms, ms, ms, ms]): Result {
  return { ...result(benchmark, configuration, median(times), kind),
    samples: [ms, ...times].map((elapsedMs, round) => ({ round, warmup: round === 0, elapsedMs, peakRssKiB: 1024, exitCode: 0, signal: 0, stdoutSha256: 'checked', stderrSha256: 'empty', valid: true })) };
}
function decisionFixture(): Result[] {
  return allConfigs.flatMap((configuration, index) => [
    sampled('a', configuration, [100, 95, 90, 80][index]!),
    sampled('b', configuration, [100, 95, 90, 80][index]!),
    sampled('self-build', configuration, [1000, 950, 900, 850][index]!, 'self-build'),
    sampled('self-emit-c', configuration, [10, 11, 12, 20][index]!, 'self-emit-c'),
  ]);
}
function replaceCase(results: Result[], replacement: Result): Result[] {
  return results.map((entry) => entry.benchmark === replacement.benchmark && entry.configuration === replacement.configuration ? replacement : entry);
}

describe('L5 performance decision', () => {
  it('requires fresh complete configurations and separate successful correctness', () => {
    expect(evaluateL5(decisionFixture(), allConfigs, false).status).toBe('not-evaluated');
    expect(evaluateL5(decisionFixture(), ['c-O2', 'llvm'], true).status).toBe('not-evaluated');
    expect(evaluateL5(decisionFixture().filter((entry) => entry.configuration !== 'c-lto'), allConfigs, true).status).toBe('inconclusive');
  });
  it('uses the best whole-suite C and all three exact gates', () => {
    const decision = evaluateL5(decisionFixture(), allConfigs, true);
    expect(decision.bestC).toBe('c-lto');
    expect(decision.suiteSpeedup).toBeCloseTo(1.125);
    expect(decision.selfBuildSpeedup).toBeCloseTo(900 / 850);
    expect(decision.suitePass).toBe(true);
    expect(decision.selfBuildPass).toBe(true);
    expect(decision.runtimePass).toBe(true);
    expect(decision.measuredGatesPass).toBe(true);
    expect(decision.status).toBe('passes');
    // The slower LLVM self-emitter is intentionally not a fourth gate.
    expect(decision.qualityIssues).toEqual([]);
  });
  it('accepts exactly 1.10x suite and equal self-build medians', () => {
    let results = decisionFixture();
    for (const name of ['a', 'b']) results = replaceCase(results, sampled(name, 'llvm', 90 / 1.1));
    results = replaceCase(results, sampled('self-build', 'llvm', 900, 'self-build'));
    expect(evaluateL5(results, allConfigs, true).status).toBe('passes');
  });
  it('fails below 1.10x even when LLVM beats unoptimized C by 10%', () => {
    let results = decisionFixture();
    for (const name of ['a', 'b']) results = replaceCase(results, sampled(name, 'llvm', 85));
    const decision = evaluateL5(results, allConfigs, true);
    expect(decision.suitePass).toBe(false);
    expect(decision.status).toBe('fails');
  });
  it('fails a slower full self-build even with a faster suite', () => {
    const decision = evaluateL5(replaceCase(decisionFixture(), sampled('self-build', 'llvm', 901, 'self-build')), allConfigs, true);
    expect(decision.suitePass).toBe(true);
    expect(decision.selfBuildPass).toBe(false);
    expect(decision.status).toBe('fails');
  });
  it('accepts 5% runtime regression and rejects anything greater', () => {
    let results = replaceCase(decisionFixture(), sampled('a', 'llvm', 90 * 1.05));
    results = replaceCase(results, sampled('b', 'llvm', 40));
    expect(evaluateL5(results, allConfigs, true).status).toBe('passes');
    const decision = evaluateL5(replaceCase(results, sampled('a', 'llvm', 90 * 1.05001)), allConfigs, true);
    expect(decision.suitePass).toBe(true);
    expect(decision.runtimePass).toBe(false);
    expect(decision.status).toBe('fails');
  });
  it('keeps noisy measured gates visible but calls the conclusion inconclusive', () => {
    const results = replaceCase(decisionFixture(), sampled('a', 'llvm', 80, 'runtime', [60, 75, 80, 90, 100]));
    const decision = evaluateL5(results, allConfigs, true);
    expect(decision.measuredGatesPass).toBe(true);
    expect(decision.status).toBe('inconclusive');
    expect(decision.qualityIssues.join(' ')).toContain('above 20%');
    expect(renderL5(decision).join('\n')).toContain('not a confidence interval');
  });
  it('considers noisy competing C configurations but treats emitter noise separately', () => {
    const noisyC = replaceCase(decisionFixture(), sampled('a', 'c-O3', 95, 'runtime', [65, 95, 95, 95, 125]));
    expect(evaluateL5(noisyC, allConfigs, true).status).toBe('inconclusive');
    const noisyEmit = replaceCase(decisionFixture(), sampled('self-emit-c', 'llvm', 20, 'self-emit-c', [1, 10, 20, 100, 1000]));
    expect(evaluateL5(noisyEmit, allConfigs, true).status).toBe('passes');
    expect(renderL5(evaluateL5(noisyEmit, allConfigs, true)).join(' ')).toContain('emission-only diagnostic, not a gate');
  });
  it('rejects short, unchecked, duplicate or inconsistent sample sets', () => {
    const short = replaceCase(decisionFixture(), sampled('a', 'llvm', 80, 'runtime', [80, 80]));
    expect(evaluateL5(short, allConfigs, true).status).toBe('inconclusive');
    const unchecked = decisionFixture();
    unchecked[0]!.samples[1]!.valid = false;
    expect(evaluateL5(unchecked, allConfigs, true).status).toBe('inconclusive');
    const inconsistent = decisionFixture();
    inconsistent[0]!.medianWallMs = 101;
    expect(evaluateL5(inconsistent, allConfigs, true).qualityIssues.join(' ')).toContain('stored median differs');
    const duplicate = decisionFixture();
    duplicate.push(duplicate[0]!);
    expect(evaluateL5(duplicate, allConfigs, true).status).toBe('inconclusive');
  });
  it('excludes warmup from spread and flags the earlier string-like variance', () => {
    const row = sampled('string', 'c-lto', 203, 'runtime', [149, 182, 203, 260, 295]);
    row.samples[0]!.elapsedMs = 5000;
    const variability = assessVariability([row])[0]!;
    expect(variability.minMs).toBe(149);
    expect(variability.maxMs).toBe(295);
    expect(variability.relativeSpread).toBeCloseTo(146 / 203);
    expect(variability.noisy).toBe(true);
    expect(assessVariability([sampled('a', 'c-O2', 100, 'runtime', [90, 100, 100, 100, 110])])[0]!.noisy).toBe(false);
  });
  it('reports correctness success independently of a performance failure', () => {
    const report = fixture();
    report.decision = evaluateL5(replaceCase(decisionFixture(), sampled('self-build', 'llvm', 950, 'self-build')), allConfigs, true);
    const text = renderReport(report);
    expect(text).toContain('L5 performance decision: FAILS');
    expect(text).toContain('Benchmark output checks: PASS');
    expect(text).toContain('No compiler defaults are changed');
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

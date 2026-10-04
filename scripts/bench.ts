import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// L1: orchestration only. No compiler implementation imports or changed driver flags.
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const C_CONFIGS = ['c-O2', 'c-O3', 'c-lto'] as const;
export type Configuration = (typeof C_CONFIGS)[number] | 'llvm';
const COMPILER_SOURCE = 'packages/asterc-self/asterc.aster';
const RUNTIME = 'packages/asterc/runtime';
const ALL_CONFIGS: readonly Configuration[] = [...C_CONFIGS, 'llvm'];
const USAGE = 'usage: pnpm bench [--runs=N] [--configs=c-O2,c-O3,c-lto[,llvm]] [--compiler=PATH] [--record[=NAME]] [--source-revision=SHA] [--environment-note=TEXT]';

export interface Options {
  runs: number;
  configs: Configuration[];
  compiler: string;
  record: string | null;
  sourceRevision: string | null;
  environmentNote: string | null;
}
export interface Expected { stdout: string; stderr: string; exitCode: number }
export interface Sample {
  round: number;
  warmup: boolean;
  elapsedMs: number;
  peakRssKiB: number;
  exitCode: number;
  signal: number;
  stdoutSha256: string;
  stderrSha256: string;
  valid: boolean;
}
export interface Result {
  benchmark: string;
  kind: 'runtime' | 'self-emit-c' | 'self-build';
  configuration: Configuration;
  command: string[];
  samples: Sample[];
  medianWallMs: number | null;
  medianPeakRssKiB: number | null;
}
export interface Environment {
  recordedAt: string;
  gitCommit: string;
  gitDirty: boolean;
  sourceRevision: string | null;
  inputSha256: string;
  compilerSha256: string;
  uname: string;
  osRelease: string;
  cpu: string;
  cpuCount: number;
  governor: string;
  cc: string;
  clang: string;
  lld: string;
  node: string;
  note: string | null;
  deviations: string[];
}
export interface Report {
  schemaVersion: 1;
  environment: Environment;
  options: Options;
  workloadSources: { name: string; sha256: string; expected: Expected }[];
  buildCommands: { configuration: Configuration; source: string; command: string[] }[];
  results: Result[];
  bestC: Configuration | null;
  geometricMeanSpeedups: Partial<Record<Configuration, number>>;
  ok: boolean;
  failure: string | null;
}

export function median(values: readonly number[]): number {
  if (values.length === 0 || values.some((v) => !Number.isFinite(v))) throw new Error('median needs finite, nonempty values');
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function geometricMean(values: readonly number[]): number {
  if (values.length === 0 || values.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('geometric mean needs positive finite, nonempty values');
  return Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length);
}

/** Deterministic rotation balances early/late placement; no configurations run concurrently. */
export function roundOrder<T>(values: readonly T[], round: number): T[] {
  if (!Number.isInteger(round) || round < 0) throw new Error('round must be a nonnegative integer');
  if (values.length === 0) return [];
  const offset = round % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

export function parseOptions(argv: string[]): Options {
  const options: Options = { runs: 5, configs: [...C_CONFIGS], compiler: 'build/asterc', record: null, sourceRevision: null, environmentNote: null };
  const seen = new Set<string>();
  for (const arg of argv) {
    const equal = arg.indexOf('=');
    const key = equal < 0 ? arg : arg.slice(0, equal);
    const value = equal < 0 ? '' : arg.slice(equal + 1);
    if (seen.has(key)) throw new Error(`duplicate argument '${key}'`);
    seen.add(key);
    if (key === '--record') {
      options.record = equal < 0 ? 'baseline' : value;
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.record)) throw new Error('record name must contain only letters, digits, hyphens and underscores');
    } else if (key === '--runs' && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 1000) {
      options.runs = Number(value);
    } else if (key === '--configs') {
      const selected = value.split(',');
      if (selected.some((c) => !ALL_CONFIGS.includes(c as Configuration)) || new Set(selected).size !== selected.length || !selected.includes('c-O2')) {
        throw new Error('--configs must be unique known configurations and include c-O2');
      }
      options.configs = selected as Configuration[];
    } else if (key === '--compiler' && value !== '') {
      options.compiler = value;
    } else if (key === '--source-revision' && /^[a-f0-9]{40}$/.test(value)) {
      options.sourceRevision = value;
    } else if (key === '--environment-note' && value !== '') {
      options.environmentNote = value;
    } else {
      throw new Error(`invalid argument '${arg}'`);
    }
  }
  return options;
}

/** Same header convention as golden tests; every benchmark must explicitly declare stdout. */
export function parseExpected(source: string): Expected {
  const expected: Expected = { stdout: '', stderr: '', exitCode: 0 };
  let stdoutSeen = false;
  let exitSeen = false;
  for (const line of source.split('\n')) {
    const match = /^\/\/ expect-(stdout|stderr|exit):(?: (.*))?$/.exec(line);
    if (!match) continue;
    const value = match[2] ?? '';
    if (match[1] === 'stdout') {
      expected.stdout += value + '\n';
      stdoutSeen = true;
    } else if (match[1] === 'stderr') {
      expected.stderr += value + '\n';
    } else {
      if (exitSeen || !/^\d+$/.test(value) || Number(value) > 255) throw new Error('expected exit must be declared once as 0..255');
      exitSeen = true;
      expected.exitCode = Number(value);
    }
  }
  if (!stdoutSeen) throw new Error('benchmark needs at least one // expect-stdout: header');
  return expected;
}

function shortened(value: string | number): string {
  return JSON.stringify(value).slice(0, 400);
}

export function assertExpected(actual: Expected, expected: Expected, subject: string): void {
  for (const field of ['exitCode', 'stdout', 'stderr'] as const) {
    if (actual[field] !== expected[field]) {
      throw new Error(`${subject}: ${field} mismatch: expected ${shortened(expected[field])}, got ${shortened(actual[field])}`);
    }
  }
}

/** One configuration wins the entire runtime suite. Never cherry-pick a different C backend per workload. */
export function compareConfigurations(results: readonly Result[], configs: readonly Configuration[]): {
  bestC: Configuration;
  geometricMeanSpeedups: Partial<Record<Configuration, number>>;
} {
  const baseline = results.filter((r) => r.kind === 'runtime' && r.configuration === 'c-O2');
  if (baseline.length === 0) throw new Error('no c-O2 runtime results');
  const geometricMeanSpeedups: Partial<Record<Configuration, number>> = {};
  for (const config of configs) {
    const ratios = baseline.map((base) => {
      const candidate = results.find((r) => r.kind === 'runtime' && r.benchmark === base.benchmark && r.configuration === config);
      if (!candidate?.medianWallMs || !base.medianWallMs) throw new Error(`missing or nonpositive median for ${config}/${base.benchmark}`);
      return base.medianWallMs / candidate.medianWallMs;
    });
    geometricMeanSpeedups[config] = geometricMean(ratios);
  }
  let bestC: Configuration = 'c-O2';
  for (const config of C_CONFIGS) {
    if ((geometricMeanSpeedups[config] ?? 0) > geometricMeanSpeedups[bestC]!) bestC = config;
  }
  return { bestC, geometricMeanSpeedups };
}

export function renderReport(report: Report): string {
  const env = report.environment;
  const lines = [
    'Aster benchmark report',
    `recorded    ${env.recordedAt}`,
    `git commit  ${env.gitCommit} (dirty: ${env.gitDirty ? 'yes' : 'no'})`,
    `source rev  ${env.sourceRevision ?? '(git commit above)'}`,
    `input hash  ${env.inputSha256}`,
    `compiler    ${env.compilerSha256}`,
    `platform    ${env.uname}; ${env.osRelease}`,
    `CPU         ${env.cpu} (${env.cpuCount} visible logical CPUs); governor: ${env.governor}`,
    `cc          ${env.cc}`,
    `clang       ${env.clang}`,
    `lld         ${env.lld}`,
    `node        ${env.node}`,
    ...(env.note ? [`note        ${env.note}`] : []),
    ...env.deviations.map((deviation) => `DEVIATION   ${deviation}`),
    '',
    `Each case: 1 checked warmup + ${report.options.runs} checked timed runs; serial, rotating configuration order.`,
    'Wall time: CLOCK_MONOTONIC around fork/exec/wait. Peak RSS: Linux wait4 ru_maxrss (KiB).',
    'RSS includes waited-for descendants, taking the largest individual process peak, not a simultaneous total.',
    'Medians exclude warmups. Raw samples and all build commands are in .bench/report.json.',
    '',
    'benchmark              configuration  median wall ms  median peak RSS KiB',
  ];
  for (const r of report.results) {
    lines.push(`${r.benchmark.padEnd(23)}${r.configuration.padEnd(15)}${(r.medianWallMs?.toFixed(3) ?? 'incomplete').padStart(14)}  ${(r.medianPeakRssKiB?.toFixed(0) ?? 'incomplete').padStart(19)}`);
  }
  lines.push('', `Suite selection: geometric mean of the ${report.workloadSources.length} runtime speedups over c-O2; self-compile rows excluded.`);
  for (const config of report.options.configs) {
    const speedup = report.geometricMeanSpeedups[config];
    lines.push(`  ${config}: ${speedup === undefined ? 'incomplete' : speedup.toFixed(4) + 'x'}`);
  }
  lines.push(`Best measured whole-suite C configuration: ${report.bestC ?? 'not established'}.`, '',
    'self-emit-c: each configured compiler emits its own C; output must be byte-identical to the oracle.',
    'self-build: each configured compiler completes a native rebuild; the rebuilt compiler must reproduce the C oracle.',
    'C self-build uses the unchanged driver (cc -O2) for the child binary, even when the running compiler is c-O3/c-lto.',
    'LLVM self-build selects --backend=llvm. Validation of rebuilt binaries is outside the measured interval.',
    'No L5/default-backend decision follows from this run alone.', '',
    report.ok ? 'PASS' : `FAIL: ${report.failure ?? 'unknown error'}`);
  return lines.join('\n') + '\n';
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function run(command: string[], timeout = 600_000) {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' },
    maxBuffer: 256 * 1024 * 1024, timeout,
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.status ?? 128, signal: result.signal };
}
function checked(command: string[]): string {
  const result = run(command);
  if (result.exitCode !== 0 || result.signal) throw new Error(`${command.join(' ')} failed (${result.exitCode}):\n${result.stderr}`);
  return result.stdout;
}
function optional(command: string[]): string {
  try { return checked(command).trim(); } catch { return 'unavailable'; }
}
function readable(path: string): string {
  try { return readFileSync(path, 'utf8').trim(); } catch { return 'unavailable'; }
}
function filesBelow(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const name = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(name) : [name];
  }).toSorted();
}
function environment(options: Options, compiler: string): Environment {
  const cc = optional(['cc', '--version']).split('\n')[0]!;
  const ccMajor = optional(['cc', '-dumpversion']).split('.')[0];
  const uname = optional(['uname', '-sm']);
  const release = readable('/etc/os-release');
  const pretty = /^PRETTY_NAME="?(.*?)"?$/m.exec(release)?.[1] ?? release;
  const deviations: string[] = [];
  if (uname !== 'Linux x86_64') deviations.push(`expected Linux x86_64, found ${uname}`);
  if (ccMajor !== '13') deviations.push(`reference C toolchain is gcc 13; actual cc major is ${ccMajor}`);
  if (!/^ID=ubuntu$/m.test(release) || !/^VERSION_ID="24\.04"$/m.test(release)) deviations.push('reference CI OS is Ubuntu 24.04; this machine differs');
  if (!optional(['cc', '--version']).includes('Free Software Foundation')) deviations.push('cc is not identified as GCC');
  const cpu = cpus();
  const inputFiles = [...filesBelow(join(REPO_ROOT, 'bench')).filter((f) => f.endsWith('.aster')),
    ...filesBelow(join(REPO_ROOT, 'packages/asterc-self')).filter((f) => f.endsWith('.aster')),
    join(REPO_ROOT, RUNTIME, 'aster_rt.c'), join(REPO_ROOT, RUNTIME, 'aster_rt.h'),
    join(REPO_ROOT, 'scripts/bench.ts'), join(REPO_ROOT, 'scripts/bench-runner.c')].toSorted();
  const inputSha256 = sha256(inputFiles.map((f) => `${relative(REPO_ROOT, f)}\0${sha256(readFileSync(f))}\n`).join(''));
  return {
    recordedAt: new Date().toISOString(), gitCommit: optional(['git', 'rev-parse', 'HEAD']),
    gitDirty: optional(['git', 'status', '--porcelain']) !== '', sourceRevision: options.sourceRevision,
    inputSha256, compilerSha256: sha256(readFileSync(compiler)), uname, osRelease: pretty,
    cpu: cpu[0]?.model ?? 'unavailable', cpuCount: cpu.length,
    governor: readable('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor'), cc,
    clang: optional(['clang', '--version']).split('\n')[0]!, lld: optional(['ld.lld', '--version']), node: process.version, note: options.environmentNote, deviations,
  };
}

export function main(argv: string[]): number {
  let options: Options;
  try { options = parseOptions(argv); } catch (error) {
    console.error(`bench: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const outDir = join(REPO_ROOT, '.bench');
  mkdirSync(outDir, { recursive: true });
  const work = mkdtempSync(join(outDir, 'work-'));
  const compiler = resolve(REPO_ROOT, options.compiler);
  const report: Report = {
    schemaVersion: 1,
    environment: { recordedAt: new Date().toISOString(), gitCommit: 'unavailable', gitDirty: true, sourceRevision: options.sourceRevision, inputSha256: '', compilerSha256: '', uname: '', osRelease: '', cpu: '', cpuCount: 0, governor: '', cc: '', clang: '', lld: '', node: process.version, note: options.environmentNote, deviations: [] },
    options, workloadSources: [], buildCommands: [], results: [], bestC: null, geometricMeanSpeedups: {}, ok: false, failure: null,
  };
  try {
    accessSync(compiler, constants.X_OK);
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or later is required');
    if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('bench measurement requires Linux x86_64');
    report.environment = environment(options, compiler);
    for (const deviation of report.environment.deviations) console.warn(`bench: ${deviation}`);
    const runner = join(work, 'bench-runner');
    checked(['cc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', join(REPO_ROOT, 'scripts/bench-runner.c'), '-o', runner]);
    const sources = readdirSync(join(REPO_ROOT, 'bench')).filter((name) => name.endsWith('.aster')).toSorted();
    if (sources.length === 0) throw new Error('no benchmark programs found');
    const programs = sources.map((file) => {
      const source = join('bench', file);
      const text = readFileSync(join(REPO_ROOT, source), 'utf8');
      const name = basename(file, '.aster');
      const expected = parseExpected(text);
      report.workloadSources.push({ name, sha256: sha256(text), expected });
      return { source, name, expected };
    });
    const cOracleResult = run([compiler, 'build', COMPILER_SOURCE, '--emit=c']);
    if (cOracleResult.exitCode !== 0 || cOracleResult.stderr !== '') throw new Error(`compiler C oracle failed: ${cOracleResult.stderr}`);
    const oracle = cOracleResult.stdout;
    const binaries = new Map<string, string>();
    const build = (source: string, name: string, configuration: Configuration): string => {
      const output = join(work, `${name}-${configuration}`);
      let command: string[];
      if (configuration === 'c-O2' || configuration === 'llvm') {
        command = [compiler, 'build', source, ...(configuration === 'llvm' ? ['--backend=llvm'] : []), '-o', output];
      } else {
        const cFile = join(work, `${name}-${configuration}.c`);
        const emitCommand = [compiler, 'build', source, '--emit=c'];
        report.buildCommands.push({ configuration, source, command: emitCommand });
        const emission = run(emitCommand);
        if (emission.exitCode !== 0 || emission.stderr !== '') throw new Error(`C emission failed for ${source}: ${emission.stderr}`);
        writeFileSync(cFile, emission.stdout);
        command = ['cc', '-std=c11', ...(configuration === 'c-O3' ? ['-O3'] : ['-O2', '-flto']), '-Wall',
          '-I' + join(REPO_ROOT, RUNTIME), cFile, join(REPO_ROOT, RUNTIME, 'aster_rt.c'), '-o', output];
      }
      report.buildCommands.push({ configuration, source, command });
      checked(command);
      binaries.set(`${name}/${configuration}`, output);
      return output;
    };
    // All compilation finishes before timing starts, so a compiler process cannot perturb a workload sample.
    for (const configuration of options.configs) {
      for (const program of programs) build(program.source, program.name, configuration);
      build(COMPILER_SOURCE, 'self', configuration);
      console.log(`built ${configuration}`);
    }
    let sampleNumber = 0;
    const measured = (result: Result, round: number, expected: Expected): string => {
      const metrics = join(work, `sample-${sampleNumber++}.json`);
      const output = run([runner, metrics, ...result.command]);
      if (output.exitCode !== 0 || !existsSync(metrics)) throw new Error(`measurement runner failed: ${output.stderr}`);
      const timing = JSON.parse(readFileSync(metrics, 'utf8')) as Pick<Sample, 'elapsedMs' | 'peakRssKiB' | 'exitCode' | 'signal'>;
      if (!Number.isFinite(timing.elapsedMs) || timing.elapsedMs <= 0 || !Number.isFinite(timing.peakRssKiB) || timing.peakRssKiB < 0) throw new Error('invalid measurement runner output');
      const sample: Sample = { ...timing, round, warmup: round === 0, stdoutSha256: sha256(output.stdout), stderrSha256: sha256(output.stderr), valid: false };
      result.samples.push(sample);
      assertExpected({ ...output, exitCode: timing.exitCode }, expected, `${result.benchmark}/${result.configuration} round ${round}`);
      if (timing.signal !== 0) throw new Error(`${result.benchmark} terminated by signal ${timing.signal}`);
      sample.valid = true;
      return output.stdout;
    };
    const addResults = (benchmark: string, kind: Result['kind'], command: (configuration: Configuration) => string[]) => {
      for (const configuration of options.configs) {
        report.results.push({ benchmark, kind, configuration, command: command(configuration), samples: [], medianWallMs: null, medianPeakRssKiB: null });
      }
    };
    for (const program of programs) addResults(program.name, 'runtime', (config) => [binaries.get(`${program.name}/${config}`)!]);
    addResults('self-emit-c', 'self-emit-c', (config) => [binaries.get(`self/${config}`)!, 'build', COMPILER_SOURCE, '--emit=c']);
    addResults('self-build', 'self-build', (config) => [binaries.get(`self/${config}`)!, 'build', COMPILER_SOURCE,
      ...(config === 'llvm' ? ['--backend=llvm'] : []), '-o', join(work, `rebuilt-${config}`)]);
    // Round 0 is the single warmup. Interleave configurations and rotate each round to reduce systematic order bias.
    for (let round = 0; round <= options.runs; round++) {
      for (const benchmark of [...programs.map((p) => p.name), 'self-emit-c', 'self-build']) {
        for (const config of roundOrder(options.configs, round)) {
          const result = report.results.find((r) => r.benchmark === benchmark && r.configuration === config)!;
          const expected = result.kind === 'runtime' ? programs.find((p) => p.name === benchmark)!.expected :
            { stdout: result.kind === 'self-emit-c' ? oracle : '', stderr: '', exitCode: 0 };
          measured(result, round, expected);
          if (result.kind === 'self-build') {
            const rebuilt = run([join(work, `rebuilt-${config}`), 'build', COMPILER_SOURCE, '--emit=c']);
            assertExpected(rebuilt, { stdout: oracle, stderr: '', exitCode: 0 }, `rebuilt ${config} compiler`);
          }
        }
      }
      console.log(round === 0 ? 'checked warmup complete' : `checked round ${round}/${options.runs} complete`);
    }
    for (const result of report.results) {
      const timed = result.samples.filter((sample) => !sample.warmup);
      result.medianWallMs = median(timed.map((sample) => sample.elapsedMs));
      result.medianPeakRssKiB = median(timed.map((sample) => sample.peakRssKiB));
    }
    Object.assign(report, compareConfigurations(report.results, options.configs));
    report.ok = true;
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const text = renderReport(report);
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(outDir, 'report.txt'), text);
  console.log(text);
  if (report.ok && options.record) {
    mkdirSync(join(REPO_ROOT, 'docs/perf'), { recursive: true });
    const rawSamples = report.results.map((result) => `### ${result.benchmark} / ${result.configuration}\n\n` +
      '| Round | Warmup | Wall ms | Peak RSS KiB | Checked |\n|---:|:---:|---:|---:|:---:|\n' +
      result.samples.map((s) => `| ${s.round} | ${s.warmup ? 'yes' : 'no'} | ${s.elapsedMs.toFixed(6)} | ${s.peakRssKiB} | ${s.valid ? 'yes' : 'NO'} |`).join('\n')).join('\n\n');
    writeFileSync(join(REPO_ROOT, 'docs/perf', `${options.record}.md`), [
      '# Aster C / LLVM benchmark record', '',
      'This is a measurement of the machine and inputs named below. Deviations are explicit; it is not automatically a certified reference-machine result.', '',
      '```text', text.trimEnd(), '```', '',
      '## Reproduce', '', 'Run `pnpm bootstrap`, then:', '',
      '```sh', `pnpm bench ${argv.map((arg) => "'" + arg.replaceAll("'", "'\\''") + "'").join(' ')}`.trimEnd(), '```', '',
      '## Raw samples', '', rawSamples, '',
      '## Exact run data', '', 'The JSON includes source checksums, expected output, compiler provenance, commands and all samples.', '',
      '```json', JSON.stringify(report, null, 2), '```', '',
    ].join('\n'));
  }
  return report.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

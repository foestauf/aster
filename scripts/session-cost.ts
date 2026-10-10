import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Issue #62, Track B: what one-shot compiler requests cost, measured on the released compiler and the unmodified editor
// adapter. Orchestration and measurement only; nothing here changes the compiler or the extension.
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const USAGE = 'usage: node scripts/session-cost.ts [--runs=N] [--compiler=PATH] [--record]';

export interface Options { runs: number; compiler: string; record: boolean }
export interface Summary { n: number; median: number; min: number; max: number }
export interface ProcessRow { program: string; command: string; wallMs: number[]; rssKiB: number[]; outBytes: number; failures: number }

// Median and spread of a sample set; the input is left untouched.
export function summarize(values: readonly number[]): Summary {
  if (values.length === 0 || values.some((v) => !Number.isFinite(v))) throw new Error('summarize needs finite samples');
  const s = values.toSorted((a, b) => a - b);
  const mid = s.length >> 1;
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return { n: s.length, median, min: s[0], max: s[s.length - 1] };
}

export function parseOptions(argv: string[]): Options {
  const options: Options = { runs: 10, compiler: 'build/asterc', record: false };
  for (const arg of argv) {
    if (arg.startsWith('--runs=')) {
      const n = Number(arg.slice('--runs='.length));
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error(`bad --runs: ${arg}\n${USAGE}`);
      options.runs = n;
    } else if (arg.startsWith('--compiler=')) {
      const c = arg.slice('--compiler='.length);
      if (c === '') throw new Error(`--compiler needs a path\n${USAGE}`);
      options.compiler = c;
    } else if (arg === '--record') {
      options.record = true;
    } else {
      throw new Error(`unknown argument: ${arg}\n${USAGE}`);
    }
  }
  return options;
}

// A single-file program of `functions` small functions and a `main` that calls the last one: the scaling input.
export function generateLargeProgram(functions: number): string {
  const parts: string[] = [];
  for (let i = 0; i < functions; i++) {
    parts.push(`fn f${i}(x: int): int {\n    let y: int = x + ${i};\n    let z: int = y * ${i % 7 + 1};\n    return z - x;\n}\n`);
  }
  parts.push(`fn main(): int {\n    let r: int = f${functions - 1}(1);\n    return r - r;\n}\n`);
  return parts.join('\n');
}

// The `%e %M` line /usr/bin/time writes last on stderr: elapsed seconds and maximum RSS in KiB.
export function parseTimeOutput(stderr: string): { elapsedS: number; maxRssKiB: number } | null {
  const lines = stderr.trimEnd().split('\n');
  const m = /^(\d+(?:\.\d+)?) (\d+)$/.exec(lines[lines.length - 1] ?? '');
  return m ? { elapsedS: Number(m[1]), maxRssKiB: Number(m[2]) } : null;
}

// A live process's resident set in KiB, or 0 when it has gone (it may exit between listing and reading).
export function readRssKiB(pid: number): number {
  try {
    const m = /^VmRSS:\s+(\d+) kB$/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

const spread = (s: Summary, digits: number) => `${s.median.toFixed(digits)} (${s.min.toFixed(digits)}–${s.max.toFixed(digits)})`;

export function renderProcessTable(rows: readonly ProcessRow[]): string {
  return [
    '| Program | Command | Wall ms median (min–max) | Max RSS KiB median (min–max) | Output bytes | Failed |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.program} | ${r.command} | ${spread(summarize(r.wallMs), 1)} | ${spread(summarize(r.rssKiB), 0)} | ${r.outBytes} | ${r.failures} |`),
  ].join('\n');
}

if (process.argv[1] !== undefined && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  parseOptions(process.argv.slice(2));
}

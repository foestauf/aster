import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLargeProgram, REPO_ROOT } from './session-cost.ts';

// Issue #71: where `aster query` spends its time. Builds two instrumented copies of the compiler from its own emitted C
// and runs one query on the compiler closure and on the generated input with each:
//   gprof  `cc -pg`: a flat profile of the compiler's own functions (user time only; libc and the kernel are invisible)
//   alloc  the runtime with every concat, alloc, array growth and int_to_string tallied by calling function, in bytes
// Plus /usr/bin/time's user/system split, since page faults on fresh memory show up as system time, not in gprof.
// Orchestration only: nothing here changes the compiler. The Markdown report goes to stdout; the records in
// docs/perf/data/query-profile/ are its output.
const USAGE = 'usage: node scripts/query-profile.ts [--compiler=PATH]';

const TRACK = `
#define TRK_SLOTS 4096
static void *trk_site[TRK_SLOTS];
static const char *trk_kind[TRK_SLOTS];
static int64_t trk_bytes[TRK_SLOTS];
static int64_t trk_calls[TRK_SLOTS];
static int64_t trk_total;
static void trk(const char *kind, void *site, int64_t n) {
    trk_total += n;
    for (uintptr_t i = 0, h = ((uintptr_t)site >> 2) % TRK_SLOTS; i < TRK_SLOTS; i++) {
        uintptr_t j = (h + i) % TRK_SLOTS;
        if (trk_site[j] == site || trk_site[j] == NULL) {
            trk_site[j] = site;
            trk_kind[j] = kind;
            trk_bytes[j] += n;
            trk_calls[j]++;
            return;
        }
    }
}
static void trk_dump(void) {
    const char *path = getenv("TRK_OUT");
    FILE *f = path ? fopen(path, "w") : NULL;
    if (f == NULL) return;
    fprintf(f, "total %lld\\n", (long long)trk_total);
    for (int i = 0; i < TRK_SLOTS; i++) {
        if (trk_site[i]) fprintf(f, "%p %s %lld %lld\\n", trk_site[i], trk_kind[i], (long long)trk_bytes[i], (long long)trk_calls[i]);
    }
    fclose(f);
}
__attribute__((constructor)) static void trk_init(void) { atexit(trk_dump); }
`;

// [function header, tally line inserted after it]
const HOOKS: [string, string][] = [
  ['aster_string aster_rt_concat(aster_string a, aster_string b) {\n', '    trk("concat", __builtin_return_address(0), a.len + b.len);\n'],
  ['void *aster_rt_alloc(int64_t size) {\n', '    trk("alloc", __builtin_return_address(0), size);\n'],
  ['        int64_t cap = a->cap > 0 ? a->cap * 2 : 4;\n', '        trk("grow", __builtin_return_address(0), cap * a->elem_size);\n'],
  ['aster_string aster_rt_int_to_string(int64_t n) {\n', '    trk("itos", __builtin_return_address(0), 20);\n'],
];

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
  return r.stdout;
}

function trackedRuntime(source: string): string {
  let out = source.replace('static char *alloc_bytes', `${TRACK}\nstatic char *alloc_bytes`);
  for (const [at, line] of HOOKS) {
    if (!out.includes(at)) throw new Error(`runtime hook point not found: ${at.trim()}`);
    out = out.replace(at, at + line);
  }
  return out;
}

interface Case { name: string; cwd: string; argv: string[] }

function timeSplit(exe: string, c: Case, runs: number): string {
  const lines: string[] = [];
  for (let i = 0; i < runs; i++) {
    const r = spawnSync('/usr/bin/time', ['-f', '%e %U %S %M', exe, ...c.argv], { cwd: c.cwd, encoding: 'utf8', maxBuffer: 1 << 30 });
    lines.push(r.stderr.trim().split('\n').at(-1) ?? '');
  }
  const cols = lines.map((l) => l.split(' ').map(Number));
  const median = (k: number) => cols.map((row) => row[k]).toSorted((a, b) => a - b)[cols.length >> 1];
  return `real ${median(0).toFixed(2)} s, user ${median(1).toFixed(2)} s, sys ${median(2).toFixed(2)} s, max RSS ${median(3)} KiB (median of ${runs})`;
}

function allocTable(exe: string, raw: string, limit: number): string {
  const [head, ...rows] = raw.trim().split('\n');
  const parsed = rows.map((r) => r.split(' ')).map(([site, kind, bytes, calls]) => ({ site, kind, bytes: Number(bytes), calls: Number(calls) }));
  parsed.sort((a, b) => b.bytes - a.bytes);
  const top = parsed.slice(0, limit);
  const names = run('addr2line', ['-f', '-e', exe, ...top.map((t) => t.site)]).split('\n').filter((_, i) => i % 2 === 0);
  return [
    `${head} bytes requested`,
    '| Bytes | Calls | Kind | Caller |',
    '| ---: | ---: | --- | --- |',
    ...top.map((t, i) => `| ${t.bytes} | ${t.calls} | ${t.kind} | ${names[i]} |`),
  ].join('\n');
}

function main(argv: string[]): number {
  let compiler = 'build/asterc';
  for (const arg of argv) {
    if (arg.startsWith('--compiler=')) compiler = arg.slice('--compiler='.length);
    else throw new Error(`unknown argument: ${arg}\n${USAGE}`);
  }
  const work = mkdtempSync(join(tmpdir(), 'aster-query-profile-'));
  try {
    // A copy of the compiler's source, so gmon.out and friends never land in the checkout.
    const self = join(work, 'compiler');
    cpSync(join(REPO_ROOT, 'packages/asterc-self'), self, { recursive: true });
    const c = run(resolve(REPO_ROOT, compiler), ['build', join(self, 'asterc.aster'), '--emit=c']);
    writeFileSync(join(work, 'asterc.c'), c);
    copyFileSync(join(REPO_ROOT, 'runtime/aster_rt.h'), join(work, 'aster_rt.h'));
    const rt = readFileSync(join(REPO_ROOT, 'runtime/aster_rt.c'), 'utf8');
    writeFileSync(join(work, 'aster_rt.c'), rt);
    writeFileSync(join(work, 'rt_track.c'), trackedRuntime(rt));
    const cc = (out: string, runtime: string, flags: string[]) =>
      run('cc', ['-std=c11', ...flags, '-I', work, join(work, 'asterc.c'), join(work, runtime), '-o', join(work, out)]);
    cc('plain', 'aster_rt.c', ['-O2']);
    cc('gprof', 'aster_rt.c', ['-O2', '-pg']);
    cc('alloc', 'rt_track.c', ['-O1', '-g', '-no-pie', '-fno-omit-frame-pointer', '-fno-inline', '-fno-optimize-sibling-calls']);

    const large = join(work, 'large');
    mkdirSync(large);
    const text = generateLargeProgram(5000);
    writeFileSync(join(large, 'large.aster'), text);
    const cases: Case[] = [
      { name: 'compiler (18 files)', cwd: self, argv: ['query', 'asterc.aster', '--file=checker.aster', '--offset=1000'] },
      { name: `generated (${Math.round(Buffer.byteLength(text) / 1024)} KiB)`, cwd: large, argv: ['query', 'large.aster', '--file=large.aster', `--offset=${Buffer.byteLength(text) - 20}`] },
    ];
    const out: string[] = [
      `compiler ${compiler}, git ${run('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).trim()}${run('git', ['status', '--porcelain'], { cwd: REPO_ROOT }).trim() ? ' (dirty)' : ''}`,
      `cc ${run('cc', ['--version']).split('\n')[0]}`,
      '',
    ];
    for (const k of cases) {
      out.push(`## ${k.name}: ${k.argv.join(' ')}`, '', timeSplit(join(work, 'plain'), k, 5), '');
      const gmon = join(work, 'gmon.out');
      rmSync(gmon, { force: true });
      run(join(work, 'gprof'), k.argv, { cwd: k.cwd });
      copyFileSync(join(k.cwd, 'gmon.out'), gmon);
      rmSync(join(k.cwd, 'gmon.out'));
      const flat = run('gprof', ['-b', '-p', join(work, 'gprof'), gmon]).split('\n').slice(0, 25).join('\n');
      out.push('```text', flat, '```', '');
      const trk = join(work, 'trk.txt');
      run(join(work, 'alloc'), k.argv, { cwd: k.cwd, env: { ...process.env, TRK_OUT: trk } });
      out.push('Bytes are len(a) + len(b) per concat (the copy cost without in-place appends) and the size of each other request.', '', allocTable(join(work, 'alloc'), readFileSync(trk, 'utf8'), 15), '');
    }
    process.stdout.write(`${out.join('\n')}\n`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

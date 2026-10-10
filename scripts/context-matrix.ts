import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #62, Track A: what the CLI (as an agent drives it) and the editor adapter (as the extension drives it) select
// for the same small programs today, and the decision each case leaves to the user. Observation only.
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

export interface Row { id: string; case: string; evidence: 'observed' | 'analysed'; cli: string; editor: string; agree: 'yes' | 'no' | 'n/a'; decision: string }

export interface CaseSpec {
  id: string;
  title: string;
  // Workspace folders, relative to the fixture root; the first is the editor's working directory (as today).
  folders?: string[];
  files: Record<string, string | Buffer>;
  // link path → target path, both relative to the fixture root.
  symlinks?: Record<string, string>;
  // `aster.entry`, relative to the first folder; null when the setting is empty.
  entry: string | null;
  // Where an agent runs the CLI, relative to the fixture root, and the entry it passes; null: it has to choose.
  cliCwd?: string;
  cliEntry: string | null;
  // The file a person or agent asks about (relative to the fixture root) and the text whose first byte is asked for.
  focus: string;
  probe: string;
  // A file the editor holds unsaved.
  dirty?: string;
  // A change after the first check: `external` fires no save; `save` is followed by the extension's save handling.
  mutate?: { kind: 'external' | 'save'; apply: (root: string) => void };
  decision: string;
}

const LIB = 'fn twice(x: int): int {\n    return x * 2;\n}\n';
const program = (...imports: string[]) => `${imports.map((i) => `import "${i}";\n`).join('')}fn main(): int {\n    let v: int = twice(2);\n    return v - 4;\n}\n`;
const MAIN = program('lib.aster');

export const CASES: CaseSpec[] = [
  {
    id: 'one-entry', title: 'One entry, query the entry', files: { 'main.aster': MAIN, 'lib.aster': LIB },
    entry: 'main.aster', cliEntry: 'main.aster', focus: 'main.aster', probe: 'twice(2)',
    decision: 'None: today\'s explicit entry is enough.',
  },
  {
    id: 'focused-import', title: 'One entry, query an imported file', files: { 'main.aster': MAIN, 'lib.aster': LIB },
    entry: 'main.aster', cliEntry: 'main.aster', focus: 'lib.aster', probe: 'x * 2',
    decision: 'None, as long as the consumer knows lib.aster belongs to main.aster\'s closure; the CLI has no way to ask "which entry owns this file".',
  },
  {
    id: 'two-entries-shared-lib', title: 'Two entries share a library; ask about the second entry',
    files: { 'app.aster': program('lib.aster'), 'tool.aster': 'import "lib.aster";\nfn main(): int {\n    let w: int = twice(3);\n    return w - 6;\n}\n', 'lib.aster': LIB },
    entry: 'app.aster', cliEntry: 'tool.aster', focus: 'tool.aster', probe: 'twice(3)',
    decision: 'Which entries exist, and which one answers for a file that several (lib.aster) or only one (tool.aster) import. One `aster.entry` cannot express this.',
  },
  {
    id: 'two-folders', title: 'Two workspace folders, each its own program; ask in the second', folders: ['a', 'b'],
    files: { 'a/main.aster': MAIN, 'a/lib.aster': LIB, 'b/main.aster': MAIN, 'b/lib.aster': LIB },
    entry: 'main.aster', cliCwd: 'b', cliEntry: 'main.aster', focus: 'b/lib.aster', probe: 'x * 2',
    decision: 'Whether context is per workspace folder. Today the second folder silently gets the first folder\'s program.',
  },
  {
    id: 'alt-cwd', title: 'The agent runs from the parent directory', folders: ['proj'],
    files: { 'proj/main.aster': MAIN, 'proj/lib.aster': LIB },
    entry: 'main.aster', cliCwd: '.', cliEntry: 'proj/main.aster', focus: 'proj/lib.aster', probe: 'x * 2',
    decision: 'Which directory paths are relative to. The answers agree but `files[].path` spellings differ (cwd-relative), so path strings from two consumers are not comparable without normalising.',
  },
  {
    id: 'outside-closure', title: 'Ask about a file no entry imports', files: { 'main.aster': MAIN, 'lib.aster': LIB, 'notes.aster': 'fn note(): int {\n    return 1;\n}\n' },
    entry: 'main.aster', cliEntry: 'main.aster', focus: 'notes.aster', probe: 'note',
    decision: 'Whether a consumer that knows the closure skips the request. Today every hover there pays for a full check (see session-cost: ~364 ms on the compiler) to learn `file-not-in-closure`.',
  },
  {
    id: 'missing-entry', title: 'The configured entry does not exist (typo)', files: { 'main.aster': MAIN, 'lib.aster': LIB },
    entry: 'mian.aster', cliEntry: 'mian.aster', focus: 'main.aster', probe: 'twice(2)',
    decision: 'None beyond a clear message: both report the unreadable root. No guessing a replacement.',
  },
  {
    id: 'ambiguous-entry', title: 'No entry configured; two files define `main`', files: { 'main.aster': MAIN, 'lib.aster': LIB, 'other.aster': 'fn main(): int {\n    return 0;\n}\n' },
    entry: null, cliEntry: null, focus: 'lib.aster', probe: 'x * 2',
    decision: 'Who names the entry. The editor stays syntax-only; an agent must pick, and the two candidates are different programs. Guessing stays out.',
  },
  {
    id: 'changed-import', title: 'An import is added outside the editor (e.g. git checkout)', files: { 'main.aster': MAIN, 'lib.aster': LIB },
    entry: 'main.aster', cliEntry: 'main.aster', focus: 'main.aster', probe: 'twice(2)',
    mutate: {
      kind: 'external', apply: (root) => {
        writeFileSync(join(root, 'lib2.aster'), 'fn thrice(x: int): int {\n    return x * 3;\n}\n');
        writeFileSync(join(root, 'main.aster'), `import "lib2.aster";\n${MAIN.replace('return v - 4;', 'return v - 4 + thrice(0);')}`);
      },
    },
    decision: 'How diagnostics learn of disk changes the editor did not save. Queries are fresh (each run reloads), but the diagnostics shown still describe the old closure until the next save.',
  },
  {
    id: 'deleted-import', title: 'An imported file is deleted outside the editor', files: { 'main.aster': MAIN, 'lib.aster': LIB },
    entry: 'main.aster', cliEntry: 'main.aster', focus: 'main.aster', probe: 'twice(2)',
    mutate: { kind: 'external', apply: (root) => unlinkSync(join(root, 'lib.aster')) },
    decision: 'Same as changed-import: a file-system watch (or refresh on focus) is the missing piece, not new context.',
  },
  {
    id: 'cycle', title: 'Two files import each other',
    files: { 'a.aster': 'import "b.aster";\nfn main(): int {\n    return helper(1) - 2;\n}\n', 'b.aster': 'import "a.aster";\nfn helper(x: int): int {\n    return x * 2;\n}\n' },
    entry: 'a.aster', cliEntry: 'a.aster', focus: 'b.aster', probe: 'x * 2',
    decision: 'None: the closure is a set, loaded once per file.',
  },
  {
    id: 'diamond', title: 'Two imports share a base file',
    files: {
      'main.aster': 'import "l.aster";\nimport "r.aster";\nfn main(): int {\n    return left() + right() - 6;\n}\n',
      'l.aster': 'import "base.aster";\nfn left(): int {\n    return twice(1);\n}\n',
      'r.aster': 'import "base.aster";\nfn right(): int {\n    return twice(2);\n}\n',
      'base.aster': LIB,
    },
    entry: 'main.aster', cliEntry: 'main.aster', focus: 'base.aster', probe: 'x * 2',
    decision: 'None: base.aster is loaded once.',
  },
  {
    id: 'symlink-alias', title: 'The person opened a symlink to an imported file', files: { 'main.aster': MAIN, 'lib.aster': LIB },
    symlinks: { 'alias.aster': 'lib.aster' }, entry: 'main.aster', cliEntry: 'main.aster', focus: 'alias.aster', probe: 'x * 2',
    decision: 'Whether a consumer may map an alias to the closure\'s spelling. The contract compares lexically and does not resolve symlinks; changing that is a separate, explicit identity decision.',
  },
  {
    id: 'lone-cr', title: 'An imported file contains a lone carriage return', files: { 'main.aster': MAIN, 'lib.aster': `// note\rmore\n${LIB}` },
    entry: 'main.aster', cliEntry: 'main.aster', focus: 'lib.aster', probe: 'x * 2',
    decision: 'None: the editor correctly withholds answers it cannot place; the CLI is unaffected. Documented limitation.',
  },
  {
    id: 'non-utf8', title: 'An imported file has a non-UTF-8 byte', files: { 'main.aster': MAIN, 'lib.aster': Buffer.concat([Buffer.from('// caf'), Buffer.from([0xe9]), Buffer.from(`\n${LIB}`)]) },
    entry: 'main.aster', cliEntry: 'main.aster', focus: 'main.aster', probe: 'twice(2)',
    decision: 'None for context: both report the encoding error and withhold semantics.',
  },
  {
    id: 'external-change', title: 'An import is broken outside the editor after a clean check', files: { 'main.aster': MAIN, 'lib.aster': LIB },
    entry: 'main.aster', cliEntry: 'main.aster', focus: 'main.aster', probe: 'twice(2)',
    mutate: { kind: 'external', apply: (root) => writeFileSync(join(root, 'lib.aster'), 'fn twice(x: int): int {\n    return true;\n}\n') },
    decision: 'Refresh policy: the editor shows "✓" with no diagnostics while every query says the program has errors.',
  },
  {
    id: 'dirty-import', title: 'An imported file has unsaved edits', files: { 'main.aster': MAIN, 'lib.aster': LIB },
    entry: 'main.aster', cliEntry: 'main.aster', focus: 'main.aster', probe: 'twice(2)', dirty: 'lib.aster',
    decision: 'None for saved-file support: the editor withholds the answer by design. Unsaved overlays are out of scope.',
  },
];

export const ANALYSED: Row[] = [
  {
    id: 'case-alias', case: 'The editor and the closure spell a path with different case (case-insensitive file system)', evidence: 'analysed',
    cli: 'Lexical comparison: `--file=Lib.aster` against `lib.aster` is `file-not-in-closure`.',
    editor: 'adapter.cjs builds `--file` from the editor\'s fsPath and compares dirty paths case-sensitively, so an answer is dropped or a dirty buffer is missed.',
    agree: 'n/a', decision: 'Whether consumers normalise case on case-insensitive systems or report it. Linux ext4 cannot reproduce this.',
  },
  {
    id: 'editor-encoding', case: 'VS Code decodes a file with a non-UTF-8 `files.encoding`', evidence: 'analysed',
    cli: 'Reads bytes; rejects non-UTF-8 source.',
    editor: 'Positions are converted from the bytes on disk (convert.byteOffset), but the displayed text is decoded differently, so a hover position can name a different character than the one shown.',
    agree: 'n/a', decision: 'Whether the extension refuses answers unless the document\'s encoding is UTF-8. Needs a real VS Code to reproduce.',
  },
  {
    id: 'config-change', case: '`aster.entry` changes or the extension deactivates while a check runs', evidence: 'analysed',
    cli: 'n/a (one process per request).',
    editor: 'extension.cjs replaces the Session; a check still running in the old Session can finish and publish diagnostics for the old entry (#67 deferred review item).',
    agree: 'n/a', decision: 'Lifecycle rule: requests belong to a context and die with it. Independent of how context is declared.',
  },
];

// One vocabulary for CLI query responses and adapter query results, so agreement is a string comparison.
export function outcomeOf(r: { cli?: any; editor?: any }): string {
  const q = r.cli ?? (r.editor?.kind === 'answer' ? r.editor.doc.query : null);
  if (q) {
    if (q.status === 'found' || q.status === 'unsupported') return `${q.status} ${q.site}`;
    if (q.status === 'invalid') return q.reason === 'file-not-in-closure' ? 'not in closure' : `invalid (${q.reason})`;
    if (q.status === 'unavailable') return `unavailable (${q.reason})`;
    return q.status;
  }
  const e = r.editor;
  if (e.kind === 'none' && /file-not-in-closure/.test(e.reason)) return 'not in closure';
  if (e.kind === 'none' && /carriage return/.test(e.reason)) return 'withheld (lone CR)';
  if (e.kind === 'unavailable') return `unavailable (${e.reason})`;
  if (e.kind === 'none') return `none (${e.reason})`;
  return e.kind;
}

const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');

export function renderMatrix(rows: readonly Row[]): string {
  return [
    '| Id | Case | Evidence | CLI (agent) | Editor adapter | Agree | Decision needed |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.id} | ${cell(r.case)} | ${r.evidence === 'observed' ? 'observed' : '**analysed, not reproduced**'} | ${cell(r.cli)} | ${cell(r.editor)} | ${r.agree} | ${cell(r.decision)} |`),
  ].join('\n');
}

// ---- Driver (not unit-tested: it needs the real compiler) ----

const require = createRequire(import.meta.url);
const adapter = require('../editors/vscode/src/adapter.cjs');

function cliRun(compiler: string, argv: string[], cwd: string): any {
  const r = spawnSync(compiler, argv, { cwd, maxBuffer: 1 << 30 });
  try {
    return JSON.parse(r.stdout.toString('utf8'));
  } catch {
    return { error: `exit ${r.status}: ${r.stderr.toString('utf8').split('\n')[0]}` };
  }
}

const checkSummary = (doc: any) =>
  doc.error ? doc.error : doc.ok ? `ok (${doc.files?.length ?? '?'} files)` : `${doc.diagnostics.length} error(s): ${doc.diagnostics.map((d: any) => d.code).join(', ')}`;

async function runCase(compiler: string, c: CaseSpec): Promise<Row & { raw: unknown }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `aster-ctx-${c.id}-`)));
  try {
    for (const [p, body] of Object.entries(c.files)) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), body);
    }
    for (const [link, target] of Object.entries(c.symlinks ?? {})) symlinkSync(target, join(root, link));
    const folder = join(root, (c.folders ?? ['.'])[0]);
    const focusAbs = join(root, c.focus);
    const offset = Buffer.from(c.files[c.focus] ?? c.files[c.symlinks?.[c.focus] ?? '']).indexOf(c.probe);

    // Editor, as extension.cjs drives the adapter: check on activation, then (after any change) a hover.
    let editor: string;
    let editorOutcome = '';
    let editorCheckOk: boolean | null = null;
    const raw: Record<string, unknown> = {};
    if (c.entry === null) {
      editor = 'syntax only: no `aster.entry`, no compiler run';
      c.mutate?.apply(root);
    } else {
      const dirty = c.dirty ? join(root, c.dirty) : null;
      const s = new adapter.Session({ compiler, root: folder, entry: c.entry, timeoutMs: 60_000, isDirty: (f: string) => f === dirty });
      let check = await s.check();
      c.mutate?.apply(root);
      if (c.mutate?.kind === 'save') {
        s.saved();
        check = await s.check();
      }
      const text = Buffer.from(c.files[c.focus] ?? c.files[c.symlinks?.[c.focus] ?? '']);
      const before = text.subarray(0, offset).toString('utf8').split('\n');
      const q = await s.query(focusAbs, 'pointer', before.length - 1, before[before.length - 1].length, undefined);
      editorCheckOk = check.kind === 'diagnostics' ? check.ok : null;
      editorOutcome = outcomeOf({ editor: q });
      const shown = check.kind === 'diagnostics' ? (check.ok ? 'ok' : `${check.count} error(s)`) : `${check.kind}${check.message ? `: ${check.message}` : ''}`;
      editor = `diagnostics shown: ${shown}${c.mutate?.kind === 'external' ? ' (from before the change)' : ''}; hover: ${editorOutcome}`;
      raw.editor = { check, query: q.kind === 'answer' ? { kind: 'answer', query: q.doc.query, files: q.doc.files.map((f: any) => f.path) } : q };
    }

    // Agent, through the CLI from its own working directory.
    const cwd = join(root, c.cliCwd ?? (c.folders ?? ['.'])[0]);
    let cli: string;
    let cliOutcome = '';
    let cliCheckOk: boolean | null = null;
    if (c.cliEntry === null) {
      const candidates = Object.entries(c.files).filter(([, b]) => Buffer.from(b).includes('fn main()')).map(([p]) => p);
      cli = `no entry given; ${candidates.length} candidates: ${candidates.map((p) => `${p} → ${checkSummary(cliRun(compiler, ['check', '--format=json', p], cwd))}`).join('; ')}`;
    } else {
      const check = cliRun(compiler, ['check', '--format=json', c.cliEntry], cwd);
      const query = cliRun(compiler, ['query', c.cliEntry, `--file=${relative(cwd, focusAbs)}`, `--offset=${offset}`], cwd);
      cliCheckOk = check.error ? null : check.ok;
      cliOutcome = query.error ? query.error : outcomeOf({ cli: query.query });
      const paths = query.files ? ` [${query.files.map((f: any) => f.path).join(', ')}]` : '';
      cli = `check: ${checkSummary(check)}; query: ${cliOutcome}${paths}`;
      raw.cli = { check, query: query.query ?? query, files: query.files?.map((f: any) => f.path) };
    }

    const agree = c.entry === null || c.cliEntry === null ? 'n/a' : editorOutcome === cliOutcome && editorCheckOk === cliCheckOk ? 'yes' : 'no';
    return { id: c.id, case: c.title, evidence: 'observed', cli, editor, agree, decision: c.decision, raw };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main(argv: string[]): Promise<number> {
  const record = argv.includes('--record');
  const compilerArg = argv.find((a) => a.startsWith('--compiler='))?.slice('--compiler='.length) ?? 'build/asterc';
  const compiler = resolve(REPO_ROOT, compilerArg);
  const rows = [];
  for (const c of CASES) rows.push(await runCase(compiler, c));
  const all: Row[] = [...rows.map(({ raw: _raw, ...r }) => r), ...ANALYSED];
  const commit = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const text = [
    '# Project context fixture matrix (#62)', '',
    `Generated by \`node scripts/context-matrix.ts --record\` at commit \`${commit}\` with \`${compilerArg}\`. Each observed row`,
    'builds a throwaway program and asks the same question two ways: the **CLI** as an agent runs it (from the case\'s',
    'working directory, with the entry it would pass), and the **editor adapter** (`editors/vscode/src/adapter.cjs`) as the',
    'extension drives it (first workspace folder as working directory, `aster.entry`, a check, then a hover). *Agree* compares',
    'the hover outcome and whether the program checks. Raw responses: [`data/matrix.json`](data/matrix.json).', '',
    renderMatrix(all), '',
  ].join('\n');
  if (record) {
    mkdirSync(join(REPO_ROOT, 'docs/context/data'), { recursive: true });
    writeFileSync(join(REPO_ROOT, 'docs/context/matrix.md'), text);
    writeFileSync(join(REPO_ROOT, 'docs/context/data/matrix.json'), `${JSON.stringify({ commit, compiler: compilerArg, rows }, null, 2)}\n`);
  }
  process.stdout.write(text);
  return 0;
}

if (process.argv[1] !== undefined && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}

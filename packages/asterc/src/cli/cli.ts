import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { formatDiagnostic, sortDiagnostics, type Diagnostic } from '../diagnostics/diagnostic.js';
import { makeSource, type SourceFile, type SourceMap } from '../diagnostics/source.js';
import { buildExecutable } from '../driver/cc.js';
import { compileToC, runFrontend } from '../driver/pipeline.js';
import { invalidUtf8At, invalidUtf8Reason } from '../driver/utf8.js';
import { printIr } from '../ir/print.js';
import { lex } from '../lexer/lexer.js';
import { parse } from '../parser/parser.js';

export interface Io {
  stdout(data: string | Uint8Array): void;
  stderr(data: string | Uint8Array): void;
  /**
   * How a program started by `run` gets its stdio. The real CLI uses 'inherit', so
   * output streams straight through byte for byte with no size limit; 'pipe'
   * captures it as raw bytes and forwards it to stdout/stderr (used by tests).
   */
  childStdio: 'inherit' | 'pipe';
}

export const EXIT = { ok: 0, compileError: 1, usage: 2, internal: 3 } as const;

const USAGE = `usage:
  aster check <file.aster>
  aster build <file.aster> [-o <out>] [--emit=tokens|ast|ir|c]
  aster run <file.aster> [-- <args>...]
`;

const EMIT_STAGES = ['tokens', 'ast', 'ir', 'c'] as const;
type EmitStage = (typeof EMIT_STAGES)[number];

interface Args {
  command: 'check' | 'build' | 'run';
  file: string;
  out: string | null;
  emit: EmitStage | null;
  /** For `run`: the arguments after `--`, passed to the program. */
  programArgs: string[];
}

/** Returns parsed arguments, or a usage-error reason. */
function parseArgs(argv: readonly string[]): Args | string {
  const [command, ...rest] = argv;
  if (command === undefined) return 'missing command';
  if (command !== 'check' && command !== 'build' && command !== 'run') return `unknown command '${command}'`;
  let file: string | null = null;
  let out: string | null = null;
  let emit: EmitStage | null = null;
  let programArgs: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--') {
      if (command !== 'run') return "'--' is only valid with 'run'";
      programArgs = rest.slice(i + 1);
      break;
    } else if (arg === '-o' || arg.startsWith('--emit=')) {
      if (command !== 'build') return `'${arg === '-o' ? '-o' : '--emit'}' is only valid with 'build'`;
      if (arg === '-o') {
        const next = rest[++i];
        if (next === undefined) return "'-o' requires a path";
        out = next;
      } else {
        const stage = arg.slice('--emit='.length);
        if (!(EMIT_STAGES as readonly string[]).includes(stage)) return `unknown emit stage '${stage}'`;
        emit = stage as EmitStage;
      }
    } else if (arg.startsWith('-')) {
      return `unknown option '${arg}'`;
    } else if (file === null) {
      file = arg;
    } else {
      return `unexpected argument '${arg}'`;
    }
  }
  if (file === null) return 'missing input file';
  return { command, file, out, emit, programArgs };
}

/** Output path for `build` without `-o`: the input's basename minus `.aster`, never the input itself. */
export function defaultOutput(file: string): string {
  const base = basename(file);
  const stripped = base.replace(/\.aster$/, '');
  return stripped === base ? `${base}.out` : stripped;
}

export function runCli(argv: readonly string[], io: Io): number {
  try {
    return runCommand(argv, io);
  } catch (e) {
    return internalError(io, e instanceof Error ? (e.stack ?? e.message) : String(e));
  }
}

function runCommand(argv: readonly string[], io: Io): number {
  const args = parseArgs(argv);
  if (typeof args === 'string') {
    io.stderr(`error: ${args}\n${USAGE}`);
    return EXIT.usage;
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(args.file);
  } catch {
    io.stderr(`error: cannot read '${args.file}'\n`);
    return EXIT.usage;
  }
  // Source must be well-formed UTF-8: decoding with 'utf8' would quietly turn malformed bytes into U+FFFD.
  const bad = invalidUtf8At(bytes);
  if (bad !== -1) {
    io.stderr(`${args.file}: error: ${invalidUtf8Reason(bytes, bad)}\n`);
    return EXIT.compileError;
  }
  const source = makeSource(args.file, bytes.toString('utf8'));

  if (args.emit === 'tokens' || args.emit === 'ast') return emitFrontEnd(io, source, args.emit);

  if (args.command === 'check') {
    const { diagnostics, map } = runFrontend(source);
    return diagnostics.length > 0 ? reportDiagnostics(io, map, diagnostics) : EXIT.ok;
  }

  const compiled = compileToC(source);
  if (!compiled.ok) return reportDiagnostics(io, compiled.map, compiled.diagnostics);
  if (args.emit === 'ir') {
    io.stdout(printIr(compiled.ir));
    return EXIT.ok;
  }
  if (args.emit === 'c') {
    io.stdout(compiled.c);
    return EXIT.ok;
  }
  if (args.command === 'build') {
    const built = buildExecutable(compiled.c, args.out ?? defaultOutput(args.file));
    return built.ok ? EXIT.ok : internalError(io, built.message);
  }
  return runProgram(io, compiled.c, args.programArgs);
}

function emitFrontEnd(io: Io, source: SourceFile, stage: 'tokens' | 'ast'): number {
  const lexed = lex(source);
  const parsed = stage === 'ast' ? parse(lexed.tokens) : null;
  const diagnostics = sortDiagnostics([...lexed.diagnostics, ...(parsed?.diagnostics ?? [])]);
  if (diagnostics.length > 0) return reportDiagnostics(io, source, diagnostics);
  io.stdout(`${toJson(parsed ? parsed.program : lexed.tokens)}\n`);
  return EXIT.ok;
}

function runProgram(io: Io, cSource: string, programArgs: readonly string[]): number {
  const dir = mkdtempSync(join(tmpdir(), 'aster-run-'));
  try {
    const exe = join(dir, 'program');
    const built = buildExecutable(cSource, exe);
    if (!built.ok) return internalError(io, built.message);
    const result = spawnSync(exe, programArgs, {
      stdio: io.childStdio === 'inherit' ? 'inherit' : ['inherit', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    });
    if (result.error) return internalError(io, `failed to run program: ${result.error.message}`);
    if (io.childStdio === 'pipe') {
      io.stdout(result.stdout);
      io.stderr(result.stderr);
    }
    if (result.signal) return 128 + constants.signals[result.signal];
    return result.status ?? EXIT.internal;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function reportDiagnostics(io: Io, where: SourceFile | SourceMap, diagnostics: readonly Diagnostic[]): number {
  for (const d of diagnostics) io.stderr(`${formatDiagnostic(where, d)}\n`);
  return EXIT.compileError;
}

function internalError(io: Io, message: string): number {
  io.stderr(`internal compiler error: ${message}\n`);
  return EXIT.internal;
}

const toJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2);

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lex, makeSource } from '../packages/asterc/src/index.js';
import { buildDriver } from './stage.js';

// Checks tests/programs/programs/lex.aster, the Aster lexer written in Aster, against the compiler's own lexer.
const PROGRAMS_DIR = fileURLToPath(new URL('./programs/', import.meta.url));
const SELF_DIR = fileURLToPath(new URL('../packages/asterc-self/', import.meta.url));
const corpus = readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.aster') || /fixtures[\\/]lex_[a-z]+\.txt$/.test(f))
  .concat(readdirSync(SELF_DIR).filter((f) => f.endsWith('.aster')).map((f) => join('..', '..', 'packages', 'asterc-self', f)))
  .toSorted();

const toOutput = (lines: string[]): string => lines.map((l) => `${l}\n`).join('');

/**
 * The TypeScript lexer's output in lex.aster's line format, with UTF-16 offsets converted to byte offsets in the raw
 * file: tokens for stdout and errors for stderr. `makeSource` strips a leading BOM before lexing, so spans are shifted
 * past its 3 bytes.
 */
function expected(text: string): { stdout: string; stderr: string; status: number } {
  const bom = text.startsWith('\uFEFF') ? 3 : 0;
  const body = bom > 0 ? text.slice(1) : text;
  const { tokens, diagnostics } = lex(makeSource('corpus', text));
  const byte = (offset: number): number => bom + Buffer.byteLength(body.slice(0, offset), 'utf8');
  const out = tokens.map((t) =>
    t.kind === 'eof' ? `eof ${byte(t.span.start)} ${byte(t.span.end)}` : `${t.kind} ${byte(t.span.start)} ${byte(t.span.end)} ${t.text}`,
  );
  const err = diagnostics.map((d) => `error ${byte(d.span.start)} ${byte(d.span.end)} ${d.message}`);
  return { stdout: toOutput(out), stderr: toOutput(err), status: diagnostics.length > 0 ? 1 : 0 };
}

const workDir = mkdtempSync(join(tmpdir(), 'aster-lex-'));
const exe = join(workDir, 'lex');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

// A driver build is cc -O2 on the compiler's C, or a stage build of the driver: both can outlast vitest's 10 s default.
const CC_HOOK_TIMEOUT = 60_000;

beforeAll(() => {
  buildDriver(join(PROGRAMS_DIR, 'programs', 'lex.aster'), exe);
}, CC_HOOK_TIMEOUT);

describe('lex.aster matches the TypeScript lexer', () => {
  it('has a corpus that includes itself and the error fixture', () => {
    expect(corpus).toContain(join('programs', 'lex.aster'));
    expect(corpus).toContain(join('..', '..', 'packages', 'asterc-self', 'lexer.aster'));
    expect(corpus).toContain(join('programs', 'fixtures', 'lex_errors.txt'));
    expect(corpus).toContain(join('programs', 'fixtures', 'lex_bom.txt'));
    expect(corpus).toContain(join('programs', 'fixtures', 'lex_chars.txt'));
    expect(corpus).toContain(join('programs', 'fixtures', 'lex_astral.txt'));
    expect(corpus).toContain(join('programs', 'fixtures', 'lex_question.txt'));
  });

  it.each(corpus)('%s', (file) => {
    const path = join(PROGRAMS_DIR, file);
    // Fatal decoding rejects invalid UTF-8; ignoreBOM keeps a BOM in the text so expected() can account for it.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
    const run = spawnSync(exe, [path], { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
    expect({ stdout: run.stdout, stderr: run.stderr, status: run.status }).toEqual(expected(text));
  });
});

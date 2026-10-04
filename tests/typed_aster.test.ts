import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExecutable, compileToC, formatDiagnostic, makeSource, runFrontend, type TypedProgram } from '../packages/asterc/src/index.js';
import { dumpTyped } from './typed_dump.js';

// Checks tests/programs/programs/typed.aster, which prints the typed program built by packages/asterc-self/checker.aster
// in the canonical dump format (packages/asterc-self/typed_dump.aster), against the compiler's own typed program
// printed by tests/typed_dump.ts. The corpus is check_aster.test.ts's plus the `fixtures/typed_*.txt` files, limited
// to the programs the TypeScript front end accepts: a rejected program has no typed tree to compare.
const PROGRAMS_DIR = fileURLToPath(new URL('./programs/', import.meta.url));
const SELF_DIR = fileURLToPath(new URL('../packages/asterc-self/', import.meta.url));

/** The TypeScript front end's typed program for the file at `path`, or null if it reports any diagnostic. */
function typedOf(path: string): TypedProgram | null {
  const result = runFrontend(makeSource(path, readFileSync(path, 'utf8')));
  return result.diagnostics.length === 0 ? result.typed : null;
}

const candidates = readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.aster') || /fixtures[\\/](check|typed)_\w+\.txt$/.test(f))
  .concat(readdirSync(SELF_DIR).filter((f) => f.endsWith('.aster')).map((f) => join('..', '..', 'packages', 'asterc-self', f)))
  .toSorted();

/** The accepted corpus, each file with its typed program. */
const accepted = candidates.flatMap((file) => {
  const typed = typedOf(join(PROGRAMS_DIR, file));
  return typed === null ? [] : [{ file, typed }];
});
const corpus = accepted.map((c) => c.file);

// Files whose typed bodies checker.aster does not build yet: they run as skipped until a later task removes them.
const PENDING = new Set<string>([
  'arith/comparisons.aster',
  'arith/precedence.aster',
  'arith/self_compare.aster',
  'arith/wrapping.aster',
  'arrays/aliasing.aster',
  'arrays/basics.aster',
  'arrays/empty_inference.aster',
  'arrays/nested_and_structs.aster',
  'basics/exit_code.aster',
  'basics/exit_negative.aster',
  'basics/exit_wraps_256.aster',
  'basics/hello.aster',
  'basics/print_types.aster',
  'bool/logic.aster',
  'bool/short_circuit.aster',
  'compound/elements.aster',
  'compound/fields.aster',
  'compound/locals.aster',
  'control/if_else.aster',
  'control/if_expr.aster',
  'control/nested_loops.aster',
  'control/while_loop.aster',
  'control/while_true_return.aster',
  'enums/aliasing.aster',
  'enums/c_names.aster',
  'enums/construction_order.aster',
  'enums/linked_list.aster',
  'enums/read_result_name.aster',
  'enums/unit_equality.aster',
  'errors/import_main_lib.aster',
  'functions/evaluation_order.aster',
  'functions/mutual_recursion.aster',
  'functions/recursion.aster',
  'functions/void_functions.aster',
  'generics/basic.aster',
  'generics/c_names.aster',
  'generics/inference.aster',
  'generics/list.aster',
  'generics/match.aster',
  'generics/nested.aster',
  'generics/shared_instance.aster',
  'generics/struct_field.aster',
  'generics/tree.aster',
  'generics/two_params.aster',
  'io/args.aster',
  'io/args_none.aster',
  'io/eprint.aster',
  'io/eprint_exit.aster',
  'io/exit_nested.aster',
  'io/exit_nested_arms.aster',
  'io/read_file.aster',
  'io/read_file_errors.aster',
  'io/read_file_result.aster',
  'io/stdin.aster',
  'io/stdin_empty.aster',
  'literals/chars.aster',
  'literals/escapes.aster',
  'loops/break_continue.aster',
  'loops/foreach.aster',
  'loops/range.aster',
  'loops/shadowing_and_returns.aster',
  'match/bool.aster',
  'match/control_flow.aster',
  'match/expressions.aster',
  'match/int.aster',
  'match/literal_scrutinee_once.aster',
  'match/or_patterns.aster',
  'match/payload_free.aster',
  'match/scrutinee_once.aster',
  'match/statements.aster',
  'match/string.aster',
  'modules/basic.aster',
  'modules/cycle.aster',
  'modules/diamond.aster',
  'modules/generic.aster',
  'modules/self_import.aster',
  'modules/subdir.aster',
  'panics/byte_at_negative.aster',
  'panics/byte_at_oob.aster',
  'panics/compound_div_zero.aster',
  'panics/div_zero.aster',
  'panics/explicit_panic.aster',
  'panics/index_negative.aster',
  'panics/index_oob_read.aster',
  'panics/index_oob_write.aster',
  'panics/mod_zero.aster',
  'panics/pop_empty.aster',
  'panics/stack_underflow.aster',
  'panics/substring_oob.aster',
  'programs/bst.aster',
  'programs/calc.aster',
  'programs/check.aster',
  'programs/fib.aster',
  'programs/fixtures/check_paths.txt',
  'programs/fixtures/check_small.txt',
  'programs/fizzbuzz.aster',
  'programs/lex.aster',
  'programs/parse.aster',
  'programs/rpn.aster',
  'programs/tokenizer.aster',
  'programs/tokenizer_structs.aster',
  'programs/typed.aster',
  'scoping/shadowing.aster',
  'strings/basics.aster',
  'strings/bytes.aster',
  'strings/equality.aster',
  'strings/escapes.aster',
  'strings/utf8.aster',
  'structs/basics.aster',
  'structs/c_names.aster',
  'structs/declaration_order.aster',
  'structs/init_order.aster',
  'structs/mutation_aliasing.aster',
  'try/chain.aster',
  'try/loops.aster',
  'try/option.aster',
  'try/order.aster',
  'try/positions.aster',
  'try/read_file.aster',
  'try/result.aster',
  'unwrap/block_arms.aster',
  'unwrap/example.aster',
  'unwrap/if_let.aster',
  'unwrap/let_else.aster',
  'unwrap/let_else_loop.aster',
  'unwrap/never.aster',
  'unwrap/scrutinee_once.aster',
]);

const workDir = mkdtempSync(join(tmpdir(), 'aster-typed-'));
const exe = join(workDir, 'typed');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

beforeAll(() => {
  const path = join(PROGRAMS_DIR, 'programs', 'typed.aster');
  const compiled = compileToC(makeSource(path, readFileSync(path, 'utf8')));
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
  const built = buildExecutable(compiled.c, exe, ['-Werror']);
  if (!built.ok) throw new Error(built.message);
});

describe('typed.aster matches the TypeScript typed program', () => {
  it('has a corpus that includes the drivers and the typed fixtures', () => {
    expect(corpus).toContain(join('programs', 'check.aster'));
    expect(corpus).toContain(join('programs', 'typed.aster'));
    for (const name of readdirSync(join(PROGRAMS_DIR, 'programs', 'fixtures')).filter((n) => /^typed_\w+\.txt$/.test(n))) {
      expect(corpus).toContain(join('programs', 'fixtures', name));
    }
  });

  it.for(accepted)('$file', ({ file, typed }, { skip }) => {
    if (PENDING.has(file)) skip();
    const run = spawnSync(exe, [join(PROGRAMS_DIR, file)], { encoding: 'utf8', timeout: 20_000, maxBuffer: 256 * 1024 * 1024 });
    expect({ stdout: run.stdout, stderr: run.stderr, status: run.status }).toEqual({ stdout: dumpTyped(typed), stderr: '', status: 0 });
  });
});

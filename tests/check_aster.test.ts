import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { goldenPath, normalise, renderOutcome } from './golden.js';
import { buildDriver } from './stage.js';
import { spawnStrict } from './spawn.js';

// Checks tests/programs/programs/check.aster, the Aster type checker written in Aster, over the corpus below. Each
// file's outcome (exit status, stdout, stderr) is pinned as a golden file under tests/golden/check/, in the format of
// docs/superpowers/specs/2026-10-03-aster-check-aster-design.md §4: diagnostics on stderr, or a summary of the typed
// program on stdout. `pnpm golden` rewrites them.
//
// Audit: every diagnostic the checker and the loader can report, with a corpus file that triggers it. A shared message
// is listed once per call site. A message no corpus file triggers gets a line in a `fixtures/check_<feature>.txt`,
// added by the task that ports that feature (named in brackets).
//
//  message                                                          triggered by
//  ---------------------------------------------------------------  -------------------------------------------
//  array element type cannot be void (resolveType)                  errors/array_errors.aster
//  '<T>' is not generic (a bound type parameter given args)         errors/generic_types.aster
//  '<E>' expects <n> type argument(s), got <m>                      errors/generic_types.aster
//  type argument cannot be void                                     errors/generic_types.aster
//  unknown type '<name>'                                            errors/builtin_and_unknown_type.aster
//  '<name>' is not generic                                          errors/generic_types.aster
//  '<name>' is a built-in type and cannot be redefined              errors/enum_decls.aster
//  '<name>' is a builtin type and cannot be redefined (types)       errors/option_redefined.aster
//  '<name>' is a builtin function and cannot be redefined (types)   errors/enum_decls.aster
//  duplicate struct|enum '<name>'                                   errors/enum_decls.aster
//  '<name>' is already declared as a struct|an enum (types)         errors/enum_decls.aster
//  duplicate type parameter '<T>'                                   errors/generic_decls.aster
//  type parameter '<T>' conflicts with a type of the same name      errors/generic_decls.aster
//  type parameter '<T>' is never used                               errors/generic_decls.aster
//  generic enum '<E>' expands infinitely                            errors/generic_expansion.aster
//  duplicate field '<f>' (struct declaration)                       errors/struct_decls.aster
//  field cannot have type void                                      errors/struct_decls.aster
//  duplicate variant '<V>' in '<E>' (non-generic enum)              errors/enum_decls.aster
//  payload cannot have type void (non-generic enum)                 errors/enum_decls.aster
//  duplicate variant '<V>' in '<E>' (generic enum)                  fixtures/check_generics.txt
//  payload cannot have type void (generic enum)                     errors/generic_decls.aster
//  'main' must be declared in the root file                         errors/import_main.aster
//  '<name>' is a builtin type and cannot be redefined (functions)   errors/option_redefined.aster
//  '<name>' is a builtin function and cannot be redefined (fns)     errors/builtin_and_unknown_type.aster
//  '<name>' is already declared as a struct|an enum (functions)     errors/enum_decls.aster
//  duplicate function '<name>'                                      errors/import_collisions.aster
//  parameter cannot have type void                                  fixtures/check_decls.txt
//  missing 'fn main(): int'                                         errors/empty_file.aster
//  'main' must have signature 'fn main(): int' or ...               errors/main_args_string.aster
//  function '<f>' is missing a return on some paths                 errors/for_errors.aster
//  '<x>' is already declared in this scope                          fixtures/check_decls.txt (a parameter)
//  type mismatch: expected <T>, found <U>                            errors/type_mismatch.aster (+11)
//  condition must be bool, found <T>                                fixtures/check_stmts.txt
//  variable cannot have type void                                   fixtures/check_stmts.txt
//  cannot iterate over a value of type <T>                          errors/for_errors.aster
//  'break'|'continue' outside of loop                               errors/multiple_errors.aster
//  missing return value: expected <T>                               fixtures/check_stmts.txt
//  void function cannot return a value                              fixtures/check_stmts.txt
//  range bound must be int, found <T>                               errors/for_errors.aster
//  '<x>' is a function, not a value                                 fixtures/check_stmts.txt
//  undefined name '<x>'                                             errors/undefined_name.aster
//  operator '<op>' cannot be applied to <T> (unary)                 fixtures/check_stmts.txt
//  if branches have different types: <T> and <U>                   errors/if_branch_types.aster
//  if expression cannot have type void                              fixtures/check_stmts.txt
//  unknown field '<f>' on '<T>' (field access)                      errors/struct_exprs.aster
//  array index must be int, found <T>                               errors/array_errors.aster
//  cannot index a value of type <T>                                 errors/array_errors.aster
//  '?' applies to Option or Result, not '<T>'                       errors/try_errors.aster
//  '?' needs the function to return <kind>, but it returns '<T>'    errors/try_errors.aster
//  '?' error type '<E>' does not match the function's error type    errors/try_errors.aster
//  unknown variant '<V>' on '<E>' (generic enum)                    fixtures/check_generics.txt
//  '<name>' is not an enum / unknown enum '<name>'                  errors/variant_exprs.aster
//  unknown variant '<V>' on '<E>' (non-generic enum)                errors/variant_exprs.aster
//  variant '<E>::<V>' expects <n> value(s), got <m> (non-generic)   errors/variant_exprs.aster
//  variant '<E>::<V>' expects <n> value(s), got <m> (generic)       fixtures/check_generics.txt
//  cannot infer type arguments for '<E>'                            errors/generic_inference.aster
//  cannot match on '<T>' values                                     errors/match_literals.aster
//  unreachable match arm (variant arms)                             errors/match_coverage.aster
//  non-exhaustive match: add a '_' arm                              errors/match_literals.aster
//  non-exhaustive match: missing <values>                           errors/generic_ops.aster, fixtures/check_match.txt
//  pattern type '<E>' does not match '<T>' (variant alternative)    errors/match_literals.aster
//  pattern type '<T>' does not match '<U>' (literal alternative)    errors/match_literals.aster
//  unreachable match arm (literal arms)                             errors/match_coverage.aster, fixtures/check_match.txt
//  duplicate pattern alternative                                    errors/match_or_patterns.aster
//  or-pattern alternatives cannot bind names                        errors/match_or_patterns.aster
//  duplicate binding '<x>'                                          errors/match_patterns.aster
//  pattern type '<E>' does not match '<T>' (variant pattern)        errors/generic_inference.aster
//  unknown variant '<V>' on '<E>' (pattern)                         errors/match_patterns.aster
//  variant '<E>::<V>' expects <n> value(s), got <m> (pattern)       errors/match_patterns.aster
//  match arms have different types: <T> and <U>                     errors/match_coverage.aster
//  match expression cannot have type void                           errors/match_coverage.aster
//  unknown struct '<S>'                                             errors/struct_exprs.aster
//  unknown field '<f>' on '<S>' (struct literal)                    errors/struct_exprs.aster
//  duplicate field '<f>' (struct literal)                           errors/struct_exprs.aster
//  missing field '<f>' in '<S>'                                     errors/struct_exprs.aster
//  cannot infer type of empty array                                 errors/array_errors.aster
//  array element cannot have type void                              errors/array_errors.aster
//  cannot assign to function '<f>' / undefined name '<x>' (target)  fixtures/check_stmts.txt
//  cannot assign to immutable variable '<x>'                        errors/immutable_assign.aster
//  invalid assignment target                                        errors/assign_errors.aster
//  operator '<op>=' cannot be applied to <T> and <U>                errors/assign_errors.aster
//  cannot compare '<T>' values                                      errors/array_errors.aster
//  operator '<op>' cannot be applied to <T> and <U>                 errors/variant_exprs.aster
//  only named functions can be called                               errors/postfix_errors.aster
//  '<x>' is not a function                                          fixtures/check_stmts.txt
//  undefined function '<f>'                                         fixtures/check_stmts.txt
//  function '<f>' expects <n> argument(s), found <m> (user fn)      errors/call_errors.aster
//  function '<print>' expects 1 argument, found <m>                 errors/eprint_exit_calls.aster
//  cannot print a value of type <T>                                 errors/array_errors.aster
//  function '<len|push|pop>' expects <n> argument(s), found <m>     errors/array_errors.aster
//  function 'len' expects a string or array, found <T>              errors/array_errors.aster
//  function '<push|pop>' expects an array, found <T>                errors/array_errors.aster
//   v0.7 rows (never, block arms, let-else and if let):
//  'never' is only allowed as a return type                         errors/never_positions.aster, fixtures/check_unwrap.txt
//  'never' is a built-in type and cannot be redefined               errors/never_errors.aster
//  function '<f>' returns 'never' but can reach its end             errors/never_errors.aster
//  '<x>' is already declared in this scope (let-else binder)        errors/let_else_scope.aster, fixtures/check_unwrap.txt
//  cannot return from a function that returns 'never'              errors/never_errors.aster, fixtures/check_unwrap.txt
//  'else' block of 'let' must diverge                               errors/let_else_errors.aster, fixtures/check_unwrap.txt
//  pattern always matches                                           errors/irrefutable.aster, fixtures/check_unwrap.txt
//  match arm block must diverge                                     errors/block_arm_errors.aster, fixtures/check_unwrap.txt
//  cannot infer type of empty array (every element never)          fixtures/check_unwrap.txt
//  operator '<op>' cannot be applied to never and <T> (never operand) errors/never_errors.aster, fixtures/check_unwrap.txt
//  cannot import '<literal>': <reason>                              errors/import_missing.aster, import_dir.aster
//  lexical and syntax errors of every loaded file                   errors/lex_errors.aster, import_syntax.aster
const PROGRAMS_DIR = fileURLToPath(new URL('./programs/', import.meta.url));
const SELF_DIR = fileURLToPath(new URL('../packages/asterc-self/', import.meta.url));
const corpus = readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.aster') || /fixtures[\\/]check_\w+\.txt$/.test(f))
  .concat(readdirSync(SELF_DIR).filter((f) => f.endsWith('.aster')).map((f) => join('..', '..', 'packages', 'asterc-self', f)))
  .toSorted();

const workDir = mkdtempSync(join(tmpdir(), 'aster-check-'));
const exe = join(workDir, 'check');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

// A driver build is cc -O2 on the compiler's C, or a stage build of the driver: both can outlast vitest's 10 s default.
const CC_HOOK_TIMEOUT = 60_000;

beforeAll(() => {
  const path = join(PROGRAMS_DIR, 'programs', 'check.aster');
  buildDriver(path, exe);
}, CC_HOOK_TIMEOUT);

describe('check.aster', () => {
  it('has a corpus that includes itself, its libraries and the checker fixtures', () => {
    expect(corpus).toContain(join('programs', 'check.aster'));
    for (const f of ['checker.aster', 'loader.aster', 'parser.aster', 'lexer.aster']) {
      expect(corpus).toContain(join('..', '..', 'packages', 'asterc-self', f));
    }
    for (const f of ['check_small', 'check_bom', 'check_bom_lib', 'check_bom2', 'check_paths', 'check_paths_lib', 'check_decls', 'check_stmts', 'check_generics', 'check_match', 'check_unwrap']) {
      expect(corpus).toContain(join('programs', 'fixtures', `${f}.txt`));
    }
  });

  it.for(corpus)('%s', async (file) => {
    const path = join(PROGRAMS_DIR, file);
    const run = spawnStrict(exe, [path], { timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
    await expect(normalise(renderOutcome(run))).toMatchFileSnapshot(goldenPath('check', file));
  });

  it('has goldens that carry no machine-specific paths or stage names', () => {
    const dir = dirname(goldenPath('check', 'x'));
    const files = readdirSync(dir);
    const expected = corpus.map((f) => basename(goldenPath('check', f))).toSorted();
    expect(files.toSorted(), 'a golden is missing or stale: run pnpm golden and review the diff').toEqual(expected);
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const bad of ['/home/', '/tmp/']) expect(text, `${f} contains ${bad}`).not.toContain(bad);
      expect(text, `${f} names a stage`).not.toMatch(/\bS[1-4]\b|\bSL[12]\b/);
    }
  });
});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExecutable, compileToC, formatDiagnostic, makeSource, runFrontend, typeToString, type SourceFile } from '../packages/asterc/src/index.js';

// Checks tests/programs/programs/check.aster, the Aster type checker written in Aster, against the compiler's own
// front end (`runFrontend`). Both sides render the result in the format of
// docs/superpowers/specs/2026-10-03-aster-check-aster-design.md §4: diagnostics on stderr, or a summary of the typed
// program on stdout.
//
// Audit: every diagnostic the checker (packages/asterc/src/check/checker.ts) and the loader (driver/load.ts) can
// report, by line in checker.ts, with a corpus file that triggers it. Found by instrumenting `report` and running the
// front end over this test's corpus, so a shared message is listed per call site. A message no corpus file triggers
// gets a line in a `fixtures/check_<feature>.txt`, added by the task that ports that feature (named in brackets).
//
//   line  message                                                          triggered by
//   ----  ---------------------------------------------------------------  -------------------------------------------
//     87  array element type cannot be void (resolveType)                  errors/array_errors.aster
//     94  '<T>' is not generic (a bound type parameter given args)         errors/generic_types.aster
//    102  '<E>' expects <n> type argument(s), got <m>                      errors/generic_types.aster
//    108  type argument cannot be void                                     errors/generic_types.aster
//    118  unknown type '<name>'                                            errors/builtin_and_unknown_type.aster
//    122  '<name>' is not generic                                          errors/generic_types.aster
//    176  '<name>' is a built-in type and cannot be redefined              errors/enum_decls.aster
//    178  '<name>' is a builtin type and cannot be redefined (types)       errors/option_redefined.aster
//    180  '<name>' is a builtin function and cannot be redefined (types)   errors/enum_decls.aster
//    182  duplicate struct|enum '<name>'                                   errors/enum_decls.aster
//    184  '<name>' is already declared as a struct|an enum (types)         errors/enum_decls.aster
//    206  duplicate type parameter '<T>'                                   errors/generic_decls.aster
//    212  type parameter '<T>' conflicts with a type of the same name      errors/generic_decls.aster
//    215  type parameter '<T>' is never used                               errors/generic_decls.aster
//    223  generic enum '<E>' expands infinitely                            errors/generic_expansion.aster
//    230  duplicate field '<f>' (struct declaration)                       errors/struct_decls.aster
//    235  field cannot have type void                                      errors/struct_decls.aster
//    244  duplicate variant '<V>' in '<E>' (non-generic enum)              errors/enum_decls.aster
//    250  payload cannot have type void (non-generic enum)                 errors/enum_decls.aster
//    263  duplicate variant '<V>' in '<E>' (generic enum)                  NONE -> fixtures/check_generics.txt [Task 5]
//    269  payload cannot have type void (generic enum)                     errors/generic_decls.aster
//    313  'main' must be declared in the root file                         errors/import_main.aster
//    317  '<name>' is a builtin type and cannot be redefined (functions)   errors/option_redefined.aster
//    321  '<name>' is a builtin function and cannot be redefined (fns)     errors/builtin_and_unknown_type.aster
//    326  '<name>' is already declared as a struct|an enum (functions)     errors/enum_decls.aster
//    330  duplicate function '<name>'                                      errors/import_collisions.aster
//    336  parameter cannot have type void                                  fixtures/check_decls.txt
//    346  missing 'fn main(): int'                                         errors/empty_file.aster
//    348  'main' must have signature 'fn main(): int' or ...               errors/main_args_string.aster
//    370  function '<f>' is missing a return on some paths                 errors/for_errors.aster
//    377  '<x>' is already declared in this scope                          fixtures/check_decls.txt (a parameter)
//    396  type mismatch: expected <T>, found <U>                            errors/type_mismatch.aster (+11)
//    402  condition must be bool, found <T>                                fixtures/check_stmts.txt
//    427  variable cannot have type void                                   fixtures/check_stmts.txt
//    467  cannot iterate over a value of type <T>                          errors/for_errors.aster
//    475  'break'|'continue' outside of loop                               errors/multiple_errors.aster
//    482  missing return value: expected <T>                               fixtures/check_stmts.txt
//    488  void function cannot return a value                              fixtures/check_stmts.txt
//    540  range bound must be int, found <T>                               errors/for_errors.aster
//    575  '<x>' is a function, not a value                                 fixtures/check_stmts.txt
//    575  undefined name '<x>'                                             errors/undefined_name.aster
//    583  operator '<op>' cannot be applied to <T> (unary)                 fixtures/check_stmts.txt
//    600  if branches have different types: <T> and <U>                   errors/if_branch_types.aster
//    604  if expression cannot have type void                              fixtures/check_stmts.txt
//    614  unknown field '<f>' on '<T>' (field access)                      errors/struct_exprs.aster
//    627  array index must be int, found <T>                               errors/array_errors.aster
//    631  cannot index a value of type <T>                                 errors/array_errors.aster
//    656  '?' applies to Option or Result, not '<T>'                       errors/try_errors.aster
//    684  '?' needs the function to return <kind>, but it returns '<T>'    errors/try_errors.aster
//    689  '?' error type '<E>' does not match the function's error type    errors/try_errors.aster
//    710  unknown variant '<V>' on '<E>' (generic enum)                    NONE -> fixtures/check_generics.txt [Task 5]
//    718  '<name>' is not an enum / unknown enum '<name>'                  errors/variant_exprs.aster
//    723  unknown variant '<V>' on '<E>' (non-generic enum)                errors/variant_exprs.aster
//    740  variant '<E>::<V>' expects <n> value(s), got <m> (non-generic)   errors/variant_exprs.aster
//    773  variant '<E>::<V>' expects <n> value(s), got <m> (generic)       NONE -> fixtures/check_generics.txt [Task 5]
//    780  cannot infer type arguments for '<E>'                            errors/generic_inference.aster
//    846  cannot match on '<T>' values                                     errors/match_literals.aster
//    862  unreachable match arm (variant arms)                             errors/match_coverage.aster
//    880  non-exhaustive match: add a '_' arm                              errors/match_literals.aster
//    881  non-exhaustive match: missing <values>                           errors/generic_ops.aster
//    898  pattern type '<E>' does not match '<T>' (variant alternative)    errors/match_literals.aster
//    906  pattern type '<T>' does not match '<U>' (literal alternative)    errors/match_literals.aster
//    945  unreachable match arm (literal arms)                             errors/match_coverage.aster
//    946  duplicate pattern alternative                                    errors/match_or_patterns.aster
//    975  or-pattern alternatives cannot bind names                        errors/match_or_patterns.aster
//    988  duplicate binding '<x>'                                          errors/match_patterns.aster
//   1024  pattern type '<E>' does not match '<T>' (variant pattern)        errors/generic_inference.aster
//   1029  unknown variant '<V>' on '<E>' (pattern)                         errors/match_patterns.aster
//   1033  variant '<E>::<V>' expects <n> value(s), got <m> (pattern)       errors/match_patterns.aster
//   1048  match arms have different types: <T> and <U>                     errors/match_coverage.aster
//   1052  match expression cannot have type void                           errors/match_coverage.aster
//   1062  unknown struct '<S>'                                             errors/struct_exprs.aster
//   1073  unknown field '<f>' on '<S>' (struct literal)                    errors/struct_exprs.aster
//   1075  duplicate field '<f>' (struct literal)                           errors/struct_exprs.aster
//   1082  missing field '<f>' in '<S>'                                     errors/struct_exprs.aster
//   1096  cannot infer type of empty array                                 errors/array_errors.aster
//   1107  array element cannot have type void                              errors/array_errors.aster
//   1132  cannot assign to function '<f>' / undefined name '<x>' (target)  fixtures/check_stmts.txt
//   1135  cannot assign to immutable variable '<x>'                        errors/immutable_assign.aster
//   1146  invalid assignment target                                        errors/assign_errors.aster
//   1155  operator '<op>=' cannot be applied to <T> and <U>                errors/assign_errors.aster
//   1191  cannot compare '<T>' values                                      errors/array_errors.aster
//   1198  operator '<op>' cannot be applied to <T> and <U>                 errors/variant_exprs.aster
//   1218  only named functions can be called                               errors/postfix_errors.aster
//   1224  '<x>' is not a function                                          fixtures/check_stmts.txt
//   1238  undefined function '<f>'                                         fixtures/check_stmts.txt
//   1243  function '<f>' expects <n> argument(s), found <m> (user fn)      errors/call_errors.aster
//   1256  function '<print>' expects 1 argument, found <m>                 errors/eprint_exit_calls.aster
//   1261  cannot print a value of type <T>                                 errors/array_errors.aster
//   1274  function '<len|push|pop>' expects <n> argument(s), found <m>     errors/array_errors.aster
//   1281  function 'len' expects a string or array, found <T>              errors/array_errors.aster
//   1287  function '<push|pop>' expects an array, found <T>                errors/array_errors.aster
//   load  cannot import '<literal>': <reason>                              errors/import_missing.aster, import_dir.aster
//   load  lexical and syntax errors of every loaded file                   errors/lex_errors.aster, import_syntax.aster
const PROGRAMS_DIR = fileURLToPath(new URL('./programs/', import.meta.url));
const corpus = readdirSync(PROGRAMS_DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.aster') || /fixtures[\\/]check_\w+\.txt$/.test(f))
  .toSorted();

/**
 * Corpus files check.aster is not expected to pass yet. Each task that ports a feature removes what now passes. Until
 * Task 6 ports `match`, a match statement never diverges, so a function that ends in one (programs/checker.aster,
 * io/exit_nested_arms.aster) is wrongly missing a return.
 */
const PENDING = new Set<string>([
  'enums/aliasing.aster', 'enums/linked_list.aster',
  'errors/eprint_exit_calls.aster', 'errors/generic_decls.aster', 'errors/generic_expansion.aster',
  'errors/generic_inference.aster', 'errors/generic_ops.aster', 'errors/generic_types.aster',
  'errors/match_coverage.aster', 'errors/match_literals.aster', 'errors/match_or_patterns.aster',
  'errors/match_patterns.aster', 'errors/read_file_match.aster', 'errors/read_result_ops.aster',
  'errors/try_errors.aster', 'errors/variant_exprs.aster',
  'generics/basic.aster', 'generics/c_names.aster', 'generics/inference.aster', 'generics/list.aster',
  'generics/match.aster', 'generics/nested.aster', 'generics/shared_instance.aster', 'generics/struct_field.aster',
  'generics/tree.aster', 'generics/two_params.aster',
  'io/exit_nested_arms.aster', 'io/read_file.aster', 'io/read_file_errors.aster', 'io/read_file_result.aster',
  'match/control_flow.aster', 'match/expressions.aster', 'match/int.aster', 'match/or_patterns.aster',
  'match/scrutinee_once.aster', 'match/statements.aster',
  'modules/generic.aster',
  'programs/bst.aster', 'programs/calc.aster', 'programs/check.aster', 'programs/checker.aster',
  'programs/fixtures/check_small.txt', 'programs/lex.aster', 'programs/parse.aster',
  'try/chain.aster', 'try/loops.aster', 'try/option.aster', 'try/order.aster', 'try/positions.aster',
  'try/read_file.aster', 'try/result.aster',
]);

const toOutput = (lines: string[]): string => lines.map((l) => `${l}\n`).join('');

/** 3 if the file at `path` starts with a UTF-8 byte order mark (which `makeSource` strips), else 0. */
function bomOf(path: string): number {
  const raw = readFileSync(path);
  return raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf ? 3 : 0;
}

/** The byte offset in `f`'s raw file of UTF-16 index `i` of its BOM-stripped text. */
const byteOffset = (f: SourceFile, i: number): number => bomOf(f.path) + Buffer.byteLength(f.text.slice(0, i));

/**
 * The TypeScript front end's result for the program rooted at `path`, in check.aster's format. Each diagnostic's
 * global UTF-16 offsets are mapped to the file that holds its start, then to byte offsets in that file's raw bytes.
 */
function expected(path: string): { stdout: string; stderr: string; status: number } {
  const text = readFileSync(path, 'utf8');
  const result = runFrontend(makeSource(path, text));
  const files = result.map.files;
  const fileAt = (offset: number): SourceFile => files.findLast((f) => f.base <= offset) ?? files[0];

  const errors = result.diagnostics.map((d) => {
    const f = fileAt(d.span.start);
    const s = byteOffset(f, d.span.start - f.base);
    const e = byteOffset(f, Math.min(d.span.end, f.base + f.text.length) - f.base);
    return `error ${f.path} ${s} ${e} ${d.message}`;
  });

  const lines: string[] = [];
  if (result.diagnostics.length === 0) {
    if (result.typed === null) throw new Error(`no diagnostics but no typed program for ${path}`);
    const { structs, enums, functions } = result.typed;
    for (const s of structs) {
      lines.push(`struct ${s.name}`);
      for (const f of s.fields) lines.push(`  field ${f.name} ${typeToString(f.type)}`);
    }
    for (const e of enums) {
      lines.push(`enum ${e.name}`);
      for (const v of e.variants) {
        lines.push(v.payload.length === 0 ? `  variant ${v.name}` : `  variant ${v.name}(${v.payload.map(typeToString).join(', ')})`);
      }
    }
    for (const f of functions) {
      lines.push(`fn ${f.name}(${f.params.map((p) => typeToString(p.type)).join(', ')}): ${typeToString(f.returnType)}`);
      for (const l of f.locals) {
        const kind = l.id < f.params.length ? 'param' : l.mutable ? 'var' : 'let';
        lines.push(`  ${kind} ${l.id} ${l.name} ${typeToString(l.type)}`);
      }
    }
  }
  return { stdout: toOutput(lines), stderr: toOutput(errors), status: result.diagnostics.length > 0 ? 1 : 0 };
}

const workDir = mkdtempSync(join(tmpdir(), 'aster-check-'));
const exe = join(workDir, 'check');
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

beforeAll(() => {
  const path = join(PROGRAMS_DIR, 'programs', 'check.aster');
  const compiled = compileToC(makeSource(path, readFileSync(path, 'utf8')));
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => formatDiagnostic(compiled.map, d)).join('\n'));
  const built = buildExecutable(compiled.c, exe, ['-Werror']);
  if (!built.ok) throw new Error(built.message);
});

describe('check.aster matches the TypeScript front end', () => {
  it('has a corpus that includes itself, its libraries and the checker fixtures', () => {
    for (const f of ['check.aster', 'checker.aster', 'loader.aster', 'parser.aster', 'lexer.aster']) {
      expect(corpus).toContain(join('programs', f));
    }
    for (const f of ['check_small', 'check_bom', 'check_bom_lib', 'check_decls', 'check_stmts']) {
      expect(corpus).toContain(join('programs', 'fixtures', `${f}.txt`));
    }
    for (const f of PENDING) expect(corpus).toContain(f);
  });

  it.for(corpus)('%s', (file, { skip }) => {
    skip(PENDING.has(file), 'not ported to check.aster yet');
    const path = join(PROGRAMS_DIR, file);
    const run = spawnSync(exe, [path], { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
    expect({ stdout: run.stdout, stderr: run.stderr, status: run.status }).toEqual(expected(path));
  });
});

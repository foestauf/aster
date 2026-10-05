import { describe, expect, it } from 'vitest';
import { lower, type IrProgram } from '../packages/asterc/src/index.js';
import { acceptedCorpus } from './corpus_ts.js';
import { validateIr } from './ir_validate.js';

const accepted = acceptedCorpus();
const INT = { kind: 'int' } as const;

describe('validateIr', () => {
  it('reports broken programs', () => {
    const broken: IrProgram = {
      structs: [],
      enums: [],
      strings: [],
      functions: [
        {
          name: 'f',
          paramCount: 0,
          locals: [{ id: 0, name: null, type: INT }],
          returnType: INT,
          blocks: [
            { label: 'start', instrs: [{ kind: 'copy', dst: 0, src: { kind: 'bool', value: true } }], term: { kind: 'jmp', target: 'nowhere' } },
            { label: 'start', instrs: [], term: { kind: 'br', cond: { kind: 'local', id: 3 }, then: 'start', else: 'start' } },
            { label: 'other', instrs: [{ kind: 'binop', dst: 0, op: 'add', left: { kind: 'string', index: 0 }, right: { kind: 'int', value: 1n } }], term: { kind: 'ret', value: null } },
          ],
        },
      ],
    };
    expect(validateIr(broken)).toEqual([
      'f: the first block is start, not entry',
      'f: duplicate label start',
      'f: copy writes bool into %0: int',
      'f: jump to unknown label nowhere',
      'f: operand %3 is out of range',
      'f: string #0 is out of range',
      'f: add operand is string, expected int',
      'f: ret without a value in a function returning int',
    ]);
  });

  it('reports a void local, a bad switch value and a value returned from a void function', () => {
    const broken: IrProgram = {
      structs: [],
      enums: [],
      strings: ['s'],
      functions: [
        {
          name: 'g',
          paramCount: 0,
          locals: [{ id: 0, name: null, type: { kind: 'void' } }],
          returnType: { kind: 'void' },
          blocks: [
            { label: 'entry', instrs: [], term: { kind: 'switch', value: { kind: 'string', index: 0 }, cases: [], default: 'done' } },
            { label: 'done', instrs: [], term: { kind: 'ret', value: { kind: 'int', value: 1n } } },
          ],
        },
      ],
    };
    expect(validateIr(broken)).toEqual([
      'g: local %0 is void',
      'g: switch value is string, expected int or bool',
      'g: ret with a value in a void function',
    ]);
  });

  it.for(accepted)('$file lowers to valid IR', ({ typed }) => {
    expect(validateIr(lower(typed))).toEqual([]);
  });
});

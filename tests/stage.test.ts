import { describe, expect, it } from 'vitest';
import { resolveStage } from './stage.js';

// tests/stage.ts picks the compiler under test: an explicit stage binary from the environment, or S1 from global setup.
const exists = (p: string): boolean => p === '/bin/s2';

describe('resolveStage', () => {
  it('defaults to S1 from global setup', () => {
    expect(resolveStage({}, '/tmp/s1', exists)).toEqual({ name: 'S1', bin: '/tmp/s1' });
  });

  it('uses ASTER_STAGE_BIN and ASTER_STAGE together', () => {
    expect(resolveStage({ ASTER_STAGE_BIN: '/bin/s2', ASTER_STAGE: 'S2' }, '/tmp/s1', exists)).toEqual({ name: 'S2', bin: '/bin/s2' });
  });

  it.for([
    [{ ASTER_STAGE_BIN: '/bin/s2' }, /set together/],
    [{ ASTER_STAGE: 'S2' }, /set together/],
    [{ ASTER_STAGE_BIN: '/bin/s2', ASTER_STAGE: 'S9' }, /S1, S2, S3 or SL1/],
    [{ ASTER_STAGE_BIN: 'rel/s2', ASTER_STAGE: 'S2' }, /absolute/],
    [{ ASTER_STAGE_BIN: '/bin/missing', ASTER_STAGE: 'S3' }, /does not exist/],
  ] as const)('rejects %j', ([env, message]) => {
    expect(() => resolveStage(env, '/tmp/s1', exists)).toThrow(message);
  });

  it('uses the LLVM-built stage', () => {
    expect(resolveStage({ ASTER_STAGE_BIN: '/bin/s2', ASTER_STAGE: 'SL1' }, '/tmp/s1', exists)).toEqual({ name: 'SL1', bin: '/bin/s2' });
  });

  it('rejects a missing S1 when no stage is given', () => {
    expect(() => resolveStage({}, undefined, exists)).toThrow(/global setup/);
  });
});

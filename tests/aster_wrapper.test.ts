import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MISSING, REPO_ROOT } from '../scripts/build-compiler.js';

// scripts/aster is `pnpm aster`: it runs build/asterc beside it and never falls back to the TypeScript seed.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aster-wrapper-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(REPO_ROOT, 'scripts', 'aster'), join(dir, 'scripts', 'aster'));
  chmodSync(join(dir, 'scripts', 'aster'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const wrapper = (args: string[], cwd: string) =>
  spawnSync(join(dir, 'scripts', 'aster'), args, { cwd, encoding: 'utf8', input: 'from stdin\n' });

describe('scripts/aster', () => {
  it('fails with the bootstrap hint when build/asterc is missing', () => {
    const r = wrapper(['run', 'x.aster'], dir);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe(MISSING + '\n');
  });

  it('runs build/asterc beside it from any cwd, passing args, stdin and exit status through', () => {
    mkdirSync(join(dir, 'build'));
    const stub = join(dir, 'build', 'asterc');
    writeFileSync(stub, '#!/bin/sh\nprintf "[%s]" "$@"\ncat\nexit 7\n');
    chmodSync(stub, 0o755);
    const r = wrapper(['run', 'a b.aster', '--', 'x'], tmpdir());
    expect(r.status).toBe(7);
    expect(r.stdout).toBe('[run][a b.aster][--][x]from stdin\n');
  });

  it('treats a non-executable build/asterc as missing', () => {
    mkdirSync(join(dir, 'build'));
    writeFileSync(join(dir, 'build', 'asterc'), 'not executable');
    expect(wrapper([], dir).status).toBe(2);
  });
});

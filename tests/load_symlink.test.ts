import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { stage } from './stage.js';
import { spawnStrict } from './spawn.js';

// #12: the loader uses lexical identity (contract §4.5, §7), not the physical path. Only the canonical spelling loads
// the root once. A root reached through a symlinked directory and `..`, or through a symlink to the file, has a lexical
// identity that differs from the physical path its helper's import cycle reaches, so it loads twice. That limit is
// asserted here, not hidden.

const dir = mkdtempSync(join(tmpdir(), 'aster-symlink-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// dir/entry/link -> dir/other/dir, so entry/link/.. is physically dir/other, lexically dir/entry.
mkdirSync(join(dir, 'entry'));
mkdirSync(join(dir, 'other', 'dir'), { recursive: true });
symlinkSync(join(dir, 'other', 'dir'), join(dir, 'entry', 'link'));
writeFileSync(join(dir, 'other', 'root.aster'), 'import "helper.aster";\nfn main(): int {\n  return helper();\n}\n');
writeFileSync(join(dir, 'other', 'helper.aster'), `import "${join(dir, 'other', 'root.aster')}";\nfn helper(): int {\n  return 0;\n}\n`);
// A root that is itself a symlink to a file, imported back by the physical path.
// Its relative imports resolve beside the spelling, so the helper is linked there too.
symlinkSync(join(dir, 'other', 'root.aster'), join(dir, 'entry', 'root_link.aster'));
symlinkSync(join(dir, 'other', 'helper.aster'), join(dir, 'entry', 'helper.aster'));

const spellings = {
  canonical: join(dir, 'other', 'root.aster'),
  aliased: `${dir}/entry/link/../root.aster`,
  'file symlink': join(dir, 'entry', 'root_link.aster'),
};

const run = (argv: string[]) => spawnStrict(stage().bin, argv, { env: { ...process.env, LC_ALL: 'C' } });

describe('the canonical spelling loads the root once', () => {
  it(`${stage().name} checks it cleanly`, () => {
    expect(run(['check', spellings.canonical])).toMatchObject({ stdout: '', stderr: '', status: 0 });
  });
});

describe('the loader keeps lexical identity (documented limit)', () => {
  it.for(['aliased', 'file symlink'] as const)(`${stage().name} loads the %s root twice`, (name) => {
    const r = run(['check', spellings[name]]);
    // Observed: the root's lexical identity differs from the physical path the helper's import reaches, so the file
    // loads a second time: `main` is then outside the root, and `helper` is declared twice.
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("other/root.aster:2:4: error: 'main' must be declared in the root file");
    expect(r.stderr).toContain("other/helper.aster:2:4: error: duplicate function 'helper'");
  });
});

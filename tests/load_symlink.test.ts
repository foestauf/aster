import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { stage } from './stage.js';

// #12: a root spelled through a symlinked directory and `..` must get the same identity as the physical file that an
// import cycle reaches, so it loads once. Stage 0 resolves physically. The self-hosted loader uses lexical identity,
// so it loads the file twice (contract §4.5, §7); that limit is asserted here, not hidden.

const S0_BIN = fileURLToPath(new URL('../packages/asterc/dist/cli/bin.js', import.meta.url));
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

const s0 = (argv: string[]) => spawnSync(process.execPath, [S0_BIN, ...argv], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });

describe('stage 0 loads a root reached through a symlink once', () => {
  it.for(Object.entries(spellings))('%s', ([, path]) => {
    expect(s0(['check', path])).toMatchObject({ stdout: '', stderr: '', status: 0 });
    const c = s0(['build', path, '--emit=c']);
    expect(c.status).toBe(0);
    expect(c.stdout).toBe(s0(['build', spellings.canonical, '--emit=c']).stdout);
  });
});

describe('the self-hosted loader keeps lexical identity (documented limit)', () => {
  it(`${stage().name} loads the aliased root twice`, () => {
    const r = spawnSync(stage().bin, ['check', spellings.aliased], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
    // Observed: the root's lexical identity (`entry/link/../root.aster`) differs from the physical path the helper's
    // import reaches, so the file loads a second time: `main` is then outside the root, and `helper` is declared twice.
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("other/root.aster:2:4: error: 'main' must be declared in the root file");
    expect(r.stderr).toContain("other/helper.aster:2:4: error: duplicate function 'helper'");
  });
});

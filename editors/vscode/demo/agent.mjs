#!/usr/bin/env node
// An agent's view of the demo through the public aster/1 JSON alone (docs/inspect/README.md), sharing no code with the
// extension. Usage: node agent.mjs <aster-compiler>. Works on a temporary copy and prints one JSON object of facts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = process.argv[2] ?? 'aster';
const compiler = /[\\/]/.test(arg) ? resolve(arg) : arg;
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'aster-agent-'));
const aster = (...argv) => JSON.parse(spawnSync(compiler, argv, { cwd: dir, encoding: 'utf8' }).stdout);
const sha = (path) => createHash('sha256').update(readFileSync(join(dir, path))).digest('hex');

try {
  copyFileSync(join(here, 'main.aster'), join(dir, 'main.aster'));
  copyFileSync(join(here, 'shapes.broken.aster'), join(dir, 'shapes.aster'));
  const broken = aster('check', '--format=json', 'main.aster').diagnostics[0];
  copyFileSync(join(here, 'shapes.aster'), join(dir, 'shapes.aster'));
  const fixed = aster('check', '--format=json', 'main.aster');
  const call = readFileSync(join(dir, 'main.aster')).indexOf('area(side)');
  const hover = aster('query', 'main.aster', '--file=main.aster', `--offset=${call + 5}`);
  const def = aster('query', 'main.aster', '--file=main.aster', `--caret=${call + 4}`);
  const target = def.semantics.declarations[def.query.target];
  console.log(JSON.stringify({
    broken: { code: broken.code, path: broken.primary.path, line: broken.primary.range.start_line, col_utf16: broken.primary.range.start_col_utf16 },
    fixed: fixed.ok,
    hover: hover.query.type,
    definition: { name: target.name, path: target.location.path, line: target.location.range.start_line, col_utf16: target.location.range.start_col_utf16 },
    fresh: [hover, def].every((doc) => doc.files.every((f) => sha(f.path) === f.sha256)),
  }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

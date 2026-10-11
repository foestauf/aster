#!/usr/bin/env node
// A stand-in compiler for the adapter tests. FAKE_ASTER picks what it does; FAKE_ASTER_JSON is printed for `json`.
const mode = process.env.FAKE_ASTER;
if (process.env.FAKE_ASTER_PIDS) require('node:fs').appendFileSync(process.env.FAKE_ASTER_PIDS, `${process.pid}\n`);
if (mode === 'hang') setTimeout(() => {}, 60_000);
else if (mode === 'echo-check') {
  // A failed check whose one diagnostic, in ./x.aster, names the working directory and the entry.
  const range = { start: 0, end: 1, start_line: 1, start_col_utf16: 1, end_line: 1, end_col_utf16: 2 };
  const message = `${process.cwd()} ${process.argv.slice(2).join(' ')}`;
  process.stdout.write(JSON.stringify({ schema: 'aster/1', command: 'check', ok: false, files: [],
    diagnostics: [{ code: 'type.mismatch', severity: 'error', message, primary: { file: 1, path: './x.aster', range }, related: [] }] }) + '\n');
  process.exit(1);
} else if (mode === 'panic') {
  process.stderr.write('internal: boom\n');
  process.exit(101);
} else if (mode === 'garbage') process.stdout.write('not json\n');
else if (mode === 'usage') {
  process.stderr.write("error: unknown command 'query'\n");
  process.exit(2);
} else if (mode === 'argv') process.stdout.write(JSON.stringify({ schema: 'aster/1', argv: process.argv.slice(2) }) + '\n');
else if (mode === 'json') {
  process.stdout.write(process.env.FAKE_ASTER_JSON + '\n');
  process.exit(Number(process.env.FAKE_ASTER_EXIT || 0));
}

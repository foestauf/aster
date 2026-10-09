#!/usr/bin/env node
// A stand-in compiler for the adapter tests. FAKE_ASTER picks what it does; FAKE_ASTER_JSON is printed for `json`.
const mode = process.env.FAKE_ASTER;
if (mode === 'hang') setTimeout(() => {}, 60_000);
else if (mode === 'panic') {
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

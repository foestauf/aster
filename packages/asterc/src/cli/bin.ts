#!/usr/bin/env node
import { runCli } from './cli.js';

process.exitCode = runCli(process.argv.slice(2), {
  stdout: (data) => process.stdout.write(data),
  stderr: (data) => process.stderr.write(data),
  childStdio: 'inherit',
});

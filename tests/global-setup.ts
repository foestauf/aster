import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// tests/asterc_self.test.ts compares the self-hosted compiler against the stage-0 CLI in packages/asterc/dist/. Building
// it here (under a second) means the suite never runs against a missing dist, as on a fresh CI checkout, or a stale one.
export default function setup(): void {
  execFileSync('pnpm', ['build'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' });
}

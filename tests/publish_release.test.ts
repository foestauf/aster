import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Execute the real shell/Node entry point with a fake gh. No test can contact GitHub or delete a real release.
const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'publish-release.sh');
const TAG = 'build-20261005-abcdef0';
const REPO = 'example/aster';
const ENDPOINT = `repos/${REPO}/releases`;
const ASSETS = ['asterc-linux-x86_64', 'asterc-c-seed.tar.gz', 'SHA256SUMS'];
const DRAFT = { id: 123, tag_name: TAG, draft: true,
  upload_url: `https://uploads.github.com/repos/${REPO}/releases/123/assets{?name,label}` };
type Reply = { stdout?: string; json?: unknown; status?: number; stderr?: string };
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aster-publish-test-'));
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'assets'));
  for (const asset of ASSETS) writeFileSync(join(root, 'assets', asset), `fixture ${asset}`);
  writeFileSync(join(root, 'bin', 'git'), '#!/bin/sh\necho "test commit"\n', { mode: 0o755 });
  writeFileSync(join(root, 'bin', 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const file = process.env.GH_FIXTURE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
state.calls.push(process.argv.slice(2));
const reply = state.replies.shift();
fs.writeFileSync(file, JSON.stringify(state));
if (!reply) { console.error('unexpected gh call'); process.exit(99); }
process.stdout.write(reply.stdout ?? (reply.json === undefined ? '' : JSON.stringify(reply.json)));
process.stderr.write(reply.stderr ?? '');
process.exit(reply.status ?? 0);
`, { mode: 0o755 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function publish(replies: Reply[]) {
  const fixture = join(root, 'gh.json');
  writeFileSync(fixture, JSON.stringify({ calls: [], replies }));
  const result = spawnSync('sh', [SCRIPT, TAG, 'abcdef0', join(root, 'assets')], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, GH_FIXTURE: fixture,
      GH_TOKEN: 'test-only', GITHUB_REPOSITORY: REPO, GITHUB_SERVER_URL: 'https://github.com' },
  });
  const state = JSON.parse(readFileSync(fixture, 'utf8')) as { calls: string[][]; replies: Reply[] };
  expect(result.stderr).not.toContain('unexpected gh call');
  // An unconditional invariant, including every failed create/upload/publish response.
  expect(state.calls.flat()).not.toContain('DELETE');
  expect(state.calls.flat()).not.toContain('delete');
  expect(state.calls.flat()).not.toContain('--cleanup-tag');
  expect(state.replies).toHaveLength(0);
  return { ...result, calls: state.calls };
}
const api = (...args: string[]) => ['api', '--hostname', 'github.com', ...args];
const lookup = api('--paginate', ENDPOINT, '--jq', 'if type == "array" then .[] | @json else error("expected release list") end');
const uploads = ASSETS.map((name) => ({ json: { name, state: 'uploaded' } }));
const beforePublish = () => [{ stdout: '' }, { json: DRAFT }, ...uploads];

describe('publish-release.sh', () => {
  it('skips an existing published release without touching it or requiring local assets', () => {
    rmSync(join(root, 'assets'), { recursive: true });
    const r = publish([{ json: { ...DRAFT, draft: false } }]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('already published');
    expect(r.calls).toEqual([lookup]);
  });

  it('refuses to adopt or delete a pre-existing draft', () => {
    const r = publish([{ json: DRAFT }]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('already has a draft');
    expect(r.calls).toEqual([lookup]);
  });

  it.each(['401 Unauthorized', '403 Forbidden', '429 rate limit', '500 server error', 'connection reset'])('fails closed when lookup fails: %s', (stderr) => {
    const r = publish([{ status: 1, stderr }]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(stderr);
    expect(r.calls).toEqual([lookup]);
  });

  it('does not treat partial pagination output as a successful absence', () => {
    const r = publish([{ stdout: JSON.stringify({ ...DRAFT, tag_name: 'other-tag' }), status: 1, stderr: 'page 2 failed' }]);
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([lookup]);
  });

  it.each(['not json', '{}', '{"id":123,"tag_name":"x","draft":null}', '[]'])('fails closed on malformed lookup output: %s', (stdout) => {
    const r = publish([{ stdout }]);
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([lookup]);
  });

  it('checks all pages, including a published match after unrelated releases', () => {
    const r = publish([{ stdout: [JSON.stringify({ ...DRAFT, tag_name: 'other-tag' }), JSON.stringify({ ...DRAFT, draft: false })].join('\n') }]);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([lookup]);
  });

  it('checks local asset availability before creating a draft', () => {
    rmSync(join(root, 'assets', 'SHA256SUMS'));
    const r = publish([{ stdout: '' }]);
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([lookup]);
  });

  it.each(['422: another publisher won the race', 'connection reset after draft creation'])('does not touch any release after a failed or uncertain create: %s', (stderr) => {
    const r = publish([{ stdout: '' }, { status: 1, stderr, json: DRAFT }]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('inspect tag');
    expect(r.calls).toHaveLength(2);
  });

  it.each([
    {}, { ...DRAFT, id: '123' }, { ...DRAFT, id: -1 }, { ...DRAFT, draft: false },
    { ...DRAFT, tag_name: 'another-tag' }, { ...DRAFT, upload_url: 'https://example.org/assets' },
    { ...DRAFT, upload_url: DRAFT.upload_url.replace('/123/', '/456/') },
  ])('stops after an invalid or mismatched create response: %j', (json) => {
    const r = publish([{ stdout: '' }, { json }]);
    expect(r.status).toBe(1);
    expect(r.calls).toHaveLength(2);
  });

  it.each([0, 1, 2])('preserves the owned draft when asset upload %i fails', (index) => {
    const r = publish([{ stdout: '' }, { json: DRAFT }, ...uploads.slice(0, index), { status: 1, stderr: 'upload interrupted' }]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('inspect release ID 123');
    expect(r.calls).toHaveLength(index + 3);
    expect(r.calls.flat()).not.toContain('PATCH');
  });

  it('does not delete when another actor publishes the draft during a failed upload', () => {
    const r = publish([{ stdout: '' }, { json: DRAFT }, { status: 1, stderr: 'release is now published' }]);
    expect(r.status).toBe(1);
    expect(r.calls).toHaveLength(3);
    expect(r.stderr).toContain('No release or tag was deleted');
  });

  it('does not publish an unconfirmed upload', () => {
    const r = publish([{ stdout: '' }, { json: DRAFT }, { json: { name: ASSETS[0], state: 'starter' } }]);
    expect(r.status).toBe(1);
    expect(r.calls).toHaveLength(3);
  });

  it('pins all uploads and publication to the created ID, and publishes only after all three uploads', () => {
    const r = publish([...beforePublish(), { json: { ...DRAFT, draft: false } }]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`published ${TAG}\n`);
    expect(r.calls).toEqual([
      lookup,
      api('--method', 'POST', ENDPOINT, '-f', `tag_name=${TAG}`, '-f', 'target_commitish=abcdef0',
        '-f', `name=${TAG}`, '-f', `body=test commit\n\nCommit abcdef0\nhttps://github.com/${REPO}/commit/abcdef0\n`, '-F', 'draft=true'),
      ...ASSETS.map((asset) => api('--method', 'POST', `https://uploads.github.com/repos/${REPO}/releases/123/assets?name=${asset}`,
        '-H', 'Content-Type: application/octet-stream', '--input', join(root, 'assets', asset))),
      api('--method', 'PATCH', `${ENDPOINT}/123`, '-F', 'draft=false', '-f', 'make_latest=true'),
    ]);
  });

  it('preserves a published release when the publication response is lost, then safely skips on rerun', () => {
    const failed = publish([...beforePublish(), { status: 1, stderr: 'connection reset after successful publication' }]);
    expect(failed.status).toBe(1);
    expect(failed.calls).toHaveLength(6);
    expect(failed.stderr).toContain('last request may have succeeded');
    const retry = publish([{ json: { ...DRAFT, draft: false } }]);
    expect(retry.status).toBe(0);
    expect(retry.calls).toEqual([lookup]);
  });

  it('refuses to mutate a retained draft on rerun after upload failure', () => {
    expect(publish([{ stdout: '' }, { json: DRAFT }, { status: 1, stderr: 'upload failed' }]).status).toBe(1);
    const retry = publish([{ json: DRAFT }]);
    expect(retry.status).toBe(1);
    expect(retry.calls).toEqual([lookup]);
  });

  it.each([{ ...DRAFT, draft: true }, { ...DRAFT, id: 456, draft: false }, {}])('preserves the release after an unconfirmed publication response: %j', (json) => {
    const r = publish([...beforePublish(), { json }]);
    expect(r.status).toBe(1);
    expect(r.calls).toHaveLength(6);
  });
});

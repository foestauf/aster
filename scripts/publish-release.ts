// Release pipeline R1: create a draft, upload every asset, then publish by its stable ID.
// Never delete remotely on failure: even an owned draft may have been published by another actor,
// and a failed request can mean GitHub committed the change but its response was lost.
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';

const ASSETS = ['asterc-linux-x86_64', 'asterc-c-seed.tar.gz', 'SHA256SUMS'];

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr.trim() ?? result.status}`);
  }
  return result.stdout.trim();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid release response');
  return value as Record<string, unknown>;
}

function release(value: unknown): { id: number; tag_name: string; draft: boolean; upload_url?: unknown } {
  const r = record(value);
  if (!Number.isSafeInteger(r.id) || (r.id as number) <= 0 || typeof r.tag_name !== 'string' || typeof r.draft !== 'boolean') {
    throw new Error('invalid release identity or draft state');
  }
  return r as { id: number; tag_name: string; draft: boolean; upload_url?: unknown };
}

function main(): void {
  const [tag, sha, dir, ...extra] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL;
  if (!tag || !sha || !dir || extra.length || !repo || !server) {
    throw new Error('usage: publish-release.sh <tag> <sha> <assets dir>; needs GITHUB_REPOSITORY and GITHUB_SERVER_URL');
  }
  const serverUrl = new URL(server);
  if (serverUrl.protocol !== 'https:') throw new Error('GITHUB_SERVER_URL must use https');
  const endpoint = `repos/${repo}/releases`;
  const api = (args: string[]) => run('gh', ['api', '--hostname', serverUrl.hostname, ...args]);
  // gh exits nonzero if any page fails. Do not interpret failed/partial output as an absent release.
  // JSON lines work with older gh versions too (no --slurp dependency).
  const rows = api(['--paginate', endpoint, '--jq', 'if type == "array" then .[] | @json else error("expected release list") end']);
  const existing = (rows ? rows.split('\n').map((line) => release(JSON.parse(line))) : []).filter((r) => r.tag_name === tag);
  if (existing.some((r) => !r.draft)) {
    console.log(`${tag} is already published; leaving it unchanged`);
    return;
  }
  if (existing.length) throw new Error(`${tag} already has a draft; inspect it manually before retrying (nothing changed)`);

  // Fail before creation if the local inputs are unavailable.
  for (const asset of ASSETS) accessSync(join(dir, asset), constants.R_OK);
  const subject = run('git', ['log', '-1', '--format=%s', sha]);
  const notes = `${subject}\n\nCommit ${sha}\n${server}/${repo}/commit/${sha}\n`;
  let created;
  try {
    created = release(JSON.parse(api(['--method', 'POST', endpoint,
      '-f', `tag_name=${tag}`, '-f', `target_commitish=${sha}`, '-f', `name=${tag}`, '-f', `body=${notes}`, '-F', 'draft=true'])));
    if (created.tag_name !== tag || !created.draft || typeof created.upload_url !== 'string') {
      throw new Error('create response did not identify the requested draft');
    }
    const upload = new URL(created.upload_url.replace(/\{\?name,label\}$/, ''));
    const uploadOrigin = serverUrl.hostname === 'github.com' ? 'https://uploads.github.com' : serverUrl.origin;
    if (upload.origin !== uploadOrigin || upload.username || upload.password || upload.search || upload.hash ||
        !upload.pathname.endsWith(`/repos/${repo}/releases/${created.id}/assets`)) {
      throw new Error('create response has an unexpected upload URL');
    }
    for (const asset of ASSETS) {
      upload.searchParams.set('name', asset);
      const uploaded = record(JSON.parse(api(['--method', 'POST', upload.href,
        '-H', 'Content-Type: application/octet-stream', '--input', join(dir, asset)])));
      if (uploaded.name !== asset || uploaded.state !== 'uploaded') throw new Error(`upload not confirmed: ${asset}`);
    }
    // Pin the update to the successful create response, never look up a mutable tag to choose a target.
    const published = release(JSON.parse(api(['--method', 'PATCH', `${endpoint}/${created.id}`,
      '-F', 'draft=false', '-f', 'make_latest=true'])));
    if (published.id !== created.id || published.tag_name !== tag || published.draft) throw new Error('publication not confirmed');
  } catch (error) {
    const identity = created ? `release ID ${created.id}` : `tag ${tag}`;
    throw new Error(`${error instanceof Error ? error.message : String(error)}; inspect ${identity} before retrying. ` +
      'No release or tag was deleted; the last request may have succeeded.', { cause: error });
  }
  console.log(`published ${tag}`);
}

try {
  main();
} catch (error) {
  console.error(`publish-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

'use strict';
// Runs the aster compiler one shot at a time and decides which answers may be shown: only those about the files as
// saved, never an older one over a newer one. No vscode import; src/extension.cjs is the glue.
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const convert = require('./convert.cjs');

// One compiler run: argv straight to the executable (never a shell), killed on timeout or abort. Resolves with the
// parsed aster/1 response and the exit status, or with why there is none.
function run(compiler, argv, { cwd, timeoutMs, signal }) {
  return new Promise((resolve) => {
    let settled = false;
    let child = null;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => {
      if (child) child.kill('SIGKILL');
      finish({ kind: 'cancelled' });
    };
    if (signal && signal.aborted) return finish({ kind: 'cancelled' });
    try {
      child = spawn(compiler, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
    } catch (e) {
      return finish({ kind: 'error', message: `cannot run ${compiler}: ${e.message}` });
    }
    if (signal) signal.addEventListener('abort', onAbort);
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ kind: 'error', message: `${compiler} timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (e) =>
      finish({ kind: 'error', message: e.code === 'ENOENT' ? `compiler not found: ${compiler}` : `cannot run ${compiler}: ${e.message}` }));
    child.on('close', (code, sig) => {
      if (code === null) return finish({ kind: 'error', message: `${compiler} was killed by ${sig}` });
      if (code === 101) return finish({ kind: 'error', message: `${compiler} panicked (exit 101)` });
      let doc = null;
      try {
        doc = JSON.parse(Buffer.concat(out).toString('utf8'));
      } catch {
        doc = null;
      }
      if (!doc || typeof doc !== 'object' || doc.schema !== 'aster/1') {
        const first = Buffer.concat(err).toString('utf8').split('\n')[0];
        return finish({ kind: 'error', message: `${compiler} did not answer with aster/1 JSON (exit ${code})${first ? `: ${first}` : ''}` });
      }
      finish({ kind: 'ok', status: code, doc });
    });
  });
}

// Whether `code` is the exit status the contract gives for this response (docs/inspect/README.md, Statuses).
function exitMatches(doc, code) {
  if (doc.command === 'query') {
    const q = doc.query;
    if (q.status === 'unavailable') return code === (q.reason === 'io' ? 2 : 1);
    if (q.status === 'invalid') return code === 2;
    return code === 0;
  }
  return doc.ok ? code === 0 : code === 1 || code === 2;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The SHA-256 of a file's bytes now, or null when it can't be read.
function hashFile(file) {
  try {
    return sha256(readFileSync(file));
  } catch {
    return null;
  }
}

// Why a query response no longer describes the saved files: a file in it is dirty in the editor, or its bytes on disk
// differ from what the compiler hashed (including a path that can't be read back). Empty when it is still fresh.
function staleReasons(doc, root, isDirty) {
  const reasons = [];
  for (const f of doc.files) {
    const file = path.resolve(root, f.path);
    if (isDirty(file)) reasons.push(`${f.path} has unsaved changes`);
    else if (hashFile(file) !== f.sha256) reasons.push(`${f.path} changed since the compiler read it`);
  }
  return reasons;
}

const mismatch = (r) => ({ kind: 'error', message: `unexpected exit ${r.status} for a ${r.doc.command} response` });

// One workspace's compiler, entry point and ordering: a newer check supersedes an older one, and a save while a query
// runs makes its answer stale.
class Session {
  constructor({ compiler, root, entry, timeoutMs, isDirty, runner = run }) {
    this.compiler = compiler;
    this.root = root;
    this.entry = entry;
    this.timeoutMs = timeoutMs;
    this.isDirty = isDirty;
    this.runner = runner;
    this.generation = 0;
    this.checkSeq = 0;
    this.checkController = null;
  }

  // A .aster file was saved: answers to requests that started before now are stale.
  saved() {
    this.generation++;
  }

  // Diagnostics for the entry's closure. Cancels a check still running; its result comes back `superseded`.
  async check() {
    if (this.checkController) this.checkController.abort();
    const controller = new AbortController();
    this.checkController = controller;
    const seq = ++this.checkSeq;
    const r = await this.runner(this.compiler, ['check', '--format=json', this.entry], { cwd: this.root, timeoutMs: this.timeoutMs, signal: controller.signal });
    if (seq !== this.checkSeq) return { kind: 'superseded' };
    this.checkController = null;
    if (r.kind !== 'ok') return r;
    if (r.doc.command !== 'check' || !exitMatches(r.doc, r.status)) return mismatch(r);
    const byFile = convert.diagnosticsByFile(r.doc, this.root, this.entry, existsSync);
    return { kind: 'diagnostics', ok: r.doc.ok, count: r.doc.diagnostics.length, byFile };
  }

  // What is at `line`/`character` of the saved `file` (absolute): `pointer` for hover, `caret` for definition.
  async query(file, mode, line, character, signal) {
    if (this.isDirty(file)) return { kind: 'stale', reasons: ['the document has unsaved changes'] };
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch (e) {
      return { kind: 'error', message: `cannot read ${file}: ${e.message}` };
    }
    const position = convert.byteOffset(bytes, line, character);
    if (position.error) return { kind: 'none', reason: position.error };
    const rel = path.relative(this.root, file).split(path.sep).join('/');
    const flag = mode === 'caret' ? '--caret' : '--offset';
    const generation = this.generation;
    const argv = ['query', this.entry, `--file=${rel}`, `${flag}=${position.offset}`];
    const r = await this.runner(this.compiler, argv, { cwd: this.root, timeoutMs: this.timeoutMs, signal });
    if (r.kind !== 'ok') return r;
    const doc = r.doc;
    if (doc.command !== 'query' || !doc.query || !exitMatches(doc, r.status)) return mismatch(r);
    if (generation !== this.generation) return { kind: 'stale', reasons: ['a file was saved while the compiler ran'] };
    const q = doc.query;
    if (q.status === 'unavailable') return { kind: 'unavailable', reason: q.reason };
    if (q.status === 'invalid') return { kind: 'none', reason: `invalid position: ${q.reason}` };
    const reasons = staleReasons(doc, this.root, this.isDirty);
    const own = doc.files[q.request.file];
    if (reasons.length === 0 && (!own || own.sha256 !== sha256(bytes))) reasons.push(`${rel} changed while the compiler ran`);
    if (reasons.length > 0) return { kind: 'stale', reasons };
    return { kind: 'answer', doc };
  }
}

module.exports = { run, exitMatches, Session };

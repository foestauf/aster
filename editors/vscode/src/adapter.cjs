'use strict';
// Runs the aster compiler one shot at a time and decides which answers may be shown: only those about the files as
// saved, never an older one over a newer one. No vscode import; src/extension.cjs is the glue.
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const convert = require('./convert.cjs');

// One compiler run: argv straight to the executable (never a shell), killed on timeout or abort. Resolves with the
// parsed aster/1 response and the exit status, or with why there is none. `spawn` is for tests that count processes.
function run(compiler, argv, { cwd, timeoutMs, signal, spawn: spawnProcess = spawn }) {
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
      child = spawnProcess(compiler, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
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

// Session.query's answer for a file outside the entry's closure.
const NOT_IN_CLOSURE = 'invalid position: file-not-in-closure';

// One entry point's compiler and ordering: a newer check supersedes an older one, and a save while a query runs makes
// its answer stale. Every check or query response also records the entry's closure (`files`, as absolute paths), which
// is fresh until the next save or file-system change.
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
    this.closure = null;
    this.closureGeneration = -1;
  }

  // A .aster file was saved or changed on disk: answers to requests that started before now are stale, and so is the
  // recorded closure.
  saved() {
    this.generation++;
  }

  // Whether the closure recorded from the latest response still describes the files on disk.
  closureFresh() {
    return this.closure !== null && this.closureGeneration === this.generation;
  }

  // Records the closure of a response to a request that started at `generation`, unless a later one is recorded. No
  // files means the entry itself didn't load: the closure is unknown, not empty, so requests still go to the compiler.
  noteClosure(doc, generation) {
    if (!Array.isArray(doc.files) || generation < this.closureGeneration) return;
    this.closure = doc.files.length > 0 ? new Set(doc.files.map((f) => path.resolve(this.root, f.path))) : null;
    this.closureGeneration = generation;
  }

  // Kills a check still running; its result comes back `superseded`.
  cancelCheck() {
    if (this.checkController) this.checkController.abort();
    this.checkController = null;
    this.checkSeq++;
  }

  // Diagnostics for the entry's closure. Cancels a check still running; its result comes back `superseded`.
  async check() {
    this.cancelCheck();
    const controller = new AbortController();
    this.checkController = controller;
    const seq = this.checkSeq;
    const generation = this.generation;
    const r = await this.runner(this.compiler, ['check', '--format=json', this.entry], { cwd: this.root, timeoutMs: this.timeoutMs, signal: controller.signal });
    if (seq !== this.checkSeq) return { kind: 'superseded' };
    this.checkController = null;
    if (r.kind !== 'ok') return r;
    if (r.doc.command !== 'check' || !exitMatches(r.doc, r.status)) return mismatch(r);
    this.noteClosure(r.doc, generation);
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
    this.noteClosure(doc, generation);
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

  // Kills the running check. Queries are killed through their own signal.
  dispose() {
    this.cancelCheck();
  }
}

// `aster.entry` as a list: a string is one entry, an array lists several (empty and repeated ones dropped).
function entryList(value) {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return [...new Set(list.filter((e) => typeof e === 'string' && e !== ''))];
}

// Whether `file` (absolute) is `root` or inside it.
function inside(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

// One workspace folder's programs: a Session per entry, in the order listed. Diagnostics are the union of every
// entry's check; a file is answered by the first entry whose latest closure contains it. One request of each kind
// (pointer for hover, caret for definition) runs at a time: a newer one kills the older one, which comes back
// `cancelled`. Nothing is guessed: with every closure fresh and none containing the file, no compiler runs at all.
class Folder {
  constructor({ compiler, root, entries, timeoutMs, isDirty, runner = run }) {
    this.root = root;
    this.entries = entries;
    this.sessions = entries.map((entry) => new Session({ compiler, root, entry, timeoutMs, isDirty, runner }));
    this.checkSeq = 0;
    this.slots = new Map();
    this.disposed = false;
  }

  contains(file) {
    return inside(this.root, file);
  }

  // Whether any entry's latest closure contains `file`.
  inClosure(file) {
    return this.sessions.some((s) => s.closure !== null && s.closure.has(file));
  }

  // The entry that answers for `file`: the first whose latest closure contains it, or undefined.
  owner(file) {
    return this.sessions.find((s) => s.closure !== null && s.closure.has(file));
  }

  saved() {
    for (const s of this.sessions) s.saved();
  }

  // Every entry checked in turn. A newer check supersedes this one; a compiler problem in any entry is the result.
  async check() {
    const seq = ++this.checkSeq;
    for (const s of this.sessions) s.cancelCheck();
    const byFile = new Map();
    const seen = new Set();
    let ok = true;
    let count = 0;
    for (const s of this.sessions) {
      const r = await s.check();
      if (seq !== this.checkSeq || this.disposed) return { kind: 'superseded' };
      if (r.kind !== 'diagnostics') return r;
      ok = ok && r.ok;
      for (const [file, list] of r.byFile) {
        for (const d of list) {
          const key = JSON.stringify([file, d.range, d.message, d.code, d.severity]);
          if (seen.has(key)) continue;
          seen.add(key);
          if (!byFile.has(file)) byFile.set(file, []);
          byFile.get(file).push(d);
          count++;
        }
      }
    }
    return { kind: 'diagnostics', ok, count, byFile };
  }

  // Session.query, from the entry that owns `file`. An entry whose fresh closure lacks the file is skipped without a
  // run; one whose closure is not fresh is asked, and passed over if it answers that the file is not in its closure.
  async query(file, mode, line, character, signal) {
    if (this.disposed) return { kind: 'cancelled' };
    const previous = this.slots.get(mode);
    if (previous) previous.abort();
    const controller = new AbortController();
    this.slots.set(mode, controller);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort);
    }
    try {
      let last = null;
      for (const s of this.sessions) {
        if (s.closureFresh() && !s.closure.has(file)) continue;
        if (controller.signal.aborted) return { kind: 'cancelled' };
        const r = await s.query(file, mode, line, character, controller.signal);
        if (r.kind === 'none' && r.reason === NOT_IN_CLOSURE) {
          last = r;
          continue;
        }
        return r;
      }
      return last ?? { kind: 'none', reason: NOT_IN_CLOSURE, skipped: true };
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (this.slots.get(mode) === controller) this.slots.delete(mode);
    }
  }

  // Kills every running check and query; later requests come back `cancelled`.
  dispose() {
    this.disposed = true;
    for (const s of this.sessions) s.dispose();
    for (const controller of this.slots.values()) controller.abort();
    this.slots.clear();
  }
}

module.exports = { run, exitMatches, entryList, inside, NOT_IN_CLOSURE, Session, Folder };

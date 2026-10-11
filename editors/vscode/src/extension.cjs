'use strict';
// VS Code glue for the saved-file compiler adapter. Each trusted workspace folder with a compiler and at least one
// entry point gets its own adapter Folder; without them it stays syntax-only and runs nothing. All decisions about what
// may be shown live in adapter.cjs and convert.cjs.
const path = require('node:path');
const vscode = require('vscode');
const { Folder, entryList, inside } = require('./adapter.cjs');
const convert = require('./convert.cjs');

// Kills the running compilers of the active extension; deactivate() calls it.
let teardown = () => {};

function activate(context) {
  const output = vscode.window.createOutputChannel('Aster');
  const diagnostics = vscode.languages.createDiagnosticCollection('aster');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  status.show();
  // One context per workspace folder: its adapter Folder (null when syntax-only), status and published diagnostics.
  let contexts = [];
  let none = { text: 'Aster: syntax only', tooltip: 'Open a folder to use the compiler.' };

  const log = (line) => output.appendLine(`[${new Date().toISOString()}] ${line}`);
  const isDirty = (file) =>
    vscode.workspace.textDocuments.some((d) => d.uri.scheme === 'file' && d.isDirty && path.resolve(d.uri.fsPath) === file);
  const toRange = (r) => new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);
  const live = (ctx) => contexts.includes(ctx);

  // The context of the innermost workspace folder containing `file`, or undefined.
  function contextOf(file) {
    let best;
    for (const ctx of contexts) if (inside(ctx.root, file) && (!best || ctx.root.length > best.root.length)) best = ctx;
    return best;
  }

  // The status bar shows the context of the active editor's file, else the first one.
  function render() {
    const editor = vscode.window.activeTextEditor;
    const ctx = (editor && editor.document.uri.scheme === 'file' && contextOf(path.resolve(editor.document.uri.fsPath))) || contexts[0];
    const shown = ctx ? ctx.status : none;
    status.text = shown.text;
    status.tooltip = contexts.length > 1 && ctx ? `${ctx.name}: ${shown.tooltip}` : shown.tooltip;
  }
  const show = (ctx, text, tooltip) => {
    ctx.status = { text, tooltip };
    render();
  };

  function problem(ctx, r) {
    if (r.kind === 'cancelled') return;
    log(contexts.length > 1 ? `${ctx.name}: ${r.message}` : r.message);
    show(ctx, 'Aster: compiler problem', r.message);
  }

  // Replaces this context's published diagnostics with `byFile` (none when omitted).
  function publish(ctx, byFile = new Map()) {
    for (const file of ctx.published) diagnostics.delete(vscode.Uri.file(file));
    ctx.published = new Set(byFile.keys());
    for (const [file, list] of byFile) {
      diagnostics.set(vscode.Uri.file(file), list.map((d) => {
        const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
        const item = new vscode.Diagnostic(toRange(d.range), d.message, severity);
        item.source = 'aster';
        item.code = d.code;
        return item;
      }));
    }
  }

  function dispose() {
    for (const ctx of contexts) if (ctx.folder) ctx.folder.dispose();
    contexts = [];
  }

  function configure() {
    dispose();
    diagnostics.clear();
    const folders = vscode.workspace.workspaceFolders || [];
    if (!vscode.workspace.isTrusted) none = { text: 'Aster: syntax only', tooltip: 'This workspace is not trusted, so no compiler runs.' };
    else none = { text: 'Aster: syntax only', tooltip: 'Open a folder to use the compiler.' };
    if (!vscode.workspace.isTrusted || folders.length === 0) return render();
    for (const wf of folders) {
      const root = wf.uri.fsPath;
      const ctx = { root, name: wf.name || path.basename(root), folder: null, status: null, published: new Set() };
      contexts.push(ctx);
      const config = vscode.workspace.getConfiguration('aster', wf.uri);
      const compilerSetting = config.get('compilerPath', '');
      const entries = entryList(config.get('entry', ''));
      if (!compilerSetting) ctx.status = { text: 'Aster: syntax only', tooltip: 'Set aster.compilerPath to use the compiler.' };
      else if (entries.length === 0) ctx.status = { text: 'Aster: syntax only', tooltip: 'Set aster.entry to the file with main.' };
      else {
        const compiler = /[\\/]/.test(compilerSetting) ? path.resolve(root, compilerSetting) : compilerSetting;
        ctx.folder = new Folder({ compiler, root, entries, timeoutMs: config.get('timeoutMs', 10000), isDirty });
        ctx.status = { text: 'Aster: checking…', tooltip: `Checking ${entries.join(', ')}` };
      }
    }
    render();
    for (const ctx of contexts) check(ctx);
  }

  async function check(ctx) {
    const current = ctx.folder;
    if (!current) return;
    show(ctx, 'Aster: checking…', `Checking ${current.entries.join(', ')}`);
    let r;
    try {
      r = await current.check();
    } catch (e) {
      r = { kind: 'error', message: `malformed compiler response: ${e.message}` };
    }
    if (!live(ctx) || r.kind === 'superseded' || r.kind === 'cancelled') return;
    // A failed check leaves no diagnostics up: the old ones may no longer be true.
    if (r.kind !== 'diagnostics') {
      publish(ctx);
      return problem(ctx, r);
    }
    publish(ctx, r.byFile);
    if (r.ok) show(ctx, 'Aster: ✓ saved files', 'Hover and go to definition answer for saved files only.');
    else show(ctx, `Aster: ${r.count} error${r.count === 1 ? '' : 's'} — semantics unavailable`, 'Fix the errors and save to get hover and definition back.');
  }

  // A .aster file was saved, or created, changed or deleted on disk: every folder's answers and closures are stale,
  // and a folder re-checks when the file is inside it or in one of its closures (every folder when `file` is null).
  function changed(file) {
    for (const ctx of contexts) {
      if (!ctx.folder) continue;
      const affected = file === null || ctx.folder.contains(file) || ctx.folder.inClosure(file);
      ctx.folder.saved();
      if (affected) check(ctx);
    }
  }

  // A fresh query answer for the position, with the root it is relative to, or null.
  async function ask(document, position, token, mode) {
    if (document.uri.scheme !== 'file') return null;
    const file = path.resolve(document.uri.fsPath);
    const ctx = contextOf(file);
    const current = ctx && ctx.folder;
    if (!current) return null;
    const controller = new AbortController();
    const subscription = token.onCancellationRequested(() => controller.abort());
    let r;
    try {
      r = await current.query(file, mode, position.line, position.character, controller.signal);
    } catch (e) {
      r = { kind: 'error', message: `malformed compiler response: ${e.message}` };
    } finally {
      subscription.dispose();
    }
    if (!live(ctx)) return null;
    if (r.kind === 'answer') return { doc: r.doc, root: ctx.root };
    if (r.kind === 'stale') {
      log(`dropped a stale answer: ${r.reasons.join('; ')}`);
      show(ctx, 'Aster: saved files only', 'Save your changes to get hover and definition.');
    } else if (r.kind === 'none') {
      if (r.reason && !r.skipped) log(r.reason);
    } else if (r.kind !== 'unavailable') {
      problem(ctx, r);
    }
    return null;
  }

  // Builds a provider's result from an answer; a response that doesn't fit the contract is a compiler problem.
  function rendered(document, build) {
    try {
      return build();
    } catch (e) {
      const ctx = contextOf(path.resolve(document.uri.fsPath));
      if (ctx) problem(ctx, { kind: 'error', message: `malformed compiler response: ${e.message}` });
      return null;
    }
  }

  const hover = {
    async provideHover(document, position, token) {
      const a = await ask(document, position, token, 'pointer');
      return a && rendered(document, () => {
        const text = convert.hoverText(a.doc);
        if (!text) return null;
        const range = toRange(convert.editorRange(a.doc.query.location.range));
        return new vscode.Hover(new vscode.MarkdownString().appendCodeblock(text, 'aster'), range);
      });
    },
  };
  const definition = {
    async provideDefinition(document, position, token) {
      const a = await ask(document, position, token, 'caret');
      return a && rendered(document, () => {
        const target = convert.definitionTarget(a.doc, a.root);
        return target ? new vscode.Location(vscode.Uri.file(target.file), toRange(target.range)) : null;
      });
    },
  };

  // Changes outside the editor (git checkout, cp, rm) refresh like a save. The editor's own saves fire it as well; the
  // second check supersedes the first.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.aster');
  const onDisk = (uri) => {
    if (uri.scheme === 'file') changed(path.resolve(uri.fsPath));
  };

  const selector = { language: 'aster', scheme: 'file' };
  context.subscriptions.push(
    output,
    diagnostics,
    status,
    watcher,
    { dispose },
    vscode.languages.registerHoverProvider(selector, hover),
    vscode.languages.registerDefinitionProvider(selector, definition),
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.languageId === 'aster') changed(d.uri && d.uri.scheme === 'file' ? path.resolve(d.uri.fsPath) : null);
    }),
    watcher.onDidCreate(onDisk),
    watcher.onDidChange(onDisk),
    watcher.onDidDelete(onDisk),
    vscode.window.onDidChangeActiveTextEditor(render),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aster')) configure();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(configure),
    vscode.workspace.onDidChangeWorkspaceFolders(configure),
  );
  teardown = dispose;
  configure();
}

function deactivate() {
  teardown();
  teardown = () => {};
}

module.exports = { activate, deactivate };

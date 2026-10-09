'use strict';
// VS Code glue for the saved-file compiler adapter. Without workspace trust, a compiler and an entry point it stays
// syntax-only and runs nothing. All decisions about what may be shown live in adapter.cjs and convert.cjs.
const path = require('node:path');
const vscode = require('vscode');
const { Session } = require('./adapter.cjs');
const convert = require('./convert.cjs');

function activate(context) {
  const output = vscode.window.createOutputChannel('Aster');
  const diagnostics = vscode.languages.createDiagnosticCollection('aster');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  status.show();
  let session = null;

  const show = (text, tooltip) => {
    status.text = text;
    status.tooltip = tooltip;
  };
  const log = (line) => output.appendLine(`[${new Date().toISOString()}] ${line}`);
  const isDirty = (file) =>
    vscode.workspace.textDocuments.some((d) => d.uri.scheme === 'file' && d.isDirty && path.resolve(d.uri.fsPath) === file);
  const toRange = (r) => new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);

  function problem(r) {
    if (r.kind === 'cancelled') return;
    log(r.message);
    show('Aster: compiler problem', r.message);
  }

  function configure() {
    session = null;
    diagnostics.clear();
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!vscode.workspace.isTrusted) return show('Aster: syntax only', 'This workspace is not trusted, so no compiler runs.');
    if (!folder) return show('Aster: syntax only', 'Open a folder to use the compiler.');
    const config = vscode.workspace.getConfiguration('aster', folder.uri);
    const compilerSetting = config.get('compilerPath', '');
    const entry = config.get('entry', '');
    if (!compilerSetting) return show('Aster: syntax only', 'Set aster.compilerPath to use the compiler.');
    if (!entry) return show('Aster: syntax only', 'Set aster.entry to the file with main.');
    const root = folder.uri.fsPath;
    const compiler = /[\\/]/.test(compilerSetting) ? path.resolve(root, compilerSetting) : compilerSetting;
    session = new Session({ compiler, root, entry, timeoutMs: config.get('timeoutMs', 10000), isDirty });
    check();
  }

  async function check() {
    const current = session;
    if (!current) return;
    show('Aster: checking…', `Checking ${current.entry}`);
    const r = await current.check();
    if (current !== session || r.kind === 'superseded') return;
    if (r.kind !== 'diagnostics') return problem(r);
    diagnostics.clear();
    for (const [file, list] of r.byFile) {
      diagnostics.set(vscode.Uri.file(file), list.map((d) => {
        const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
        const item = new vscode.Diagnostic(toRange(d.range), d.message, severity);
        item.source = 'aster';
        item.code = d.code;
        return item;
      }));
    }
    if (r.ok) show('Aster: ✓ saved files', 'Hover and go to definition answer for saved files only.');
    else show(`Aster: ${r.count} error${r.count === 1 ? '' : 's'} — semantics unavailable`, 'Fix the errors and save to get hover and definition back.');
  }

  // A fresh query answer for the position, with the root it is relative to, or null.
  async function ask(document, position, token, mode) {
    const current = session;
    if (!current || document.uri.scheme !== 'file') return null;
    const controller = new AbortController();
    const subscription = token.onCancellationRequested(() => controller.abort());
    try {
      const r = await current.query(document.uri.fsPath, mode, position.line, position.character, controller.signal);
      if (current !== session) return null;
      if (r.kind === 'answer') return { doc: r.doc, root: current.root };
      if (r.kind === 'stale') {
        log(`dropped a stale answer: ${r.reasons.join('; ')}`);
        show('Aster: saved files only', 'Save your changes to get hover and definition.');
      } else if (r.kind === 'none') {
        if (r.reason) log(r.reason);
      } else if (r.kind !== 'unavailable') {
        problem(r);
      }
      return null;
    } finally {
      subscription.dispose();
    }
  }

  const hover = {
    async provideHover(document, position, token) {
      const a = await ask(document, position, token, 'pointer');
      const text = a && convert.hoverText(a.doc);
      if (!text) return null;
      const range = toRange(convert.editorRange(a.doc.query.location.range));
      return new vscode.Hover(new vscode.MarkdownString().appendCodeblock(text, 'aster'), range);
    },
  };
  const definition = {
    async provideDefinition(document, position, token) {
      const a = await ask(document, position, token, 'caret');
      const target = a && convert.definitionTarget(a.doc, a.root);
      return target ? new vscode.Location(vscode.Uri.file(target.file), toRange(target.range)) : null;
    },
  };

  const selector = { language: 'aster', scheme: 'file' };
  context.subscriptions.push(
    output,
    diagnostics,
    status,
    vscode.languages.registerHoverProvider(selector, hover),
    vscode.languages.registerDefinitionProvider(selector, definition),
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (session && d.languageId === 'aster') {
        session.saved();
        check();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aster')) configure();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(configure),
    vscode.workspace.onDidChangeWorkspaceFolders(configure),
  );
  configure();
}

function deactivate() {}

module.exports = { activate, deactivate };

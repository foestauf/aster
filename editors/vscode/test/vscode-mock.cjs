// The slice of the VS Code API that src/extension.cjs uses, recorded for assertions. activate() loads the extension
// with require('vscode') returning it.
const Module = require('node:module');

function Range(sl, sc, el, ec) {
  Object.assign(this, { start: { line: sl, character: sc }, end: { line: el, character: ec } });
}
function Diagnostic(range, message, severity) {
  Object.assign(this, { range, message, severity });
}
function Hover(contents, range) {
  Object.assign(this, { contents, range });
}
function Location(uri, range) {
  Object.assign(this, { uri, range });
}

// `folder` and `settings` describe one workspace folder; `folders` lists several as [{ path, settings }], each read with
// getConfiguration('aster', folder.uri).
function create({ trusted = true, folder = null, settings = {}, folders = null } = {}) {
  const list = folders ?? (folder ? [{ path: folder, settings }] : []);
  const state = { status: null, diagnostics: new Map(), hover: null, definition: null, log: [], listeners: {}, watchers: [] };
  const on = (name) => (fn) => {
    state.listeners[name] = fn;
    return { dispose() {} };
  };
  const vscode = {
    Range,
    Diagnostic,
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    Hover,
    MarkdownString: class { appendCodeblock(code, lang) { this.value = `\`\`\`${lang}\n${code}\n\`\`\``; return this; } },
    Location,
    StatusBarAlignment: { Left: 1 },
    Uri: { file: (fsPath) => ({ scheme: 'file', fsPath }) },
    window: {
      createOutputChannel: () => ({ appendLine: (l) => state.log.push(l), dispose() {} }),
      createStatusBarItem: () => (state.status = { text: '', tooltip: '', show() {}, dispose() {} }),
      activeTextEditor: undefined,
      onDidChangeActiveTextEditor: on('activeEditor'),
    },
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri, items) => state.diagnostics.set(uri.fsPath, items),
        clear: () => state.diagnostics.clear(),
        delete: (uri) => state.diagnostics.delete(uri.fsPath),
        dispose() {},
      }),
      registerHoverProvider: (_, p) => ((state.hover = p), { dispose() {} }),
      registerDefinitionProvider: (_, p) => ((state.definition = p), { dispose() {} }),
    },
    workspace: {
      isTrusted: trusted,
      workspaceFolders: list.length > 0 ? list.map((f) => ({ uri: { scheme: 'file', fsPath: f.path }, name: f.path.split('/').pop() })) : undefined,
      textDocuments: [],
      getConfiguration: (_, uri) => {
        const own = (uri && list.find((f) => f.path === uri.fsPath)) || list[0];
        const values = own ? own.settings : settings;
        return { get: (key, fallback) => (key in values ? values[key] : fallback) };
      },
      createFileSystemWatcher: (glob) => {
        const watcher = { glob, onDidCreate: on('fsCreate'), onDidChange: on('fsChange'), onDidDelete: on('fsDelete'), dispose() {} };
        state.watchers.push(watcher);
        return watcher;
      },
      onDidSaveTextDocument: on('save'),
      onDidChangeConfiguration: on('config'),
      onDidGrantWorkspaceTrust: on('trust'),
      onDidChangeWorkspaceFolders: on('folders'),
    },
  };
  return { vscode, state };
}

// Loads src/extension.cjs fresh against `vscode`, activates it and returns the module (for deactivate()).
function activate(vscode) {
  const original = Module.prototype.require;
  Module.prototype.require = function (request) {
    return request === 'vscode' ? vscode : original.call(this, request);
  };
  try {
    const file = require.resolve('../src/extension.cjs');
    delete require.cache[file];
    const extension = require(file);
    extension.activate({ subscriptions: [] });
    return extension;
  } finally {
    Module.prototype.require = original;
  }
}

module.exports = { create, activate };

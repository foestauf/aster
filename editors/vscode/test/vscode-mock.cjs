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

function create({ trusted = true, folder = null, settings = {} } = {}) {
  const state = { status: null, diagnostics: new Map(), hover: null, definition: null, log: [], listeners: {} };
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
    },
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri, list) => state.diagnostics.set(uri.fsPath, list),
        clear: () => state.diagnostics.clear(),
        dispose() {},
      }),
      registerHoverProvider: (_, p) => ((state.hover = p), { dispose() {} }),
      registerDefinitionProvider: (_, p) => ((state.definition = p), { dispose() {} }),
    },
    workspace: {
      isTrusted: trusted,
      workspaceFolders: folder ? [{ uri: { fsPath: folder } }] : undefined,
      textDocuments: [],
      getConfiguration: () => ({ get: (key, fallback) => (key in settings ? settings[key] : fallback) }),
      onDidSaveTextDocument: on('save'),
      onDidChangeConfiguration: on('config'),
      onDidGrantWorkspaceTrust: on('trust'),
      onDidChangeWorkspaceFolders: on('folders'),
    },
  };
  return { vscode, state };
}

// Loads src/extension.cjs fresh against `vscode` and activates it.
function activate(vscode) {
  const original = Module.prototype.require;
  Module.prototype.require = function (request) {
    return request === 'vscode' ? vscode : original.call(this, request);
  };
  try {
    const file = require.resolve('../src/extension.cjs');
    delete require.cache[file];
    require(file).activate({ subscriptions: [] });
  } finally {
    Module.prototype.require = original;
  }
}

module.exports = { create, activate };

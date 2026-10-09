// The slice of the VS Code API that src/extension.cjs uses, recorded for assertions. install() makes
// require('vscode') return it.
const Module = require('node:module');

function create({ trusted = true, folder = null, settings = {} } = {}) {
  const state = { status: null, diagnostics: new Map(), hover: null, definition: null, log: [], listeners: {} };
  const on = (name) => (fn) => {
    state.listeners[name] = fn;
    return { dispose() {} };
  };
  class Range {
    constructor(sl, sc, el, ec) {
      Object.assign(this, { start: { line: sl, character: sc }, end: { line: el, character: ec } });
    }
  }
  const vscode = {
    Range,
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
    MarkdownString: class { appendCodeblock(code, lang) { this.value = `\`\`\`${lang}\n${code}\n\`\`\``; return this; } },
    Location: class { constructor(uri, range) { Object.assign(this, { uri, range }); } },
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
  const original = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'vscode' ? vscode : original.call(this, request, ...rest);
  };
  try {
    const file = require.resolve('../src/extension.cjs');
    delete require.cache[file];
    require(file).activate({ subscriptions: [] });
  } finally {
    Module._load = original;
  }
}

module.exports = { create, activate };

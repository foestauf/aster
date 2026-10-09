'use strict';
// Pure conversions between VS Code and the compiler's aster/1 JSON (docs/inspect/README.md). No vscode, no I/O.
const path = require('node:path');

// The byte offset in `bytes` (a file as saved, BOM included) of the editor position `line`/`character`: 0-based, in
// UTF-16 code units, as VS Code counts them. A position inside a surrogate pair names the start of its code point; one
// past the end of a line is the line's end, and one past the last line is the end of the file. A lone '\r' is a line
// break to VS Code but an ordinary character to the compiler, so such a file gets {error} instead.
function byteOffset(bytes, line, character) {
  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  for (let k = start; k < bytes.length; k++) {
    if (bytes[k] === 0x0d && bytes[k + 1] !== 0x0a) return { error: 'the file has a carriage return that does not end a line' };
  }
  let i = start;
  for (let l = 0; l < line; l++) {
    const nl = bytes.indexOf(0x0a, i);
    if (nl < 0) return { offset: bytes.length };
    i = nl + 1;
  }
  let units = 0;
  while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) {
    const b = bytes[i];
    const size = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    const width = size === 4 ? 2 : 1;
    if (units + width > character) break;
    units += width;
    i += size;
  }
  return { offset: i };
}

// An editor range (0-based) from a compiler range (1-based lines, 1-based UTF-16 columns).
function editorRange(r) {
  return {
    start: { line: r.start_line - 1, character: r.start_col_utf16 - 1 },
    end: { line: r.end_line - 1, character: r.end_col_utf16 - 1 },
  };
}

// A structured type as Aster source spells it.
function renderType(t) {
  switch (t.kind) {
    case 'int':
    case 'bool':
    case 'string':
    case 'void':
    case 'never':
      return t.kind;
    case 'array':
      return `[${renderType(t.element)}]`;
    case 'map':
      return `Map[${renderType(t.key)}, ${renderType(t.value)}]`;
    case 'set':
      return `Set[${renderType(t.element)}]`;
    default:
      return t.name === undefined ? t.kind : t.name;
  }
}

// `fn name(p: T, ...): R`, or `fn name` for a builtin the checker types by hand (a null signature).
function renderSignature(name, sig) {
  if (!sig) return `fn ${name}`;
  const params = sig.params.map((p) => `${p.name}: ${renderType(p.type)}`).join(', ');
  return `fn ${name}(${params}): ${renderType(sig.ret)}`;
}

// How hover describes a declaration: a signature for a function, `kind name: type` when it has a type.
function describe(d) {
  if (d.kind === 'fn' || d.kind === 'builtin-fn') return renderSignature(d.name, d.signature);
  if (d.type !== undefined) return `${d.kind} ${d.name}: ${renderType(d.type)}`;
  return `${d.kind} ${d.name}`;
}

// The hover text for a query response, or null when there is nothing to show.
function hoverText(doc) {
  const q = doc.query;
  if (q.status !== 'found') return null;
  const target = q.target === undefined ? null : doc.semantics.declarations[q.target];
  if (q.site === 'callee') return renderSignature(target ? target.name : '', q.signature);
  if (q.site === 'declaration' && target) return describe(target);
  return q.type === undefined ? null : renderType(q.type);
}

// Where go-to-definition goes: the target declaration's name, or null when there is no navigable target.
function definitionTarget(doc, root) {
  const q = doc.query;
  if (q.status !== 'found' || q.target === undefined) return null;
  const location = doc.semantics.declarations[q.target].location;
  if (!location) return null;
  return { file: path.resolve(root, location.path), range: editorRange(location.range) };
}

// A check response's diagnostics by absolute file, in editor coordinates; one with no range (an unreadable root) is at
// 0:0. A diagnostic in a file that didn't load (`file` null) stays on that path when the file exists; otherwise it goes
// on the entry at 0:0 with the path in front.
function diagnosticsByFile(doc, root, entry, exists) {
  const byFile = new Map();
  for (const d of doc.diagnostics) {
    const zero = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    let file = path.resolve(root, d.primary.path);
    let range = d.primary.range === null ? zero : editorRange(d.primary.range);
    let message = d.message;
    if (d.primary.file === null && !exists(file)) {
      file = path.resolve(root, entry);
      range = zero;
      message = `${d.primary.path}: ${d.message}`;
    }
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ range, message, code: d.code, severity: d.severity });
  }
  return byFile;
}

module.exports = { byteOffset, editorRange, renderType, renderSignature, hoverText, definitionTarget, diagnosticsByFile };

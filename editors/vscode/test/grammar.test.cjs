const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { INITIAL, Registry, parseRawGrammar } = require('vscode-textmate');
const { loadWASM, OnigScanner, OnigString } = require('vscode-oniguruma');

const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '../..');
const read = (file) => readFileSync(path.join(extensionRoot, file), 'utf8');
const manifest = JSON.parse(read('package.json'));
let grammar;

before(async () => {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new OnigScanner(patterns),
      createOnigString: (text) => new OnigString(text),
    }),
    loadGrammar: async (scope) => scope === 'source.aster'
      ? parseRawGrammar(read('syntaxes/aster.tmLanguage.json'), 'aster.tmLanguage.json')
      : null,
  });
  grammar = await registry.loadGrammar('source.aster');
  assert.ok(grammar);
});

function tokenize(line, state = INITIAL) {
  const result = grammar.tokenizeLine(line, state, 1000);
  assert.equal(result.stoppedEarly, false, `tokenization timed out: ${line.slice(0, 80)}`);
  const tokens = result.tokens.filter((token) => token.startIndex < line.length).map((token) => ({
    text: line.slice(token.startIndex, token.endIndex),
    start: token.startIndex,
    end: Math.min(token.endIndex, line.length),
    scopes: token.scopes,
  }));
  return { tokens, state: result.ruleStack };
}

function hasScope(token, scope) {
  return token.scopes.includes(`${scope}.aster`);
}

function assertScope(line, text, scope, occurrence = 0) {
  let offset = -1;
  for (let i = 0; i <= occurrence; i++) offset = line.indexOf(text, offset + 1);
  assert.notEqual(offset, -1, `${JSON.stringify(text)} missing from fixture`);
  const { tokens } = tokenize(line);
  for (let i = offset; i < offset + text.length; i++) {
    const token = tokens.find((entry) => entry.start <= i && entry.end > i);
    assert.ok(token && hasScope(token, scope), `${JSON.stringify(text)} at ${i}: expected ${scope}, got ${JSON.stringify(token)}`);
  }
}

function assertPlainIdentifier(word) {
  const { tokens } = tokenize(word);
  assert.deepEqual(tokens.map(({ text, scopes }) => ({ text, scopes })), [
    { text: word, scopes: ['source.aster', 'variable.other.aster'] },
  ]);
}

test('manifest associates .aster with the grammar and configuration, and runs only the compiler adapter', () => {
  assert.equal(manifest.main, './src/extension.cjs');
  assert.equal(manifest.browser, undefined);
  assert.deepEqual(manifest.activationEvents, ['onLanguage:aster']);
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(manifest.capabilities.untrustedWorkspaces, {
    supported: 'limited',
    description: 'In an untrusted workspace the extension only highlights syntax; it never runs a compiler.',
    restrictedConfigurations: ['aster.compilerPath', 'aster.entry'],
  });
  const [language] = manifest.contributes.languages;
  const [contribution] = manifest.contributes.grammars;
  assert.equal(language.id, 'aster');
  assert.deepEqual(language.extensions, ['.aster']);
  assert.equal(contribution.language, language.id);
  assert.equal(contribution.scopeName, 'source.aster');
  assert.equal(JSON.parse(read(contribution.path)).scopeName, contribution.scopeName);
  const config = JSON.parse(read(language.configuration));
  assert.deepEqual(config.comments, { lineComment: '//' });
  assert.deepEqual(config.brackets, [['{', '}'], ['[', ']'], ['(', ')']]);
  assert.deepEqual(config.surroundingPairs, [...config.brackets, ['"', '"'], ["'", "'"]]);
  assert.deepEqual(config.autoClosingPairs.map(({ open, close }) => [open, close]), config.surroundingPairs);
  for (const pair of config.autoClosingPairs) assert.deepEqual(pair.notIn, ['string', 'comment']);
  const words = new RegExp(config.wordPattern, 'g');
  assert.deepEqual('foo_2 Option[int] 123 0..10'.match(words), ['foo_2', 'Option', 'int', '123', '0', '10']);
});

test('every current lexer keyword has its expected standard scope', () => {
  const groups = {
    'storage.type': ['fn', 'struct', 'enum'],
    'storage.modifier': ['let', 'var'],
    'keyword.control': ['if', 'else', 'while', 'for', 'in', 'break', 'continue', 'return', 'match', 'import'],
    'constant.language.boolean': ['true', 'false'],
  };
  const lexer = readFileSync(path.join(repoRoot, 'packages/asterc-self/lexer.aster'), 'utf8');
  const keywordFunction = lexer.match(/fn is_keyword\([\s\S]*?(?=\nfn is_punct)/)[0];
  const actual = [...keywordFunction.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(Object.values(groups).flat().toSorted(), actual.toSorted(), 'update grammar/tests when lexer keywords change');
  for (const [scope, words] of Object.entries(groups)) {
    for (const word of words) {
      assertScope(word, word, scope);
      assertPlainIdentifier(`${word}_value`);
      assertPlainIdentifier(`my_${word}`);
    }
  }
  assertScope('_', '_', 'constant.language.wildcard');
  for (const word of ['_value', '__', '_1', 'fn1']) assertPlainIdentifier(word);
});

test('type names and Rust-only words remain ordinary identifiers, including fields', () => {
  const words = ['int', 'bool', 'string', 'void', 'never', 'Option', 'Result', 'Map', 'Set', 'pub', 'use', 'impl', 'mut', 'trait', 'self'];
  for (const word of words) {
    assertPlainIdentifier(word);
    for (const line of [`let ${word}: int = 1;`, `value.${word}`, `Fields { ${word}: 1 }`, `fn ${word}(): int { return 0; }`]) {
      assertScope(line, word, 'variable.other');
    }
  }
});

test('all lexer punctuation uses the longest token and a standard operator/punctuation scope', () => {
  const lexer = readFileSync(path.join(repoRoot, 'packages/asterc-self/lexer.aster'), 'utf8');
  const punctFunction = lexer.match(/fn is_punct\([\s\S]*?(?=\n\/\/)/)[0];
  const punct = [...punctFunction.matchAll(/"([^"\n]+)"/g)].map((match) => match[1]);
  for (const value of punct) {
    const { tokens } = tokenize(value);
    assert.equal(tokens.length, 1, value);
    assert.equal(tokens[0].text, value);
    assert.ok(tokens[0].scopes.some((scope) => /^(keyword\.operator|punctuation\.)/.test(scope)), value);
  }
  for (const value of ['::', '=>', '?', '|', '..', '&&', '||', '+=', '-=', '*=', '/=', '%=']) assertScope(value, value, 'keyword.operator');
  assert.deepEqual(tokenize('0..10').tokens.map((token) => token.text), ['0', '..', '10']);
  assert.deepEqual(tokenize('x::Y(a)?!=b||c').tokens.map((token) => token.text), ['x', '::', 'Y', '(', 'a', ')', '?', '!=', 'b', '||', 'c']);
});

test('only decimal digits form numbers; minus, decimal point and suffixes stay separate', () => {
  for (const value of ['0', '123', '0007', '9223372036854775808']) assertScope(value, value, 'constant.numeric.integer');
  for (const [line, expected] of [
    ['-42', ['-', '42']], ['1.5', ['1', '.', '5']], ['0xFF', ['0', 'xFF']],
    ['12_345', ['12', '_345']], ['1e10', ['1', 'e10']], ['123let', ['123', 'let']],
  ]) assert.deepEqual(tokenize(line).tokens.map((token) => token.text), expected);
  assertScope('0xFF', 'xFF', 'variable.other');
  assertScope('1e10', 'e10', 'variable.other');
});

test('comments have priority and do not leak into the next line; block comments are unsupported', () => {
  const comment = '// "unterminated \' fn 42';
  assertScope(comment, comment, 'comment.line.double-slash');
  assertScope('"// text"', '//', 'string.quoted.double');
  const { tokens } = tokenize('/* fn */');
  assert.ok(tokens.every((token) => !token.scopes.some((scope) => scope.startsWith('comment.'))));
  assertScope('/* fn */', 'fn', 'storage.type');
});

test('strings and ASCII characters accept exactly the lexer escape set', () => {
  for (const escape of ['\\n', '\\t', '\\r', '\\\\', '\\"', "\\'", '\\0']) {
    assertScope(`"${escape}"`, escape, 'constant.character.escape');
    assertScope(`'${escape}'`, escape, 'constant.character.escape');
    for (const literal of [`"${escape}"`, `'${escape}'`]) {
      assert.ok(tokenize(literal).tokens.every((token) => !token.scopes.some((scope) => scope.startsWith('invalid.'))), literal);
    }
  }
  for (const char of ['a', ' ', '0', '/', '"', '~', '[', ']']) assertScope(`'${char}'`, char, 'string.quoted.single');
  assertScope('"héllo 😀"', 'héllo 😀', 'string.quoted.double');
  for (const escape of ['\\q', '\\u', '\\x', '\\é']) {
    assertScope(`"${escape}"`, escape, 'invalid.illegal.escape');
    assertScope(`'${escape}'`, escape, 'invalid.illegal.escape');
  }
  for (const body of ['ab', 'é', '😀', '\t']) assertScope(`'${body}'`, body, 'invalid.illegal.character');
  assertScope(String.raw`"a\"//b" + 2`, '//b', 'string.quoted.double');
  assertScope(String.raw`"a\"//b" + 2`, '+', 'keyword.operator');
  assertScope(String.raw`'\'' + 2`, '+', 'keyword.operator');
});

test('unterminated edits, escaped closing quotes and CRLF recover on the next line', () => {
  const next = 'let recovered: int = 42; // recovered';
  const baseline = tokenize(next).tokens;
  for (const broken of ['"', '"text', '"text\\', "'", "'a", "'abc\\", "''", "'ab'", '// "', '"text\r', "'a\r", String.raw`"escaped\"`, String.raw`'\'`, "'\\é'"]) {
    const first = tokenize(broken);
    assert.deepEqual(tokenize(next, first.state).tokens, baseline, JSON.stringify(broken));
  }
  // Simulate line replacement during an edit while preserving the previous line's state.
  const prefix = tokenize('fn main(): int {').state;
  const complete = tokenize('let s: string = "ok";', prefix);
  const incomplete = tokenize('let s: string = "ok', prefix);
  assert.deepEqual(tokenize(next, complete.state).tokens, tokenize(next, incomplete.state).tokens);
});

test('nested constructs and unmatched brackets do not suppress lexical scopes', () => {
  const fixture = read('test/fixtures/nested.aster');
  const lines = fixture.split(/\r?\n/);
  let state = INITIAL;
  for (const line of lines) state = tokenize(line, state).state;
  const fields = lines.find((line) => line.startsWith('struct Fields'));
  assertScope(fields, 'int', 'variable.other');
  assertScope(fields, 'Map', 'variable.other');
  const type = 'Result[Map[string, Option[[int]]], string]';
  for (const word of ['Result', 'Map', 'string', 'Option', 'int']) assertScope(type, word, 'variable.other');
  const dangling = tokenize('fn main(x: Option[Map[string, [int').state;
  assertScope('return match xs[0]? { _ => 1 };', 'return', 'keyword.control');
  assert.deepEqual(tokenize('let next: int = 1;', dangling).tokens, tokenize('let next: int = 1;').tokens);
});

function asterFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? asterFiles(file) : entry.name.endsWith('.aster') ? [file] : [];
  });
}

test('compiler and representative program/error corpus tokenize without leaked line state', (context) => {
  const files = ['packages/asterc-self', 'tests/programs'].flatMap((dir) => asterFiles(path.join(repoRoot, dir)));
  assert.ok(files.length > 200);
  let lines = 0;
  const sentinel = 'let sentinel: int = 123;';
  const baseline = tokenize(sentinel).tokens;
  for (const file of files) {
    let state = INITIAL;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const result = tokenize(line, state);
      state = result.state;
      assert.deepEqual(tokenize(sentinel, state).tokens, baseline, `${path.relative(repoRoot, file)} line ${lines + 1}`);
      for (const token of result.tokens) {
        assert.equal(token.scopes[0], 'source.aster');
        assert.ok(token.end > token.start);
      }
      lines++;
    }
  }
  context.diagnostic(`Tokenized ${files.length} Aster files (${lines} lines), with recovery checked after every line.`);
});

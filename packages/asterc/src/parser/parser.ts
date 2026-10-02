import type { BinaryOp, Block, Expr, FnDecl, IfExpr, IfStmt, Param, Program, Stmt, TypeRef } from '../ast/ast.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { Span } from '../diagnostics/source.js';
import type { Token, TokenKind } from '../lexer/token.js';

const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;

/** Thrown after a syntax error has been reported, to unwind to the nearest recovery point. */
const SYNC = Symbol('sync');

interface Level {
  ops: readonly TokenKind[];
  chainable: boolean;
}

/** Binary operator levels, loosest first. */
const LEVELS: readonly Level[] = [
  { ops: ['||'], chainable: true },
  { ops: ['&&'], chainable: true },
  { ops: ['==', '!='], chainable: false },
  { ops: ['<', '<=', '>', '>='], chainable: false },
  { ops: ['+', '-'], chainable: true },
  { ops: ['*', '/', '%'], chainable: true },
];

export interface ParseResult {
  program: Program;
  diagnostics: Diagnostic[];
}

const join = (from: Span, to: Span): Span => ({ start: from.start, end: to.end });

/** How a token is named in error messages. */
function describe(t: Token): string {
  switch (t.kind) {
    case 'eof':
      return 'end of file';
    case 'ident':
      return `identifier '${t.text}'`;
    case 'int':
      return `integer '${t.text}'`;
    case 'string':
      return 'string literal';
    default:
      return `'${t.text}'`;
  }
}

export function parse(tokens: readonly Token[]): ParseResult {
  const diagnostics: Diagnostic[] = [];
  let pos = 0;

  const peek = (offset = 0): Token => tokens[Math.min(pos + offset, tokens.length - 1)];
  const previous = (): Token => tokens[Math.max(pos - 1, 0)];
  const at = (kind: TokenKind): boolean => peek().kind === kind;
  const advance = (): Token => {
    const t = peek();
    if (t.kind !== 'eof') pos++;
    return t;
  };
  const eat = (kind: TokenKind): Token | null => (at(kind) ? advance() : null);

  function fail(message: string, where: Span): never {
    diagnostics.push({ message, span: where });
    throw SYNC;
  }

  function expect(kind: TokenKind): Token {
    if (at(kind)) return advance();
    const what = kind === 'ident' ? 'identifier' : `'${kind}'`;
    return fail(`expected ${what}, found ${describe(peek())}`, peek().span);
  }

  function checkIntRange(value: bigint, where: Span): void {
    if (value < INT_MIN || value > INT_MAX) diagnostics.push({ message: 'integer literal out of range', span: where });
  }

  // ---- declarations

  function parseProgram(): Program {
    const functions: FnDecl[] = [];
    while (!at('eof')) {
      if (!at('fn')) {
        diagnostics.push({ message: `expected 'fn', found ${describe(peek())}`, span: peek().span });
        syncToFn();
        continue;
      }
      try {
        functions.push(parseFunction());
      } catch (e) {
        if (e !== SYNC) throw e;
        syncToFn();
      }
    }
    return { functions };
  }

  /** Skips to the next `fn` or EOF. Consumes at least one token unless already at `fn`. */
  function syncToFn(): void {
    if (!at('fn')) advance();
    while (!at('fn') && !at('eof')) advance();
  }

  function parseFunction(): FnDecl {
    const fnTok = expect('fn');
    const name = expect('ident');
    expect('(');
    const params: Param[] = [];
    if (!at(')')) {
      do {
        const paramName = expect('ident');
        expect(':');
        params.push({ name: paramName.text, nameSpan: paramName.span, type: parseType() });
      } while (eat(','));
    }
    expect(')');
    const returnType = eat(':') ? parseType() : null;
    const body = parseBlock();
    return { kind: 'fn', name: name.text, nameSpan: name.span, params, returnType, body, span: join(fnTok.span, body.span) };
  }

  function parseType(): TypeRef {
    const t = expect('ident');
    return { name: t.text, span: t.span };
  }

  // ---- statements

  function parseBlock(): Block {
    const open = expect('{');
    const statements: Stmt[] = [];
    while (!at('}') && !at('eof') && !at('fn')) {
      try {
        statements.push(parseStatement());
      } catch (e) {
        if (e !== SYNC) throw e;
        syncStatement();
      }
    }
    const close = expect('}');
    return { kind: 'block', statements, span: join(open.span, close.span) };
  }

  /** Skips past the next `;`, or up to (not past) a `}`, `fn` or EOF. */
  function syncStatement(): void {
    while (!at('eof') && !at('}') && !at('fn')) {
      if (advance().kind === ';') return;
    }
  }

  function parseStatement(): Stmt {
    const t = peek();
    switch (t.kind) {
      case 'let':
      case 'var': {
        advance();
        const name = expect('ident');
        expect(':');
        const type = parseType();
        expect('=');
        const init = parseExpr();
        const semi = expect(';');
        return {
          kind: 'let',
          mutable: t.kind === 'var',
          name: name.text,
          nameSpan: name.span,
          type,
          init,
          span: join(t.span, semi.span),
        };
      }
      case 'if':
        return parseIfStmt();
      case 'while': {
        advance();
        const cond = parseExpr();
        const body = parseBlock();
        return { kind: 'while', cond, body, span: join(t.span, body.span) };
      }
      case 'break':
      case 'continue': {
        advance();
        const semi = expect(';');
        const span = join(t.span, semi.span);
        return t.kind === 'break' ? { kind: 'break', span } : { kind: 'continue', span };
      }
      case 'return': {
        advance();
        const value = at(';') ? null : parseExpr();
        const semi = expect(';');
        return { kind: 'return', value, span: join(t.span, semi.span) };
      }
      case '{':
        return parseBlock();
      default:
        return parseSimpleStatement();
    }
  }

  /** An assignment `x = e;` or an expression statement `e;`. */
  function parseSimpleStatement(): Stmt {
    const t = peek();
    if (t.kind === 'ident' && peek(1).kind === '=') {
      advance();
      advance();
      const value = parseExpr();
      const semi = expect(';');
      return { kind: 'assign', name: t.text, nameSpan: t.span, value, span: join(t.span, semi.span) };
    }
    const expr = parseExpr();
    const semi = expect(';');
    return { kind: 'expr', expr, span: join(expr.span, semi.span) };
  }

  function parseIfStmt(): IfStmt {
    const kw = expect('if');
    const cond = parseExpr();
    const then = parseBlock();
    let elseBranch: Block | IfStmt | null = null;
    if (eat('else')) elseBranch = at('if') ? parseIfStmt() : parseBlock();
    return { kind: 'if', cond, then, else: elseBranch, span: join(kw.span, (elseBranch ?? then).span) };
  }

  // ---- expressions

  function parseExpr(): Expr {
    return parseBinary(0);
  }

  function parseBinary(level: number): Expr {
    if (level === LEVELS.length) return parseUnary();
    const { ops, chainable } = LEVELS[level];
    let left = parseBinary(level + 1);
    while (ops.includes(peek().kind)) {
      const op = advance().kind as BinaryOp;
      const right = parseBinary(level + 1);
      left = { kind: 'binary', op, left, right, span: join(left.span, right.span) };
      if (!chainable && ops.includes(peek().kind)) fail('comparison operators cannot be chained', peek().span);
    }
    return left;
  }

  function parseUnary(): Expr {
    const t = peek();
    if (t.kind !== '-' && t.kind !== '!') return parsePostfix();
    advance();
    if (t.kind === '-' && at('int')) {
      // Folding here is what lets -9223372036854775808 be written as a literal.
      const literal = advance();
      const value = -(literal.intValue as bigint);
      const span = join(t.span, literal.span);
      checkIntRange(value, span);
      return { kind: 'int', value, span };
    }
    const operand = parseUnary();
    return { kind: 'unary', op: t.kind, operand, span: join(t.span, operand.span) };
  }

  function parsePostfix(): Expr {
    let expr = parsePrimary();
    while (at('(')) {
      advance();
      const args: Expr[] = [];
      if (!at(')')) {
        do args.push(parseExpr());
        while (eat(','));
      }
      const close = expect(')');
      expr = { kind: 'call', callee: expr, args, span: join(expr.span, close.span) };
    }
    return expr;
  }

  function parsePrimary(): Expr {
    const t = peek();
    switch (t.kind) {
      case 'int': {
        advance();
        const value = t.intValue as bigint;
        checkIntRange(value, t.span);
        return { kind: 'int', value, span: t.span };
      }
      case 'string':
        advance();
        return { kind: 'string', value: t.stringValue as string, span: t.span };
      case 'true':
      case 'false':
        advance();
        return { kind: 'bool', value: t.kind === 'true', span: t.span };
      case 'ident':
        advance();
        return { kind: 'name', name: t.text, span: t.span };
      case '(': {
        advance();
        const inner = parseExpr();
        expect(')');
        return inner;
      }
      case 'if':
        return parseIfExpr();
      default:
        return fail(`expected expression, found ${describe(t)}`, t.span);
    }
  }

  function parseIfExpr(): IfExpr {
    const kw = expect('if');
    const cond = parseExpr();
    const then = parseExprBlock();
    if (!at('else')) fail('if expression requires an else branch', peek().span);
    advance();
    const elseBranch = at('if') ? parseIfExpr() : parseExprBlock();
    return { kind: 'ifExpr', cond, then, else: elseBranch, span: join(kw.span, previous().span) };
  }

  function parseExprBlock(): Expr {
    expect('{');
    const e = parseExpr();
    expect('}');
    return e;
  }

  const program = parseProgram();
  return { program, diagnostics };
}

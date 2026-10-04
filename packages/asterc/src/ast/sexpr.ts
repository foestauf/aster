import type { Expr, Pattern } from './ast.js';

/** Renders an expression as a compact s-expression, e.g. `(+ 1 (* 2 3))`. */
export function sexpr(e: Expr): string {
  switch (e.kind) {
    case 'int':
      return e.value.toString();
    case 'char':
      return e.raw;
    case 'string':
      return JSON.stringify(e.value);
    case 'bool':
      return String(e.value);
    case 'name':
      return e.name;
    case 'unary':
      return `(${e.op} ${sexpr(e.operand)})`;
    case 'binary':
      return `(${e.op} ${sexpr(e.left)} ${sexpr(e.right)})`;
    case 'call':
      return `(call ${[e.callee, ...e.args].map(sexpr).join(' ')})`;
    case 'matchExpr':
      return `(match ${[sexpr(e.scrutinee), ...e.arms.map((a) => `(${patternText(a.pattern)} ${a.body.kind === 'block' ? `(block ${a.body.statements.length})` : sexpr(a.body)})`)].join(' ')})`;
    case 'ifExpr':
      return `(if ${sexpr(e.cond)} ${sexpr(e.then)} ${sexpr(e.else)})`;
    case 'field':
      return `(. ${sexpr(e.object)} ${e.field})`;
    case 'try':
      return `(? ${sexpr(e.operand)})`;
    case 'index':
      return `(index ${sexpr(e.array)} ${sexpr(e.index)})`;
    case 'arrayLit':
      return `(${['array', ...e.elements.map(sexpr)].join(' ')})`;
    case 'variant': {
      const head = `${e.enumName}::${e.variant}`;
      return e.args.length === 0 ? head : `(${[head, ...e.args.map(sexpr)].join(' ')})`;
    }
    case 'structLit':
      return `(struct ${[e.name, ...e.fields.map((f) => `(${f.name} ${sexpr(f.value)})`)].join(' ')})`;
  }
}

/** Renders a pattern: `_`, `E::V`, `(E::V x _)` with binders, a literal by its source text, or `(| a b c)`. */
export function patternText(p: Pattern): string {
  switch (p.kind) {
    case 'wildcard':
      return '_';
    case 'or':
      return `(| ${p.alternatives.map(patternText).join(' ')})`;
    case 'variant': {
      const head = `${p.enumName}::${p.variant}`;
      return p.binders.length === 0 ? head : `(${[head, ...p.binders.map((b) => b?.name ?? '_')].join(' ')})`;
    }
    case 'intPat':
    case 'charPat':
    case 'stringPat':
      return p.raw;
    case 'boolPat':
      return String(p.value);
  }
}

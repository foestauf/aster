import type { Expr } from './ast.js';

/** Renders an expression as a compact s-expression, e.g. `(+ 1 (* 2 3))`. */
export function sexpr(e: Expr): string {
  switch (e.kind) {
    case 'int':
      return e.value.toString();
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
    case 'ifExpr':
      return `(if ${sexpr(e.cond)} ${sexpr(e.then)} ${sexpr(e.else)})`;
    case 'field':
      return `(. ${sexpr(e.object)} ${e.field})`;
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

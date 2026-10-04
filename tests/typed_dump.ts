import { typeToString, type TBlock, type TExpr, type TPattern, type TPlace, type TStmt, type Type, type TypedProgram } from '../packages/asterc/src/index.js';

/** A dump string value: `"…"` over the value's UTF-8 bytes (see the plan's escaping table). */
export function escapeDump(value: string): string {
  let out = '"';
  for (const b of Buffer.from(value, 'utf8')) {
    if (b === 0x22) out += '\\"';
    else if (b === 0x5c) out += '\\\\';
    else if (b === 0x0a) out += '\\n';
    else if (b === 0x09) out += '\\t';
    else if (b < 0x20 || b >= 0x7f) out += `\\x${b.toString(16).padStart(2, '0')}`;
    else out += String.fromCharCode(b);
  }
  return `${out}"`;
}

const t = (type: Type): string => typeToString(type);

const head = (word: string, parts: readonly string[]): string => [word, ...parts].join(' ');

/** The typed program in the canonical dump format shared with packages/asterc-self/typed_dump.aster. */
export function dumpTyped(program: TypedProgram): string {
  const lines: string[] = [];
  const put = (depth: number, text: string): void => {
    lines.push(`${'  '.repeat(depth)}${text}`);
  };

  function block(d: number, b: TBlock): void {
    put(d, 'block');
    for (const s of b.statements) stmt(d + 1, s);
  }

  function arm(d: number, pattern: TPattern, body: TExpr | TBlock): void {
    put(d, 'arm');
    pat(d + 1, pattern);
    if ('statements' in body) block(d + 1, body);
    else expr(d + 1, body);
  }

  function pat(d: number, p: TPattern): void {
    switch (p.kind) {
      case 'wildcard':
        return put(d, 'wildcard');
      case 'variants':
        put(d, head('variants', p.variants.map((v) => `${v.name}/${v.tag}`)));
        if (p.binders.length > 0) put(d, head('binders', p.binders.map((b) => (b === null ? '_' : String(b.id)))));
        return;
      case 'ints':
        return put(d, head('ints', p.values.map(String)));
      case 'strings':
        return put(d, head('strings', p.values.map(escapeDump)));
    }
  }

  function place(d: number, p: TPlace): void {
    switch (p.kind) {
      case 'local':
        return put(d, `place-local ${p.local.id} ${p.local.name} : ${t(p.type)}`);
      case 'field':
        put(d, `place-field .${p.field} : ${t(p.type)}`);
        return expr(d + 1, p.object);
      case 'index':
        put(d, `place-index : ${t(p.type)}`);
        expr(d + 1, p.array);
        return expr(d + 1, p.index);
    }
  }

  function stmt(d: number, s: TStmt): void {
    switch (s.kind) {
      case 'let':
        put(d, `let ${s.local.id}`);
        return expr(d + 1, s.init);
      case 'assign':
        put(d, `assign ${s.op}`);
        place(d + 1, s.place);
        return expr(d + 1, s.value);
      case 'if':
        put(d, 'if');
        expr(d + 1, s.cond);
        block(d + 1, s.then);
        if (s.else === null) put(d + 1, 'none');
        else block(d + 1, s.else);
        return;
      case 'while':
        put(d, 'while');
        expr(d + 1, s.cond);
        return block(d + 1, s.body);
      case 'forRange':
        put(d, `for-range ${s.local.id}`);
        expr(d + 1, s.start);
        expr(d + 1, s.end);
        return block(d + 1, s.body);
      case 'forEach':
        put(d, `for-each ${s.local.id}`);
        expr(d + 1, s.array);
        return block(d + 1, s.body);
      case 'break':
      case 'continue':
        return put(d, s.kind);
      case 'return':
        put(d, 'return');
        if (s.value === null) put(d + 1, 'none');
        else expr(d + 1, s.value);
        return;
      case 'match':
        put(d, 'match');
        expr(d + 1, s.scrutinee);
        for (const a of s.arms) arm(d + 1, a.pattern, a.body);
        return;
      case 'block':
        return block(d, s);
      case 'expr':
        put(d, 'expr');
        return expr(d + 1, s.expr);
    }
  }

  function expr(d: number, e: TExpr): void {
    const at = (text: string): void => put(d, `${text} : ${t(e.type)}`);
    const kids = (es: readonly TExpr[]): void => {
      for (const c of es) expr(d + 1, c);
    };
    switch (e.kind) {
      case 'int':
        return at(`int ${e.value}`);
      case 'string':
        return at(`str ${escapeDump(e.value)}`);
      case 'bool':
        return at(`bool ${e.value}`);
      case 'local':
        return at(`local ${e.local.id} ${e.local.name}`);
      case 'unary':
        at(`unary ${e.op}`);
        return kids([e.operand]);
      case 'binary':
        at(`binary ${e.op}`);
        return kids([e.left, e.right]);
      case 'call':
        at(`call ${e.fn}`);
        return kids(e.args);
      case 'builtin':
        at(`builtin ${e.builtin}`);
        return kids(e.args);
      case 'if':
        at('if');
        return kids([e.cond, e.then, e.else]);
      case 'field':
        at(`field .${e.field}`);
        return kids([e.object]);
      case 'index':
        at('index');
        return kids([e.array, e.index]);
      case 'arrayLit':
        at('array');
        return kids(e.elements);
      case 'structLit':
        at(`struct-lit ${e.struct}`);
        for (const f of e.fields) {
          put(d + 1, `init ${f.field}`);
          expr(d + 2, f.value);
        }
        return;
      case 'variant':
        at(`variant ${e.enum} ${e.variant} ${e.tag}`);
        return kids(e.args);
      case 'enumCompare':
        at(`enum-compare ${e.op}`);
        return kids([e.left, e.right]);
      case 'match':
        at('match');
        expr(d + 1, e.scrutinee);
        for (const a of e.arms) arm(d + 1, a.pattern, a.body);
        return;
      case 'try':
        at(`try ${e.okVariant}/${e.okTag} ${e.failVariant}/${e.failTag} -> ${e.returnEnum} ${e.returnFailVariant}/${e.returnFailTag}`);
        put(d + 1, `return-type ${t(e.returnType)}`);
        if (e.failPayloadType !== null) put(d + 1, `fail-payload ${t(e.failPayloadType)}`);
        return expr(d + 1, e.operand);
    }
  }

  for (const s of program.structs) {
    put(0, `struct ${s.name}`);
    for (const f of s.fields) put(1, `field ${f.name} ${t(f.type)}`);
  }
  for (const e of program.enums) {
    put(0, `enum ${e.name}`);
    for (const v of e.variants) put(1, head(`variant ${v.name}`, v.payload.map(t)));
  }
  for (const f of program.functions) {
    put(0, `fn ${f.name} ${t(f.returnType)}`);
    for (const l of f.locals) {
      const kind = l.id < f.params.length ? 'param' : l.mutable ? 'var' : 'let';
      put(1, `local ${l.id} ${l.name} ${t(l.type)} ${kind}`);
    }
    put(1, 'body');
    for (const s of f.body.statements) stmt(2, s);
  }
  return lines.map((l) => `${l}\n`).join('');
}

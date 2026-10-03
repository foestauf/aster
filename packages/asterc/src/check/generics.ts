import type { EnumDecl, TypeExpr } from '../ast/ast.js';

/** A generic enum, kept as written until an instantiation names it. */
export interface Template {
  decl: EnumDecl;
  params: string[];
  /** Set when the declaration was rejected (it expands infinitely); a broken template resolves to the error type. */
  broken: boolean;
  /** Set when validating the declaration reported a diagnostic; uses then stay quiet instead of cascading. */
  hasErrors: boolean;
}

/** True when the type parameter `param` occurs anywhere in `ref`. */
export function mentionsParam(ref: TypeExpr, param: string): boolean {
  if (ref.kind === 'array') return mentionsParam(ref.elem, param);
  return ref.name === param || ref.args.some((arg) => mentionsParam(arg, param));
}

interface Edge {
  from: string;
  to: string;
  expanding: boolean;
}

const nodeKey = (enumName: string, param: string): string => `${enumName}\0${param}`;

/**
 * The generic enums that would need infinitely many instantiations (spec §3.3), in declaration order. Nodes are
 * (enum, parameter) pairs; passing an argument that mentions parameter P of E to parameter Q of F adds the edge
 * (E, P) → (F, Q), which is expanding unless the argument is exactly P. An enum expands infinitely when one of its
 * nodes lies on a cycle through an expanding edge, which is when its strongly connected component contains one.
 */
export function findExpandingEnums(templates: ReadonlyMap<string, Template>): Set<string> {
  const edges: Edge[] = [];
  for (const template of templates.values()) {
    const walk = (ref: TypeExpr): void => {
      if (ref.kind === 'array') {
        walk(ref.elem);
        return;
      }
      // A type parameter that shadows a template's name is a parameter here, not a reference to the template.
      const target = template.params.includes(ref.name) ? undefined : templates.get(ref.name);
      if (target && target.params.length === ref.args.length) {
        ref.args.forEach((arg, i) => {
          for (const param of template.params) {
            if (!mentionsParam(arg, param)) continue;
            const exact = arg.kind === 'named' && arg.args.length === 0 && arg.name === param;
            edges.push({ from: nodeKey(template.decl.name, param), to: nodeKey(target.decl.name, target.params[i]), expanding: !exact });
          }
        });
      }
      ref.args.forEach(walk);
    };
    for (const variant of template.decl.variants) variant.payload.forEach(walk);
  }

  const component = stronglyConnectedComponents(edges);
  const expandingComponents = new Set<number>();
  for (const edge of edges) {
    const c = component.get(edge.from);
    if (edge.expanding && c !== undefined && c === component.get(edge.to)) expandingComponents.add(c);
  }
  const expanding = new Set<string>();
  for (const template of templates.values()) {
    const onCycle = template.params.some((param) => {
      const c = component.get(nodeKey(template.decl.name, param));
      return c !== undefined && expandingComponents.has(c);
    });
    if (onCycle) expanding.add(template.decl.name);
  }
  return expanding;
}

/** Tarjan's algorithm: maps every node that has an edge to the index of its strongly connected component. */
function stronglyConnectedComponents(edges: readonly Edge[]): Map<string, number> {
  const successors = new Map<string, string[]>();
  for (const { from, to } of edges) {
    successors.set(from, [...(successors.get(from) ?? []), to]);
    if (!successors.has(to)) successors.set(to, []);
  }
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const component = new Map<string, number>();
  let components = 0;

  const visit = (node: string): void => {
    index.set(node, index.size);
    lowLink.set(node, index.get(node) ?? 0);
    stack.push(node);
    onStack.add(node);
    for (const next of successors.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, lowLink.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, index.get(next) ?? 0));
      }
    }
    if (lowLink.get(node) !== index.get(node)) return;
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.set(member, components);
    } while (member !== node);
    components++;
  };

  for (const node of successors.keys()) if (!index.has(node)) visit(node);
  return component;
}

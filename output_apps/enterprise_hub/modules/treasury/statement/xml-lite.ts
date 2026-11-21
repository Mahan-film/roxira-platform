import { StatementParseError } from './statement.types';

/**
 * Minimal XML reader for bank statements. It builds an element tree with namespace prefixes
 * dropped, decodes the five predefined entities and numeric character references, and REFUSES any
 * DOCTYPE / ENTITY declaration (no external or user-defined entities: no XXE, no entity blow-up).
 */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
}

const MAX_DEPTH = 64;
const MAX_NODES = 500_000;

function decode(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

const local = (qname: string): string => qname.slice(qname.indexOf(':') + 1);

function attributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out[local(m[1])] = decode(m[2] ?? m[3] ?? '');
  return out;
}

export function parseXml(source: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new StatementParseError('XML with a DOCTYPE or ENTITY declaration is refused.');
  }
  const root: XmlNode = { name: '#document', attrs: {}, text: '', children: [] };
  const stack: XmlNode[] = [root];
  const tag =
    /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let index = 0;
  let nodes = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(source)) !== null) {
    const top = stack[stack.length - 1];
    if (match.index > index) top.text += decode(source.slice(index, match.index));
    index = tag.lastIndex;
    if (match[1] !== undefined) {
      top.text += match[1];
    } else if (match[2] !== undefined) {
      if (stack.length < 2 || top.name !== local(match[2])) {
        throw new StatementParseError(`Malformed XML: unexpected closing tag </${match[2]}>.`);
      }
      stack.pop();
    } else if (match[3] !== undefined) {
      if (++nodes > MAX_NODES) throw new StatementParseError('XML is too large.');
      const node: XmlNode = { name: local(match[3]), attrs: attributes(match[4] ?? ''), text: '', children: [] };
      top.children.push(node);
      if (match[5] !== '/') {
        if (stack.length > MAX_DEPTH) throw new StatementParseError('XML is nested too deeply.');
        stack.push(node);
      }
    }
  }
  if (stack.length !== 1) throw new StatementParseError('Malformed XML: unclosed element.');
  if (source.slice(index).trim() !== '') throw new StatementParseError('Malformed XML: trailing text.');
  return root;
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Text of the element reached by following `path`, trimmed; undefined when absent or empty. */
export function textAt(node: XmlNode | undefined, ...path: string[]): string | undefined {
  let cur = node;
  for (const name of path) cur = child(cur, name);
  const value = cur?.text.trim();
  return value ? value : undefined;
}

/** Descendants (any depth) with this name, document order. */
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

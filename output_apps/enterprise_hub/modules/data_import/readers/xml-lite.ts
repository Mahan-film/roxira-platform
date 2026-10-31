/**
 * تجزیه‌گر کوچک و امن XML برای ODS/XML/OFX‌ ۲.
 *
 * عمداً: بدون DTD و بدون گسترش موجودیت (ضد XXE و billion-laughs)، عمق و تعداد گره کران‌دار،
 * پیشوند فضای‌نام حذف می‌شود. فقط پنج موجودیت استاندارد و ارجاع عددی گسترش می‌یابند.
 */

import { READER_LIMITS } from './limits';
import { ReaderError } from './reader.types';

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) {
    return value;
  }
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return '';
      }
      return String.fromCodePoint(code);
    }
    return NAMED[body] ?? whole;
  });
}

function stripPrefix(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

const XML_ERROR = 'فایل XML معتبر نیست یا آسیب‌دیده است.';

export function parseXml(input: string): XmlNode {
  const text = input.replace(/^﻿/, '');
  if (/<!DOCTYPE[^>]*\[|<!ENTITY/i.test(text.slice(0, 200_000))) {
    throw new ReaderError(
      'این فایل XML شامل تعریف DTD/ENTITY است که به‌دلایل امنیتی پردازش نمی‌شود.',
    );
  }
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let nodes = 0;
  let pos = 0;
  const length = text.length;

  while (pos < length) {
    const lt = text.indexOf('<', pos);
    const current = stack[stack.length - 1];
    if (lt === -1) {
      current.text += decodeXmlEntities(text.slice(pos));
      break;
    }
    if (lt > pos) {
      current.text += decodeXmlEntities(text.slice(pos, lt));
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) throw new ReaderError(XML_ERROR);
      pos = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1) throw new ReaderError(XML_ERROR);
      current.text += text.slice(lt + 9, end);
      pos = end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) throw new ReaderError(XML_ERROR);
      pos = end + 2;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt + 2);
      if (end === -1) throw new ReaderError(XML_ERROR);
      pos = end + 1;
      continue;
    }
    const gt = findTagEnd(text, lt + 1);
    if (gt === -1) throw new ReaderError(XML_ERROR);
    const body = text.slice(lt + 1, gt);
    pos = gt + 1;
    if (body.startsWith('/')) {
      if (stack.length <= 1) throw new ReaderError(XML_ERROR);
      stack.pop();
      continue;
    }
    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const nameMatch = /^([^\s/>]+)/.exec(inner);
    if (!nameMatch) throw new ReaderError(XML_ERROR);
    nodes += 1;
    if (nodes > READER_LIMITS.maxXmlNodes) {
      throw new ReaderError('تعداد گره‌های XML بیش از سقف مجاز است.');
    }
    const node: XmlNode = {
      name: stripPrefix(nameMatch[1]),
      attrs: parseAttrs(inner.slice(nameMatch[0].length)),
      children: [],
      text: '',
    };
    current.children.push(node);
    if (!selfClosing) {
      stack.push(node);
      if (stack.length > READER_LIMITS.maxXmlDepth) {
        throw new ReaderError('عمق تودرتوی XML بیش از سقف مجاز است.');
      }
    }
  }
  if (stack.length !== 1) {
    throw new ReaderError(XML_ERROR);
  }
  const first = root.children[0];
  if (!first) {
    throw new ReaderError(XML_ERROR);
  }
  return first;
}

function findTagEnd(text: string, from: number): number {
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = pattern.exec(source)) !== null) {
    count += 1;
    if (count > 256) break;
    attrs[stripPrefix(match[1])] = decodeXmlEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

export function firstNamed(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((child) => child.name === name);
}

import { ImportFileError } from './types';

export interface XmlHandler {
  open(name: string, attrs: Record<string, string>, selfClosing: boolean): void;
  close(name: string): void;
  text(text: string): void;
}

const ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * A small incremental XML tokenizer for OOXML parts. It never builds a tree, keeps only the unfinished
 * tag between chunks, refuses DOCTYPE/ENTITY declarations (XXE and billion-laughs) and decodes only the
 * five predefined entities plus numeric references.
 */
export class XmlScanner {
  private carry = '';

  constructor(private readonly handler: XmlHandler, private readonly wantText: () => boolean) {}

  write(text: string): void {
    let buf = this.carry + text;
    this.carry = '';
    let pos = 0;
    const n = buf.length;
    while (pos < n) {
      const lt = buf.indexOf('<', pos);
      if (lt === -1) {
        if (this.wantText()) this.handler.text(decodeEntities(buf.slice(pos)));
        pos = n;
        break;
      }
      if (lt > pos && this.wantText()) this.handler.text(decodeEntities(buf.slice(pos, lt)));
      if (buf.startsWith('<![CDATA[', lt)) {
        const end = buf.indexOf(']]>', lt);
        if (end === -1) {
          this.carry = buf.slice(lt);
          pos = n;
          break;
        }
        if (this.wantText()) this.handler.text(buf.slice(lt + 9, end));
        pos = end + 3;
        continue;
      }
      if (buf.startsWith('<!--', lt)) {
        const end = buf.indexOf('-->', lt);
        if (end === -1) {
          this.carry = buf.slice(lt);
          pos = n;
          break;
        }
        pos = end + 3;
        continue;
      }
      const gt = buf.indexOf('>', lt);
      if (gt === -1) {
        if (n - lt > 1_000_000) throw new ImportFileError('ساختار XML فایل نامعتبر است.');
        this.carry = buf.slice(lt);
        pos = n;
        break;
      }
      const tag = buf.slice(lt + 1, gt);
      pos = gt + 1;
      const first = tag.charCodeAt(0);
      if (first === 33) {
        if (/^!(DOCTYPE|ENTITY)/i.test(tag)) {
          throw new ImportFileError('فایل شامل تعریف DTD/ENTITY است و به‌دلایل امنیتی رد شد.');
        }
        continue;
      }
      if (first === 63) continue; // processing instruction
      if (first === 47) {
        this.handler.close(localName(tag.slice(1).trim()));
        continue;
      }
      const selfClosing = tag.charCodeAt(tag.length - 1) === 47;
      const body = selfClosing ? tag.slice(0, -1) : tag;
      const space = body.search(/\s/);
      const name = localName(space === -1 ? body : body.slice(0, space));
      const attrs: Record<string, string> = {};
      if (space !== -1) {
        ATTR.lastIndex = 0;
        let m: RegExpExecArray | null;
        const attrText = body.slice(space);
        while ((m = ATTR.exec(attrText))) attrs[localName(m[1])] = decodeEntities(m[2] ?? m[3] ?? '');
      }
      this.handler.open(name, attrs, selfClosing);
      if (selfClosing) this.handler.close(name);
    }
    buf = '';
  }
}

function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

export function decodeEntities(text: string): string {
  if (text.indexOf('&') === -1) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, ref: string) => {
    switch (ref) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default: {
        const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      }
    }
  });
}

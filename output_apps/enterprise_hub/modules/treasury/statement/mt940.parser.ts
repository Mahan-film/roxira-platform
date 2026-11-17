import { createHash } from 'crypto';
import { MoneyFormatError, parseMinor } from '../../accounting/money';
import { ParsedStatement, ParsedStatementLine, StatementParseError } from './statement.types';

interface Field {
  tag: string;
  value: string;
}

const TAG_LINE = /^:(\d{2}[A-Z]?):(.*)$/;

/** Splits the message into `:tag:value` fields; continuation lines belong to the previous field. */
function fields(text: string): Field[] {
  const out: Field[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line === '-' || line.startsWith('{') || line.startsWith('}')) continue;
    const m = TAG_LINE.exec(line);
    if (m) out.push({ tag: m[1], value: m[2] });
    else if (out.length > 0 && line !== '') out[out.length - 1].value += `\n${line}`;
  }
  return out;
}

function fullYear(yy: number): number {
  return yy < 80 ? 2000 + yy : 1900 + yy;
}

function isoDate(yyyy: number, mm: number, dd: number, what: string): string {
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) {
    throw new StatementParseError(`${what}: invalid date ${yyyy}-${mm}-${dd}.`);
  }
  return d.toISOString().slice(0, 10);
}

function minorOf(raw: string, what: string): bigint {
  try {
    return parseMinor(raw.replace(',', '.').replace(/\.$/, ''));
  } catch (e) {
    if (e instanceof MoneyFormatError) throw new StatementParseError(`${what}: ${e.message}`);
    throw e;
  }
}

const STATEMENT_61 =
  /^(\d{2})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?(RC|RD|C|D)([A-Z])?(\d+(?:,\d{0,3})?)(?:[A-Z][A-Z0-9]{3})([^\n]*?)(?:\/\/([^\n]*))?(?:\n([\s\S]*))?$/;

/** `?20...?21...` German structured subfields: text for matching, plus the name subfields. */
function details(raw: string): { text: string; party: string | null } {
  const flat = raw.replace(/\n/g, '');
  if (!/\?\d{2}/.test(flat)) return { text: raw.replace(/\n/g, ' ').trim(), party: null };
  const subs = new Map<string, string>();
  for (const part of flat.split('?').slice(1)) subs.set(part.slice(0, 2), (subs.get(part.slice(0, 2)) ?? '') + part.slice(2));
  const text = [...subs.entries()]
    .filter(([k]) => (k >= '20' && k <= '29') || k === '60' || k === '61' || k === '62' || k === '63')
    .map(([, v]) => v.trim())
    .filter(Boolean)
    .join(' ');
  const party = [subs.get('32'), subs.get('33')].filter(Boolean).join(' ').trim();
  return { text: text || flat.replace(/\?\d{2}/g, ' ').trim(), party: party || null };
}

const synthetic = (...parts: string[]): string =>
  `syn-${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24)}`;

/**
 * MT940 customer statement: `:20:` reference, `:25:` account, `:28C:` statement number, `:60F:`
 * opening balance, repeating `:61:` (statement line) + `:86:` (information to account owner),
 * `:62F:` closing balance. The bank transaction id is the bank reference after `//` in `:61:`; when
 * the bank leaves it out, a stable hash of account, dates, amount and reference is used (the
 * statement number is NOT part of it, so a transaction repeated in an overlapping statement is
 * still recognised). Several statements in one file are read in order.
 */
export function parseMt940(text: string): ParsedStatement {
  const all = fields(text);
  if (!all.some((f) => f.tag === '61')) throw new StatementParseError('Not an MT940 file: no :61: statement line.');

  const lines: ParsedStatementLine[] = [];
  const seen = new Map<string, number>();
  let statementId: string | null = null;
  let accountRef: string | null = null;
  let currency: string | null = null;
  let account = '';
  let ccy: string | null = null;

  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    if (f.tag === '20') {
      statementId ??= f.value.trim() || null;
    } else if (f.tag === '25') {
      account = f.value.trim().replace(/\/[A-Z]{3}$/, '');
      accountRef ??= account || null;
    } else if (f.tag === '60F' || f.tag === '60M') {
      const m = /^([CD])(\d{6})([A-Z]{3})/.exec(f.value.trim());
      if (m) {
        ccy = m[3];
        currency ??= ccy;
      }
    } else if (f.tag === '61') {
      const m = STATEMENT_61.exec(f.value.trim());
      if (!m) throw new StatementParseError(`Invalid :61: line: ${f.value.split('\n')[0]}`);
      const [, yy, vm, vd, em, ed, mark, , amountRaw, customerRef, bankRef, supplementary] = m;
      const valueYear = fullYear(Number(yy));
      const valueDate = isoDate(valueYear, Number(vm), Number(vd), ':61: value date');
      let bookingDate = valueDate;
      if (em && ed) {
        // the entry date has no year: take the year that puts it closest to the value date
        const candidates = [valueYear - 1, valueYear, valueYear + 1].map((y) => isoDate(y, Number(em), Number(ed), ':61: entry date'));
        const base = Date.parse(valueDate);
        bookingDate = candidates.sort((a, b) => Math.abs(Date.parse(a) - base) - Math.abs(Date.parse(b) - base))[0];
      }
      const amountMinor = minorOf(amountRaw, ':61: amount');
      if (amountMinor <= 0n) throw new StatementParseError(':61: amount must be positive.');
      const credit = mark === 'C' || mark === 'RD';

      // the :86: that follows (before the next :61:) describes this line
      let info = '';
      for (let j = i + 1; j < all.length && all[j].tag !== '61'; j++) {
        if (all[j].tag === '86') {
          info = all[j].value;
          break;
        }
      }
      const detail = details([supplementary?.trim(), info].filter(Boolean).join(' '));
      const cust = customerRef.trim();
      const reference = [cust && cust !== 'NONREF' ? cust : '', detail.text].filter(Boolean).join(' ');

      let id = bankRef?.trim() || '';
      if (!id) {
        id = synthetic(account, valueDate, bookingDate, mark, amountMinor.toString(), cust, detail.text);
      }
      if (id.length > 128) id = synthetic(id);
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      if (n > 0) id = `${id}#${n + 1}`;

      lines.push({
        bankTxnId: id,
        bookingDate,
        valueDate,
        amountMinor,
        direction: credit ? 'credit' : 'debit',
        currency: ccy,
        reference,
        counterparty: detail.party,
      });
    }
  }
  return { format: 'mt940', statementId, accountRef, currency, lines };
}

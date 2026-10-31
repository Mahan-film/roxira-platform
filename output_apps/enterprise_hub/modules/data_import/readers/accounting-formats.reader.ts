/**
 * قالب‌های حسابداری با مشخصات عمومی: QuickBooks IIF و OFX/QBO (صورت‌حساب بانکی).
 * ساختار هر دو در مشخصات رسمی تعریف شده است؛ بنابراین نگاشت پیشنهادی (hint) قطعی است.
 */

import { InMemoryTableReader } from '../parsers/package-source.types';
import { rowLimit } from './limits';
import { decodeText } from './persian/text-decode';
import { FormatReader, ReaderError } from './reader.types';
import { buildTable, TableNotes, uniqueTableName } from './tabular';
import { headText, packageOf } from './text-formats.reader';

/* ----------------------------------- IIF ---------------------------------- */

/** MM/DD/YY(YY) آمریکایی در IIF → ISO. */
export function iifDate(raw: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw.trim());
  if (!m) return raw.trim();
  const year = m[3].length === 2 ? (Number(m[3]) >= 70 ? 1900 : 2000) + Number(m[3]) : Number(m[3]);
  return `${String(year).padStart(4, '0')}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function iifAmount(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return raw.trim() !== '' && Number.isFinite(n) ? n : null;
}

export const iifReader: FormatReader = {
  id: 'iif',
  labelFa: 'QuickBooks IIF',
  extensions: ['.iif'],
  detect(buffer) {
    const head = headText(buffer, 4096);
    return /^!(HDR|ACCNT|TRNS|CUST|VEND|SPL)\t/m.test(head) ? 0.95 : 0;
  },
  read(buffer) {
    const decoded = decodeText(buffer);
    const lines = decoded.text.split(/\r?\n/);
    if (lines.length > rowLimit() * 3) throw new ReaderError(`حداکثر ${rowLimit()} ردیف در هر بسته مجاز است.`);
    const headers = new Map<string, string[]>();
    const rowsByType = new Map<string, string[][]>();
    const journal: unknown[][] = [['Voucher No', 'Date', 'Account Code', 'Debit', 'Credit', 'Description', 'Name']];
    let voucher = 0;
    let block: Array<{ type: string; cells: Record<string, string> }> | null = null;
    const flush = (): void => {
      if (!block) return;
      voucher += 1;
      const trns = block[0];
      const id = trns?.cells.DOCNUM || trns?.cells.TRNSID || `IIF-${voucher}`;
      for (const part of block) {
        const amount = iifAmount(part.cells.AMOUNT ?? '');
        if (amount === null) continue;
        journal.push([
          id,
          iifDate(part.cells.DATE || trns?.cells.DATE || ''),
          part.cells.ACCNT ?? '',
          amount > 0 ? amount : '',
          amount < 0 ? -amount : '',
          part.cells.MEMO || trns?.cells.MEMO || '',
          part.cells.NAME || trns?.cells.NAME || '',
        ]);
      }
      block = null;
    };
    for (const line of lines) {
      if (!line.trim()) continue;
      const cells = line.split('\t');
      const tag = cells[0];
      if (tag.startsWith('!')) {
        const type = tag.slice(1).toUpperCase();
        if (type !== 'ENDTRNS') headers.set(type, cells.slice(1).map((c) => c.trim().toUpperCase()));
        continue;
      }
      const type = tag.toUpperCase();
      if (type === 'ENDTRNS') { flush(); continue; }
      const head = headers.get(type);
      if (!head) continue;
      const record: Record<string, string> = {};
      head.forEach((h, i) => { record[h] = (cells[i + 1] ?? '').trim(); });
      const list = rowsByType.get(type) ?? [];
      list.push(head.map((h) => record[h] ?? ''));
      rowsByType.set(type, list);
      if (type === 'TRNS') { flush(); block = [{ type, cells: record }]; }
      else if (type === 'SPL' && block) block.push({ type, cells: record });
    }
    flush();
    const notes = new TableNotes();
    const used = new Set<string>();
    const tables: Array<InMemoryTableReader | null> = [];
    for (const [type, rows] of rowsByType) {
      tables.push(buildTable(uniqueTableName(type, used), [headers.get(type) ?? [], ...rows], notes));
    }
    if (journal.length > 1) {
      tables.push(
        buildTable(uniqueTableName('JOURNAL', used), journal, notes, {
          hint: {
            entity: 'accounting-journal-lines',
            mapping: {
              'Voucher No': 'voucherNo',
              Date: 'date',
              'Account Code': 'accountCode',
              Debit: 'debitRial',
              Credit: 'creditRial',
              Description: 'description',
              Name: null,
            },
            reasonFa:
              'ساختار IIF در مشخصات QuickBooks تعریف شده است: هر TRNS با SPLهایش یک سند است؛ مبلغ مثبت بدهکار و منفی بستانکار.',
          },
        }),
      );
    }
    return packageOf('iif', tables, notes, [
      ...decoded.notes,
      'مبلغ‌های IIF به ارز منبع‌اند؛ پیش از ثبت، واحد پول را در پیش‌نمایش تأیید کنید.',
    ]);
  },
};

/* ------------------------------------ OFX ---------------------------------- */

export function ofxDate(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw.trim();
}

export const ofxReader: FormatReader = {
  id: 'ofx',
  labelFa: 'صورت‌حساب بانکی OFX / QBO',
  extensions: ['.ofx', '.qbo', '.qfx'],
  detect(buffer) {
    const head = headText(buffer, 4096);
    return /OFXHEADER\s*:/i.test(head) || /<OFX[\s>]/i.test(head) ? 0.95 : 0;
  },
  read(buffer) {
    const asciiHead = headText(buffer, 1024);
    const text = /CHARSET\s*:\s*1252|ENCODING\s*:\s*USASCII/i.test(asciiHead)
      ? buffer.toString('latin1')
      : decodeText(buffer).text;
    const rows: unknown[][] = [['Date', 'Description', 'Amount', 'Reference', 'Type']];
    const info: unknown[][] = [['Field', 'Value']];
    const firstTxn = text.search(/<STMTTRN>/i);
    const outside = firstTxn === -1 ? text : text.slice(0, firstTxn) + text.slice(text.search(/<\/BANKTRANLIST>/i) >= 0 ? text.search(/<\/BANKTRANLIST>/i) : text.length);
    const infoTags = /<(ACCTID|BANKID|CURDEF|BALAMT|DTASOF|ORG|DTSTART|DTEND)>([^<\r\n]*)/gi;
    let infoMatch: RegExpExecArray | null;
    while ((infoMatch = infoTags.exec(outside)) !== null) {
      info.push([infoMatch[1].toUpperCase(), infoMatch[2].trim()]);
    }
    // second pass: split into transactions robustly for both SGML (no closers) and XML
    const blocks = text.split(/<STMTTRN>/i).slice(1);
    for (const rawBlock of blocks) {
      const body = rawBlock.split(/<\/STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTRS>|<\/STMTRS>/i)[0];
      const field = (name: string): string => {
        const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(body);
        return m ? m[1].trim() : '';
      };
      const amount = Number(field('TRNAMT').replace(',', '.'));
      if (!Number.isFinite(amount)) continue;
      rows.push([
        ofxDate(field('DTPOSTED')),
        [field('NAME') || field('PAYEE'), field('MEMO')].filter(Boolean).join(' — '),
        amount,
        field('FITID') || field('CHECKNUM'),
        field('TRNTYPE'),
      ]);
      if (rows.length > rowLimit() + 1) throw new ReaderError(`حداکثر ${rowLimit()} ردیف در هر بسته مجاز است.`);
    }
    if (rows.length === 1) throw new ReaderError('هیچ تراکنشی (STMTTRN) در فایل OFX پیدا نشد.');
    const notes = new TableNotes();
    const tables = [
      buildTable('bank_transactions', rows, notes, {
        hint: {
          entity: 'bank-statement',
          mapping: { Date: 'date', Description: 'description', Amount: 'amount', Reference: 'reference', Type: null },
          reasonFa: 'ساختار OFX استاندارد است: مبلغ علامت‌دار (منفی = برداشت).',
        },
      }),
      info.length > 1 ? buildTable('account_info', info, notes) : null,
    ];
    return packageOf('ofx', tables, notes);
  },
};

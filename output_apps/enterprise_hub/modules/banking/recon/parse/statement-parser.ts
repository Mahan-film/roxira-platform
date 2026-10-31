import { createHash } from 'crypto';
import { parseCsv } from '../../../data_import/parsers/csv.parser';
import { sniffFileKind } from '../../../data_import/parsers/file-kind';
import { parsePdf } from '../../../data_import/parsers/pdf.parser';
import { parseXlsx } from '../../../data_import/parsers/xlsx.parser';
import {
  parseJalaliDate,
  toAsciiDigits,
} from '../../../data_import/normaliser/normalise';
import { BankCode } from '../../enums/banking.enum';
import { isValidIban, normaliseAccountNumber, normaliseIban } from '../iban';
import {
  bankFromIban,
  bankFromText,
  FIELD_SYNONYMS,
  matchLayout,
  normaliseHeader,
} from '../profiles/bank-profiles';
import { absBig, parseRial, sanitizeText } from '../rial';
import {
  ColumnMap,
  ParseOutcome,
  RowIssue,
  StatementField,
  StatementHeaderInfo,
  StatementRow,
  STATEMENT_FIELDS,
} from '../types';

export class StatementParseError extends Error {}

/** Uploads above this are refused before parsing (statement exports are small). */
export const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;
export const MAX_STATEMENT_ROWS = 20_000;

export interface ParsedFile {
  sha256: string;
  kind: 'csv' | 'xlsx' | 'pdf';
  /** Every non-empty row of the first sheet/page, title rows included. */
  grid: string[][];
}

/** Reads the file into a grid of cells without interpreting it (no row is dropped as a title). */
export function readGrid(
  buffer: Buffer,
  filename = '',
  mimetype = '',
): ParsedFile {
  if (buffer.length === 0) {
    throw new StatementParseError('فایل خالی است.');
  }
  if (buffer.length > MAX_STATEMENT_BYTES) {
    throw new StatementParseError('حجم فایل صورتحساب بیش از ۱۰ مگابایت است.');
  }
  const sniffed = sniffFileKind(buffer, filename, mimetype);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  let captured: string[][] = [];
  const capture = (rows: string[][]): number => {
    captured = rows.map((row) => row.map((cell) => String(cell ?? '')));
    return 0;
  };
  try {
    if (sniffed === 'xlsx') {
      parseXlsx(buffer, capture);
      return { sha256, kind: 'xlsx', grid: capped(captured) };
    }
    if (sniffed === 'pdf') {
      const table = parsePdf(buffer);
      return { sha256, kind: 'pdf', grid: capped([table.headers, ...table.rows]) };
    }
    if (sniffed === 'csv' || sniffed === 'unknown') {
      const text = looksBinary(buffer)
        ? ''
        : decodeText(buffer);
      if (!text.trim()) {
        throw new StatementParseError('نوع فایل پشتیبانی نمی‌شود (Excel، CSV یا PDF).');
      }
      parseCsv(text, MAX_STATEMENT_ROWS, capture);
      return { sha256, kind: 'csv', grid: capped(captured) };
    }
  } catch (error) {
    if (error instanceof StatementParseError) {
      throw error;
    }
    throw new StatementParseError(
      error instanceof Error && error.message
        ? error.message
        : 'فایل قابل خواندن نیست.',
    );
  }
  throw new StatementParseError('تصویر اسکن‌شده پشتیبانی نمی‌شود؛ فایل Excel، CSV یا PDF متنی بارگذاری کنید.');
}

function capped(grid: string[][]): string[][] {
  if (grid.length > MAX_STATEMENT_ROWS + 50) {
    throw new StatementParseError('تعداد سطرهای صورتحساب بیش از حد مجاز است.');
  }
  return grid;
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 512).includes(0);
}

function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le');
  }
  const utf8 = buffer.toString('utf8');
  // Windows-1256 exports decode to replacement characters under UTF-8.
  if (!utf8.includes('�')) {
    return utf8;
  }
  return new TextDecoder('windows-1256').decode(buffer);
}

// --------------------------------------------------------------------- header info

const ACCOUNT_LABEL = /(?:شماره\s*حساب|حساب\s*شماره|account\s*(?:no|number))\s*[:：]?\s*([\d\-./ ]{5,})/i;
const IBAN_LABEL = /(IR[\d\s\-]{24,34})/i;
const PERIOD = /از\s*(?:تاریخ)?\s*[:：]?\s*(\d{2,4}[/\-.]\d{1,2}[/\-.]\d{1,2})\s*(?:تا|الی)\s*(?:تاریخ)?\s*[:：]?\s*(\d{2,4}[/\-.]\d{1,2}[/\-.]\d{1,2})/;
const OPENING = /(?:مانده\s*(?:اول|ابتدای|از\s*قبل)(?:\s*دوره)?|مانده\s*قبل)\s*[:：]?\s*([-\d,٬.()]+)/;
const CLOSING = /(?:مانده\s*(?:پایان|انتهای|آخر)(?:\s*دوره)?|مانده\s*نهایی)\s*[:：]?\s*([-\d,٬.()]+)/;

export function extractHeaderInfo(rows: string[][]): StatementHeaderInfo {
  const info: StatementHeaderInfo = {
    bankCode: null,
    accountNumber: null,
    iban: null,
    periodFrom: null,
    periodTo: null,
    openingBalance: null,
    closingBalance: null,
  };
  for (const row of rows) {
    const line = sanitizeText(row.filter(Boolean).join(' '), 400);
    if (!line) {
      continue;
    }
    const iban = IBAN_LABEL.exec(line);
    if (!info.iban && iban) {
      info.iban = normaliseIban(iban[1]);
    }
    const account = ACCOUNT_LABEL.exec(line);
    if (!info.accountNumber && account) {
      info.accountNumber = normaliseAccountNumber(account[1]) || null;
    }
    const period = PERIOD.exec(line);
    if (!info.periodFrom && period) {
      info.periodFrom = parseJalaliDate(period[1]);
      info.periodTo = parseJalaliDate(period[2]);
    }
    const opening = OPENING.exec(line);
    if (info.openingBalance === null && opening) {
      const value = parseRial(opening[1]);
      info.openingBalance = value.kind === 'ok' ? value.value : null;
    }
    const closing = CLOSING.exec(line);
    if (info.closingBalance === null && closing) {
      const value = parseRial(closing[1]);
      info.closingBalance = value.kind === 'ok' ? value.value : null;
    }
    info.bankCode ??= bankFromText(line);
  }
  if (info.iban && !info.bankCode) {
    info.bankCode = bankFromIban(info.iban);
  }
  return info;
}

// --------------------------------------------------------------------- table

const HEADER_WORDS = new Set(
  Object.values(FIELD_SYNONYMS).flat().map(normaliseHeader),
);

/** First row (within 40) that looks like a table header: >= 3 known header words. */
export function findHeaderRow(grid: string[][]): number {
  const limit = Math.min(grid.length, 40);
  for (let index = 0; index < limit; index += 1) {
    const hits = grid[index].filter((cell) =>
      HEADER_WORDS.has(normaliseHeader(cell)),
    ).length;
    if (hits >= 3) {
      return index;
    }
  }
  return -1;
}

/** Best-effort mapping for a layout we do not know; always confirmed by the user. */
export function suggestColumnMap(headers: string[]): ColumnMap {
  const normal = headers.map(normaliseHeader);
  const map: ColumnMap = {};
  for (const field of STATEMENT_FIELDS) {
    const words = FIELD_SYNONYMS[field].map(normaliseHeader);
    const index = normal.findIndex(
      (header, position) =>
        words.includes(header) && !Object.values(map).includes(position),
    );
    if (index !== -1) {
      map[field] = index;
    }
  }
  return map;
}

/** A mapping can be used when it has a date, a balance-independent amount source and a description. */
export function validateColumnMap(map: ColumnMap, width: number): string | null {
  for (const [field, index] of Object.entries(map)) {
    if (!(STATEMENT_FIELDS as readonly string[]).includes(field)) {
      return `ستون ناشناخته: ${field}`;
    }
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= width) {
      return `شماره ستون «${field}» نامعتبر است.`;
    }
  }
  if (map.date === undefined) {
    return 'ستون تاریخ مشخص نشده است.';
  }
  if (map.amount === undefined && map.withdrawal === undefined && map.deposit === undefined) {
    return 'ستون مبلغ (برداشت/واریز یا مبلغ) مشخص نشده است.';
  }
  if (map.description === undefined) {
    return 'ستون شرح مشخص نشده است.';
  }
  const indexes = Object.values(map);
  if (new Set(indexes).size !== indexes.length) {
    return 'یک ستون به دو فیلد نگاشت شده است.';
  }
  return null;
}

const SAYAD = /(?<!\d)(\d{16})(?!\d)/;
const CHEQUE = /(?:چک|cheque|check)\s*(?:شماره|ش|no)?\s*[:：.]?\s*(\d{5,10})(?!\d)/i;
const OPENING_ROW = /مانده\s*(?:از\s*قبل|اول\s*دوره|ابتدای\s*دوره|قبل)/;

export function extractSayad(text: string): string | null {
  return SAYAD.exec(toAsciiDigits(text))?.[1] ?? null;
}

export function extractChequeNo(text: string): string | null {
  return CHEQUE.exec(toAsciiDigits(text))?.[1] ?? null;
}

function cell(row: string[], index: number | undefined): string {
  return index === undefined ? '' : sanitizeText(row[index] ?? '', 1000);
}

/** Turns table rows into statement rows. Direction (newest-first) is normalised to chronological. */
export function buildRows(
  dataRows: string[][],
  map: ColumnMap,
  firstRowNo: number,
): { rows: StatementRow[]; issues: RowIssue[]; openingFromRow: bigint | null; reversed: boolean } {
  const rows: StatementRow[] = [];
  const issues: RowIssue[] = [];
  let openingFromRow: bigint | null = null;

  dataRows.forEach((raw, offset) => {
    const rowNo = firstRowNo + offset;
    if (raw.every((value) => !String(value ?? '').trim())) {
      return;
    }
    const description = cell(raw, map.description);
    const balanceCell = parseRial(cell(raw, map.balance));
    if (OPENING_ROW.test(description) && balanceCell.kind === 'ok') {
      openingFromRow ??= balanceCell.value;
      return;
    }
    const date = parseJalaliDate(cell(raw, map.date));
    if (!date) {
      issues.push({ rowNo, message: 'تاریخ سطر معتبر نیست.' });
      return;
    }
    const withdrawalCell = parseRial(cell(raw, map.withdrawal));
    const depositCell = parseRial(cell(raw, map.deposit));
    const amountCell = parseRial(cell(raw, map.amount));
    if ([withdrawalCell, depositCell, amountCell, balanceCell].some((v) => v.kind === 'invalid')) {
      issues.push({ rowNo, message: 'مبلغ یا مانده سطر قابل تفسیر نیست.' });
      return;
    }
    let withdrawal = withdrawalCell.kind === 'ok' ? absBig(withdrawalCell.value) : 0n;
    let deposit = depositCell.kind === 'ok' ? absBig(depositCell.value) : 0n;
    if (withdrawal === 0n && deposit === 0n && amountCell.kind === 'ok') {
      if (amountCell.value < 0n) {
        withdrawal = -amountCell.value;
      } else {
        deposit = amountCell.value;
      }
    }
    if (withdrawal > 0n && deposit > 0n) {
      issues.push({ rowNo, message: 'سطر هم برداشت و هم واریز دارد.' });
      return;
    }
    if (withdrawal === 0n && deposit === 0n) {
      issues.push({ rowNo, message: 'سطر مبلغ ندارد (جمع یا مانده؟).' });
      return;
    }
    const time = cell(raw, map.time) || null;
    const reference = cell(raw, map.reference).slice(0, 64) || null;
    const chequeCol = cell(raw, map.chequeNo);
    rows.push({
      rowNo,
      date,
      time: time ? time.slice(0, 16) : null,
      description,
      withdrawal,
      deposit,
      balance: balanceCell.kind === 'ok' ? balanceCell.value : null,
      reference,
      chequeNo: (/^\d{5,10}$/.test(chequeCol) ? chequeCol : extractChequeNo(description)) ?? null,
      sayadId: extractSayad(`${chequeCol} ${description} ${reference ?? ''}`),
    });
  });

  const reversed = isNewestFirst(rows);
  if (reversed) {
    rows.reverse();
  }
  return { rows, issues, openingFromRow, reversed };
}

/**
 * Newest-first when the running balance only works backwards, or (without balances) when dates
 * strictly decrease down the file.
 */
export function isNewestFirst(rows: StatementRow[]): boolean {
  let forward = 0;
  let backward = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const a = rows[i - 1];
    const b = rows[i];
    if (a.balance !== null && b.balance !== null) {
      if (a.balance + b.deposit - b.withdrawal === b.balance) {
        forward += 1;
      }
      if (b.balance + a.deposit - a.withdrawal === a.balance) {
        backward += 1;
      }
    }
  }
  if (forward !== backward) {
    return backward > forward;
  }
  const first = rows[0]?.date;
  const last = rows[rows.length - 1]?.date;
  return Boolean(first && last && first > last);
}

/**
 * Parses a statement. A proven per-bank layout is applied automatically; anything else returns
 * `needs_mapping` unless the caller supplies a `columnMap` (the user's mapping step).
 */
export function parseStatement(
  file: ParsedFile,
  userMap?: ColumnMap,
): ParseOutcome {
  const headerIndex = findHeaderRow(file.grid);
  const header = extractHeaderInfo(
    file.grid.slice(0, headerIndex === -1 ? Math.min(file.grid.length, 15) : headerIndex),
  );
  if (headerIndex === -1) {
    return {
      status: 'needs_mapping',
      header,
      headers: file.grid[0] ?? [],
      suggestedMap: {},
      sampleRows: file.grid.slice(0, 5),
      reason: 'سطر عنوان ستون‌ها پیدا نشد.',
    };
  }
  const headers = file.grid[headerIndex].map((value) => sanitizeText(value, 80));
  const dataRows = file.grid.slice(headerIndex + 1);

  let map: ColumnMap | null = null;
  let layoutId = 'user-mapping';
  if (userMap) {
    const problem = validateColumnMap(userMap, headers.length);
    if (problem) {
      return {
        status: 'needs_mapping',
        header,
        headers,
        suggestedMap: userMap,
        sampleRows: dataRows.slice(0, 5),
        reason: problem,
      };
    }
    map = userMap;
  } else {
    const layout = matchLayout(headers);
    if (layout) {
      map = layout.map as ColumnMap;
      layoutId = layout.layout.id;
      header.bankCode ??= layout.profile.code;
      if (header.bankCode !== layout.profile.code) {
        // Title says one bank, columns say another: keep both facts for the prerequisite check.
        header.bankCode = header.bankCode as BankCode;
      }
    }
  }
  if (!map) {
    return {
      status: 'needs_mapping',
      header,
      headers,
      suggestedMap: suggestColumnMap(headers),
      sampleRows: dataRows.slice(0, 5),
      reason: 'چیدمان ستون‌ها در قالب‌های تأییدشده بانک‌ها نیست؛ ستون‌ها را مشخص کنید.',
    };
  }
  const built = buildRows(dataRows, map, 1);
  if (header.openingBalance === null && built.openingFromRow !== null) {
    header.openingBalance = built.openingFromRow;
  }
  return {
    status: 'parsed',
    layoutId,
    header,
    columnMap: map,
    rows: built.rows,
    issues: built.issues,
    reversed: built.reversed,
  };
}

export { isValidIban };
export type { StatementField };

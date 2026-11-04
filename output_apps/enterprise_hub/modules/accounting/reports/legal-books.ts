/**
 * Legal books (#249): the journal (دفتر روزنامه) and the general ledger (دفتر کل) as page-numbered
 * books. Pure: rows in, pages out, money as exact minor units (bigint).
 *
 * Layout follows Iranian bookkeeping convention, not a primary legal text (see the PR's owner
 * questions): every page carries the totals of the pages before it ("نقل از صفحه قبل") and ends with
 * the running totals ("نقل به صفحه بعد"), pages are numbered "n از N" across the whole book, and
 * rows run on without gaps. Each ledger account starts on a new page.
 */
import { ReportCell, ReportColumn, ReportRow, ReportTable } from './report-table';

export interface BookLine {
  /** Leading cells; debit, credit (and the balance for a ledger) are appended. */
  cells: ReportCell[];
  debit: bigint;
  credit: bigint;
}

export interface BookSection {
  /** Shown under the book title, e.g. the ledger account. */
  heading?: string;
  /** Ledger sections: the balance (debit minus credit) before the first line. */
  opening?: bigint;
  lines: BookLine[];
}

export interface Book {
  title: string;
  subtitle: string;
  /** Leading columns; the money columns are added here. */
  columns: ReportColumn[];
  /** A ledger shows a running balance; the journal only running totals. */
  withBalance: boolean;
  sections: BookSection[];
}

export class BookTooLargeError extends Error {}

const MONEY_COLUMNS: ReportColumn[] = [
  { title: 'بدهکار', money: true },
  { title: 'بستانکار', money: true },
];

const pageText = (page: number, pages: number): string =>
  `صفحه ${page} از ${pages}`.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * The book as pages of at most `rowsPerPage` rows, carry rows included. Pass the PDF writer's
 * `rowsPerPage` so no page breaks inside the writer. With `Infinity` each section is one page (XLSX).
 */
export function bookPages(book: Book, rowsPerPage: number): ReportTable[] {
  const linesPerPage = rowsPerPage - 2;
  if (linesPerPage < 1) {
    throw new BookTooLargeError('A page must hold at least one line between its carry rows.');
  }
  const columns = [...book.columns, ...MONEY_COLUMNS, ...(book.withBalance ? [{ title: 'مانده', money: true }] : [])];
  const blanks = book.columns.length - 1;
  const totalsRow = (label: string, debit: bigint | null, credit: bigint | null, balance: bigint): ReportRow => ({
    cells: [...Array<ReportCell>(blanks).fill(''), label, debit, credit, ...(book.withBalance ? [balance] : [])],
    bold: true,
  });

  const drafts: Array<{ heading?: string; rows: ReportRow[] }> = [];
  for (const section of book.sections) {
    const opening = section.opening ?? 0n;
    let debit = 0n;
    let credit = 0n;
    let balance = opening;
    let index = 0;
    do {
      const rows: ReportRow[] = [];
      if (index === 0) {
        if (book.withBalance) rows.push(totalsRow('مانده ابتدای دوره', null, null, opening));
      } else {
        rows.push(totalsRow('نقل از صفحه قبل', debit, credit, balance));
      }
      for (const line of section.lines.slice(index, index + linesPerPage)) {
        debit += line.debit;
        credit += line.credit;
        balance += line.debit - line.credit;
        rows.push({ cells: [...line.cells, line.debit, line.credit, ...(book.withBalance ? [balance] : [])] });
      }
      index += linesPerPage;
      const last = index >= section.lines.length;
      rows.push(
        totalsRow(last ? (book.withBalance ? 'جمع و مانده پایان دوره' : 'جمع کل') : 'جمع و نقل به صفحه بعد', debit, credit, balance),
      );
      drafts.push({ heading: section.heading, rows });
    } while (index < section.lines.length);
  }
  if (drafts.length === 0) {
    drafts.push({ rows: [totalsRow('جمع کل', 0n, 0n, 0n)] });
  }
  return drafts.map((draft, i) => ({
    title: book.title,
    subtitle: [draft.heading, book.subtitle, pageText(i + 1, drafts.length)].filter(Boolean).join('، '),
    columns,
    rows: draft.rows,
  }));
}

/** All pages as one sheet (XLSX keeps the section and carry rows, without page breaks). */
export function bookSheet(book: Book): ReportTable {
  const pages = bookPages(book, Number.POSITIVE_INFINITY);
  return {
    title: book.title,
    subtitle: book.subtitle,
    columns: pages[0].columns,
    rows: pages.flatMap((page, i) => [
      ...(book.sections[i]?.heading ? [{ cells: [book.sections[i].heading as string], bold: true }] : []),
      ...page.rows,
    ]),
  };
}

export interface JournalBookLine {
  entryNumber: string;
  /** YYYY-MM-DD. */
  day: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: bigint;
  credit: bigint;
}

/** The journal: every posted line in date and voucher order, numbered without gaps. */
export function journalBook(lines: JournalBookLine[], subtitle: string, jalali: (day: string) => string): Book {
  return {
    title: 'دفتر روزنامه',
    subtitle,
    withBalance: false,
    columns: [
      { title: 'ردیف', width: 0.5 },
      { title: 'تاریخ', width: 0.8 },
      { title: 'سند', width: 0.7 },
      { title: 'کد حساب', width: 0.7 },
      { title: 'نام حساب', width: 1.6 },
      { title: 'شرح', width: 2.2 },
    ],
    sections: [
      {
        lines: lines.map((line, i) => ({
          cells: [String(i + 1), jalali(line.day), line.entryNumber, line.accountCode, line.accountName, line.description],
          debit: line.debit,
          credit: line.credit,
        })),
      },
    ],
  };
}

export interface LedgerBookAccount {
  code: string;
  name: string;
  opening: bigint;
  /** Lines of the account and the accounts under it, in date order. */
  lines: Array<{ journalEntryId: number; entryNumber: string; day: string; description: string; debit: bigint; credit: bigint }>;
}

/**
 * The general ledger: one section per account, one row per voucher (the voucher's lines on the
 * account and its sub-accounts summed, debit and credit kept apart). Accounts with no opening and
 * no lines are left out.
 */
export function generalLedgerBook(accounts: LedgerBookAccount[], subtitle: string, jalali: (day: string) => string): Book {
  return {
    title: 'دفتر کل',
    subtitle,
    withBalance: true,
    columns: [
      { title: 'تاریخ', width: 0.8 },
      { title: 'سند', width: 0.7 },
      { title: 'شرح', width: 2.6 },
    ],
    sections: accounts
      .filter((account) => account.opening !== 0n || account.lines.length > 0)
      .map((account) => {
        const byEntry = new Map<number, BookLine>();
        for (const line of account.lines) {
          const row = byEntry.get(line.journalEntryId);
          if (row) {
            row.debit += line.debit;
            row.credit += line.credit;
          } else {
            byEntry.set(line.journalEntryId, {
              cells: [jalali(line.day), line.entryNumber, line.description],
              debit: line.debit,
              credit: line.credit,
            });
          }
        }
        return { heading: `حساب ${account.code} ${account.name}`, opening: account.opening, lines: [...byEntry.values()] };
      }),
  };
}

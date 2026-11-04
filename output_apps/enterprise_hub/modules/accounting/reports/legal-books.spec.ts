import { Book, bookPages, bookSheet, generalLedgerBook, journalBook, JournalBookLine } from './legal-books';
import { rowsPerPage, writePdfs } from './pdf-writer';

const day = (d: string) => d;
const pdfPageCount = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;

const journalLine = (n: number): JournalBookLine => ({
  entryNumber: `J${n}`,
  day: '2026-04-01',
  accountCode: n % 2 ? '1011' : '3010',
  accountName: n % 2 ? 'صندوق' : 'سرمایه',
  description: `ردیف ${n}`,
  debit: n % 2 ? 100n : 0n,
  credit: n % 2 ? 0n : 100n,
});

describe('bookPages', () => {
  it('carries the journal totals from page to page and numbers every page "n از N"', () => {
    const book = journalBook(Array.from({ length: 7 }, (_, i) => journalLine(i + 1)), 'از ۱۴۰۵/۱/۱', day);
    const pages = bookPages(book, 5); // 3 lines between the two carry rows
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.subtitle)).toEqual([
      'از ۱۴۰۵/۱/۱، صفحه ۱ از ۳',
      'از ۱۴۰۵/۱/۱، صفحه ۲ از ۳',
      'از ۱۴۰۵/۱/۱، صفحه ۳ از ۳',
    ]);
    const label = (row: { cells: unknown[] }) => row.cells[5];
    const money = (row: { cells: unknown[] }) => row.cells.slice(6);
    // Page 1: three lines, then the totals carried forward.
    expect(pages[0].rows.map(label)).toEqual(['ردیف 1', 'ردیف 2', 'ردیف 3', 'جمع و نقل به صفحه بعد']);
    expect(money(pages[0].rows[3])).toEqual([200n, 100n]);
    // Page 2 opens with the same totals brought forward, rows numbered on without a gap.
    expect(label(pages[1].rows[0])).toBe('نقل از صفحه قبل');
    expect(money(pages[1].rows[0])).toEqual([200n, 100n]);
    expect(pages[1].rows[1].cells[0]).toBe('4');
    // Last page ends with the book total: debit equals credit for a balanced journal.
    expect(pages[2].rows.at(-1)?.cells.slice(5)).toEqual(['جمع کل', 400n, 300n]);
    expect(pages.every((p) => p.rows.length <= 5)).toBe(true);
  });

  it('gives the ledger an opening balance, a running balance and a closing balance per account page', () => {
    const book = generalLedgerBook(
      [
        {
          code: '10',
          name: 'دارایی‌های جاری',
          opening: 1000n,
          lines: [
            { journalEntryId: 5, entryNumber: 'J05', day: '2026-05-01', description: 'فروش', debit: 300n, credit: 0n },
            { journalEntryId: 5, entryNumber: 'J05', day: '2026-05-01', description: 'فروش', debit: 0n, credit: 50n },
            { journalEntryId: 9, entryNumber: 'J09', day: '2026-10-01', description: 'وصول', debit: 0n, credit: 200n },
          ],
        },
        { code: '20', name: 'بدون گردش', opening: 0n, lines: [] },
        { code: '30', name: 'حقوق مالکانه', opening: -1000n, lines: [] },
      ],
      'دوره',
      day,
    );
    expect(book.sections.map((s) => s.heading)).toEqual(['حساب 10 دارایی‌های جاری', 'حساب 30 حقوق مالکانه']);
    const pages = bookPages(book, 10);
    expect(pages).toHaveLength(2); // each account on its own page; the idle account is left out
    expect(pages[0].rows.map((r) => r.cells)).toEqual([
      ['', '', 'مانده ابتدای دوره', null, null, 1000n],
      // One row per voucher: J05's two lines summed, debit and credit kept apart.
      ['2026-05-01', 'J05', 'فروش', 300n, 50n, 1250n],
      ['2026-10-01', 'J09', 'وصول', 0n, 200n, 1050n],
      ['', '', 'جمع و مانده پایان دوره', 300n, 250n, 1050n],
    ]);
    expect(pages[1].subtitle).toBe('حساب 30 حقوق مالکانه، دوره، صفحه ۲ از ۲');
    expect(pages[1].rows.at(-1)?.cells.at(-1)).toBe(-1000n);
  });

  it('prints an empty book as one page with zero totals, and puts the XLSX on one sheet', () => {
    const empty = journalBook([], 'دوره', day);
    expect(bookPages(empty, 20)).toHaveLength(1);
    const sheet = bookSheet(journalBook([journalLine(1), journalLine(2)], 'دوره', day));
    expect(sheet.rows.map((r) => r.cells[5])).toEqual(['ردیف 1', 'ردیف 2', 'جمع کل']);
  });

  it.each([[8], [6]])('fills a %i-column PDF page exactly, so the writer never breaks a book page itself', async (columns) => {
    const lines = Array.from({ length: 200 }, (_, i) => journalLine(i + 1));
    const book: Book = journalBook(lines, 'دوره', day);
    book.columns = book.columns.slice(0, columns - 2);
    for (const line of book.sections[0].lines) {
      line.cells = line.cells.slice(0, columns - 2);
    }
    const pages = bookPages(book, rowsPerPage(columns));
    expect(pages.every((p) => p.rows.length === rowsPerPage(columns) || p === pages.at(-1))).toBe(true);
    expect(pdfPageCount(await writePdfs(pages))).toBe(pages.length);
    // One row more per page and the writer would have to break pages on its own.
    const overfull = bookPages(book, rowsPerPage(columns) + 1);
    expect(pdfPageCount(await writePdfs(overfull))).toBeGreaterThan(overfull.length);
  });
});

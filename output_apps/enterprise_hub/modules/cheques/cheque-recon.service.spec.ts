import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ChequeReconService } from './services/cheque-recon.service';

const T = '11111111-1111-4111-8111-111111111111';
const BANK = 7;

type Ev = { id: number; chequeId: number; eventDate: string; journalEntryId: number | null; amount: string | null; toStatus: string; fromStatus: string | null };
type Chq = { id: number; direction: 'received' | 'issued'; chequeNumber: string; sayadNumber: string | null; partyName: string; amount: string };
type Book = { id: number; journalEntryId: number; debit: number; credit: number; matchedStatementLineId: number | null };
type Stmt = { id: number; txnDate: string; deposit: number; withdrawal: number; description: string | null; reference: string | null };

function build(events: Ev[], cheques: Chq[], books: Book[], stmts: Stmt[]) {
  const matched: Array<[number, number]> = [];
  const repo = {
    listClearingEvents: jest.fn(async () => events),
    findClearingEvent: jest.fn(async (_t: string, id: number) => events.find((e) => e.id === id) ?? null),
    findByIds: jest.fn(async (_t: string, ids: number[]) => cheques.filter((c) => ids.includes(c.id))),
  };
  const banking = {
    listBookLines: jest.fn(async () => books),
    listStatementLines: jest.fn(async () => stmts.filter((s) => !matched.some(([line]) => line === s.id))),
    manualMatch: jest.fn(async (_t: string, statementLineId: number, journalLineId: number) => {
      if (matched.some(([line]) => line === statementLineId)) throw new ConflictException('already matched');
      matched.push([statementLineId, journalLineId]);
      const book = books.find((b) => b.id === journalLineId)!;
      book.matchedStatementLineId = statementLineId;
      return {};
    }),
  };
  return { service: new ChequeReconService(repo as never, banking as never), banking, matched };
}

const ev = (id: number, chequeId: number, journalEntryId: number, date: string, amount = '100.00'): Ev => ({
  id, chequeId, eventDate: date, journalEntryId, amount, toStatus: 'cleared', fromStatus: 'deposited',
});
const rec: Chq = { id: 1, direction: 'received', chequeNumber: '555', sayadNumber: '1234567890123456', partyName: 'مشتری', amount: '100.00' };
const iss: Chq = { id: 2, direction: 'issued', chequeNumber: '777', sayadNumber: null, partyName: 'تأمین‌کننده', amount: '250.00' };

describe('ChequeReconService', () => {
  it('suggests the deposit line for a received clearing and the withdrawal line for an issued one', async () => {
    const t = build(
      [ev(1, 1, 11, '2026-11-02'), ev(2, 2, 12, '2026-11-03', '250.00')],
      [rec, iss],
      [
        { id: 101, journalEntryId: 11, debit: 100, credit: 0, matchedStatementLineId: null },
        { id: 102, journalEntryId: 12, debit: 0, credit: 250, matchedStatementLineId: null },
      ],
      [
        { id: 1, txnDate: '2026-11-03', deposit: 100, withdrawal: 0, description: 'چک 555', reference: 'r1' },
        { id: 2, txnDate: '2026-11-03', deposit: 0, withdrawal: 250, description: null, reference: null },
        { id: 3, txnDate: '2026-11-03', deposit: 250, withdrawal: 0, description: 'wrong direction', reference: null },
      ],
    );
    const { items, counts } = await t.service.suggest(T, { bankAccountId: BANK });
    expect(counts).toEqual({ reconciled: 0, suggested: 2, unmatched: 0, no_bank_line: 0 });
    expect(items.map((i) => i.candidates.map((c) => c.statementLineId))).toEqual([[1], [2]]);
  });

  it('respects the date window and reports unmatched when nothing fits', async () => {
    const t = build([ev(1, 1, 11, '2026-11-02')], [rec],
      [{ id: 101, journalEntryId: 11, debit: 100, credit: 0, matchedStatementLineId: null }],
      [{ id: 1, txnDate: '2026-11-20', deposit: 100, withdrawal: 0, description: null, reference: null }]);
    expect((await t.service.suggest(T, { bankAccountId: BANK })).items[0].state).toBe('unmatched');
    expect((await t.service.suggest(T, { bankAccountId: BANK, windowDays: 30 })).items[0].state).toBe('suggested');
  });

  it('marks a clearing posted to another ledger account as no_bank_line and an already matched one as reconciled', async () => {
    const t = build([ev(1, 1, 11, '2026-11-02'), ev(2, 2, 12, '2026-11-02', '250.00')], [rec, iss],
      [{ id: 102, journalEntryId: 12, debit: 0, credit: 250, matchedStatementLineId: 9 }], []);
    const { items } = await t.service.suggest(T, { bankAccountId: BANK });
    expect(items.map((i) => i.state)).toEqual(['no_bank_line', 'reconciled']);
    expect(items[1].matchedStatementLineId).toBe(9);
  });

  it('does not match a book line of the same entry with a different amount (partial payment vs. other line)', async () => {
    const t = build([ev(1, 1, 11, '2026-11-02', '40.00')], [rec],
      [{ id: 101, journalEntryId: 11, debit: 100, credit: 0, matchedStatementLineId: null }], []);
    expect((await t.service.suggest(T, { bankAccountId: BANK })).items[0].state).toBe('no_bank_line');
  });

  it('match() delegates to the banking module with the cheque entry\'s book line', async () => {
    const t = build([ev(1, 1, 11, '2026-11-02')], [rec],
      [{ id: 101, journalEntryId: 11, debit: 100, credit: 0, matchedStatementLineId: null }],
      [{ id: 1, txnDate: '2026-11-02', deposit: 100, withdrawal: 0, description: null, reference: null }]);
    const item = await t.service.match(T, { bankAccountId: BANK, eventId: 1, statementLineId: 1 });
    expect(t.banking.manualMatch).toHaveBeenCalledWith(T, 1, 101);
    expect(item.state).toBe('reconciled');
    await expect(t.service.match(T, { bankAccountId: BANK, eventId: 1, statementLineId: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('match() rejects unknown events and clearings with no bank line', async () => {
    const t = build([ev(1, 1, 11, '2026-11-02')], [rec], [], []);
    await expect(t.service.match(T, { bankAccountId: BANK, eventId: 99, statementLineId: 1 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.service.match(T, { bankAccountId: BANK, eventId: 1, statementLineId: 1 })).rejects.toBeInstanceOf(BadRequestException);
    expect(t.banking.manualMatch).not.toHaveBeenCalled();
  });

  it('applyUnambiguous matches single-candidate items and skips ones that compete for a line', async () => {
    const a = { ...rec, id: 1 };
    const b = { ...rec, id: 3, chequeNumber: '556' };
    const c = { ...rec, id: 4, chequeNumber: '557' };
    const t = build(
      [ev(1, 1, 11, '2026-11-02'), ev(2, 3, 12, '2026-11-02'), ev(3, 4, 13, '2026-11-02', '300.00')],
      [a, b, c],
      [
        { id: 101, journalEntryId: 11, debit: 100, credit: 0, matchedStatementLineId: null },
        { id: 102, journalEntryId: 12, debit: 100, credit: 0, matchedStatementLineId: null },
        { id: 103, journalEntryId: 13, debit: 300, credit: 0, matchedStatementLineId: null },
      ],
      [
        { id: 1, txnDate: '2026-11-02', deposit: 100, withdrawal: 0, description: null, reference: null }, // wanted by 2 items
        { id: 2, txnDate: '2026-11-02', deposit: 300, withdrawal: 0, description: null, reference: null },
      ],
    );
    expect(await t.service.applyUnambiguous(T, { bankAccountId: BANK })).toEqual({ matched: 1, skippedAmbiguous: 2, failed: 0 });
    expect(t.matched).toEqual([[2, 103]]);
  });

  it('is empty when no cheque has cleared', async () => {
    const t = build([], [], [], []);
    expect(await t.service.suggest(T, { bankAccountId: BANK })).toEqual({ items: [], counts: { reconciled: 0, suggested: 0, unmatched: 0, no_bank_line: 0 } });
  });
});

describe('ChequeReconService limits and failures', () => {
  it('reads book and statement lines once per call, limited to the events\' date range', async () => {
    const t = build([ev(1, 1, 11, '2026-11-02'), ev(2, 1, 12, '2026-11-09')], [rec], [], []);
    await t.service.suggest(T, { bankAccountId: BANK, windowDays: 3 });
    expect(t.banking.listBookLines).toHaveBeenCalledTimes(1);
    expect(t.banking.listBookLines).toHaveBeenCalledWith(T, BANK, { fromDate: '2026-11-02', toDate: '2026-11-09' });
    expect(t.banking.listStatementLines).toHaveBeenCalledWith(T, BANK, { status: 'unmatched', fromDate: '2026-10-30', toDate: '2026-11-12' });
  });

  it('applyUnambiguous counts a pair the banking module refuses and keeps going', async () => {
    const t = build(
      [ev(1, 1, 11, '2026-11-02'), ev(2, 3, 12, '2026-11-02', '300.00')],
      [rec, { ...rec, id: 3, chequeNumber: '9' }],
      [
        { id: 101, journalEntryId: 11, debit: 100, credit: 0, matchedStatementLineId: null },
        { id: 102, journalEntryId: 12, debit: 300, credit: 0, matchedStatementLineId: null },
      ],
      [
        { id: 1, txnDate: '2026-11-02', deposit: 100, withdrawal: 0, description: null, reference: null },
        { id: 2, txnDate: '2026-11-02', deposit: 300, withdrawal: 0, description: null, reference: null },
      ],
    );
    t.banking.manualMatch.mockRejectedValueOnce(new ConflictException('taken'));
    expect(await t.service.applyUnambiguous(T, { bankAccountId: BANK })).toEqual({ matched: 1, skippedAmbiguous: 0, failed: 1 });
  });
});
